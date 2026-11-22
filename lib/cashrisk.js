// Cash risk: how likely is the bank balance to drop below a minimum, and how much can we trust the forecast?
//
// Monte Carlo on top of the 13-week cash forecast (lib/forecast.js). Fixed costs, VAT and open supplier
// invoices are kept as in the forecast. What is uncertain is simulated from the company's own history:
//   - when each open customer invoice is paid: drawn from THAT customer's past days-late (12 months);
//     an overdue invoice is drawn from the customer's delays that are longer than it has already waited.
//   - how much is sold each future week: drawn from the last 26 weeks (bootstrap), rescaled so the average
//     equals the forecast's weekly sales; split in three batches, each paid after a days-to-pay drawn from
//     all customers' payments.
//   - how much is bought each future week: drawn the same way, paid as in the forecast.
// The balance is followed day by day, so a dip in the middle of a week (salary and VAT before customer
// payments arrive) counts, even if the balance is positive again by the end of the week.
//
// Backtest: the forecast of customer payments is rerun as of earlier dates and compared with the payments
// that actually came in, week by week. The simulation's 80 % interval should contain the actual ~80 % of
// the time (calibration).
import { analyze } from "./analyze.js";
import { forecast } from "./forecast.js";
import { rng, quantile, mean, sum, round } from "./stats.js";
import { tr, kr, pct, dayMonth as da } from "./i18n.js";

const DAY = 86400000;
const t = (d) => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// "9 dage før forfald", "på forfaldsdagen", "mellem 3 og 12 dage efter forfald".
const relDue = (d) => (d === 0 ? tr("på forfaldsdagen", "on the due date") : d < 0 ? tr(`${-d} dage før forfald`, `${-d} days before the due date`) : tr(`${d} dage efter forfald`, `${d} days after the due date`));
const rangeDue = (lo, hi) => (lo === hi ? relDue(lo)
  : lo >= 0 ? tr(`mellem ${lo} og ${hi} dage efter forfald`, `between ${lo} and ${hi} days after the due date`)
  : hi <= 0 ? tr(`mellem ${-hi} og ${-lo} dage før forfald`, `between ${-hi} and ${-lo} days before the due date`)
  : tr(`mellem ${-lo} dage før og ${hi} dage efter forfald`, `between ${-lo} days before and ${hi} days after the due date`));

// What the simulation draws from, as of the analysis date.
function history(data, analysis) {
  const asOf = t(analysis.asOf);
  const paid = analysis._invoices.filter((i) => i.paidDate && t(i.paidDate) > asOf - 365 * DAY);
  const delays = new Map();
  const names = new Map(data.customers.map((c) => [c.number, c.name]));
  for (const i of paid) {
    const name = names.get(i.customer) || tr(`Kunde ${i.customer}`, `Customer ${i.customer}`);
    if (!delays.has(name)) delays.set(name, []);
    delays.get(name).push(i.daysLate);
  }
  const allDelays = paid.map((i) => i.daysLate);
  const daysToPay = paid.map((i) => i.daysToPay);
  const weekly = (items, f) => Array.from({ length: 26 }, (_, k) => {
    const to = asOf - k * 7 * DAY, from = to - 7 * DAY;
    return sum(items.filter((x) => t(x.date) > from && t(x.date) <= to), f);
  });
  const sales = weekly(data.invoices, (i) => i.amount);
  const purchases = weekly(data.entries.filter((e) => e.type === "supplierInvoice"), (e) => Math.abs(e.amount));
  return { delays, allDelays, daysToPay, sales, purchases };
}

// Keep the week-to-week variation of the history, but at the forecast's level.
const rescale = (xs, level) => { const m = mean(xs); return m > 0 ? xs.map((x) => (x * level) / m) : xs.map(() => level); };

// Lowest balance of a fixed list of events, day by day.
function lowestDaily(start, events, minimum) {
  let bal = start, low = start, when = null, breach = null;
  for (const e of [...events].sort((a, b) => a.date - b.date)) {
    bal += e.amount;
    if (bal < low) { low = bal; when = e.date; }
    if (breach == null && bal < minimum) breach = e.date;
  }
  return { low, when, breach };
}

