// A fictional company with 36 months of data, in the same shape loadFromEconomic() returns.
// Deterministic (seeded), so the numbers are the same on every run. All names are made up.
import { sampleInventory } from "./sample-inventory.js";

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const CUSTOMERS = [
  ["Bolighuset Vest", -1, 0.9], ["Café Havnen", -2, 0.3], ["Kontorhuset Syd", 9, 0.7],
  ["Butik Østerbro", -1, 0.5], ["Hotel Fjordudsigt", 12, 1.4], ["Indretning Nord", 2, 1.0],
  ["Restaurant Torvet", 4, 0.6], ["Skolen ved Søen", -3, 0.8], ["Klinik Midtby", 0, 0.4],
  ["Møbelhuset Øst", 16, 1.6], ["Studio Lys & Rum", -2, 0.3], ["Byggefirmaet Kant", 6, 1.2],
  ["Kommunal Institution", -1, 1.1], ["Designbutikken", 1, 0.4], ["Feriecenter Klit", 5, 0.9],
  ["Arkitektkontoret", -2, 0.5], ["Erhvervsparken", 1, 0.7], ["Café Hjørnet", 7, 0.2],
  ["Sportshallen", -1, 0.5], ["Konferencecenteret", 4, 1.3],
];
// Sales by calendar month, relative to an average month.
const SEASON = [0.82, 0.9, 1.06, 1.12, 1.1, 1.0, 0.68, 0.92, 1.12, 1.18, 1.12, 0.98];
// [name, base days late, size factor]; some customers drift slower over time:
const DRIFT = { "Konferencecenteret": 1.1, "Kontorhuset Syd": 0.5, "Feriecenter Klit": 0.4, "Café Hjørnet": -0.25 };

const SUPPLIERS = [
  ["Træværk Nord", "Denmark", "DKK", 0.34, 30], ["Polstring & Stof", "Denmark", "DKK", 0.12, 14],
  ["Holzwerk GmbH", "Germany", "EUR", 0.16, 30], ["Baltic Timber", "Lithuania", "EUR", 0.09, 30],
  ["Metalbeslag A/S", "Denmark", "DKK", 0.07, 14], ["Fragtcentralen", "Denmark", "DKK", 0.06, 8],
  ["Svensk Lack AB", "Sweden", "SEK", 0.05, 30], ["Lampefabrikken", "Denmark", "DKK", 0.04, 14],
  ["Glas & Spejl", "Denmark", "DKK", 0.03, 14], ["Shanghai Hardware Co.", "China", "USD", 0.04, 45],
];
// [name, country, currency, share of purchases, payment terms in days]

export function loadSample(asOf = new Date()) {
  const r = rng(20261118);
  const gauss = () => (r() + r() + r() + r() - 2) * 1.7; // ~N(0,1)
  const end = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const start = end - 1095 * DAY;
  const driftFrom = end - 730 * DAY; // payment habits start drifting 24 months ago

  const customers = CUSTOMERS.map(([name], i) => ({ number: i + 1, name, country: "Denmark" }));
  const suppliers = SUPPLIERS.map(([name, country, currency], i) => ({ number: i + 1, name, country, currency }));
  const invoices = [];
  const entries = [];

  // Sales invoices and the customers' payments.
  let invNo = 1000;
  for (let t = start; t <= end; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const perDay = 1 + Math.floor(r() * 3);
    for (let k = 0; k < perDay; k++) {
      const ci = Math.floor(Math.pow(r(), 1.35) * CUSTOMERS.length);
      const [name, baseLate, size] = CUSTOMERS[ci];
      const terms = [8, 14, 30][ci % 3];
      // Furniture for offices, hotels and restaurants: busy spring and autumn, quiet July and around new year,
      // and about 8 % growth a year.
      const season = SEASON[new Date(t).getUTCMonth()];
      const growth = Math.pow(1.08, (t - end) / (365 * DAY));
      const amount = Math.round((2500 + r() * 22000) * size * season * growth * 100) / 100 * 1.25;
      const due = t + terms * DAY;
      const monthsIn = Math.max(0, (t - driftFrom) / (30 * DAY));
      const late = Math.round(baseLate + (DRIFT[name] || 0) * monthsIn + gauss() * (1.5 + Math.max(0, baseLate) * 0.3));
      const paid = due + Math.max(-terms + 1, late) * DAY;
      invNo++;
      const isPaid = paid <= end;
      invoices.push({ number: invNo, date: iso(t), dueDate: iso(due), amount: Math.round(amount * 100) / 100,
        remainder: isPaid ? 0 : Math.round(amount * 100) / 100, customer: ci + 1 });
      if (isPaid) entries.push({ type: "customerPayment", date: iso(paid), amount: -Math.round(amount * 100) / 100,
        remainder: 0, currency: "DKK", customer: ci + 1, invoiceNumber: invNo });
    }
  }

  // Purchases: supplier invoices and our payments (not linked to a specific invoice, like in e-conomic).
  const monthlySpend = 410000;
  SUPPLIERS.forEach(([, , currency, share, terms], si) => {
    const perMonth = share > 0.1 ? 4 : share > 0.05 ? 2 : 1;
    // How we pay this supplier: some early (giving away cash), some late.
    const habit = [-12, -2, 0, 3, -9, 0, 6, -1, 0, -15][si];
    for (let t = start; t <= end; t += (30 / perMonth) * DAY) {
      const date = t + Math.floor(r() * 5) * DAY;
      if (date > end) continue;
      const amount = Math.round(monthlySpend * share / perMonth * (0.75 + r() * 0.5));
      const due = date + terms * DAY;
      const paid = due + Math.round(habit + gauss() * 2) * DAY;
      const isPaid = paid <= end;
      entries.push({ type: "supplierInvoice", date: iso(date), dueDate: iso(due), amount: -amount,
        remainder: isPaid ? 0 : -amount, currency, supplier: si + 1 });
      if (isPaid) entries.push({ type: "supplierPayment", date: iso(paid), amount, remainder: 0, currency, supplier: si + 1 });
    }
  });

  // Two deliberate oddities for the anomaly check (lib/anomalies.js): a supplier invoice about 3× the usual
  // size, and a customer invoice that looks like a duplicate of one sent two days earlier. Both unpaid.
  const odd = end - 25 * DAY;
  entries.push({ type: "supplierInvoice", date: iso(odd), dueDate: iso(odd + 14 * DAY), amount: -46800, remainder: -46800, currency: "DKK", supplier: 5 });
  const twin = [...invoices].reverse().find((i) => i.customer === 5 && i.remainder > 0);
  if (twin) {
    const d2 = Date.parse(twin.date + "T00:00:00Z") + 2 * DAY;
    if (d2 <= end) invoices.push({ ...twin, number: ++invNo, date: iso(d2), dueDate: iso(Date.parse(twin.dueDate + "T00:00:00Z") + 2 * DAY) });
  }

  // Bank balance today and recurring costs that are not supplier invoices (salaries, rent, other).
  const bank = { balance: 185000, note: "Bankkonto" };
  const fixedCosts = [
    { name: "Løn", amount: 78000, day: "last-business-day" },
    { name: "Husleje", amount: 18500, day: 1 },
    { name: "Øvrige faste omkostninger", amount: 9500, day: 10 },
  ];

  // Products, stock and invoice lines for the inventory tools (lib/sample-inventory.js).
  const inventory = sampleInventory({ invoices, suppliers, end });

  return { company: "Demo Møbler ApS (eksempeldata)", source: "Eksempelvirksomhed", invoices, customers, suppliers, entries, bank, fixedCosts, inventory };
}
