// Inventory management from invoice lines and stock figures.
//
// Per product:
// 1. Daily and weekly sales (units) from the invoice lines, up to 104 weeks back.
// 2. Demand pattern (Syntetos–Boylan): how often it sells (ADI) and how much the order sizes vary (CV²):
//    jævn, svingende, sporadisk or klumpet. ABC class by revenue the last 12 months (80/15/5 %).
// 3. Three forecast models on season-adjusted weekly sales: 13-week average, exponential smoothing and
//    Croston (SBA, made for products that sell now and then). Each is backtested from 26 earlier weeks on
//    what matters for ordering: total sales over the lead time. The model with the lowest error is used.
// 4. Safety stock = k × the chosen model's own backtest error (RMSE) over the lead time, where k is the
//    t-quantile for the service level with a prediction-interval correction for the number of backtest points.
//    So the buffer is as large as the forecast has actually been wrong, not a textbook assumption. Reorder point = expected
//    sales over the lead time + safety stock. Order size = economic order quantity (EOQ).
// 5. Checks on stock: what to order now, risk of running out before a delivery arrives, dead stock and
//    overstock (capital that could be freed).
// The season is shared across products (from total revenue per calendar month), because one product's
// season is too noisy to estimate on its own.
import { mean, sum, sd, round, normCdf, normInv, tInv } from "./stats.js";