function simulateCustomerEvents(r, model, analysis, hist) {
  const asOf = model.asOf, ev = [];
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  for (const inv of analysis.openInvoices) {
    const own = hist.delays.get(inv.customer);
    const pool = own && own.length >= 5 ? own : hist.allDelays;
    const waited = Math.max(0, inv.daysOverdue ?? 0);
    const longer = pool.filter((d) => d > waited);
    // Already later than this customer has ever been: assume payment in 3–20 days.
    const late = longer.length ? pick(longer) : waited + 3 + Math.floor(r() * 18);
    ev.push({ date: Math.max(t(inv.dueDate) + late * DAY, asOf + DAY), amount: inv.open, kind: "kunder_kendte" });
  }
  for (let w = 0; w < model.weeks; w++) {
    const weekStart = asOf + DAY + w * 7 * DAY;
    const total = pick(hist.sales);
    for (let k = 0; k < 3; k++) {
      ev.push({ date: weekStart + Math.floor(r() * 5) * DAY + pick(hist.daysToPay) * DAY, amount: total / 3, kind: "kunder_forventede" });
    }
  }
  return ev;
}

function simulate(data, analysis, base, { paths = 2000, seed = 20261121 } = {}) {
  const model = base._model;
  const hist = history(data, analysis);
  hist.sales = rescale(hist.sales, model.weeklySales);
  hist.purchases = rescale(hist.purchases, model.weeklyPurchases);
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const fixedEvents = model.events.filter((e) => e.kind !== "kunder_kendte" && e.kind !== "kunder_forventede" && !e.newPurchase);
  const purchaseEvents = model.events.filter((e) => e.newPurchase);
  const weeks = model.weeks;
  const ends = Array.from({ length: weeks }, () => []);
  const weekMins = Array.from({ length: weeks }, () => []);
  const inflows = Array.from({ length: weeks }, () => []);
  const lowest = [], firstBreach = [];
  for (let p = 0; p < paths; p++) {
    const ev = [
      ...fixedEvents,
      ...purchaseEvents.map((e) => ({ ...e, amount: -pick(hist.purchases) })),
      ...simulateCustomerEvents(r, model, analysis, hist),
    ].filter((e) => e.date > model.asOf && e.date < model.end).sort((a, b) => a.date - b.date);
    let bal = model.start, low = Infinity, breach = null, i = 0;
    for (let w = 0; w < weeks; w++) {
      const to = model.asOf + DAY + (w + 1) * 7 * DAY;
      let wMin = bal, inflow = 0;
      for (; i < ev.length && ev[i].date < to; i++) {
        bal += ev[i].amount;
        if (ev[i].kind === "kunder_kendte" || ev[i].kind === "kunder_forventede") inflow += ev[i].amount;
        if (bal < wMin) wMin = bal;
      }
      ends[w].push(bal);
      weekMins[w].push(wMin);
      inflows[w].push(inflow);
      if (wMin < low) low = wMin;
      if (breach == null && wMin < model.minimum) breach = w;
    }
    lowest.push(low);
    firstBreach.push(breach);
  }
  return { model, hist, ends, weekMins, inflows, lowest, firstBreach, paths };
}

