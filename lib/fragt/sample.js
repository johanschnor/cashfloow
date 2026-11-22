// A fictional webshop with 12 months of orders, shipments, returns and reviews.
// Field names follow Shipmondo (shipments, products, Shipment Monitor webhooks) and
// Trustpilot (private reviews with referenceId = order id).
// THE NUMBERS ARE MADE UP and say nothing about how the real carriers perform.

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

// Shipmondo-style products: carrier, product code, service point or home, expected transit time.
export const PRODUCTS = [
  { product_code: "PDK_MC", carrier_code: "postnord", name: "PostNord MyPack Collect", service_point: true, expected_transit_time: "1-2 days", price: 39 },
  { product_code: "PDK_MH", carrier_code: "postnord", name: "PostNord MyPack Home", service_point: false, expected_transit_time: "1-2 days", price: 55 },
  { product_code: "GLSDK_SD", carrier_code: "gls", name: "GLS PakkeShop", service_point: true, expected_transit_time: "1-2 days", price: 36 },
  { product_code: "GLSDK_HD", carrier_code: "gls", name: "GLS Privatlevering", service_point: false, expected_transit_time: "1-2 days", price: 52 },
  { product_code: "DAO_SP", carrier_code: "dao", name: "DAO Pakkeshop", service_point: true, expected_transit_time: "1-3 days", price: 33 },
  { product_code: "DAO_DIR", carrier_code: "dao", name: "DAO Direkte", service_point: false, expected_transit_time: "1-2 days", price: 45 },
  { product_code: "BRING_PP", carrier_code: "bring", name: "Bring Pakke til pakkeshop", service_point: true, expected_transit_time: "1-3 days", price: 37 },
  { product_code: "BRING_HD", carrier_code: "bring", name: "Bring Hjemlevering", service_point: false, expected_transit_time: "1-2 days", price: 54 },
];

// Made-up performance profiles: chance of being late, how late, and weak regions/days.
const PROFILE = {
  postnord: { late: 0.2, tail: 1.5, weakRegion: "Nordjylland", weakDay: 5 },
  gls:      { late: 0.09, tail: 1.1, weakRegion: "Fyn", weakDay: 4 },
  dao:      { late: 0.33, tail: 1.9, weakRegion: "Sydjylland", weakDay: 5 },
  bring:    { late: 0.14, tail: 1.3, weakRegion: "Hovedstaden", weakDay: 1 },
};
const MIX = [["PDK_MC", 0.22], ["PDK_MH", 0.06], ["GLSDK_SD", 0.24], ["GLSDK_HD", 0.06], ["DAO_SP", 0.2], ["DAO_DIR", 0.06], ["BRING_PP", 0.11], ["BRING_HD", 0.05]];

const CATEGORIES = [ // [name, share of orders, base return rate, avg order value]
  ["Tøj", 0.38, 0.21, 640], ["Sko", 0.17, 0.17, 820], ["Accessories", 0.2, 0.07, 310],
  ["Boligudstyr", 0.15, 0.05, 560], ["Sport", 0.1, 0.11, 720],
];
const ZIPS = [ // [zip range start, end, weight]
  [1000, 2990, 0.32], [3000, 4990, 0.17], [5000, 5990, 0.09], [6000, 6990, 0.12], [7000, 8990, 0.2], [9000, 9990, 0.1],
];
export function region(zip) {
  if (zip < 3000) return "Hovedstaden";
  if (zip < 5000) return "Sjælland";
  if (zip < 6000) return "Fyn";
  if (zip < 7000) return "Sydjylland";
  if (zip < 9000) return "Midtjylland";
  return "Nordjylland";
}

