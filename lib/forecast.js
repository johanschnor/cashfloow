// 13-week cash forecast: "will we run out of money, when, and why?"
//
// Money in:  open customer invoices, paid when THAT customer usually pays (due date + their habit),
//            plus future sales at the recent weekly run-rate, paid after the usual payment time.
// Money out: open supplier invoices, paid when the company usually pays that supplier,
//            future purchases at the recent run-rate, fixed costs (salaries, rent …) and VAT.
// Every number that is an assumption is listed in `assumptions`, so Claude and the user can see it.

const DAY = 86400000;
const t = (d) => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + f(x), 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
const round = (x) => Math.round(x);
const kr = (x) => Math.round(x).toLocaleString("da-DK") + " kr.";
const MON = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const da = (ms) => { const d = new Date(ms); return `${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`; };

// Danish quarterly VAT: Q1 → 1 June, Q2 → 1 September, Q3 → 1 December, Q4 → 1 March.
function vatDeadlines(fromMs, toMs) {
  const out = [];
  const y0 = new Date(fromMs).getUTCFullYear();
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    for (const [q, m, yy] of [[1, 5, y], [2, 8, y], [3, 11, y], [4, 2, y + 1]]) {
      const due = Date.UTC(yy, m, 1);
      if (due >= fromMs && due < toMs) {
        const qStart = Date.UTC(y, (q - 1) * 3, 1), qEnd = Date.UTC(y, q * 3, 1);
        out.push({ due, quarter: `${q}. kvartal ${y}`, qStart, qEnd });
      }
    }
  }
  return out.sort((a, b) => a.due - b.due);
}

function lastBusinessDay(y, m) {
  let d = Date.UTC(y, m + 1, 0);
  while ([0, 6].includes(new Date(d).getUTCDay())) d -= DAY;
  return d;
}