// Rerun the forecast of customer payments as of earlier dates and compare with what actually came in.
function backtest(data, asOfIso, { origins = 8, step = 4, horizon = 13, paths = 400 } = {}) {
  const asOf = t(asOfIso);
  const payments = data.entries.filter((e) => e.type === "customerPayment");
  const rows = [];
  let inside = 0, checked = 0;
  for (let k = 0; k < origins; k++) {
    const origin = asOf - (horizon + k * step) * 7 * DAY;
    const a = analyze(data, iso(origin));
    if (a.asOf !== iso(origin) || a._invoices.filter((i) => i.paidDate).length < 30) continue;
    const f = forecast(data, a, { weeks: horizon });
    const sim = simulate(data, a, f, { paths, seed: 7 + k });
    for (let w = 0; w < horizon; w++) {
      const from = origin + DAY + w * 7 * DAY, to = from + 7 * DAY;
      const actual = sum(payments.filter((e) => t(e.date) >= from && t(e.date) < to), (e) => Math.abs(e.amount));
      const row = f.ugeplan[w];
      const predicted = row.ind_kunder_kendte + row.ind_kunder_forventede;
      const lo = quantile(sim.inflows[w], 0.1), hi = quantile(sim.inflows[w], 0.9);
      checked++;
      if (actual >= lo && actual <= hi) inside++;
      rows.push({ origin: iso(origin), week: w + 1, actual, predicted });
    }
  }
  if (!rows.length) return null;
  const bucket = (lo, hi, label) => {
    const xs = rows.filter((r) => r.week >= lo && r.week <= hi);
    const wape = sum(xs, (r) => Math.abs(r.predicted - r.actual)) / sum(xs, (r) => r.actual);
    const bias = sum(xs, (r) => r.predicted - r.actual) / sum(xs, (r) => r.actual);
    return { horisont: label, wape: round(wape, 4), bias: round(bias, 4), uger_målt: xs.length };
  };
  // Error on the total over 4 and 13 weeks, which matters more for the balance than single weeks.
  const totalErr = (weeks) => {
    const byOrigin = new Map();
    for (const r of rows.filter((x) => x.week <= weeks)) {
      const o = byOrigin.get(r.origin) || { a: 0, p: 0 };
      o.a += r.actual; o.p += r.predicted; byOrigin.set(r.origin, o);
    }
    const xs = [...byOrigin.values()];
    return { mae_kr: round(mean(xs.map((o) => Math.abs(o.p - o.a))), 0), wape: round(sum(xs, (o) => Math.abs(o.p - o.a)) / sum(xs, (o) => o.a), 4) };
  };
  return {
    oprindelser: [...new Set(rows.map((r) => r.origin))],
    pr_horisont: [bucket(1, 1, "uge 1"), bucket(2, 4, "uge 2–4"), bucket(5, 13, "uge 5–13")],
    samlet_4_uger: totalErr(4),
    samlet_13_uger: totalErr(13),
    dækning_80_interval: round(inside / checked, 3),
  };
}

