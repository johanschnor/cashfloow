// Small statistics library used by the forecasts and tests. No dependencies.
// Distributions: normal, Student's t, chi-square. Intervals: Wilson, OLS slope.
// Tests: two-proportion z, chi-square independence, Welch t. Models: OLS, logistic regression (IRLS).
import { tr } from "./i18n.js";

export const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + f(x), 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
export function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(sum(xs, (x) => (x - m) ** 2) / (xs.length - 1));
}
export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (xs) => quantile(xs, 0.5);
// Median absolute deviation, scaled to be comparable with the standard deviation.
export function mad(xs) {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}
export const round = (x, n = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

// Deterministic random numbers (mulberry32), so simulations give the same answer every time.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Distributions ----------------
function erf(x) {
  // Abramowitz & Stegun 7.1.26 is too coarse for p-values; use a series/continued fraction via gamma.
  const sign = x < 0 ? -1 : 1;
  return sign * regGammaP(0.5, x * x);
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export function normInv(p) {
  // Acklam's algorithm (relative error < 1.2e-9).
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
// Regularized lower incomplete gamma P(a, x).
function regGammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, del = 1 / a, s = del;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 1e-14) break; }
    return s * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
// Regularized incomplete beta I_x(a, b).
function betacf(a, b, x) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
function regBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function tCdf(t, df) {
  const x = df / (df + t * t);
  const tail = 0.5 * regBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
export function tInv(p, df) {
  let lo = -1000, hi = 1000;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
export const chi2Sf = (x, df) => 1 - regGammaP(df / 2, x / 2);

// ---------------- Intervals and tests ----------------
// Wilson score interval for a proportion k/n.
export function wilson(k, n, conf = 0.95) {
  if (!n) return [null, null];
  const z = normInv(1 - (1 - conf) / 2), p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Two-sided test that two proportions are equal.
export function twoProportionTest(k1, n1, k2, n2) {
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return { z: 0, p: 1 };
  const z = (k1 / n1 - k2 / n2) / se;
  return { z, p: 2 * (1 - normCdf(Math.abs(z))) };
}

// Chi-square test of independence for an r × c table of counts.
export function chiSquare(table) {
  const r = table.length, c = table[0].length;
  const rows = table.map((row) => sum(row)), cols = table[0].map((_, j) => sum(table, (row) => row[j])), n = sum(rows);
  let stat = 0;
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    const e = (rows[i] * cols[j]) / n;
    if (e > 0) stat += (table[i][j] - e) ** 2 / e;
  }
  const df = (r - 1) * (c - 1);
  return { stat, df, p: chi2Sf(stat, df), cramersV: Math.sqrt(stat / (n * Math.min(r - 1, c - 1))) };
}

// Welch's t-test for a difference in means (a − b), with a confidence interval.
export function welch(a, b, conf = 0.95) {
  if (a.length < 2 || b.length < 2) return null;
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length, se = Math.sqrt(va + vb);
  const diff = mean(a) - mean(b);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const t = se ? diff / se : 0;
  const q = tInv(1 - (1 - conf) / 2, df);
  return { diff, ci: [diff - q * se, diff + q * se], t, df, p: 2 * (1 - tCdf(Math.abs(t), df)) };
}

// Holm's adjustment of p-values for several tests at once.
export function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(ps.length);
  let running = 0;
  order.forEach(([p, i], k) => { running = Math.max(running, Math.min(1, p * (ps.length - k))); out[i] = running; });
  return out;
}

// ---------------- Regression ----------------
// Simple linear regression y = a + b·x, with the slope's confidence interval and p-value.
export function ols(x, y, conf = 0.95) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  const sxx = sum(x, (v) => (v - mx) ** 2);
  if (!sxx) return null;
  const slope = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / sxx;
  const intercept = my - slope * mx;
  const resid = y.map((v, i) => v - intercept - slope * x[i]);
  const sse = sum(resid, (e) => e * e), sst = sum(y, (v) => (v - my) ** 2);
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const t = se ? slope / se : 0;
  const q = tInv(1 - (1 - conf) / 2, n - 2);
  return { slope, intercept, se, ci: [slope - q * se, slope + q * se], p: se ? 2 * (1 - tCdf(Math.abs(t), n - 2)) : 0, r2: sst ? 1 - sse / sst : 0, n };
}

// Logistic regression by iteratively reweighted least squares. X: rows of predictors (no intercept column).
export function logistic(X, y, names) {
  const n = X.length, k = X[0].length + 1;
  const rows = X.map((r) => [1, ...r]);
  let beta = new Array(k).fill(0);
  let cov = null;
  for (let iter = 0; iter < 50; iter++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = sum(rows[i].map((v, j) => v * beta[j]));
      const p = 1 / (1 + Math.exp(-eta)), w = Math.max(p * (1 - p), 1e-10);
      for (let a = 0; a < k; a++) {
        g[a] += rows[i][a] * (y[i] - p);
        for (let b = 0; b < k; b++) H[a][b] += rows[i][a] * rows[i][b] * w;
      }
    }
    cov = invert(H);
    if (!cov) return null;
    const step = cov.map((row) => sum(row.map((v, j) => v * g[j])));
    beta = beta.map((b, j) => b + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  const z = normInv(0.975);
  return ["(konstant)", ...names].map((name, j) => {
    const se = Math.sqrt(cov[j][j]);
    return { name, coef: beta[j], se, oddsRatio: Math.exp(beta[j]), ci: [Math.exp(beta[j] - z * se), Math.exp(beta[j] + z * se)], p: 2 * (1 - normCdf(Math.abs(beta[j] / se))) };
  });
}

function invert(m) {
  const n = m.length, a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map((row) => row.slice(n));
}

// ---------------- Statistical process control ----------------
// p-chart: share per period with 3-sigma limits around the overall share. Flags points outside the
// limits and runs of 8 periods in a row on the same side of the centre line (Western Electric rule 2).
export function pChart(periods) {
  const K = sum(periods, (p) => p.k), N = sum(periods, (p) => p.n);
  if (!N) return null;
  const pbar = K / N;
  const points = periods.map((p) => {
    const s = Math.sqrt(pbar * (1 - pbar) / p.n);
    return { ...p, share: p.n ? p.k / p.n : null, lcl: Math.max(0, pbar - 3 * s), ucl: Math.min(1, pbar + 3 * s) };
  });
  const signals = [];
  points.forEach((p, i) => {
    if (p.share == null) return;
    if (p.share < p.lcl) signals.push({ index: i, rule: tr("under nedre kontrolgrænse", "below lower control limit") });
    if (p.share > p.ucl) signals.push({ index: i, rule: tr("over øvre kontrolgrænse", "above upper control limit") });
  });
  let run = 0, side = 0;
  points.forEach((p, i) => {
    const s = p.share == null ? 0 : Math.sign(p.share - pbar);
    run = s !== 0 && s === side ? run + 1 : s !== 0 ? 1 : 0;
    side = s;
    if (run === 8) signals.push({ index: i, rule: s < 0 ? tr("8 perioder i træk under gennemsnittet", "8 periods in a row below the average") : tr("8 perioder i træk over gennemsnittet", "8 periods in a row above the average") });
  });
  return { centre: pbar, points, signals };
}
