// Statistical tests on the freight data: are the differences real, or could they be chance?
//
// - On-time share per carrier with a 95 % Wilson interval; chi-square test that the carriers differ;
//   each carrier against the best one with a two-proportion test (Holm-adjusted p-values).
// - Returns: logistic regression of "returned" on how late the parcel was, adjusted for product category.
//   Gives the odds ratio for 1, 2 and 3+ days late with 95 % intervals.
// - Reviews: Welch t-test of the stars for late vs on-time parcels.
// - Control chart (p-chart) of each carrier's weekly on-time share for the last 26 weeks, flagging
//   weeks outside the 3-sigma limits and runs of 8 weeks below the average.
import { wilson, chiSquare, twoProportionTest, holm, logistic, welch, pChart, round } from "../stats.js";
import { tr, pct as pctFmt, num } from "../i18n.js";

const DAY = 86400000;
const pct = (x, d = 0) => pctFmt(x, d);
const pFmt = (p) => (p < 0.001 ? tr("p < 0,001", "p < 0.001") : `p = ${num(p, 3)}`);
const DELAY_EN = { "1 dag for sent": "1 day", "2 dage for sent": "2 days", "3+ dage for sent": "3+ days" };
const weekStart = (ms) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; return ms - day * DAY; };
const isoWeek = (ms) => {
  const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThu) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
};

