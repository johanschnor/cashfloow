// Turns invoices, payments and supplier entries into answers a finance manager asks every month.
// Input: the shape returned by loadFromEconomic() / loadSample(). All amounts in base currency.
// Can be run as of an earlier date (asOfInput), which the backtests in lib/cashrisk.js use.
import { ols } from "./stats.js";

const DAY = 86400000;
const t = (d) => Date.parse(d + "T00:00:00Z");
const days = (a, b) => Math.round((t(a) - t(b)) / DAY);
const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + f(x), 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
const round = (x, n = 1) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
const monthKey = (d) => d.slice(0, 7);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function analyze(data, asOfInput) {
  const allDates = [...data.invoices.map((i) => i.date), ...data.entries.map((e) => e.date)].filter(Boolean).sort();
  const lastDataDate = allDates[allDates.length - 1] || isoDay(Date.now());
  // If the data is old (e.g. the e-conomic demo account), analyse as of just after the data ends.
  let asOf = asOfInput || isoDay(Date.now());
  let asOfNote = null;
  if (days(asOf, lastDataDate) > 365) {
    asOf = isoDay(t(lastDataDate) + 30 * DAY);
    asOfNote = `Data slutter ${lastDataDate}, så analysen er lavet pr. ${asOf}.`;
  }
  const yearAgo = isoDay(t(asOf) - 365 * DAY);
  const halfYearAgo = isoDay(t(asOf) - 182 * DAY);

  const customerName = new Map(data.customers.map((c) => [c.number, c.name]));
  const supplierInfo = new Map(data.suppliers.map((s) => [s.number, s]));

  // ---------- Customers: when was each invoice actually paid? ----------
  const paymentsByInvoice = new Map();
  for (const e of data.entries) {
    if (e.type !== "customerPayment" || e.invoiceNumber == null) continue;
    if (!paymentsByInvoice.has(e.invoiceNumber)) paymentsByInvoice.set(e.invoiceNumber, []);
    paymentsByInvoice.get(e.invoiceNumber).push(e);
  }
  const invoices = data.invoices.filter((i) => i.date <= asOf).map((inv) => {
    let paidDate = null;
    const pays = (paymentsByInvoice.get(inv.number) || []).filter((p) => p.date <= asOf).sort((a, b) => (a.date < b.date ? -1 : 1));
    let cum = 0;
    for (const p of pays) {
      cum += Math.abs(p.amount);
      if (cum >= Math.abs(inv.amount) - 0.01) { paidDate = p.date; break; }
    }
    // As of an earlier date, an invoice paid later was still open then (its remainder today is 0).
    const paidLater = (paymentsByInvoice.get(inv.number) || []).some((p) => p.date > asOf);
    const open = paidDate ? 0 : paidLater ? Math.max(0, Math.abs(inv.amount) - cum) : inv.remainder > 0.01 ? inv.remainder : 0;
    return {
      ...inv,
      paidDate,
      daysLate: paidDate ? days(paidDate, inv.dueDate) : null,
      daysToPay: paidDate ? days(paidDate, inv.date) : null,
      open,
      overdueDays: open > 0 ? days(asOf, inv.dueDate) : null,
    };
  });

  const paidLastYear = invoices.filter((i) => i.paidDate && i.paidDate > yearAgo);
  const openInv = invoices.filter((i) => i.open > 0);
  const overdueInv = openInv.filter((i) => i.overdueDays > 0);
  const lateOnes = paidLastYear.filter((i) => i.daysLate > 0);

  const buckets = [
    { label: "Ikke forfalden", test: (d) => d <= 0 },
    { label: "1–15 dage", test: (d) => d >= 1 && d <= 15 },
    { label: "16–30 dage", test: (d) => d >= 16 && d <= 30 },
    { label: "31–60 dage", test: (d) => d >= 31 && d <= 60 },
    { label: "Over 60 dage", test: (d) => d > 60 },
  ].map((b) => {
    const xs = openInv.filter((i) => b.test(i.overdueDays));
    return { label: b.label, amount: round(sum(xs, (i) => i.open), 0), count: xs.length };
  });

  // Average days paid after the due date, by the month the payment came in (last 12 months).
  const months = [];
  for (let k = 11; k >= 0; k--) {
    const d = new Date(t(asOf));
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - k);
    months.push(d.toISOString().slice(0, 7));
  }
  const lateByMonth = months.map((m) => {
    const xs = invoices.filter((i) => i.paidDate && monthKey(i.paidDate) === m);
    return { month: m, avgDaysLate: round(avg(xs.map((i) => i.daysLate))), payments: xs.length, amount: round(sum(xs, (i) => i.amount), 0) };
  });

  // Per customer.
  const byCustomer = new Map();
  for (const inv of invoices) {
    if (!byCustomer.has(inv.customer)) byCustomer.set(inv.customer, []);
    byCustomer.get(inv.customer).push(inv);
  }
  const customers = [...byCustomer.entries()].map(([num, xs]) => {
    const paid = xs.filter((i) => i.paidDate && i.paidDate > yearAgo);
    const recent = xs.filter((i) => i.paidDate && i.paidDate > halfYearAgo);
    const before = xs.filter((i) => i.paidDate && i.paidDate > yearAgo && i.paidDate <= halfYearAgo);
    const recentAvg = avg(recent.map((i) => i.daysLate));
    const beforeAvg = avg(before.map((i) => i.daysLate));
    const open = xs.filter((i) => i.open > 0);
    // Is the customer really getting slower? Regress days late on payment date (last 12 months).
    const fit = paid.length >= 8 ? ols(paid.map((i) => (t(i.paidDate) - t(asOf)) / (30.44 * DAY)), paid.map((i) => i.daysLate)) : null;
    const verdict = !fit ? null : fit.p < 0.05 ? (fit.slope > 0 ? "langsommere" : "hurtigere") : "ingen sikker ændring";
    return {
      number: num,
      name: customerName.get(num) || `Kunde ${num}`,
      revenue12m: round(sum(xs.filter((i) => i.date > yearAgo), (i) => i.amount), 0),
      invoices12m: xs.filter((i) => i.date > yearAgo).length,
      avgDaysLate: round(avg(paid.map((i) => i.daysLate))),
      onTimeShare: paid.length ? round(paid.filter((i) => i.daysLate <= 0).length / paid.length, 3) : null,
      trendDays: recentAvg != null && beforeAvg != null && recent.length >= 3 && before.length >= 3 ? round(recentAvg - beforeAvg) : null,
      trendPerMonth: fit ? round(fit.slope, 2) : null,
      trendCI: fit ? [round(fit.ci[0], 2), round(fit.ci[1], 2)] : null,
      trendP: fit ? round(fit.p, 4) : null,
      trendVerdict: verdict,
      outstanding: round(sum(open, (i) => i.open), 0),
      overdue: round(sum(open.filter((i) => i.overdueDays > 0), (i) => i.open), 0),
      oldestOverdueDays: open.length ? Math.max(...open.map((i) => i.overdueDays)) : null,
    };
  }).sort((a, b) => b.overdue - a.overdue || b.revenue12m - a.revenue12m);

  // ---------- Suppliers ----------
  // e-conomic does not link a supplier payment to a specific invoice, so we match first-in-first-out
  // per supplier. The resulting payment dates are an estimate.
  const supInvoices = data.entries.filter((e) => e.type === "supplierInvoice" && e.supplier != null && e.date <= asOf)
    .map((e) => ({ ...e, amount: Math.abs(e.amount), remainder: Math.abs(e.remainder || 0) }));
  const supPayments = data.entries.filter((e) => e.type === "supplierPayment" && e.supplier != null && e.date <= asOf)
    .map((e) => ({ ...e, amount: Math.abs(e.amount) }));

  const bySupplier = new Map();
  for (const e of supInvoices) {
    if (!bySupplier.has(e.supplier)) bySupplier.set(e.supplier, { invoices: [], payments: [] });
    bySupplier.get(e.supplier).invoices.push(e);
  }
  for (const p of supPayments) {
    if (!bySupplier.has(p.supplier)) bySupplier.set(p.supplier, { invoices: [], payments: [] });
    bySupplier.get(p.supplier).payments.push(p);
  }

  const matched = [];
  for (const [num, { invoices: inv, payments: pay }] of bySupplier) {
    const queue = [...inv].sort((a, b) => (a.date < b.date ? -1 : 1)).map((x) => ({ ...x, left: x.amount }));
    let qi = 0;
    for (const p of [...pay].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      let money = p.amount;
      while (money > 0.01 && qi < queue.length) {
        const take = Math.min(money, queue[qi].left);
        queue[qi].left -= take;
        money -= take;
        if (queue[qi].left <= 0.01) { queue[qi].paidDate = p.date; qi++; }
      }
    }
    for (const q of queue) matched.push({ ...q, supplier: num });
  }

  const spendWindow = matched.filter((e) => e.date > yearAgo);
  const totalSpend = sum(spendWindow, (e) => e.amount);
  const suppliers = [...bySupplier.keys()].map((num) => {
    const info = supplierInfo.get(num) || {};
    const xs = matched.filter((e) => e.supplier === num);
    const recent = xs.filter((e) => e.date > yearAgo);
    const paid = recent.filter((e) => e.paidDate && e.dueDate);
    const spend = sum(recent, (e) => e.amount);
    return {
      number: num,
      name: info.name || `Leverandør ${num}`,
      country: info.country || "",
      currency: info.currency || "",
      spend12m: round(spend, 0),
      share: totalSpend ? round(spend / totalSpend, 3) : 0,
      avgPaidVsDue: round(avg(paid.map((e) => days(e.paidDate, e.dueDate)))),
      open: round(sum(xs.filter((e) => e.date <= asOf), (e) => (e.paidDate ? 0 : e.left)), 0),
    };
  }).sort((a, b) => b.spend12m - a.spend12m);

  const countryTotals = new Map();
  for (const s of suppliers) countryTotals.set(s.country || "Ukendt", (countryTotals.get(s.country || "Ukendt") || 0) + s.spend12m);
  const countries = [...countryTotals.entries()]
    .map(([country, spend]) => ({ country: niceCountry(country), spend: round(spend, 0), share: totalSpend ? round(spend / totalSpend, 3) : 0 }))
    .sort((a, b) => b.spend - a.spend);

  const paidSup = spendWindow.filter((e) => e.paidDate && e.dueDate);
  const early = paidSup.filter((e) => days(e.dueDate, e.paidDate) > 3);
  const lateSup = paidSup.filter((e) => days(e.paidDate, e.dueDate) > 0);
  // Cash given away by paying early: amount × days early, expressed as average extra cash tied up.
  const earlyCashDays = sum(early, (e) => e.amount * days(e.dueDate, e.paidDate));

  // ---------- Headline numbers and plain-language findings ----------
  const totalOutstanding = sum(openInv, (i) => i.open);
  const totalOverdue = sum(overdueInv, (i) => i.open);
  const top3Overdue = customers.filter((c) => c.overdue > 0).slice(0, 3);
  const top3OverdueShare = totalOverdue ? sum(top3Overdue, (c) => c.overdue) / totalOverdue : 0;
  // Only call a customer slower when the trend is statistically clear (p < 0.05), not just noise.
  const slowest = customers.filter((c) => c.trendVerdict === "langsommere" && c.trendDays != null).sort((a, b) => b.trendPerMonth - a.trendPerMonth)[0];
  // Payment time for all customers together, last 12 months.
  const allFit = paidLastYear.length >= 8 ? ols(paidLastYear.map((i) => (t(i.paidDate) - t(asOf)) / (30.44 * DAY)), paidLastYear.map((i) => i.daysLate)) : null;
  const top3Spend = sum(suppliers.slice(0, 3), (s) => s.share);

  const kr = (x) => Math.round(x).toLocaleString("da-DK") + " kr.";
  const pct = (x) => Math.round(x * 100) + " %";
  const insights = [];
  if (totalOverdue > 0 && top3Overdue.length) {
    insights.push(`${listDa(top3Overdue.map((c) => c.name))} står for ${pct(top3OverdueShare)} af jeres forfaldne tilgodehavender (${kr(totalOverdue)}).`);
  }
  if (slowest && slowest.trendDays >= 2) {
    insights.push(`${slowest.name} er blevet ${round(slowest.trendDays, 0)} dage langsommere til at betale det seneste halve år. Det er ikke tilfældig variation: de betaler ${slowest.trendPerMonth.toLocaleString("da-DK")} dage senere for hver måned, der går (95 %-interval ${slowest.trendCI.map((x) => x.toLocaleString("da-DK")).join(" til ")} dage).`);
  }
  if (paidLastYear.length && lateOnes.length) {
    insights.push(`${pct(lateOnes.length / paidLastYear.length)} af fakturaerne det seneste år blev betalt for sent, i snit ${round(avg(lateOnes.map((i) => i.daysLate)), 0)} dage efter forfald.`);
  } else if (paidLastYear.length) {
    insights.push(paidLastYear.length === 1 ? "Den eneste betalte faktura det seneste år blev betalt til tiden." : `Alle ${paidLastYear.length} betalte fakturaer det seneste år blev betalt til tiden.`);
  }
  if (suppliers[0] && suppliers[0].share >= 0.25) {
    insights.push(`${suppliers[0].name} står for ${pct(suppliers[0].share)} af jeres indkøb. De tre største leverandører står for ${pct(top3Spend)}.`);
  }
  if (early.length && earlyCashDays > 0) {
    insights.push(`I betalte ${early.length} leverandørfakturaer mere end 3 dage før forfald. Det svarer til ${kr(earlyCashDays / 365)} bundet i gennemsnit hele året (skøn).`);
  }

  const result = {
    company: data.company,
    source: data.source,
    asOf,
    asOfNote,
    counts: { invoices: invoices.length, customers: data.customers.length, suppliers: data.suppliers.length, entries: data.entries.length },
    receivables: {
      outstanding: round(totalOutstanding, 0),
      overdue: round(totalOverdue, 0),
      onTimeShare: paidLastYear.length ? round((paidLastYear.length - lateOnes.length) / paidLastYear.length, 3) : null,
      avgDaysLateWhenLate: round(avg(lateOnes.map((i) => i.daysLate))),
      avgDaysToPay: round(avg(paidLastYear.map((i) => i.daysToPay))),
      buckets,
      lateByMonth,
      trend: allFit ? { perMonth: round(allFit.slope, 2), ci: [round(allFit.ci[0], 2), round(allFit.ci[1], 2)], p: round(allFit.p, 4), n: allFit.n,
        verdict: allFit.p < 0.05 ? (allFit.slope > 0 ? "langsommere" : "hurtigere") : "ingen sikker ændring" } : null,
    },
    customers,
    openInvoices: openInv
      .map((i) => ({ number: i.number, customer: customerName.get(i.customer) || `Kunde ${i.customer}`, date: i.date, dueDate: i.dueDate, open: round(i.open, 0), daysOverdue: i.overdueDays }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue),
    payables: {
      spend12m: round(totalSpend, 0),
      open: round(sum(suppliers, (s) => s.open), 0),
      top3Share: round(top3Spend, 3),
      foreignShare: totalSpend ? round(sum(suppliers.filter((s) => !/^den/i.test(s.country)), (s) => s.spend12m) / totalSpend, 3) : 0,
      paidEarlyCount: early.length,
      paidLateCount: lateSup.length,
      paidCount: paidSup.length,
      matchingNote: "Leverandørbetalinger er ikke koblet til en bestemt faktura i e-conomic. Betalingsdatoer er parret efter først-ind-først-ud pr. leverandør og er et skøn.",
    },
    suppliers,
    countries,
    insights,
  };
  // Invoice-level detail for the forecasts and tests; hidden so it is not sent to Claude.
  Object.defineProperty(result, "_invoices", { value: invoices });
  return result;
}

function listDa(xs) {
  return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " og " + xs[xs.length - 1];
}

const COUNTRY_DA = { denmark: "Danmark", germany: "Tyskland", sweden: "Sverige", lithuania: "Litauen", china: "Kina", belgium: "Belgien", norway: "Norge", poland: "Polen", netherlands: "Holland" };
function niceCountry(c) {
  return COUNTRY_DA[String(c).toLowerCase()] || c;
}
