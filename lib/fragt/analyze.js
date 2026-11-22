// Joins shipments (Shipmondo), delivery events (Shipment Monitor webhooks), returns and
// reviews (Trustpilot referenceId = order id), and answers:
//   1. Which carrier delivers on the promised date?
//   2. Do late deliveries cause more returns and worse reviews (adjusted for product category)?
//   3. What does each carrier really cost per parcel once the cost of delays is included?
import { region, addBusinessDays } from "./sample.js";

const DAY = 86400000;
const dayStart = (iso) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + f(x), 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
const round = (x, n = 1) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
// Carrier codes as in the sample data and in Shipmondo; anything else is shown by its code.
const CARRIER_NAMES = {
  postnord: "PostNord", post_nord: "PostNord", pdk: "PostNord", gls: "GLS", gls_de: "GLS Tyskland", dao: "DAO", bring: "Bring",
  dhl_express: "DHL Express", dhl_parcel: "DHL Parcel", ups: "UPS", fed_ex: "FedEx", dpd: "DPD", budbee: "Budbee",
  burd: "Burd", airmee: "Airmee", instabox: "Instabox", helthjem: "Helthjem", dfm: "Danske Fragtmænd", danx: "DANX",
  dsv: "DSV", db_schenker: "DB Schenker", tnt: "TNT", deutsche_post: "Deutsche Post", post_nl: "PostNL", posti: "Posti",
};
const carrierName = (c) => CARRIER_NAMES[c] || c;
// "1-2 days", "2 days", "1-3" → the highest number of days; default 2 business days.
const maxTransitDays = (t) => {
  const nums = String(t ?? "").match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : 2;
};
const BUCKETS = ["Til tiden", "1 dag for sent", "2 dage for sent", "3+ dage for sent"];
const WEEKDAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const REGIONS = ["Hovedstaden", "Sjælland", "Fyn", "Sydjylland", "Midtjylland", "Nordjylland"];

