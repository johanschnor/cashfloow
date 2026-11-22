// Products, stock and invoice lines for the sample company (lib/sample.js), in the same shape
// loadInventoryFromEconomic() returns. The lines fill the existing invoices: products are drawn by
// popularity until the invoice amount is used up, and the rest becomes a delivery-and-assembly line.
// Uses its own seeded generator, so the rest of the sample data stays exactly the same.

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86400000;

// [number, name, group, cost price, sales price, popularity, pattern, growth per year, lead time days,
//  supplier, stock today in days of recent sales, units on order from the supplier]
// pattern: "jævn" = most orders 1–3 units; "klumpet" = now and then a large order (a hotel buys 30 chairs);
// "sporadisk" = rare single units. Special cases: "udgået" (no sales for 9 months, stock left),
// "ny" (launched 5 months ago).
export const PRODUCTS = [
  ["1001", "Konferencestol Nova sort", "Stole", 620, 1295, 10, "klumpet", 0.10, 21, 1, 45, 0],
  ["1002", "Konferencestol Nova eg", "Stole", 680, 1395, 6, "klumpet", 0.05, 21, 1, 80, 0],
  ["1003", "Spisebordsstol Eg", "Stole", 540, 1150, 12, "jævn", 0.08, 21, 1, 9, 0],
  ["1004", "Barstol Havn", "Stole", 450, 995, 5, "jævn", 0.0, 30, 3, 70, 0],
  ["1005", "Loungestol Fjord", "Stole", 1850, 3995, 2, "sporadisk", 0.15, 14, 2, 150, 0],
  ["1006", "Kontorstol Ergo", "Stole", 1400, 2895, 7, "jævn", 0.12, 45, 10, 5, 0],
  ["1007", "Klapstol Event", "Stole", 210, 495, 4, "klumpet", -0.05, 30, 4, 200, 0],
  ["1008", "Akustikskærm Felt", "Kontor", 980, 2195, 9, "ny", 0.0, 21, 2, 10, 0],
  ["2001", "Spisebord Eg 200 cm", "Borde", 4200, 8995, 9, "jævn", 0.08, 30, 1, 90, 0],
  ["2002", "Cafébord rundt Ø70", "Borde", 950, 2195, 6, "jævn", 0.05, 30, 3, 85, 0],
  ["2003", "Mødebord Oval 240 cm", "Borde", 6800, 13995, 3, "sporadisk", 0.10, 30, 1, 200, 0],
  ["2004", "Skrivebord hæve-sænke", "Kontor", 3100, 6495, 5, "jævn", 0.20, 45, 10, 12, 100],
  ["2005", "Sofabord Valnød", "Borde", 1600, 3495, 3, "udgået", 0.0, 30, 1, 0, 0],
  ["2006", "Højbord Event", "Borde", 780, 1795, 3, "klumpet", 0.0, 30, 4, 110, 0],
  ["3001", "Sofa Fjord 3-personers", "Polstrede møbler", 7400, 15995, 9, "jævn", 0.10, 42, 2, 200, 0],
  ["3002", "Sofa Fjord 2-personers", "Polstrede møbler", 6100, 12995, 9, "jævn", 0.05, 42, 2, 14, 0],
  ["3003", "Sengegavl polstret", "Polstrede møbler", 2300, 4995, 3, "klumpet", 0.05, 28, 2, 160, 0],
  ["3004", "Puf Rund", "Polstrede møbler", 640, 1395, 5, "jævn", -0.45, 14, 2, 420, 0],
  ["4001", "Pendel Opal Ø40", "Belysning", 520, 1195, 8, "jævn", 0.10, 14, 8, 45, 0],
  ["4002", "Bordlampe Messing", "Belysning", 380, 895, 6, "jævn", 0.0, 14, 8, 45, 0],
  ["4003", "Gulvlampe Bue", "Belysning", 1150, 2595, 2, "sporadisk", 0.05, 14, 8, 75, 0],
  ["4004", "LED-spot til skinne", "Belysning", 180, 445, 8, "jævn", 0.30, 14, 8, 6, 0],
  ["5001", "Reol Eg 5 hylder", "Opbevaring", 1900, 3995, 4, "jævn", 0.05, 30, 1, 60, 0],
  ["5002", "Skab med låger", "Opbevaring", 2600, 5495, 5, "jævn", 0.0, 30, 1, 80, 0],
  ["5003", "Garderobestativ Messing", "Opbevaring", 820, 1795, 3, "jævn", -0.10, 21, 5, 170, 0],
  ["5004", "Kontorreol Stål", "Kontor", 1300, 2795, 3, "jævn", 0.05, 30, 4, 100, 0],
  ["6001", "Hynde Hør", "Tilbehør", 120, 295, 10, "jævn", 0.10, 14, 2, 50, 0],
  ["6002", "Spejl rundt Ø80", "Tilbehør", 690, 1595, 4, "jævn", 0.0, 21, 9, 70, 0],
  ["6003", "Glasplade til bord", "Tilbehør", 450, 995, 1, "sporadisk", 0.0, 21, 9, 100, 0],
  ["6004", "Møbelfødder Messing, 4 stk.", "Tilbehør", 85, 220, 6, "jævn", 0.05, 14, 5, 60, 0],
  ["6005", "Stabelvogn til stole", "Tilbehør", 1450, 2995, 1, "sporadisk", 0.0, 30, 4, 400, 0],
];
const SERVICE = { number: "9001", name: "Levering og montering", group: "Ydelser", costPrice: 0, salesPrice: 0, inventoryEnabled: false, inventory: null };