const DAY = 86400000;
const toT = (d) => Date.parse(d + "T00:00:00Z");
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const MON = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const dato = (t) => { const d = new Date(t); return `${d.getUTCDate()}. ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const kr = (x) => Math.round(x).toLocaleString("da-DK") + " kr.";
const pct = (x, d = 0) => (x * 100).toLocaleString("da-DK", { maximumFractionDigits: d }) + " %";
const stk = (x) => `${(Math.abs(x) < 10 && x % 1 ? round(x, 1) : Math.round(x)).toLocaleString("da-DK")} stk.`;
const tidy = (s) => s.replace(/kr\.\./g, "kr.").replace(/stk\.\./g, "stk.");

const WEEKS = 104, ORIGINS = 26, MIN_TRAIN = 13;
export const DEFAULTS = { leadTimeDays: 14, orderCost: 500, holdingRate: 0.2, service: { A: 0.97, B: 0.95, C: 0.9 } };

// ---------------- Season (shared) ----------------
// Classical decomposition on monthly revenue: value / centred 12-month average, averaged per calendar month.
function seasonIndex(lines, end) {
  const byMonth = new Map();
  for (const l of lines) { const k = l.date.slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + l.quantity * l.unitNetPrice); }
  const lastFull = iso(end - DAY).slice(0, 7) === iso(end).slice(0, 7) ? null : iso(end - DAY).slice(0, 7);
  const months = [...byMonth.keys()].sort();
  const first = months[0];
  const keys = [];
  if (first) {
    for (let d = new Date(first + "-01T00:00:00Z"); ; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const k = d.toISOString().slice(0, 7);
      if (k >= iso(end).slice(0, 7) && k !== lastFull) break;
      keys.push(k);
      if (keys.length > 200) break;
    }
  }
  // Drop the first month if it is partial.
  const firstDay = lines.reduce((m, l) => (l.date < m ? l.date : m), "9999");
  if (keys.length && Number(firstDay.slice(8, 10)) > 5) keys.shift();
  const v = keys.map((k) => byMonth.get(k) || 0);
  if (v.length < 24) return { index: Array(12).fill(1), used: false, months: v.length };
  const ratios = Array.from({ length: 12 }, () => []);
  for (let i = 6; i < v.length - 6; i++) {
    const cma = (sum(v.slice(i - 6, i + 6)) + sum(v.slice(i - 5, i + 7))) / 24;
    if (cma > 0) ratios[Number(keys[i].slice(5, 7)) - 1].push(v[i] / cma);
  }
  let index = ratios.map((r) => (r.length ? mean(r) : 1));
  const m = mean(index);
  index = index.map((x) => x / m);
  return { index, used: true, months: v.length };
}

// ---------------- Models on season-adjusted weekly sales ----------------
function ses(y, alpha) {
  let level = mean(y.slice(0, Math.min(4, y.length))), err = 0;
  for (let t = 0; t < y.length; t++) { err += (y[t] - level) ** 2; level += alpha * (y[t] - level); }
  return { level, err };
}
const MODELS = [
  { name: "gennemsnit", label: "Gennemsnit af de seneste 13 uger", rate: (y) => mean(y.slice(-13)) },
  { name: "udjævning", label: "Eksponentiel udjævning", rate: (y) => {
    let best = null;
    for (const a of [0.05, 0.1, 0.2, 0.3, 0.5]) { const r = ses(y, a); if (!best || r.err < best.err) best = r; }
    return best.level;
  } },
  { name: "croston", label: "Croston (SBA, til varer der sælger ind imellem)", rate: (y) => {
    const a = 0.1;
    let z = null, p = null, q = 1;
    for (const x of y) {
      if (x > 0) {
        if (z == null) { z = x; p = q; } else { z += a * (x - z); p += a * (q - p); }
        q = 1;
      } else q++;
    }
    return z == null ? 0 : (1 - a / 2) * z / p;
  } },
];

// Syntetos–Boylan: average interval between selling weeks (ADI) and squared CV of the sizes.
function pattern(weekly) {
  const nz = weekly.filter((x) => x > 0);
  if (!nz.length) return { mønster: "intet salg", adi: null, cv2: null };
  const adi = weekly.length / nz.length;
  const cv2 = nz.length > 1 ? (sd(nz) / mean(nz)) ** 2 : 0;
  const m = adi < 1.32 ? (cv2 < 0.49 ? "jævn" : "svingende") : (cv2 < 0.49 ? "sporadisk" : "klumpet");
  return { mønster: m, adi: round(adi, 2), cv2: round(cv2, 2) };
}

// ---------------- The analysis ----------------
// inv = { products, lines, hasStock, notes }; asOf = "YYYY-MM-DD".
// opts: leadTimeDays (overrides every product), service (overrides the ABC defaults), orderCost, holdingRate.
export function inventoryAnalysis(inv, asOf, opts = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v != null)) };
  const end = toT(asOf) + DAY; // exclusive: sales on asOf count
  const D = WEEKS * 7, start = end - D * DAY;
  const anyEnabled = inv.products.some((p) => p.inventoryEnabled);
  const sold = new Set(inv.lines.map((l) => l.product));
  const products = inv.products.filter((p) => (anyEnabled ? p.inventoryEnabled : sold.has(p.number)) && (!p.barred || (p.inventory?.inStock || 0) > 0));
  const ids = new Set(products.map((p) => p.number));
  const lines = inv.lines.filter((l) => ids.has(l.product) && toT(l.date) < end);
  const season = seasonIndex(lines, end);
  const sDay = (t) => season.index[new Date(t).getUTCMonth()];
  const leadSeason = (from, L) => { let s = 0; for (let d = 0; d < L; d++) s += sDay(from + d * DAY); return s; };

  // Daily units per product in the window, first sale, revenue and cost of goods sold the last 12 months.
  const daily = new Map(products.map((p) => [p.number, new Float64Array(D)]));
  const firstSale = new Map(), lastSale = new Map(), rev12 = new Map(), cogs12 = new Map();
  for (const l of lines) {
    const t = toT(l.date);
    if (!firstSale.has(l.product) || t < firstSale.get(l.product)) firstSale.set(l.product, t);
    if (!lastSale.has(l.product) || t > lastSale.get(l.product)) lastSale.set(l.product, t);
    if (t >= start) daily.get(l.product)[Math.floor((t - start) / DAY)] += l.quantity;
    if (t >= end - 365 * DAY) {
      rev12.set(l.product, (rev12.get(l.product) || 0) + l.quantity * l.unitNetPrice);
      cogs12.set(l.product, (cogs12.get(l.product) || 0) + l.quantity * l.unitCostPrice);
    }
  }
  const weekSeason = Array.from({ length: WEEKS }, (_, w) => leadSeason(start + w * 7 * DAY, 7) / 7);

  // ABC by revenue the last 12 months.
  const totalRev = sum([...rev12.values()]);
  const abc = new Map();
  let cum = 0;
  for (const p of [...products].sort((a, b) => (rev12.get(b.number) || 0) - (rev12.get(a.number) || 0))) {
    const r = rev12.get(p.number) || 0;
    abc.set(p.number, r <= 0 ? "C" : cum < 0.8 * totalRev ? "A" : cum < 0.95 * totalRev ? "B" : "C");
    cum += r;
  }

  const items = products.map((p) => {
    const dy = daily.get(p.number);
    const weekly = Array.from({ length: WEEKS }, (_, w) => sum(dy.subarray(w * 7, w * 7 + 7)));
    const adj = weekly.map((x, w) => x / weekSeason[w]);
    const fs = firstSale.has(p.number) ? Math.max(0, Math.floor((firstSale.get(p.number) - start) / (7 * DAY))) : WEEKS;
    const L = Math.max(1, Math.round(opts.leadTimeDays ?? p.leadTimeDays ?? DEFAULTS.leadTimeDays));
    const Lw = Math.ceil(L / 7);
    const cls = abc.get(p.number);
    const service = opts.service ?? DEFAULTS.service[cls];
    const z = normInv(service);
    // Multiplier for a prediction interval from n backtest errors (t instead of normal for small n).
    const kFor = (n) => (n >= 2 ? tInv(service, n - 1) * Math.sqrt(1 + 1 / n) : z);

    // Backtest: forecast total sales over the lead time from each of the last 26 possible origins.
    const origins = [];
    for (let ow = WEEKS - Lw - ORIGINS; ow < WEEKS - Lw; ow++) {
      if (ow - fs < MIN_TRAIN) continue;
      const from = start + ow * 7 * DAY;
      const actual = sum(dy.subarray(ow * 7, ow * 7 + L));
      const train = adj.slice(fs, ow);
      origins.push({ ow, actual, f: MODELS.map((m) => Math.max(0, m.rate(train)) / 7 * leadSeason(from, L)) });
    }
    const perModel = MODELS.map((m, k) => {
      const e = origins.map((x) => x.actual - x.f[k]);
      return { model: m.label, name: m.name, mae: e.length ? mean(e.map(Math.abs)) : null, rmse: e.length ? Math.sqrt(mean(e.map((x) => x * x))) : null,
        bias: e.length ? mean(e) : null };
    });
    const enough = origins.length >= 8;
    const best = enough ? perModel.reduce((b, m, k) => (m.mae < perModel[b].mae ? k : b), 0) : 0;
    const train = adj.slice(fs);
    const rate = train.length ? Math.max(0, MODELS[best].rate(train)) : 0; // season-adjusted units per week
    const mu = rate / 7 * leadSeason(end, L);
    let sigma, sigmaNote = null, k = z;
    if (enough) { sigma = perModel[best].rmse; k = kFor(origins.length); }
    else if (train.length >= 4) { sigma = (sd(train) || 0) * Math.sqrt(L / 7); sigmaNote = "kort historik: usikkerheden er skønnet ud fra ugesalgets spredning"; }
    else { sigma = Math.sqrt(mu); sigmaNote = "meget kort historik: usikkerheden er et groft skøn"; }

    // Out-of-sample check of the safety stock: each origin uses only errors from earlier, non-overlapping origins.
    const checks = [];
    for (let i = 0; i < origins.length; i++) {
      const prior = origins.slice(0, Math.max(0, i - Lw + 1)).map((x) => x.actual - x.f[best]);
      if (prior.length < 6) continue;
      const s = Math.sqrt(mean(prior.map((e) => e * e)));
      checks.push(origins[i].actual <= Math.ceil(origins[i].f[best] + kFor(prior.length) * s));
    }

    const safety = k * sigma;
    const rop = Math.ceil(mu + safety); // stock is held in whole units
    const annual = rate * 52;
    const eoq = p.costPrice > 0 && annual > 0 ? Math.sqrt((2 * annual * o.orderCost) / (o.holdingRate * p.costPrice)) : null;
    const st = p.inventory;
    const position = st ? st.available + st.orderedFromSuppliers : null;
    const perDay = mu / L;
    const orderNow = st != null && rate > 0 && position < rop; // rop = the whole units needed for the service level
    const orderQty = orderNow ? Math.max(Math.ceil(eoq || 1), Math.ceil(rop + (eoq || 0) - position)) : 0;
    const risk = st != null && sigma > 0 ? 1 - normCdf((position - mu) / sigma) : st != null ? (position < mu ? 1 : 0) : null;
    const cover = st != null && perDay > 0 ? st.available / perDay : null;
    const lastT = lastSale.get(p.number);
    const daysSinceSale = lastT != null ? Math.floor((end - DAY - lastT) / DAY) : null;
    const dead = st != null && st.inStock > 0 && (daysSinceSale == null || daysSinceSale > 180);
    const target = rop + (eoq || 0);
    const excessUnits = st != null && !dead && cover != null && cover > 180 ? Math.max(0, st.available - target) : 0;

    return {
      p, cls, service, L, rate, mu, sigma, sigmaNote, safety, rop, eoq, position, orderNow, orderQty, risk, cover, perDay,
      dead, daysSinceSale, excessUnits, perModel, best, origins, checks, pattern: pattern(weekly.slice(-52)), weekly,
      rev12: rev12.get(p.number) || 0, cogs12: cogs12.get(p.number) || 0, stockValue: st ? st.inStock * p.costPrice : null,
      weeksOfHistory: WEEKS - fs, newProduct: WEEKS - fs < 26,
    };
  });

  // Portfolio accuracy: chosen models vs the 13-week average, on the same origins.
  let absBest = 0, absMa = 0, act = 0, hits = 0, n = 0;
  const byPattern = {};
  for (const it of items) {
    if (it.origins.length < 8) continue;
    for (const x of it.origins) { absBest += Math.abs(x.actual - x.f[it.best]); absMa += Math.abs(x.actual - x.f[0]); act += x.actual; }
    hits += it.checks.filter(Boolean).length; n += it.checks.length;
    const b = byPattern[it.pattern.mønster] ??= { hits: 0, n: 0, service: [] };
    b.hits += it.checks.filter(Boolean).length; b.n += it.checks.length; if (it.checks.length) b.service.push(it.service);
  }
  const targetService = items.length ? mean(items.filter((it) => it.checks.length).map((it) => it.service)) : null;

  return {
    asOf, asOfT: toT(asOf), items, season, options: o, hasStock: !!inv.hasStock && items.some((it) => it.p.inventory),
    leadFromData: opts.leadTimeDays == null && items.some((it) => it.p.leadTimeDays != null),
    accuracy: act > 0 ? { wape: absBest / act, wapeMa: absMa / act, coverage: n ? hits / n : null, checks: n, target: targetService,
      byPattern: Object.entries(byPattern).filter(([, b]) => b.n).map(([m, b]) => ({ mønster: m, dækning: round(b.hits / b.n, 3), mål: round(mean(b.service), 3), kontroller: b.n })) } : null,
    notes: inv.notes || [],
  };
}

// ---------------- Output for the tools (Danish) ----------------
const pName = (it) => `${it.p.name} (${it.p.number})`;
const leadText = (r) => (r.leadFromData ? "Leveringstiden er pr. vare fra leverandørdata." :
  `Leveringstiden er sat til ${r.items[0]?.L ?? DEFAULTS.leadTimeDays} dage for alle varer (e-conomic har ikke leveringstider). Angiv leveringstid_dage, hvis jeres er en anden.`);

function itemRow(it) {
  const st = it.p.inventory;
  return {
    varenr: it.p.number, navn: it.p.name, gruppe: it.p.group ?? null, abc: it.cls, mønster: it.pattern.mønster,
    ...(st ? { på_lager: st.inStock, reserveret_til_kunder: st.orderedByCustomers, i_bestilling_hos_leverandør: st.orderedFromSuppliers, lagerposition: it.position } : {}),
    salg_pr_uge: round(it.mu / it.L * 7, 1), leveringstid_dage: it.L,
    salg_i_leveringstiden: round(it.mu, 1), sikkerhedslager: Math.ceil(it.safety), genbestillingspunkt: Math.ceil(it.rop),
    økonomisk_ordrestørrelse: it.eoq ? Math.ceil(it.eoq) : null, servicegrad: it.service,
    ...(st ? { dages_dækning: it.cover == null ? null : Math.round(it.cover), risiko_udsolgt_før_levering: round(it.risk, 2) } : {}),
    ...(it.p.supplier ? { leverandør: it.p.supplier } : {}),
  };
}

export function reorderList(r) {
  if (!r.hasStock) {
    return {
      lagertal: false,
      genbestillingspunkter: r.items.filter((it) => it.rate > 0).sort((a, b) => b.rev12 - a.rev12).slice(0, 40).map(itemRow),
      fund: ["e-conomics lagermodul er ikke slået til (eller ingen varegrupper har lagerstyring), så beholdningen kendes ikke. Her er genbestillingspunkterne: bestil, når lager plus det, der er i bestilling, kommer under genbestillingspunktet."],
      forudsætninger: [leadText(r)], bemærkninger: r.notes,
    };
  }
  const now = r.items.filter((it) => it.orderNow).sort((a, b) => b.risk - a.risk || (a.cover ?? 0) - (b.cover ?? 0));
  const soon = r.items.filter((it) => !it.orderNow && it.p.inventory && it.perDay > 0 && it.rate > 0 && (it.position - it.rop) / it.perDay <= 14)
    .sort((a, b) => (a.position - a.rop) / a.perDay - (b.position - b.rop) / b.perDay);
  const cost = sum(now, (it) => it.orderQty * it.p.costPrice);
  const fund = [];
  if (now.length) {
    fund.push(`${now.length} ${now.length === 1 ? "vare" : "varer"} er nået genbestillingspunktet og bør bestilles nu. Samlet indkøb: ${kr(cost)}.`);
    const urgent = now.filter((it) => it.risk >= 0.5);
    for (const it of urgent.slice(0, 3)) {
      const outDay = it.perDay > 0 ? r.asOfT + it.p.inventory.available / it.perDay * DAY : null;
      fund.push(`${pName(it)}: ${stk(it.p.inventory.available)} disponibelt, og der sælges ca. ${stk(it.mu / it.L * 7)} om ugen. ${outDay ? `Lageret slipper op omkring ${dato(outDay)}, ` : ""}men en ny levering tager ${it.L} dage. Risiko for at være udsolgt før levering: ${pct(it.risk)}.`);
    }
    const top = now.find((it) => it.risk < 0.5);
    if (top) fund.push(`${pName(top)}: bestil ${stk(top.orderQty)}. Lagerpositionen (${stk(top.position)}) er under genbestillingspunktet (${stk(Math.ceil(top.rop))}).`);
  } else fund.push("Ingen varer er nået genbestillingspunktet.");
  if (soon.length) fund.push(`Inden for 14 dage når ${soon.length} ${soon.length === 1 ? "vare" : "varer"} mere genbestillingspunktet: ${soon.slice(0, 4).map((it) => it.p.name).join(", ")}.`);
  const onOrder = r.items.filter((it) => it.p.inventory?.orderedFromSuppliers > 0 && it.p.inventory.available < it.mu && !it.orderNow);
  for (const it of onOrder.slice(0, 2)) fund.push(`${pName(it)} har lavt lager (${stk(it.p.inventory.available)}), men ${stk(it.p.inventory.orderedFromSuppliers)} er allerede i bestilling, så der skal ikke bestilles mere nu.`);
  return {
    lagertal: true,
    bestil_nu: now.map((it) => ({ ...itemRow(it), foreslået_antal: it.orderQty, indkøbspris: Math.round(it.orderQty * it.p.costPrice) })),
    samlet_indkøb_kr: Math.round(cost),
    snart: soon.map((it) => ({ varenr: it.p.number, navn: it.p.name, dage_til_genbestillingspunkt: Math.max(0, Math.round((it.position - it.rop) / it.perDay)) })),
    fund: fund.map(tidy),
    forudsætninger: [
      leadText(r),
      opts_service(r) != null ? `Servicegrad ${pct(opts_service(r), 1)} for alle varer.` : "Servicegrad efter ABC-klasse: A 97 %, B 95 %, C 90 % (sandsynligheden for ikke at løbe tør i en leveringsperiode).",
      `Ordrestørrelse = økonomisk ordrestørrelse (EOQ) med ${kr(r.options.orderCost)} pr. bestilling og ${pct(r.options.holdingRate)} om året i lageromkostning.`,
    ],
    metode: METHOD,
    bemærkninger: r.notes,
  };
}
const opts_service = (r) => (typeof r.options.service === "number" ? r.options.service : null);

const METHOD = "Salg pr. vare fra fakturalinjerne, justeret for sæson. Tre prognosemodeller (gennemsnit af 13 uger, eksponentiel udjævning og Croston) backtestes fra 26 tidligere uger på salget i leveringstiden, og modellen med mindst fejl bruges. Sikkerhedslager = modellens egen fejl (RMSE) i backtesten × t-fraktilen for servicegraden (prædiktionsinterval). Genbestillingspunkt = forventet salg i leveringstiden + sikkerhedslager, rundet op; der bestilles, når lagerpositionen kommer under det. Lagerposition = disponibelt + i bestilling hos leverandør.";

export function inventoryOverview(r) {
  const its = r.items;
  const withStock = its.filter((it) => it.p.inventory);
  const value = sum(withStock, (it) => it.stockValue);
  const cogs = sum(its, (it) => it.cogs12);
  const classes = ["A", "B", "C"].map((c) => {
    const xs = its.filter((it) => it.cls === c);
    return { klasse: c, varer: xs.length, andel_af_omsætning: round(sum(xs, (it) => it.rev12) / (sum(its, (it) => it.rev12) || 1), 3),
      ...(r.hasStock ? { lagerværdi: Math.round(sum(xs, (it) => it.stockValue || 0)) } : {}) };
  });
  const patterns = {};
  for (const it of its) patterns[it.pattern.mønster] = (patterns[it.pattern.mønster] || 0) + 1;
  const dead = withStock.filter((it) => it.dead).sort((a, b) => b.stockValue - a.stockValue);
  const over = withStock.filter((it) => it.excessUnits > 0).sort((a, b) => b.excessUnits * b.p.costPrice - a.excessUnits * a.p.costPrice);
  const deadValue = sum(dead, (it) => it.stockValue), overValue = sum(over, (it) => it.excessUnits * it.p.costPrice);
  const now = withStock.filter((it) => it.orderNow);
  const risky = withStock.filter((it) => it.risk >= 0.25 && it.rate > 0).sort((a, b) => b.risk - a.risk);
  const acc = r.accuracy;

  const fund = [];
  if (r.hasStock) {
    fund.push(`Lageret er ${kr(value)} værd (kostpris). Med et vareforbrug på ${kr(cogs)} det seneste år svarer det til ${Math.round(value / (cogs || 1) * 365)} dages salg.`);
    if (now.length) fund.push(`${now.length} ${now.length === 1 ? "vare" : "varer"} bør bestilles nu (brug genbestilling for antal).${risky.length ? ` Størst risiko for at blive udsolgt: ${risky.slice(0, 3).map((it) => `${it.p.name} (${pct(it.risk)})`).join(", ")}.` : ""}`);
    if (dead.length) fund.push(`Død beholdning: ${dead.map((it) => `${it.p.name} (${stk(it.p.inventory.inStock)}, ${kr(it.stockValue)})`).join(", ")} er ikke solgt i over 180 dage.`);
    if (over.length) fund.push(`Overlager: ${over.slice(0, 3).map((it) => `${it.p.name} har ${Math.round(it.cover)} dages salg på lager`).join("; ")}. Ca. ${kr(overValue)} kunne frigøres ved at sælge ned til genbestillingspunkt plus én ordre.`);
    if (dead.length || over.length) fund.push(`I alt binder død beholdning og overlager ca. ${kr(deadValue + overValue)}, som kunne styrke likviditeten.`);
  } else {
    fund.push("Beholdningen kendes ikke, fordi e-conomics lagermodul ikke er slået til. Salgsmønstre og genbestillingspunkter kan stadig beregnes.");
  }
  const a = its.filter((it) => it.cls === "A");
  fund.push(`${a.length} af ${its.length} varer (A-varer) står for ${pct(classes[0].andel_af_omsætning)} af omsætningen det seneste år.`);
  if (acc) {
    fund.push(`Træfsikkerhed: prognosen for salget i leveringstiden ramte i backtesten ${pct(acc.wape)} ved siden af (WAPE) mod ${pct(acc.wapeMa)} for et simpelt 13-ugers gennemsnit.`);
    if (acc.coverage != null) fund.push(`Sikkerhedslageret ville have dækket salget i ${pct(acc.coverage)} af leveringsperioderne i backtesten (mål: ${pct(acc.target)}).${acc.coverage < acc.target - 0.03 ? " Det er under målet, så sikkerhedslagrene er formentlig for små." : ""}`);
    const weak = acc.byPattern.filter((b) => b.kontroller >= 30 && b.dækning < b.mål - 0.02);
    for (const b of weak) fund.push(`For varer med ${b.mønster} efterspørgsel dækkede sikkerhedslageret kun ${pct(b.dækning)} (mål ${pct(b.mål)}). Store enkeltordrer er svære at forudse, så overvej en højere servicegrad for dem.`);
  }
  const fresh = its.filter((it) => it.newProduct && it.rate > 0);
  if (fresh.length) fund.push(`Nye varer med under et halvt års salg: ${fresh.map((it) => it.p.name).join(", ")}. Prognoserne for dem er usikre.`);

  return {
    lagertal: r.hasStock,
    varer: its.length,
    ...(r.hasStock ? { lagerværdi_kostpris: Math.round(value), vareforbrug_12m: Math.round(cogs), lagerdage: Math.round(value / (cogs || 1) * 365),
      omsætningshastighed: round(cogs / (value || 1), 1) } : {}),
    abc: classes,
    efterspørgselsmønstre: patterns,
    ...(r.hasStock ? {
      bestil_nu: now.length,
      højest_risiko_for_udsolgt: risky.slice(0, 5).map((it) => ({ varenr: it.p.number, navn: it.p.name, risiko: round(it.risk, 2), disponibelt: it.p.inventory.available, dages_dækning: Math.round(it.cover), leveringstid_dage: it.L })),
      død_beholdning: dead.map((it) => ({ varenr: it.p.number, navn: it.p.name, på_lager: it.p.inventory.inStock, værdi: Math.round(it.stockValue), dage_siden_salg: it.daysSinceSale })),
      overlager: over.map((it) => ({ varenr: it.p.number, navn: it.p.name, på_lager: it.p.inventory.inStock, dages_dækning: Math.round(it.cover), overskud_stk: Math.round(it.excessUnits), overskud_kr: Math.round(it.excessUnits * it.p.costPrice) })),
      bundet_kapital_kr: Math.round(deadValue + overValue),
    } : {}),
    prognosens_træfsikkerhed: acc ? { wape: round(acc.wape, 3), wape_13_ugers_gennemsnit: round(acc.wapeMa, 3), sikkerhedslager_dækning: round(acc.coverage, 3), mål: round(acc.target, 3), kontroller: acc.checks,
      dækning_pr_mønster: acc.byPattern } : null,
    sæson: r.season.used ? Object.fromEntries(r.season.index.map((x, i) => [MON[i], round(x, 2)])) : `ikke brugt (kræver 24 hele måneder, der er ${r.season.months})`,
    fund: fund.map(tidy),
    forudsætninger: [leadText(r)],
    metode: METHOD + " Mønster efter Syntetos–Boylan: ADI (gennemsnitligt antal uger mellem salg) under/over 1,32 og CV² af ordrestørrelser under/over 0,49. ABC: A = varerne bag de første 80 % af omsætningen, B = de næste 15 %, C = resten.",
    bemærkninger: r.notes,
  };
}

export function productDetail(r, query) {
  const q = String(query || "").toLowerCase().trim();
  const hits = r.items.filter((it) => it.p.number.toLowerCase() === q || it.p.name.toLowerCase().includes(q));
  if (!hits.length) return { fejl: `Ingen vare matcher "${query}".`, varer: r.items.slice(0, 50).map((it) => `${it.p.number} ${it.p.name}`) };
  if (hits.length > 1 && !hits.some((it) => it.p.number.toLowerCase() === q)) return { flere_varer_matcher: hits.map((it) => ({ varenr: it.p.number, navn: it.p.name })) };
  const it = hits.find((x) => x.p.number.toLowerCase() === q) || hits[0];
  const fund = [];
  fund.push(`${pName(it)} er en ${it.cls}-vare med ${it.pattern.mønster === "intet salg" ? "intet salg det seneste år" : `${it.pattern.mønster} efterspørgsel`}. Der sælges ca. ${stk(it.mu / it.L * 7)} om ugen lige nu (sæsonjusteret prognose).`);
  if (it.p.inventory) {
    if (it.orderNow) fund.push(`Bør bestilles nu: ${stk(it.orderQty)} (${kr(it.orderQty * it.p.costPrice)}). Risiko for at være udsolgt før levering: ${pct(it.risk)}.`);
    else if (it.dead) fund.push(`Ikke solgt i ${it.daysSinceSale ?? "over 180"} dage, men der ligger ${stk(it.p.inventory.inStock)} på lager (${kr(it.stockValue)}).`);
    else fund.push(`Lageret dækker ca. ${Math.round(it.cover)} dages salg. Der skal bestilles, når lagerpositionen kommer under ${stk(it.rop)}.`);
  }
  if (it.origins.length >= 8) fund.push(`Bedste model i backtesten: ${it.perModel[it.best].model}, gennemsnitlig fejl ${round(it.perModel[it.best].mae, 1).toLocaleString("da-DK")} stk. på salget i en leveringsperiode.`);
  if (it.sigmaNote) fund.push(`Bemærk: ${it.sigmaNote}.`);
  return {
    ...itemRow(it),
    salgspris: it.p.salesPrice, kostpris: it.p.costPrice, omsætning_12m: Math.round(it.rev12),
    adi: it.pattern.adi, cv2: it.pattern.cv2,
    salg_seneste_26_uger: it.weekly.slice(-26),
    modeller: it.perModel.map((m, k) => ({ model: m.model, valgt: k === it.best, gns_fejl_stk: round(m.mae, 1), rmse_stk: round(m.rmse, 1), bias_stk: round(m.bias, 1) })),
    backtest_oprindelser: it.origins.length,
    fund: fund.map(tidy),
    forudsætninger: [leadText(r)],
  };
}