export function addBusinessDays(t, n) {
  let d = t;
  let left = n;
  while (left > 0) {
    d += DAY;
    const w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

function pick(r, pairs) {
  let x = r();
  for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

export function loadSample(asOf = new Date()) {
  const r = rng(424242);
  const end = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const start = end - 365 * DAY;
  const products = new Map(PRODUCTS.map((p) => [p.product_code, p]));

  const orders = [], shipments = [], monitorEvents = [], reviews = [];
  let orderNo = 50000, shipId = 900000;

  for (let day = start; day < end - 2 * DAY; day += DAY) {
    const date = new Date(day);
    const dow = date.getUTCDay();
    const month = date.getUTCMonth();
    const season = month === 10 ? 2.1 : month === 11 ? 1.8 : month === 0 ? 0.8 : 1; // Black Friday / Christmas peak
    const n = Math.round((32 + r() * 18) * season * (dow === 0 ? 0.6 : dow === 6 ? 0.7 : 1));
    for (let k = 0; k < n; k++) {
      const [cat, , baseReturn, aov] = pick(r, CATEGORIES.map((c) => [c, c[1]]));
      const zr = pick(r, ZIPS.map((z) => [z, z[2]]));
      const zip = Math.floor(zr[0] + r() * (zr[1] - zr[0]));
      const reg = region(zip);
      const code = pick(r, MIX);
      const prod = products.get(code);
      const prof = PROFILE[prod.carrier_code];
      const created = day + (8 + r() * 10) * 3600000;
      // Shipped next business day if ordered on a weekend.
      const shipDay = dow === 6 ? day + 2 * DAY : dow === 0 ? day + DAY : day;
      const maxTransit = Number(prod.expected_transit_time.split("-")[1]);
      const promised = addBusinessDays(shipDay, maxTransit);

      // Lateness: carrier profile, weak region/day, peak season.
      let pLate = prof.late * (reg === prof.weakRegion ? 1.9 : 1) * (new Date(shipDay).getUTCDay() === prof.weakDay ? 1.6 : 1) * (season > 1.5 ? 1.7 : 1) * (prod.service_point ? 1 : 0.85);
      let late = 0;
      if (r() < pLate) late = 1 + Math.floor(-Math.log(1 - r()) * prof.tail);
      const early = !late && r() < 0.55 ? 1 : 0; // many parcels arrive a day before the promised date
      const delivered = late ? addBusinessDays(promised, late) : early && maxTransit > 1 ? addBusinessDays(shipDay, maxTransit - 1) : promised;
      const deliveredAt = delivered + (10 + r() * 8) * 3600000;

      const orderId = String(++orderNo);
      const total = Math.round(aov * (0.5 + r()) * 100) / 100;
      orders.push({ order_id: orderId, created_at: iso(created), category: cat, total, receiver_zipcode: zip });

      const id = ++shipId;
      const deliveredInWindow = deliveredAt <= end;
      shipments.push({
        id, order_id: orderId, created_at: iso(shipDay + 15 * 3600000), carrier_code: prod.carrier_code, product_code: code,
        service_point: prod.service_point ? { id: "SP" + (zip % 97) } : null, price: String(prod.price),
        receiver: { zipcode: String(zip), country_code: "DK" }, return_shipment_id: null, origin_shipment_id: null,
      });
      if (deliveredInWindow) {
        monitorEvents.push({ shipment_id: id, current_status: "DELIVERED", current_status_registered_at: iso(deliveredAt), carrier_code: prod.carrier_code });
      }

      // Returns: base rate by category, higher when the parcel was late.
      const lateBoost = late === 0 ? 1 : late === 1 ? 1.18 : late === 2 ? 1.35 : 1.6;
      if (deliveredInWindow && r() < baseReturn * lateBoost) {
        const rid = ++shipId;
        const rdate = deliveredAt + (2 + r() * 12) * DAY;
        if (rdate <= end) {
          shipments[shipments.length - 1].return_shipment_id = rid;
          shipments.push({ id: rid, order_id: orderId, created_at: iso(rdate), carrier_code: prod.carrier_code, product_code: code + "_RET",
            service_point: null, price: "35", receiver: { zipcode: "8000", country_code: "DK" }, return_shipment_id: null, origin_shipment_id: id, source_type: "return" });
        }
      }

      // Reviews via invitations carrying the order id as referenceId.
      if (deliveredInWindow && r() < 0.24) {
        const penalty = late === 0 ? 0 : late === 1 ? 0.45 : late === 2 ? 0.9 : 1.5;
        const raw = 4.55 - penalty + (r() - 0.5) * 1.6 - (cat === "Tøj" ? 0.1 : 0);
        const stars = Math.max(1, Math.min(5, Math.round(raw)));
        const at = deliveredAt + (1 + r() * 6) * DAY;
        if (at <= end) reviews.push({ id: "r" + id, stars, createdAt: iso(at), referenceId: orderId });
      }
    }
  }

  return {
    shop: "Demo Webshop ApS (eksempeldata)",
    source: "Eksempeldata",
    asOf: isoDate(end),
    products: PRODUCTS,
    orders, shipments, monitorEvents, reviews,
  };
}