export function sampleInventory({ invoices, suppliers, end }) {
  const r = rng(424242);
  const lines = [];
  const discontinued = end - 270 * DAY, launched = end - 150 * DAY;
  const weight = (p, t) => {
    const [, , , , , pop, pattern, growth] = p;
    if (pattern === "udgået" && t > discontinued) return 0;
    if (pattern === "ny") return t < launched ? 0 : pop * Math.min(1, 0.3 + (t - launched) / (90 * DAY));
    return pop * Math.pow(1 + growth, (t - end) / (365 * DAY));
  };
  const quantity = (pattern) => {
    if (pattern === "klumpet") return r() < 0.22 ? 8 + Math.floor(r() * 28) : 1 + Math.floor(r() * 2);
    if (pattern === "sporadisk") return 1;
    return 1 + Math.floor(-Math.log(1 - r()) * 1.4);
  };

  for (const inv of [...invoices].sort((a, b) => a.number - b.number)) {
    const t = Date.parse(inv.date + "T00:00:00Z");
    const net = inv.amount / 1.25;
    let left = net * (0.9 + r() * 0.06); // the rest is delivery and assembly
    const ws = PRODUCTS.map((p) => weight(p, t)), total = ws.reduce((s, w) => s + w, 0);
    const discount = inv.amount > 30000 ? 0.08 : 0;
    for (let tries = 0; tries < 12 && left > 150; tries++) {
      let x = r() * total, i = 0;
      while (x > ws[i]) x -= ws[i++];
      const p = PRODUCTS[Math.min(i, PRODUCTS.length - 1)];
      const price = Math.round(p[4] * (1 - discount) * 100) / 100;
      const q = Math.min(quantity(p[6]), Math.floor(left / price));
      if (q < 1) continue;
      const same = lines.find((l) => l.invoice === inv.number && l.product === p[0]);
      if (same) same.quantity += q;
      else lines.push({ date: inv.date, invoice: inv.number, customer: inv.customer, product: p[0], quantity: q, unitNetPrice: price, unitCostPrice: p[3] });
      left -= q * price;
    }
    const used = lines.filter((l) => l.invoice === inv.number).reduce((s, l) => s + l.quantity * l.unitNetPrice, 0);
    lines.push({ date: inv.date, invoice: inv.number, customer: inv.customer, product: SERVICE.number, quantity: 1,
      unitNetPrice: Math.round((net - used) * 100) / 100, unitCostPrice: 0 });
  }

  // Stock today: a number of days of the last 13 weeks' sales (plus a fixed remainder for the discontinued table).
  const recent = {};
  for (const l of lines) if (Date.parse(l.date + "T00:00:00Z") > end - 91 * DAY) recent[l.product] = (recent[l.product] || 0) + l.quantity;
  const products = PRODUCTS.map(([number, name, group, cost, price, , pattern, , lead, supplier, cover, onOrder]) => {
    const perDay = (recent[number] || 0) / 91;
    const inStock = pattern === "udgået" ? 85 : Math.round(perDay * cover);
    const orderedByCustomers = Math.min(inStock, Math.round(perDay * 2 * r()));
    const ordered = onOrder ? Math.round(perDay * onOrder) : 0;
    return {
      number, name, group, costPrice: cost, salesPrice: price, inventoryEnabled: true,
      inventory: { inStock, orderedByCustomers, available: inStock - orderedByCustomers, orderedFromSuppliers: ordered },
      leadTimeDays: lead, supplier: suppliers[supplier - 1]?.name,
    };
  });
  return { products: [...products, SERVICE], lines, hasStock: true, notes: [] };
}
