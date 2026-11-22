// Monthly sales forecast with an honest measure of how wrong it tends to be.
//
// 1. Builds the monthly invoiced amount (full months only).
// 2. Tries several standard models: naive, seasonal naive, 3-month average, damped Holt (trend) and
//    Holt-Winters (trend + season, additive and multiplicative; needs two full years).
// 3. Backtests them with a rolling origin: for each of the last months, fit on the data before it and
//    forecast 1..H months ahead, then compare with what actually happened. Same origins for all models.
// 4. Picks the model with the lowest WAPE and builds prediction intervals from its own backtest errors.
import { mean, sum, round, normInv } from "./stats.js";

const MON = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const monthName = (key) => { const [y, m] = key.split("-").map(Number); return `${MON[m - 1]} ${y}`; };
const addMonths = (key, k) => { const [y, m] = key.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const kr = (x) => Math.round(x).toLocaleString("da-DK") + " kr.";
const pct = (x, d = 0) => (x * 100).toLocaleString("da-DK", { maximumFractionDigits: d }) + " %";

// Full calendar months of invoiced sales up to (not including) the month of asOf.
export function monthlySales(invoices, asOf) {
  const dated = invoices.filter((i) => i.date && i.date < asOf.slice(0, 7) + "-01");
  if (!dated.length) return [];
  const byMonth = new Map();
  for (const i of dated) byMonth.set(i.date.slice(0, 7), (byMonth.get(i.date.slice(0, 7)) || 0) + i.amount);
  const first = dated.reduce((m, i) => (i.date < m ? i.date : m), dated[0].date);
  // Skip the first month if the data starts after its first few days (a partial month).
  let start = first.slice(0, 7);
  if (Number(first.slice(8, 10)) > 5) start = addMonths(start, 1);
  const out = [];
  for (let k = start; k < asOf.slice(0, 7); k = addMonths(k, 1)) out.push({ month: k, value: byMonth.get(k) || 0 });
  return out;
}

// ---------------- Models ----------------
// Each model: fit(y) returns (h) => [forecast for 1..h]. minLength: shortest history it needs.
const grid = (xs) => xs;
function sse1(y, run) { const f = run(y); let s = 0; for (let t = 0; t < y.length; t++) if (f[t] != null) s += (y[t] - f[t]) ** 2; return s; }

const naive = { name: "naiv", label: "Naiv (sidste måned)", minLength: 1,
  fit: (y) => (h) => Array(h).fill(y[y.length - 1]) };
const snaive = { name: "saesonnaiv", label: "Sæsonnaiv (samme måned sidste år)", minLength: 12,
  fit: (y) => (h) => Array.from({ length: h }, (_, i) => y[y.length - 12 + (i % 12)]) };
const ma3 = { name: "gennemsnit3", label: "Gennemsnit af de seneste 3 måneder", minLength: 3,
  fit: (y) => { const m = mean(y.slice(-3)); return (h) => Array(h).fill(m); } };

// Damped Holt: level + damped trend.
function holtRun(y, a, b, phi) {
  let l = y[0], tr = y.length > 1 ? y[1] - y[0] : 0;
  const f = [null];
  for (let t = 1; t < y.length; t++) {
    f.push(l + phi * tr);
    const lPrev = l;
    l = a * y[t] + (1 - a) * (lPrev + phi * tr);
    tr = b * (l - lPrev) + (1 - b) * phi * tr;
  }
  return { f, l, tr };
}
const holt = { name: "holt", label: "Holt (dæmpet trend)", minLength: 6,
  fit: (y) => {
    let best = null;
    for (const a of grid([0.1, 0.2, 0.3, 0.5, 0.7, 0.9])) for (const b of grid([0.01, 0.05, 0.1, 0.2])) for (const phi of grid([0.8, 0.9, 0.98])) {
      const s = sse1(y, (yy) => holtRun(yy, a, b, phi).f);
      if (!best || s < best.s) best = { s, a, b, phi };
    }
    const { l, tr } = holtRun(y, best.a, best.b, best.phi);
    return (h) => Array.from({ length: h }, (_, i) => { let d = 0; for (let k = 1; k <= i + 1; k++) d += best.phi ** k; return l + d * tr; });
  } };

// Holt-Winters with damped trend, additive or multiplicative season of length 12.
function hwRun(y, a, b, g, phi, mult) {
  const m = 12;
  const s1 = mean(y.slice(0, m)), s2 = mean(y.slice(m, 2 * m));
  let l = s1, tr = (s2 - s1) / m;
  const season = y.slice(0, m).map((v) => (mult ? v / s1 : v - s1));
  const f = Array(m).fill(null);
  for (let t = m; t < y.length; t++) {
    const s = season[t % m];
    f.push(mult ? (l + phi * tr) * s : l + phi * tr + s);
    const lPrev = l;
    l = mult ? a * (y[t] / s) + (1 - a) * (lPrev + phi * tr) : a * (y[t] - s) + (1 - a) * (lPrev + phi * tr);
    tr = b * (l - lPrev) + (1 - b) * phi * tr;
    season[t % m] = mult ? g * (y[t] / l) + (1 - g) * s : g * (y[t] - l) + (1 - g) * s;
  }
  return { f, l, tr, season, n: y.length };
}
function hwModel(mult) {
  return { name: mult ? "holt_winters_mult" : "holt_winters_add", label: `Holt-Winters (trend og sæson, ${mult ? "multiplikativ" : "additiv"})`, minLength: 24,
    fit: (y) => {
      if (mult && y.slice(0, 12).some((v) => v <= 0)) return null;
      let best = null;
      for (const a of grid([0.1, 0.2, 0.3, 0.5, 0.7])) for (const b of grid([0.01, 0.05, 0.1])) for (const g of grid([0.05, 0.1, 0.2, 0.4])) {
        const s = sse1(y, (yy) => hwRun(yy, a, b, g, 0.95, mult).f);
        if (!best || s < best.s) best = { s, a, b, g };
      }
      const r = hwRun(y, best.a, best.b, best.g, 0.95, mult);
      return (h) => Array.from({ length: h }, (_, i) => {
        let d = 0; for (let k = 1; k <= i + 1; k++) d += 0.95 ** k;
        const s = r.season[(r.n + i) % 12];
        return mult ? (r.l + d * r.tr) * s : r.l + d * r.tr + s;
      });
    } };
}
const MODELS = [naive, snaive, ma3, holt, hwModel(false), hwModel(true)];

// ---------------- Backtest and forecast ----------------
export function salesForecast(invoices, asOf, { months = 6 } = {}) {
  const series = monthlySales(invoices, asOf);
  const y = series.map((s) => s.value);
  const n = y.length;
  if (n < 9) {
    return { tilstrækkelige_data: false, måneder_med_data: n,
      fund: [`Der er kun ${n} ${n === 1 ? "hel måned" : "hele måneder"} med salg. En prognose med målt træfsikkerhed kræver mindst 9 måneder.`] };
  }

  const H = Math.min(months, 6);
  const models = MODELS.filter((m) => n >= m.minLength + 6);
  const minTrain = Math.max(...models.map((m) => m.minLength), 6);
  const origins = [];
  for (let o = Math.max(minTrain, n - 12); o < n; o++) origins.push(o);

  // Seasonal-naive in-sample MAE as the MASE scale (lag 12 if possible, else lag 1).
  const lag = n > 24 ? 12 : 1;
  const scale = mean(y.slice(lag).map((v, i) => Math.abs(v - y[i]))) || 1;

  const results = models.map((m) => {
    const errs = []; // { h, actual, forecast }
    let failed = false;
    for (const o of origins) {
      const fc = m.fit(y.slice(0, o));
      if (!fc) { failed = true; break; }
      const f = fc(Math.min(H, n - o));
      f.forEach((v, i) => errs.push({ h: i + 1, actual: y[o + i], forecast: v }));
    }
    if (failed || !errs.length) return null;
    const abs = errs.map((e) => Math.abs(e.actual - e.forecast));
    const wape = sum(abs) / sum(errs, (e) => Math.abs(e.actual));
    const bias = sum(errs, (e) => e.forecast - e.actual) / sum(errs, (e) => e.actual);
    const nz = errs.filter((e) => e.actual !== 0);
    return {
      model: m, errs,
      mae: mean(abs), rmse: Math.sqrt(mean(errs.map((e) => (e.actual - e.forecast) ** 2))),
      wape, mape: nz.length ? mean(nz.map((e) => Math.abs(e.actual - e.forecast) / Math.abs(e.actual))) : null,
      bias, mase: mean(abs) / scale,
      wape1: (() => { const e1 = errs.filter((e) => e.h === 1); return sum(e1, (e) => Math.abs(e.actual - e.forecast)) / sum(e1, (e) => Math.abs(e.actual)); })(),
    };
  }).filter(Boolean).sort((a, b) => a.wape - b.wape);

  const best = results[0];
  const fc = best.model.fit(y)(months);

  // Prediction intervals from the chosen model's own backtest: RMS of relative errors per horizon,
  // forced non-decreasing; beyond the backtested horizon it grows with the square root of the horizon.
  const rel = (h) => best.errs.filter((e) => e.h === h && e.forecast).map((e) => (e.actual - e.forecast) / e.forecast);
  const sig = [];
  for (let h = 1; h <= months; h++) {
    const r = h <= H ? rel(h) : [];
    let s = r.length >= 4 ? Math.sqrt(mean(r.map((x) => x * x))) : null;
    if (s == null) s = sig.length ? sig[sig.length - 1] * Math.sqrt(h / (h - 1)) : best.wape * 1.25;
    sig.push(Math.max(s, sig[sig.length - 1] || 0));
  }
  const z80 = normInv(0.9), z95 = normInv(0.975);
  const last = series[n - 1].month;
  const forecastRows = fc.map((v, i) => ({
    måned: addMonths(last, i + 1),
    prognose: round(v, 0),
    interval_80: [round(Math.max(0, v * (1 - z80 * sig[i])), 0), round(v * (1 + z80 * sig[i]), 0)],
    interval_95: [round(Math.max(0, v * (1 - z95 * sig[i])), 0), round(v * (1 + z95 * sig[i]), 0)],
    samme_måned_sidste_år: n - 12 + i >= 0 && n - 12 + i < n ? round(y[n - 12 + i], 0) : null,
  }));

  const snaiveRes = results.find((r) => r.model.name === "saesonnaiv");
  const naiveRes = results.find((r) => r.model.name === "naiv");
  const benchmark = snaiveRes || naiveRes;
  const next3 = forecastRows.slice(0, 3);
  const next3Sum = sum(next3, (r) => r.prognose);
  const ly3 = next3.every((r) => r.samme_måned_sidste_år != null) ? sum(next3, (r) => r.samme_måned_sidste_år) : null;
  // Interval for the 3-month total, assuming the monthly errors are independent (a lower bound on the width).
  const sd3 = Math.sqrt(sum(next3.map((r, i) => (r.prognose * sig[i]) ** 2)));

  const fund = [];
  fund.push(`Salget de næste 3 måneder (${monthName(next3[0].måned)} – ${monthName(next3[next3.length - 1].måned)}) ventes at blive ${kr(next3Sum)}. Med 80 % sandsynlighed mellem ${kr(next3Sum - z80 * sd3)} og ${kr(next3Sum + z80 * sd3)}.`);
  if (ly3) fund.push(`Det er ${next3Sum >= ly3 ? pct(next3Sum / ly3 - 1) + " mere" : pct(1 - next3Sum / ly3) + " mindre"} end de samme måneder sidste år (${kr(ly3)}).`);
  fund.push(`Bedste model i backtesten er ${best.model.label}. Den ramte i snit ${pct(best.wape1, 1)} ved siden af én måned frem og ${pct(best.wape, 1)} på tværs af 1–${H} måneder frem (WAPE).`);
  if (benchmark && benchmark !== best) fund.push(`Det er ${pct(1 - best.wape / benchmark.wape)} mere præcist end en ${benchmark.model.name === "saesonnaiv" ? "sæsonnaiv prognose (samme måned sidste år)" : "naiv prognose (sidste måned)"}.`);
  if (Math.abs(best.bias) >= 0.03) fund.push(`Modellen har i backtesten ramt systematisk ${best.bias > 0 ? "for højt" : "for lavt"}, i snit ${pct(Math.abs(best.bias), 1)}. Tag højde for det.`);
  else fund.push(`Modellen har ikke ramt systematisk for højt eller lavt (bias ${pct(best.bias, 1)}).`);

  // The current month has already started: show what is invoiced so far next to its forecast.
  const curMonth = asOf.slice(0, 7);
  const soFar = sum(invoices.filter((i) => i.date && i.date.startsWith(curMonth) && i.date <= asOf), (i) => i.amount);
  if (forecastRows[0]?.måned === curMonth) forecastRows[0].faktureret_indtil_nu = round(soFar, 0);

  return {
    tilstrækkelige_data: true,
    måneder_med_data: n,
    valgt_model: best.model.label,
    prognose: forecastRows,
    historik_seneste_12: series.slice(-12).map((s) => ({ måned: s.month, salg: round(s.value, 0) })),
    modeller: results.map((r) => ({
      model: r.model.label,
      wape: round(r.wape, 4), wape_1_måned_frem: round(r.wape1, 4), mape: round(r.mape, 4),
      mae_kr: round(r.mae, 0), rmse_kr: round(r.rmse, 0), bias: round(r.bias, 4), mase: round(r.mase, 3),
    })),
    backtest: { metode: "rullende oprindelse", oprindelser: origins.length, første: series[origins[0]].month, sidste: series[origins[origins.length - 1]].month, horisont_måneder: H, prognoser_målt: best.errs.length },
    fund: fund.map((f) => f.replace(/kr\.\./g, "kr.")),
    forklaring: {
      wape: "Samlet fejl i procent af det faktiske salg. Lavere er bedre.",
      mape: "Gennemsnitlig fejl i procent pr. måned.",
      bias: "Positiv = prognosen ramte for højt i snit, negativ = for lavt.",
      mase: "Fejl i forhold til en naiv sæsonprognose i data. Under 1 = bedre end den naive metode.",
      intervaller: "Bygget på modellens egne fejl i backtesten. Intervallet for de 3 måneder tilsammen antager uafhængige fejl og er derfor snarere for smalt end for bredt.",
    },
    beløb: "Fakturerede beløb inkl. moms, pr. kalendermåned.",
  };
}