function businessDaysBetween(a, b) {
  // Business days from a to b (positive if b is after a).
  if (b === a) return 0;
  if (b < a) return -businessDaysBetween(b, a);
  let n = 0;
  for (let d = a + DAY; d <= b; d += DAY) {
    const w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export function analyze(data, { returnCost = 250 } = {}) {
  const products = new Map(data.products.map((p) => [p.product_code, p]));
  const orders = new Map(data.orders.map((o) => [o.order_id, o]));
  const delivered = new Map();
  for (const e of data.monitorEvents) if (e.current_status === "DELIVERED") delivered.set(e.shipment_id, e.current_status_registered_at);
  const reviews = new Map(data.reviews.map((r) => [r.referenceId, r]));

  // One row per outbound parcel that has been delivered.
  const rows = [];
  for (const s of data.shipments) {
    if (s.origin_shipment_id || s.source_type === "return") continue;
    const prod = products.get(s.product_code);
    const at = delivered.get(s.id);
    if (!at) continue;
    const ship = dayStart(s.created_at);
    const maxTransit = maxTransitDays(prod?.expected_transit_time);
    const promised = addBusinessDays(ship, maxTransit);
    const lateDays = Math.max(0, businessDaysBetween(promised, dayStart(at)));
    const order = orders.get(s.order_id) || {};
    rows.push({
      carrier: s.carrier_code,
      servicePoint: !!s.service_point,
      price: Number(s.price) || 0,
      region: region(Number(s.receiver?.zipcode)),
      weekday: new Date(ship).getUTCDay(),
      month: s.created_at.slice(0, 7),
      shipDay: ship,
      transit: businessDaysBetween(ship, dayStart(at)),
      lateDays,
      bucket: Math.min(lateDays, 3),
      category: order.category || "Ukendt",
      returned: !!s.return_shipment_id,
      stars: reviews.get(s.order_id)?.stars ?? null,
    });
  }

  // ---- Effect of delay, adjusted for product category (direct standardisation) ----
  const categories = [...new Set(rows.map((r) => r.category))];
  const catShare = new Map(categories.map((c) => [c, rows.filter((r) => r.category === c).length / rows.length]));
  const rateBy = (xs, f) => {
    const g = xs.filter(f);
    return g.length ? g.filter((r) => r.returned).length / g.length : null;
  };
  const adjustedReturnRate = (bucket) => {
    let total = 0, weight = 0;
    for (const c of categories) {
      const rate = rateBy(rows, (r) => r.bucket === bucket && r.category === c);
      if (rate == null) continue;
      total += rate * catShare.get(c);
      weight += catShare.get(c);
    }
    return weight ? total / weight : null;
  };
  const delayEffect = BUCKETS.map((label, b) => {
    const g = rows.filter((r) => r.bucket === b);
    const rated = g.filter((r) => r.stars != null);
    return {
      label,
      parcels: g.length,
      returnRateRaw: round(rateBy(rows, (r) => r.bucket === b), 4),
      returnRate: round(adjustedReturnRate(b), 4),
      avgStars: round(avg(rated.map((r) => r.stars)), 2),
      reviews: rated.length,
      lowReviewShare: rated.length ? round(rated.filter((r) => r.stars <= 2).length / rated.length, 3) : null,
    };
  });
  const base = delayEffect[0].returnRate || 0;
  const uplift = delayEffect.map((d) => (base && d.returnRate != null ? d.returnRate / base : 1));
  const baseByCat = new Map(categories.map((c) => [c, rateBy(rows, (r) => r.bucket === 0 && r.category === c) || 0]));

  // ---- Per carrier ----
  const carrierCodes = [...new Set(rows.map((r) => r.carrier))]
    .sort((a, b) => rows.filter((r) => r.carrier === b).length - rows.filter((r) => r.carrier === a).length);
  const carriers = carrierCodes.map((c) => {
    const g = rows.filter((r) => r.carrier === c);
    const late = g.filter((r) => r.lateDays > 0);
    const rated = g.filter((r) => r.stars != null);
    // Extra returns caused by delays: for each late parcel, its category's on-time return rate × (uplift − 1).
    const extraReturns = sum(late, (r) => baseByCat.get(r.category) * Math.max(0, uplift[r.bucket] - 1));
    const delayCost = extraReturns * returnCost;
    const avgPrice = avg(g.map((r) => r.price));
    return {
      code: c,
      name: carrierName(c),
      parcels: g.length,
      share: round(g.length / rows.length, 3),
      onTime: round(1 - late.length / g.length, 3),
      avgLateWhenLate: round(avg(late.map((r) => r.lateDays))),
      avgTransit: round(avg(g.map((r) => r.transit))),
      returnRate: round(g.filter((r) => r.returned).length / g.length, 4),
      avgStars: round(avg(rated.map((r) => r.stars)), 2),
      reviews: rated.length,
      avgPrice: round(avgPrice, 2),
      extraReturns: round(extraReturns, 0),
      delayCostPerParcel: round(delayCost / g.length, 2),
      realPricePerParcel: round(avgPrice + delayCost / g.length, 2),
      servicePointOnTime: round(onTimeOf(g.filter((r) => r.servicePoint)), 3),
      homeOnTime: round(onTimeOf(g.filter((r) => !r.servicePoint)), 3),
    };
  });

  function onTimeOf(xs) {
    return xs.length ? 1 - xs.filter((r) => r.lateDays > 0).length / xs.length : null;
  }

  // ---- Where and when: on-time share by region and weekday, per carrier ----
  const byRegion = REGIONS.map((reg) => ({
    label: reg,
    values: carriers.map((c) => {
      const g = rows.filter((r) => r.carrier === c.code && r.region === reg);
      return { carrier: c.code, onTime: round(onTimeOf(g), 3), parcels: g.length };
    }),
  }));
  const byWeekday = [1, 2, 3, 4, 5].map((w) => ({
    label: WEEKDAYS[w],
    values: carriers.map((c) => {
      const g = rows.filter((r) => r.carrier === c.code && r.weekday === w);
      return { carrier: c.code, onTime: round(onTimeOf(g), 3), parcels: g.length };
    }),
  }));
  const peak = rows.filter((r) => /-(11|12)$/.test(r.month));
  const rest = rows.filter((r) => !/-(11|12)$/.test(r.month));

  // ---- Plain-language findings ----
  const pct = (x) => Math.round(x * 100) + " %";
  const kr = (x) => x.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr.";
  const stars = (x) => x.toLocaleString("da-DK");
  const best = [...carriers].sort((a, b) => b.onTime - a.onTime)[0];
  const worst = [...carriers].sort((a, b) => a.onTime - b.onTime)[0];
  const cheapest = [...carriers].sort((a, b) => a.avgPrice - b.avgPrice)[0];
  const realCheapest = [...carriers].sort((a, b) => a.realPricePerParcel - b.realPricePerParcel)[0];
  const weakest = [];
  for (const row of byRegion) for (const v of row.values) if (v.parcels >= 100) weakest.push({ region: row.label, ...v });
  weakest.sort((a, b) => a.onTime - b.onTime);

  const insights = [];
  if (best && worst && best !== worst) insights.push(`${best.name} leverer til tiden ${pct(best.onTime)} af gangene, ${worst.name} kun ${pct(worst.onTime)}.`);
  if (!rows.length) insights.push("Der er endnu ingen leverede pakker at analysere.");
  if (delayEffect[0].returnRate && delayEffect[3].returnRate) {
    insights.push(`Pakker, der kommer 3+ dage for sent, bliver returneret ${round((uplift[3] - 1) * 100, 0)} % oftere end pakker til tiden, også når der er justeret for produktkategori.`);
  }
  if (delayEffect[0].avgStars && delayEffect[3].avgStars) {
    insights.push(`Anmeldelserne falder fra ${delayEffect[0].avgStars.toLocaleString("da-DK")} stjerner ved levering til tiden til ${delayEffect[3].avgStars.toLocaleString("da-DK")} ved 3+ dages forsinkelse.`);
  }
  if (cheapest && realCheapest && cheapest !== realCheapest) {
    insights.push(`${cheapest.name} er billigst på fragtprisen, men når forsinkelsernes ekstra returneringer regnes med, er ${realCheapest.name} billigst: ${kr(realCheapest.realPricePerParcel)} mod ${kr(cheapest.realPricePerParcel)} pr. pakke.`);
  } else if (cheapest) {
    const bestStars = [...carriers].filter((c) => c.avgStars != null).sort((a, b) => b.avgStars - a.avgStars)[0];
    if (bestStars && cheapest.avgStars != null && bestStars !== cheapest) {
      insights.push(`${cheapest.name} er stadig billigst med forsinkelsernes returneringer regnet med (${kr(cheapest.realPricePerParcel)} pr. pakke), men giver de laveste anmeldelser: ${stars(cheapest.avgStars)} stjerner mod ${stars(bestStars.avgStars)} hos ${bestStars.name}.`);
    }
  }
  if (weakest[0]) {
    const w = weakest[0];
    insights.push(`Det svageste sted er ${carrierName(w.carrier)} i ${w.region}: kun ${pct(w.onTime)} til tiden.`);
  }
  if (peak.length && rest.length) {
    insights.push(`I november og december falder leveringspræcisionen fra ${pct(onTimeOf(rest))} til ${pct(onTimeOf(peak))} på tværs af fragtfirmaer.`);
  }

  const result = {
    shop: data.shop,
    source: data.source,
    asOf: data.asOf,
    notes: data.notes || [],
    returnCost,
    totals: {
      parcels: rows.length,
      onTime: round(onTimeOf(rows), 3),
      returnRate: rows.length ? round(rows.filter((r) => r.returned).length / rows.length, 4) : null,
      avgStars: round(avg(rows.filter((r) => r.stars != null).map((r) => r.stars)), 2),
      reviews: rows.filter((r) => r.stars != null).length,
      delayCost: round(sum(carriers, (c) => c.delayCostPerParcel * c.parcels), 0),
    },
    carriers,
    delayEffect,
    byRegion,
    byWeekday,
    insights,
    method: "Lovet leveringsdato = afsendelsesdag + produktets maksimale forventede leveringstid i hverdage. Returrater er justeret for produktkategori, så fx tøj (som returneres oftere) ikke forvrænger sammenligningen. Ekstra returneringer pr. fragtfirma = for hver forsinket pakke: kategoriens returrate ved levering til tiden × den målte stigning ved den forsinkelse.",
  };
  // Parcel-level rows for lib/fragt/stats.js; hidden from the JSON output.
  Object.defineProperty(result, "_rows", { value: rows });
  return result;
}
