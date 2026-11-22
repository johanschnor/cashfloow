// Things that look unusual compared with the company's own history.
//
// - Invoice amounts (to customers and from suppliers) in the last 90 days, compared with the same
//   customer's or supplier's earlier invoices. Robust z-score on the log amount: (x − median) / MAD.
//   Over 3.5 is flagged; median and MAD are not thrown off by the outliers themselves.
// - Possible duplicates: same customer or supplier, same amount, within 7 days.
// - Open invoices that are later than the customer has been in 95 % of their payments the last year.
import { median, mad, quantile, round } from "./stats.js";

const DAY = 86400000;
const t = (d) => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");
const kr = (x) => Math.round(x).toLocaleString("da-DK") + " kr.";
const Z = 3.5;

function amountOutliers(items, keyOf, nameOf, asOf, kind) {
  const since = asOf - 90 * DAY;
  const groups = new Map();
  for (const x of items) {
    const k = keyOf(x);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const out = [];
  for (const [k, xs] of groups) {
    const hist = xs.filter((x) => t(x.date) <= since).map((x) => Math.log(x.amount));
    if (hist.length < 8) continue;
    const m = median(hist), s = mad(hist) || 0.05;
    for (const x of xs.filter((x) => t(x.date) > since)) {
      const z = (Math.log(x.amount) - m) / s;
      if (Math.abs(z) >= Z) {
        out.push({
          type: kind, navn: nameOf(k), dato: x.date, beløb: round(x.amount, 0), normalt_beløb: round(Math.exp(m), 0),
          gange_normalt: round(x.amount / Math.exp(m), 1), robust_z: round(z, 1), ...(x.number != null ? { faktura: x.number } : {}),
        });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.robust_z) - Math.abs(a.robust_z));
}

function duplicates(items, keyOf, nameOf, asOf, kind) {
  const since = asOf - 90 * DAY;
  const recent = items.filter((x) => t(x.date) > since).sort((a, b) => t(a.date) - t(b.date));
  const out = [];
  for (let i = 0; i < recent.length; i++) for (let j = i + 1; j < recent.length; j++) {
    const a = recent[i], b = recent[j];
    if (t(b.date) - t(a.date) > 7 * DAY) break;
    if (keyOf(a) === keyOf(b) && Math.abs(a.amount - b.amount) < 0.5) {
      out.push({ type: kind, navn: nameOf(keyOf(a)), beløb: round(a.amount, 0), datoer: [a.date, b.date], ...(a.number != null ? { fakturaer: [a.number, b.number] } : {}) });
    }
  }
  return out;
}

export function anomalies(data, analysis) {
  const asOf = t(analysis.asOf);
  const custName = new Map(data.customers.map((c) => [c.number, c.name]));
  const supName = new Map(data.suppliers.map((s) => [s.number, s.name]));
  const sales = data.invoices.filter((i) => t(i.date) <= asOf && i.amount > 0);
  const buys = data.entries.filter((e) => e.type === "supplierInvoice" && e.supplier != null && t(e.date) <= asOf)
    .map((e) => ({ ...e, amount: Math.abs(e.amount) })).filter((e) => e.amount > 0);

  const amountFlags = [
    ...amountOutliers(sales, (i) => i.customer, (k) => custName.get(k) || `Kunde ${k}`, asOf, "kundefaktura"),
    ...amountOutliers(buys, (e) => e.supplier, (k) => supName.get(k) || `Leverandør ${k}`, asOf, "leverandørfaktura"),
  ];
  const dupes = [
    ...duplicates(sales, (i) => i.customer, (k) => custName.get(k) || `Kunde ${k}`, asOf, "kundefaktura"),
    ...duplicates(buys, (e) => e.supplier, (k) => supName.get(k) || `Leverandør ${k}`, asOf, "leverandørfaktura"),
  ];

  // Open invoices later than the customer's own 95th percentile.
  const yearAgo = asOf - 365 * DAY;
  const lateByCustomer = new Map();
  for (const i of analysis._invoices.filter((i) => i.paidDate && t(i.paidDate) > yearAgo)) {
    const n = custName.get(i.customer) || `Kunde ${i.customer}`;
    if (!lateByCustomer.has(n)) lateByCustomer.set(n, []);
    lateByCustomer.get(n).push(i.daysLate);
  }
  const unusualLate = analysis.openInvoices.filter((i) => i.daysOverdue > 0).flatMap((i) => {
    const hist = lateByCustomer.get(i.customer) || [];
    if (hist.length < 8) return [];
    const p95 = quantile(hist, 0.95);
    return i.daysOverdue > Math.max(p95, 0) ? [{ kunde: i.customer, faktura: i.number, ubetalt: i.open, dage_over_forfald: i.daysOverdue, kundens_95_percentil_dage: round(p95, 0), betalinger_bag: hist.length }] : [];
  }).sort((a, b) => b.ubetalt - a.ubetalt);

  const fund = [];
  for (const d of dupes.slice(0, 3)) fund.push(`Mulig dobbeltfaktura: ${d.navn}, ${kr(d.beløb)} den ${d.datoer[0]} og igen den ${d.datoer[1]}${d.fakturaer ? ` (faktura ${d.fakturaer.join(" og ")})` : ""}.`);
  for (const a of amountFlags.slice(0, 3)) fund.push(`${a.type === "kundefaktura" ? "Faktura til" : "Faktura fra"} ${a.navn} den ${a.dato} på ${kr(a.beløb)} er ${a.gange_normalt.toLocaleString("da-DK")} gange det normale (${kr(a.normalt_beløb)}).`);
  for (const l of unusualLate.slice(0, 3)) fund.push(`${l.kunde} er ${l.dage_over_forfald} dage over forfald med faktura ${l.faktura} (${kr(l.ubetalt)}). Det er senere end i 95 % af deres betalinger det seneste år (normalt højst ${l.kundens_95_percentil_dage} dage). Værd at rykke.`);
  if (!fund.length) fund.push("Intet usædvanligt de seneste 90 dage: ingen mulige dobbeltfakturaer, ingen usædvanlige beløb og ingen fakturaer, der er markant senere end kunden plejer.");

  return {
    periode: "seneste 90 dage",
    mulige_dobbeltfakturaer: dupes,
    usædvanlige_beløb: amountFlags,
    usædvanligt_sene_betalinger: unusualLate,
    fund: fund.map((f) => f.replace(/kr\.\./g, "kr.").replace(/kr\.\)\./g, "kr.).")),
    metode: `Beløb sammenlignes med samme kundes eller leverandørs tidligere fakturaer (mindst 8): robust z-score på logaritmen af beløbet, (x − median) / MAD, markeret ved ${Z.toLocaleString("da-DK")} eller mere. Dobbeltfakturaer: samme modpart og samme beløb inden for 7 dage. Sene betalinger: åbne fakturaer, der er længere over forfald end kundens 95. percentil det seneste år.`,
  };
}