export function fragtStats(f) {
  const rows = f._rows || [];
  const names = Object.fromEntries(f.carriers.map((c) => [c.code, c.name]));
  if (rows.length < 50) {
    return { tilstrækkelige_data: false, pakker: rows.length, fund: [tr(`Der er kun ${rows.length} leverede pakker. De statistiske tests kræver mindst 50.`, `There are only ${rows.length} delivered parcels. The statistical tests need at least 50.`)] };
  }

  // ---- On time per carrier ----
  const carriers = f.carriers.map((c) => {
    const g = rows.filter((r) => r.carrier === c.code);
    const k = g.filter((r) => r.lateDays === 0).length;
    const [lo, hi] = wilson(k, g.length);
    return { code: c.code, name: c.name, n: g.length, k, share: k / g.length, lo, hi };
  }).filter((c) => c.n >= 20);
  const best = [...carriers].sort((a, b) => b.share - a.share)[0];
  const chi = carriers.length >= 2 ? chiSquare(carriers.map((c) => [c.k, c.n - c.k])) : null;
  const others = carriers.filter((c) => c !== best);
  const rawP = others.map((c) => twoProportionTest(best.k, best.n, c.k, c.n).p);
  const adjP = holm(rawP);
  const vsBest = others.map((c, i) => ({
    fragtfirma: c.name, forskel_procentpoint: round((best.share - c.share) * 100, 1), p_værdi_holm: round(adjP[i], 4), sikker_forskel: adjP[i] < 0.05,
  }));

  // ---- Returns: logistic regression ----
  const cats = [...new Set(rows.map((r) => r.category))];
  const baseCat = cats.sort((a, b) => rows.filter((r) => r.category === b).length - rows.filter((r) => r.category === a).length)[0];
  const otherCats = cats.filter((c) => c !== baseCat);
  const X = rows.map((r) => [r.bucket === 1 ? 1 : 0, r.bucket === 2 ? 1 : 0, r.bucket === 3 ? 1 : 0, ...otherCats.map((c) => (r.category === c ? 1 : 0))]);
  const y = rows.map((r) => (r.returned ? 1 : 0));
  const lr = rows.some((r) => r.bucket > 0) ? logistic(X, y, ["1 dag for sent", "2 dage for sent", "3+ dage for sent", ...otherCats.map((c) => "kategori: " + c)]) : null;
  const delayOR = lr ? lr.slice(1, 4).map((c) => ({
    levering: c.name, odds_ratio: round(c.oddsRatio, 2), interval_95: [round(c.ci[0], 2), round(c.ci[1], 2)], p_værdi: round(c.p, 4), sikker_effekt: c.p < 0.05,
  })) : [];

  // ---- Reviews ----
  const starsOn = rows.filter((r) => r.lateDays === 0 && r.stars != null).map((r) => r.stars);
  const starsLate = rows.filter((r) => r.lateDays > 0 && r.stars != null).map((r) => r.stars);
  const w = welch(starsLate, starsOn);

  // ---- Control charts, last 26 weeks (only weeks that are fully past) ----
  const lastShip = Math.max(...rows.map((r) => r.shipDay));
  const lastWeek = weekStart(lastShip) - 7 * DAY;
  const weeks = Array.from({ length: 26 }, (_, i) => lastWeek - (25 - i) * 7 * DAY);
  const control = carriers.map((c) => {
    const periods = weeks.map((ws) => {
      const g = rows.filter((r) => r.carrier === c.code && r.shipDay >= ws && r.shipDay < ws + 7 * DAY);
      return { uge: isoWeek(ws), fra: new Date(ws).toISOString().slice(0, 10), n: g.length, k: g.filter((r) => r.lateDays === 0).length };
    }).filter((p) => p.n >= 10);
    const chart = pChart(periods);
    if (!chart) return null;
    return {
      fragtfirma: c.name,
      gennemsnit: round(chart.centre, 3),
      uger: chart.points.map((p) => ({ uge: p.uge, fra: p.fra, pakker: p.n, til_tiden: round(p.share, 3), nedre_grænse: round(p.lcl, 3), øvre_grænse: round(p.ucl, 3) })),
      signaler: chart.signals.map((s) => ({ uge: chart.points[s.index].uge, fra: chart.points[s.index].fra, regel: s.rule, til_tiden: round(chart.points[s.index].share, 3) })),
    };
  }).filter(Boolean);
  const recentFrom = new Date(lastWeek - 7 * 7 * DAY).toISOString().slice(0, 10);

  // ---- Findings ----
  const fund = [];
  if (chi) {
    fund.push(chi.p < 0.05
      ? tr(`Forskellen i leveringspræcision mellem fragtfirmaerne er statistisk sikker (chi²-test, ${pFmt(chi.p)}). ${best.name} er bedst med ${pct(best.share, 1)} til tiden (95 %-interval ${pct(best.lo, 1)}–${pct(best.hi, 1)}).`,
        `The difference in delivery precision between carriers is statistically significant (chi² test, ${pFmt(chi.p)}). ${best.name} is best with ${pct(best.share, 1)} on time (95% interval ${pct(best.lo, 1)}–${pct(best.hi, 1)}).`)
      : tr(`Forskellene i leveringspræcision mellem fragtfirmaerne kan skyldes tilfældigheder (chi²-test, ${pFmt(chi.p)}).`, `The differences in delivery precision between carriers may be due to chance (chi² test, ${pFmt(chi.p)}).`));
  }
  const notSure = vsBest.filter((v) => !v.sikker_forskel);
  if (chi && chi.p < 0.05 && notSure.length) fund.push(tr(`${notSure.map((v) => v.fragtfirma).join(" og ")} kan ikke skelnes sikkert fra ${best.name} med de data, der er.`, `${notSure.map((v) => v.fragtfirma).join(" and ")} cannot be reliably told apart from ${best.name} with the data available.`));
  const sig = delayOR.filter((d) => d.sikker_effekt);
  if (sig.length) {
    const d = sig[0];
    fund.push(tr(`Forsinkelser giver flere returneringer, også når produktkategori er holdt fast: ved ${d.levering.replace(" for sent", "")} forsinkelse er oddsene for returnering ${num(d.odds_ratio, 2)} gange så høje (95 %-interval ${d.interval_95.map((x) => num(x, 2)).join("–")}).`,
      `Delays cause more returns, even with product category held fixed: at ${DELAY_EN[d.levering] ?? d.levering} late, the odds of a return are ${num(d.odds_ratio, 2)} times as high (95% interval ${d.interval_95.map((x) => num(x, 2)).join("–")}).`));
  } else if (delayOR.length) {
    fund.push(tr("Der er ingen statistisk sikker sammenhæng mellem forsinkelse og returneringer i disse data.", "There is no statistically significant link between delay and returns in this data."));
  }
  if (w) {
    fund.push(w.p < 0.05
      ? tr(`Forsinkede pakker får ${num(Math.abs(w.diff), 2)} stjerner ${w.diff < 0 ? "færre" : "flere"} i snit (95 %-interval ${num(Math.abs(w.ci[1]), 2)}–${num(Math.abs(w.ci[0]), 2)}, ${pFmt(w.p)}).`,
        `Late parcels get ${num(Math.abs(w.diff), 2)} ${w.diff < 0 ? "fewer" : "more"} stars on average (95% interval ${num(Math.abs(w.ci[1]), 2)}–${num(Math.abs(w.ci[0]), 2)}, ${pFmt(w.p)}).`)
      : tr(`Der er ingen statistisk sikker forskel i stjerner mellem forsinkede pakker og pakker til tiden (${pFmt(w.p)}).`, `There is no statistically significant difference in stars between late parcels and parcels on time (${pFmt(w.p)}).`));
  }
  const recentSignals = control.flatMap((c) => c.signaler.filter((s) => s.fra >= recentFrom).map((s) => ({ ...s, fragtfirma: c.fragtfirma })));
  if (recentSignals.length) {
    const s = recentSignals.sort((a, b) => (a.fra < b.fra ? 1 : -1))[0];
    fund.push(tr(`Kontrolkort: ${s.fragtfirma} i uge ${s.uge} (${pct(s.til_tiden)} til tiden) er ${s.regel}. Ugen afviger mere, end tilfældig variation normalt kan forklare, så det er værd at undersøge.`,
      `Control chart: ${s.fragtfirma} in week ${s.uge} (${pct(s.til_tiden)} on time) is ${s.regel}. The week deviates more than chance normally explains, so it is worth looking into.`));
  } else if (control.length) {
    fund.push(tr("Kontrolkort: ingen fragtfirmaer har haft en usædvanlig dårlig uge de seneste 8 uger.", "Control chart: no carrier has had an unusually bad week in the last 8 weeks."));
  }

  return {
    tilstrækkelige_data: true,
    pakker: rows.length,
    til_tiden: {
      fragtfirmaer: carriers.map((c) => ({ fragtfirma: c.name, pakker: c.n, andel: round(c.share, 4), interval_95: [round(c.lo, 4), round(c.hi, 4)] })),
      chi2_test: chi ? { chi2: round(chi.stat, 1), frihedsgrader: chi.df, p_værdi: round(chi.p, 6), cramers_v: round(chi.cramersV, 3) } : null,
      i_forhold_til_bedste: { bedste: best.name, sammenligninger: vsBest },
    },
    returneringer: lr ? {
      model: tr(`Logistisk regression: returneret ~ forsinkelse + produktkategori (reference: til tiden, ${baseCat})`, `Logistic regression: returned ~ delay + product category (reference: on time, ${({ Tøj: "Clothing", Sko: "Shoes" })[baseCat] ?? baseCat})`),
      forsinkelse: delayOR,
    } : null,
    anmeldelser: w ? { forskel_stjerner_forsinket_minus_til_tiden: round(w.diff, 3), interval_95: [round(w.ci[0], 3), round(w.ci[1], 3)], p_værdi: round(w.p, 6), anmeldelser_til_tiden: starsOn.length, anmeldelser_forsinket: starsLate.length } : null,
    kontrolkort: control,
    fund,
    forklaring: {
      interval_95: tr("Med 95 % sikkerhed ligger den sande værdi i intervallet.", "With 95% confidence the true value lies in the interval."),
      p_værdi: tr("Sandsynligheden for at se en så stor forskel, hvis der i virkeligheden ingen var. Under 0,05 regnes som statistisk sikker.", "The probability of seeing a difference this large if there really were none. Below 0.05 counts as statistically significant."),
      odds_ratio: tr("Over 1 = flere returneringer end ved levering til tiden. 1,5 = 50 % højere odds.", "Above 1 = more returns than with on-time delivery. 1.5 = 50% higher odds."),
      kontrolkort: tr("Ugentlig andel til tiden med 3-sigma kontrolgrænser. Et signal betyder, at ugen afviger mere, end tilfældig variation kan forklare.", "Weekly share on time with 3-sigma control limits. A signal means the week deviates more than chance can explain."),
    },
  };
}