export function cashRisk(data, analysis, { weeks = 13, minimum = 0, paths = 2000 } = {}) {
  const base = forecast(data, analysis, { weeks, minimum });
  const sim = simulate(data, analysis, base, { paths });
  const { model } = sim;
  const n = sim.paths;
  const breaches = sim.firstBreach.filter((b) => b != null);
  const pBreach = breaches.length / n;

  const perWeek = base.ugeplan.map((row, w) => ({
    uge: row.uge, fra: row.fra,
    prognose: row.slut,
    p10: round(quantile(sim.ends[w], 0.1), 0),
    median: round(quantile(sim.ends[w], 0.5), 0),
    p90: round(quantile(sim.ends[w], 0.9), 0),
    risiko_under_minimum: round(sim.weekMins[w].filter((x) => x < minimum).length / n, 3),
  }));
  const riskiest = perWeek.reduce((m, r) => (r.risiko_under_minimum > m.risiko_under_minimum ? r : m), perWeek[0]);
  const shortfalls = sim.lowest.filter((x) => x < minimum).map((x) => minimum - x);
  const fixedDaily = lowestDaily(model.start, model.events.filter((e) => e.date > model.asOf && e.date < model.end), minimum);

  // Which open invoices make the result most uncertain: amount × spread in the customer's payment habit.
  const spread = analysis.openInvoices.map((inv) => {
    const d = sim.hist.delays.get(inv.customer) || sim.hist.allDelays;
    return { ...inv, lo: quantile(d, 0.1), hi: quantile(d, 0.9), weight: inv.open * ((quantile(d, 0.9) - quantile(d, 0.1)) || 1) };
  });
  const byCustomer = new Map();
  for (const s of spread) {
    const c = byCustomer.get(s.customer) || { kunde: s.customer, ubetalt: 0, weight: 0, lo: s.lo, hi: s.hi, fakturaer: 0 };
    c.ubetalt += s.open; c.weight += s.weight; c.fakturaer++;
    byCustomer.set(s.customer, c);
  }
  const uncertain = [...byCustomer.values()].sort((a, b) => b.weight - a.weight).slice(0, 3).map((c) => ({
    kunde: c.kunde, ubetalt: round(c.ubetalt, 0), fakturaer: c.fakturaer,
    betaler_normalt_dage_efter_forfald: [round(c.lo, 0), round(c.hi, 0)],
  }));

  const bt = backtest(data, analysis.asOf, { horizon: weeks });

  const fund = [];
  const lowP = (q) => round(quantile(sim.lowest, q), 0);
  if (pBreach >= 0.005) {
    const mostLikely = [...breaches.reduce((m, b) => m.set(b, (m.get(b) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0];
    const wk = perWeek[mostLikely];
    fund.push(tr(`Der er ${pct(pBreach)} risiko for, at saldoen kommer under ${kr(minimum)} inden for ${weeks} uger. Den mest sandsynlige uge er uge ${wk.uge} (fra ${da(t(wk.fra))}).`,
      `There is a ${pct(pBreach)} risk that the balance drops below ${kr(minimum)} within ${weeks} weeks. The most likely week is week ${wk.uge} (from ${da(t(wk.fra))}).`));
    fund.push(tr(`Går det galt, mangler der i snit ${kr(mean(shortfalls))}. I de 10 % værste forløb mangler der mindst ${kr(quantile(shortfalls.concat(Array(n - shortfalls.length).fill(0)), 0.9))}.`,
      `If it goes wrong, the average shortfall is ${kr(mean(shortfalls))}. In the worst 10% of paths the shortfall is at least ${kr(quantile(shortfalls.concat(Array(n - shortfalls.length).fill(0)), 0.9))}.`));
  } else {
    fund.push(tr(`Saldoen kommer under ${kr(minimum)} i færre end 1 % af de simulerede forløb de næste ${weeks} uger.`, `The balance drops below ${kr(minimum)} in fewer than 1% of the simulated paths over the next ${weeks} weeks.`));
  }
  fund.push(tr(`Laveste saldo i perioden, dag for dag: 50 % sandsynlighed for under ${kr(lowP(0.5))}, 10 % for under ${kr(lowP(0.1))}. Den faste prognose siger ${kr(fixedDaily.low)}${fixedDaily.when ? ` (${da(fixedDaily.when)})` : ""}.`,
    `Lowest balance in the period, day by day: 50% probability of below ${kr(lowP(0.5))}, 10% of below ${kr(lowP(0.1))}. The point forecast says ${kr(fixedDaily.low)}${fixedDaily.when ? ` (${da(fixedDaily.when)})` : ""}.`));
  if (fixedDaily.low < base.laveste.saldo - 1000) fund.push(tr(`Den faste prognose ser kun på saldoen ved ugens slutning (laveste ${kr(base.laveste.saldo)}). Midt i ugen kan den være lavere, fordi løn, husleje og moms bliver trukket, før kundernes betalinger kommer ind.`,
    `The point forecast only looks at the balance at the end of each week (lowest ${kr(base.laveste.saldo)}). Mid-week it can be lower, because salaries, rent and VAT are paid before customer payments come in.`));
  if (riskiest.risiko_under_minimum > 0) fund.push(tr(`Uge ${riskiest.uge} er den mest udsatte uge: ${pct(riskiest.risiko_under_minimum)} risiko og en saldo mellem ${kr(riskiest.p10)} og ${kr(riskiest.p90)} (80 %-interval) ved ugens slutning.`,
    `Week ${riskiest.uge} is the most exposed week: ${pct(riskiest.risiko_under_minimum)} risk and a balance between ${kr(riskiest.p10)} and ${kr(riskiest.p90)} (80% interval) at the end of the week.`));
  if (uncertain[0]) fund.push(tr(`Mest usikkerhed skaber ${uncertain[0].kunde}: ${kr(uncertain[0].ubetalt)} ubetalt, og de betaler normalt ${rangeDue(...uncertain[0].betaler_normalt_dage_efter_forfald)}.`,
    `${uncertain[0].kunde} creates the most uncertainty: ${kr(uncertain[0].ubetalt)} unpaid, and they normally pay ${rangeDue(...uncertain[0].betaler_normalt_dage_efter_forfald)}.`));
  const paidCount = sim.hist.allDelays.length;
  if (paidCount < 30) fund.push(tr(`Der er kun ${paidCount} betalte kundefakturaer det seneste år at simulere ud fra, så sandsynlighederne er selv meget usikre. Brug dem som en grov retning.`,
    `There are only ${paidCount} paid customer invoices in the last year to simulate from, so the probabilities are themselves very uncertain. Use them as a rough guide.`));
  if (bt) {
    const [w1, w24, w513] = bt.pr_horisont;
    fund.push(tr(`Træfsikkerhed: prognosen for kundeindbetalinger ramte i backtesten ${pct(w1.wape)} ved siden af for næste uge, ${pct(w24.wape)} for uge 2–4 og ${pct(w513.wape)} for uge 5–13. Over 4 uger samlet ${pct(bt.samlet_4_uger.wape)}.`,
      `Accuracy: in the backtest the forecast of customer payments missed by ${pct(w1.wape)} for the next week, ${pct(w24.wape)} for weeks 2–4 and ${pct(w513.wape)} for weeks 5–13. Over 4 weeks in total ${pct(bt.samlet_4_uger.wape)}.`));
    const cov = bt.dækning_80_interval;
    fund.push(cov >= 0.7 && cov <= 0.9
      ? tr(`Simulationens 80 %-intervaller ramte det faktiske i ${pct(cov)} af ugerne, så usikkerheden er godt kalibreret.`, `The simulation's 80% intervals contained the actual value in ${pct(cov)} of the weeks, so the uncertainty is well calibrated.`)
      : tr(`Simulationens 80 %-intervaller ramte det faktiske i ${pct(cov)} af ugerne, så usikkerheden er ${cov < 0.7 ? "undervurderet: tag intervallerne som for smalle" : "overvurderet: intervallerne er for brede"}.`,
        `The simulation's 80% intervals contained the actual value in ${pct(cov)} of the weeks, so the uncertainty is ${cov < 0.7 ? "underestimated: treat the intervals as too narrow" : "overestimated: the intervals are too wide"}.`));
  }

  return {
    opgjort_pr: analysis.asOf,
    uger: weeks,
    minimum,
    simulerede_forløb: n,
    sandsynlighed_under_minimum: round(pBreach, 3),
    laveste_saldo_dagsniveau: { p5: lowP(0.05), p10: lowP(0.1), median: lowP(0.5), p90: lowP(0.9), fast_prognose: round(fixedDaily.low, 0), fast_prognose_dato: fixedDaily.when ? iso(fixedDaily.when) : null },
    manglende_beløb_hvis_under: shortfalls.length ? { gennemsnit: round(mean(shortfalls), 0), p90: round(quantile(shortfalls, 0.9), 0) } : null,
    ugevis: perWeek,
    største_usikkerhed: uncertain,
    træfsikkerhed: bt,
    fund: fund.map((f) => f.replace(/kr\.\./g, "kr.")),
    metode: tr("Monte Carlo med " + n + " forløb oven på den faste likviditetsprognose. Løn, husleje, moms og åbne leverandørfakturaer er som i prognosen. Hvornår hver åben kundefaktura bliver betalt, trækkes fra den kundes egne forsinkelser det seneste år (en faktura, der allerede er forfalden, kun fra forsinkelser længere end den har ventet). Nyt salg og nye indkøb pr. uge trækkes fra de seneste 26 uger. Fordi salget spredes over ugen og betalingstiderne trækkes fra hele fordelingen, kommer pengene typisk lidt senere end i den faste prognose, som bruger gennemsnit. Træfsikkerheden er målt ved at køre prognosen for kundeindbetalinger pr. tidligere datoer og sammenligne med de indbetalinger, der faktisk kom.",
      "Monte Carlo with " + n + " paths on top of the point cash forecast. Salaries, rent, VAT and open supplier invoices are as in the forecast. When each open customer invoice is paid is drawn from that customer's own delays in the last year (an invoice that is already overdue only from delays longer than it has waited). New sales and purchases per week are drawn from the last 26 weeks. Because sales are spread over the week and payment times are drawn from the whole distribution, the money typically arrives a little later than in the point forecast, which uses averages. Accuracy is measured by running the forecast of customer payments as of earlier dates and comparing with the payments that actually came in."),
    forklaring: {
      p10_p90: tr("80 % af de simulerede forløb ligger mellem p10 og p90 (saldo ved ugens slutning).", "80% of the simulated paths lie between p10 and p90 (balance at the end of the week)."),
      risiko_under_minimum: tr("Andel af forløbene, hvor saldoen på et tidspunkt i ugen er under minimum.", "Share of paths where the balance is below the minimum at some point during the week."),
      wape: tr("Fejl i procent af de faktiske indbetalinger.", "Error as a percentage of actual payments received."),
      bias: tr("Positiv = prognosen ventede flere indbetalinger, end der kom.", "Positive = the forecast expected more payments than came in."),
      dækning_80_interval: tr("Andel af ugerne i backtesten, hvor de faktiske indbetalinger lå i simulationens 80 %-interval. Tæt på 0,8 er godt.", "Share of backtest weeks where actual payments were within the simulation's 80% interval. Close to 0.8 is good."),
    },
  };
}