export function forecast(data, analysis, { weeks = 13, minimum = 0 } = {}) {
  const asOf = t(analysis.asOf);
  const end = asOf + weeks * 7 * DAY;
  const assumptions = [];

  // ---------- Opening bank balance ----------
  let start = 0, bankSource;
  if (data.bank) {
    start = data.bank.balance;
    bankSource = `${data.bank.note || "Bank"}: ${kr(start)}`;
  } else {
    const bankAccounts = (data.accounts || []).filter((a) => a.type === "status" && /bank|kassebeholdning|kassekredit/i.test(a.name));
    start = sum(bankAccounts, (a) => a.balance);
    bankSource = bankAccounts.length
      ? `Saldo på ${bankAccounts.map((a) => `${a.number} ${a.name}`).join(", ")} i e-conomic: ${kr(start)}`
      : "Ingen bankkonto fundet i kontoplanen, så startsaldo er sat til 0 kr.";
  }
  assumptions.push(`Startsaldo: ${bankSource}`);

  // ---------- Customer habits ----------
  const custByName = new Map(analysis.customers.map((c) => [c.name, c]));
  const avgDaysToPay = Math.max(0, analysis.receivables.avgDaysToPay ?? 14);
  const recentInvoices = data.invoices.filter((i) => t(i.date) > asOf - 84 * DAY && t(i.date) <= asOf);
  const avgTerms = avg(recentInvoices.map((i) => (t(i.dueDate) - t(i.date)) / DAY)) ?? 14;
  const weeklySales = sum(recentInvoices, (i) => i.amount) / 12;

  // ---------- Supplier habits ----------
  const supHabit = new Map(analysis.suppliers.map((s) => [s.number, s.avgPaidVsDue ?? 0]));
  const supInvoices = data.entries.filter((e) => e.type === "supplierInvoice" && e.supplier != null && t(e.date) <= asOf);
  const openSup = supInvoices.filter((e) => Math.abs(e.remainder || 0) > 0.01);
  const recentSup = supInvoices.filter((e) => t(e.date) > asOf - 84 * DAY);
  const weeklyPurchases = sum(recentSup, (e) => Math.abs(e.amount)) / 12;
  const supTerms0 = avg(recentSup.filter((e) => e.dueDate).map((e) => (t(e.dueDate) - t(e.date)) / DAY)) ?? 30;
  const supTerms = Math.max(0, supTerms0);
  const supWeighted = analysis.suppliers.reduce((s, x) => s + (x.avgPaidVsDue ?? 0) * x.share, 0);

  // ---------- Fixed costs ----------
  let fixed = data.fixedCosts;
  if (!fixed) {
    // e-conomic: other money leaving the bank (not supplier payments) over the last 3 months, as a monthly average.
    const bankNos = new Set((data.accounts || []).filter((a) => a.type === "status" && /bank|kasse/i.test(a.name)).map((a) => a.number));
    const out3m = data.entries.filter((e) => e.type === "financeVoucher" && bankNos.has(e.account) && e.amount < 0 && t(e.date) > asOf - 91 * DAY && t(e.date) <= asOf);
    const monthly = -sum(out3m, (e) => e.amount) / 3;
    fixed = monthly > 0 ? [{ name: "Øvrige faste udgifter (skøn)", amount: round(monthly), day: 1 }] : [];
    assumptions.push(monthly > 0
      ? `Faste udgifter (løn, husleje mv.) er skønnet til ${kr(monthly)} om måneden ud fra de seneste 3 måneders øvrige bankudbetalinger.`
      : "Ingen faste udgifter fundet i bogføringen de seneste 3 måneder. Løn og husleje er derfor ikke med i prognosen.");
  } else {
    assumptions.push(`Faste udgifter: ${fixed.map((f) => `${f.name} ${kr(f.amount)}`).join(", ")} om måneden.`);
  }

  // ---------- VAT ----------
  const vatItems = [];
  const deadlines = vatDeadlines(asOf, end);
  const vatAccounts = (data.accounts || []).filter((a) => a.type === "status" && /moms/i.test(a.name));
  deadlines.forEach((d, i) => {
    let amount;
    if (i === 0 && vatAccounts.length && !data.bank) {
      amount = -sum(vatAccounts, (a) => a.balance); // VAT owed is a credit balance
      assumptions.push(amount > 0
        ? `Moms ${d.quarter} (${da(d.due)}): saldoen på momskontiene i e-conomic, ${kr(amount)}`
        : `Moms ${d.quarter} (${da(d.due)}): momskontiene viser et tilgodehavende på ${kr(-amount)}, som ikke er regnet med som indbetaling.`);
    } else {
      // Output VAT on sales minus input VAT on Danish purchases in the quarter (20 % of amounts incl. VAT).
      const salesQ = sum(data.invoices.filter((x) => t(x.date) >= d.qStart && t(x.date) < d.qEnd), (x) => x.amount);
      const dkSup = new Set(data.suppliers.filter((s) => /^den/i.test(s.country || "")).map((s) => s.number));
      const buyQ = sum(supInvoices.filter((x) => dkSup.has(x.supplier) && t(x.date) >= d.qStart && t(x.date) < d.qEnd), (x) => Math.abs(x.amount));
      // Quarter not finished yet: extend with run-rates.
      const futureWeeks = Math.max(0, (d.qEnd - asOf) / (7 * DAY));
      const dkShare = analysis.payables.foreignShare != null ? 1 - analysis.payables.foreignShare : 1;
      amount = 0.2 * (salesQ + weeklySales * futureWeeks) - 0.2 * (buyQ + weeklyPurchases * dkShare * futureWeeks);
      assumptions.push(`Moms ${d.quarter} (${da(d.due)}): skønnet til ${kr(amount)} som 20 % af salget minus 20 % af danske indkøb i kvartalet (inkl. moms). Udenlandske indkøb er antaget omvendt betalingspligt.`);
    }
    if (amount > 0) vatItems.push({ date: d.due, amount, label: `Moms ${d.quarter}` });
  });
  if (!deadlines.length) assumptions.push("Ingen momsfrister i perioden (kvartalsvis afregning antaget).");

  assumptions.push(`Kunder: åbne fakturaer forventes betalt på forfaldsdagen + kundens egen gennemsnitlige forsinkelse. Nyt salg ${kr(weeklySales)} om ugen (snit for de seneste 12 uger), betalt efter ${Math.round(avgDaysToPay)} dage i snit.`);
  assumptions.push(`Leverandører: åbne fakturaer forventes betalt, som I plejer at betale den leverandør (skøn). Nye indkøb ${kr(weeklyPurchases)} om ugen, betalt efter ${Math.max(0, Math.round(supTerms + supWeighted))} dage i snit.`);

  // ---------- Build cash events for a scenario ----------
  function events({ customersOnTime = false, suppliersOnDue = false } = {}) {
    const ev = [];
    const clamp = (ms) => Math.max(ms, asOf + DAY);
    for (const inv of analysis.openInvoices) {
      const late = customersOnTime ? 0 : Math.max(0, custByName.get(inv.customer)?.avgDaysLate ?? 0);
      // Overdue invoices: at least 3 days out, plus the customer's usual lateness beyond the due date.
      const when = Math.max(t(inv.dueDate) + late * DAY, asOf + 3 * DAY);
      ev.push({ date: when, amount: inv.open, kind: "kunder_kendte" });
    }
    const payDelay = customersOnTime ? avgTerms : avgDaysToPay;
    for (let d = asOf + DAY; d < end; d += 7 * DAY) {
      ev.push({ date: d + payDelay * DAY, amount: weeklySales, kind: "kunder_forventede", week: d });
    }
    for (const s of openSup) {
      const habit = suppliersOnDue ? Math.max(0, supHabit.get(s.supplier) ?? 0) : supHabit.get(s.supplier) ?? 0;
      ev.push({ date: clamp(t(s.dueDate || s.date) + Math.round(habit) * DAY), amount: -Math.abs(s.remainder), kind: "leverandører" });
    }
    const supDelay = supTerms + (suppliersOnDue ? Math.max(0, supWeighted) : supWeighted);
    for (let d = asOf + DAY; d < end; d += 7 * DAY) {
      ev.push({ date: d + supDelay * DAY, amount: -weeklyPurchases, kind: "leverandører", newPurchase: true });
    }
    for (let m = 0; m <= Math.ceil(weeks / 4) + 1; m++) {
      const base = new Date(asOf);
      const y = base.getUTCFullYear(), mo = base.getUTCMonth() + m;
      for (const f of fixed) {
        const when = f.day === "last-business-day" ? lastBusinessDay(y, mo) : Date.UTC(y, mo, f.day);
        if (when > asOf && when < end) ev.push({ date: when, amount: -f.amount, kind: "faste_udgifter", label: f.name });
      }
    }
    for (const v of vatItems) ev.push({ date: v.date, amount: -v.amount, kind: "moms", label: v.label });
    return ev.filter((e) => e.date > asOf && e.date < end);
  }

  function run(ev) {
    let bal = start;
    const rows = [];
    for (let w = 0; w < weeks; w++) {
      const from = asOf + w * 7 * DAY + DAY, to = from + 7 * DAY;
      const inWeek = ev.filter((e) => e.date >= from && e.date < to);
      const by = (k) => round(sum(inWeek.filter((e) => e.kind === k), (e) => e.amount));
      const row = {
        uge: isoWeek(from), fra: iso(from), til: iso(to - DAY),
        start: round(bal),
        ind_kunder_kendte: by("kunder_kendte"),
        ind_kunder_forventede: by("kunder_forventede"),
        ud_leverandører: by("leverandører"),
        ud_faste_udgifter: by("faste_udgifter"),
        ud_moms: by("moms"),
        store_poster: inWeek.filter((e) => e.label && Math.abs(e.amount) >= 10000).map((e) => `${e.label} ${kr(-e.amount)} (${da(e.date)})`),
      };
      bal += sum(inWeek, (e) => e.amount);
      row.slut = round(bal);
      rows.push(row);
    }
    const lowest = rows.reduce((m, r) => (r.slut < m.slut ? r : m), rows[0]);
    return { rows, lowest };
  }

  const base = run(events());
  const onTime = run(events({ customersOnTime: true }));
  const onDue = run(events({ suppliersOnDue: true }));
  const both = run(events({ customersOnTime: true, suppliersOnDue: true }));
  const below = base.rows.filter((r) => r.slut < minimum);

  const scenarios = [
    { navn: "Kunderne betaler til tiden", laveste_saldo: onTime.lowest.slut, forbedring: onTime.lowest.slut - base.lowest.slut },
    { navn: "I betaler leverandører på forfaldsdagen, ikke før", laveste_saldo: onDue.lowest.slut, forbedring: onDue.lowest.slut - base.lowest.slut },
    { navn: "Begge dele", laveste_saldo: both.lowest.slut, forbedring: both.lowest.slut - base.lowest.slut },
  ];

  // What drives the balance down to its lowest point?
  const upTo = base.rows.slice(0, base.rows.indexOf(base.lowest) + 1);
  const drivers = [
    { post: "Indbetalinger fra kunder", beløb: sum(upTo, (r) => r.ind_kunder_kendte + r.ind_kunder_forventede) },
    { post: "Betalinger til leverandører", beløb: sum(upTo, (r) => r.ud_leverandører) },
    { post: "Faste udgifter (løn, husleje mv.)", beløb: sum(upTo, (r) => r.ud_faste_udgifter) },
    { post: "Moms", beløb: sum(upTo, (r) => r.ud_moms) },
  ];

  const insights = [];
  const low = base.lowest;
  insights.push(`Laveste forventede saldo er ${kr(low.slut)} i uge ${low.uge} (${da(t(low.fra))} – ${da(t(low.til))}).`);
  if (below.length) insights.push(`Saldoen er under ${kr(minimum)} i ${below.length} af de næste ${weeks} uger, første gang i uge ${below[0].uge}.`);
  const big = upTo.flatMap((r) => r.store_poster);
  if (big.length) insights.push(`Store udbetalinger frem til da: ${big.slice(0, 4).join(", ")}.`);
  if (scenarios[0].forbedring > 0) insights.push(`Hvis kunderne betalte til tiden, ville den laveste saldo være ${kr(scenarios[0].laveste_saldo)} (${kr(scenarios[0].forbedring)} bedre).`);
  if (scenarios[1].forbedring > 0) insights.push(`Hvis I betalte leverandørerne på forfaldsdagen i stedet for før, ville den laveste saldo være ${kr(scenarios[1].laveste_saldo)} (${kr(scenarios[1].forbedring)} bedre).`);
  if (scenarios[2].forbedring > Math.max(scenarios[0].forbedring, scenarios[1].forbedring)) insights.push(`Begge dele tilsammen giver en laveste saldo på ${kr(scenarios[2].laveste_saldo)}`);

  const result = {
    opgjort_pr: analysis.asOf,
    uger: weeks,
    minimum,
    startsaldo: round(start),
    laveste: { uge: low.uge, fra: low.fra, til: low.til, saldo: low.slut },
    uger_under_minimum: below.map((r) => r.uge),
    scenarier: scenarios.map((s) => ({ ...s, forbedring: round(s.forbedring) })),
    bevægelser_frem_til_laveste_punkt: drivers.map((d) => ({ ...d, beløb: round(d.beløb) })),
    fund: insights,
    antagelser: assumptions,
    ugeplan: base.rows,
  };
  // For lib/cashrisk.js: the deterministic cash events behind this forecast. Hidden from the JSON output.
  Object.defineProperty(result, "_model", { value: { start, asOf, end, weeks, minimum, events: events(), weeklySales, weeklyPurchases, avgDaysToPay, run } });
  return result;
}

function isoWeek(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThu) / DAY - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
