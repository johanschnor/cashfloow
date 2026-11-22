const $ = (id) => document.getElementById(id);
// Language comes from the server (CASHFLOOW_LANG). Static texts in index.html carry their English in data-en.
let EN = false;
const L = (da, en) => (EN ? en : da);
const LOC = () => (EN ? "en-GB" : "da-DK");
const VAL = { "Ikke forfalden": "Not yet due", "1–15 dage": "1–15 days", "16–30 dage": "16–30 days", "31–60 dage": "31–60 days", "Over 60 dage": "Over 60 days",
  Eksempelvirksomhed: "Sample company", "Demo Møbler ApS (eksempeldata)": "Demo Møbler ApS (sample data)", "e-conomic demokonto": "e-conomic demo account" };
const val = (x) => (EN ? VAL[x] ?? x : x);
const kr = (x) => (x == null ? "–" : EN ? (x < 0 ? "-DKK " : "DKK ") + Math.abs(Math.round(x)).toLocaleString("en-GB") : Math.round(x).toLocaleString("da-DK") + " kr.");
const krShort = (x) => {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toLocaleString(LOC(), { maximumFractionDigits: 1 }) + L(" mio.", "m");
  if (a >= 1e3) return Math.round(x / 1e3).toLocaleString(LOC()) + "k";
  return Math.round(x).toLocaleString(LOC());
};
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + L(" %", "%"));
const dage = (x) => (x == null ? "–" : (x > 0 ? "+" : "") + x.toLocaleString(LOC(), { maximumFractionDigits: 1 }) + " d");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MONTHS_DA = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (i) => (EN ? MONTHS_EN : MONTHS_DA)[i];

let source = "sample";
let data = null;
let sort = { key: "overdue", dir: -1 };

document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", () => {
    source = b.dataset.source;
    document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    load();
  })
);
load();

async function load() {
  $("app").setAttribute("aria-busy", "true");
  try {
    const res = await fetch(`/api/analysis?source=${source}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    data = json;
    if (json.lang === "en" && !EN) {
      EN = true;
      document.documentElement.lang = "en";
      document.querySelectorAll("[data-en]").forEach((el) => (el.textContent = el.dataset.en));
    }
    render();
  } catch (err) {
    $("insights").innerHTML = `<li class="error">${L("Kunne ikke hente data", "Could not load data")}: ${esc(err.message)}</li>`;
  } finally {
    $("app").setAttribute("aria-busy", "false");
  }
}

function render() {
  const d = data;
  $("company").textContent = `${val(d.company)} · ${val(d.source)} · ${d.counts.invoices} ${L("fakturaer", "invoices")}, ${d.counts.customers} ${L("kunder", "customers")}, ${d.counts.suppliers} ${L("leverandører", "suppliers")}`;
  $("asof").textContent = `${L("Pr.", "As of")} ${new Date(d.asOf).toLocaleDateString(LOC(), { day: "numeric", month: "long", year: "numeric" })}`;
  $("asofNote").hidden = !d.asOfNote;
  $("asofNote").textContent = d.asOfNote || "";

  renderCash(d.forecast);
  const r = d.receivables;
  tiles("custTiles", [
    [L("Udestående hos kunder", "Owed by customers"), kr(r.outstanding), L("Ubetalte fakturaer i alt", "Unpaid invoices in total")],
    [L("Heraf forfaldent", "Of which overdue"), kr(r.overdue), r.outstanding ? pct(r.overdue / r.outstanding) + L(" af det udestående", " of outstanding") : ""],
    [L("Betalt til tiden", "Paid on time"), pct(r.onTimeShare), L("Andel af fakturaer betalt senest på forfaldsdagen", "Share of invoices paid by the due date")],
    [L("Når der betales for sent", "When paid late"), r.avgDaysLateWhenLate == null ? "–" : Math.round(r.avgDaysLateWhenLate) + L(" dage", " days"), L("Gennemsnitlig forsinkelse", "Average delay")],
  ]);
  $("insights").innerHTML = d.insights.map((t) => `<li>${esc(t)}</li>`).join("");

  hbars("agingChart", r.buckets.map((b) => ({ label: val(b.label), value: b.amount, tip: `${kr(b.amount)} · ${b.count} ${L("fakturaer", "invoices")}` })), krShort);
  vbars("lateChart", r.lateByMonth.map((m) => {
    const [y, mm] = m.month.split("-");
    return { label: month(+mm - 1), value: m.avgDaysLate, tip: m.avgDaysLate == null ? L("Ingen betalinger", "No payments") : `${dage(m.avgDaysLate)} ${L("i snit", "on average")} · ${m.payments} ${L("betalinger", "payments")} · ${kr(m.amount)}`, title: `${month(+mm - 1)} ${y}` };
  }));
  table();

  const p = d.payables;
  tiles("supTiles", [
    [L("Indkøb, 12 måneder", "Purchases, 12 months"), kr(p.spend12m), `${d.suppliers.length} ${L("leverandører", "suppliers")}`],
    [L("De 3 største leverandører", "The 3 largest suppliers"), pct(p.top3Share), L("Andel af indkøbet", "Share of purchases")],
    [L("Fra udlandet", "From abroad"), pct(p.foreignShare), L("Andel af indkøbet", "Share of purchases")],
    [L("Betalt mere end 3 dage før forfald", "Paid more than 3 days early"), p.paidCount ? `${p.paidEarlyCount} ${L("af", "of")} ${p.paidCount}` : "–", L("Leverandørfakturaer, skøn", "Supplier invoices, estimate")],
  ]);
  hbars("supChart", d.suppliers.slice(0, 8).map((s) => ({ label: s.name, value: s.share, tip: `${kr(s.spend12m)} · ${s.country}${s.avgPaidVsDue != null ? ` · ${L("I betaler", "You pay")} ${dage(s.avgPaidVsDue)} ${L("ift. forfald", "vs. due date")}` : ""}` })), pct);
  hbars("countryChart", d.countries.map((c) => ({ label: c.country, value: c.share, tip: kr(c.spend) })), pct);
  $("matchNote").textContent = p.matchingNote;
}

function renderCash(f) {
  if (!f) return;
  const below = f.uger_under_minimum.length;
  const s0 = f.scenarier[0], s2 = f.scenarier[2];
  tiles("cashTiles", [
    [L("Banksaldo i dag", "Bank balance today"), kr(f.startsaldo), L("Udgangspunkt for prognosen", "Starting point of the forecast")],
    [L("Laveste forventede saldo", "Lowest expected balance"), kr(f.laveste.saldo), `${L("Uge", "Week")} ${f.laveste.uge}`],
    [L("Uger under 0 kr.", "Weeks below DKK 0"), String(below), below ? `${L("Første gang i uge", "First in week")} ${f.uger_under_minimum[0]}` : L("Ingen i perioden", "None in the period")],
    [L("Hvis kunderne betalte til tiden", "If customers paid on time"), kr(s0.laveste_saldo), s0.forbedring > 0 ? `${kr(s0.forbedring)} ${L("bedre på det laveste punkt", "better at the lowest point")}` : L("Ingen forskel", "No difference")],
  ]);
  $("cashInsights").innerHTML = f.fund.map((x) => `<li>${esc(x)}</li>`).join("");
  vbars("cashChart", f.ugeplan.map((w) => ({
    label: String(w.uge), title: `${L("Uge", "Week")} ${w.uge} (${w.fra} – ${w.til})`, value: w.slut,
    tip: `${L("Saldo", "Balance")} ${kr(w.slut)} · ${L("ind", "in")} ${kr(w.ind_kunder_kendte + w.ind_kunder_forventede)} · ${L("ud", "out")} ${kr(-(w.ud_leverandører + w.ud_faste_udgifter + w.ud_moms))}${w.store_poster.length ? " · " + w.store_poster.join(", ") : ""}`,
  })), krShort, 1100);
  $("cashAssumptions").innerHTML = f.antagelser.map((x) => `<li>${esc(x)}</li>`).join("");
  const cols = [[L("Uge", "Week"), (w) => w.uge], ["Start", (w) => kr(w.start)], [L("Kunder (kendte)", "Customers (known)"), (w) => kr(w.ind_kunder_kendte)], [L("Kunder (nyt salg)", "Customers (new sales)"), (w) => kr(w.ind_kunder_forventede)],
    [L("Leverandører", "Suppliers"), (w) => kr(w.ud_leverandører)], [L("Løn og faste", "Salaries and fixed"), (w) => kr(w.ud_faste_udgifter)], [L("Moms", "VAT"), (w) => kr(w.ud_moms)],
    [L("Slut", "End"), (w) => w.slut < f.minimum ? `<span class="status bad">${kr(w.slut)}</span>` : kr(w.slut)]];
  $("cashTable").innerHTML = `<thead><tr>${cols.map(([h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${f.ugeplan.map((w) => `<tr>${cols.map(([, fn]) => `<td>${fn(w)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function tiles(id, items) {
  $(id).innerHTML = items.map(([label, value, hint]) =>
    `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`).join("");
}

function table() {
  const cols = [
    ["name", L("Kunde", "Customer"), (c) => esc(c.name)],
    ["revenue12m", L("Omsætning", "Revenue"), (c) => kr(c.revenue12m)],
    ["invoices12m", L("Fakturaer", "Invoices"), (c) => c.invoices12m],
    ["onTimeShare", L("Til tiden", "On time"), (c) => c.onTimeShare == null ? "–" : `<span class="status ${c.onTimeShare >= 0.7 ? "good" : c.onTimeShare < 0.4 ? "bad" : ""}">${pct(c.onTimeShare)}</span>`],
    ["avgDaysLate", L("Gns. ift. forfald", "Avg. vs. due"), (c) => dage(c.avgDaysLate)],
    ["trendDays", L("Udvikling, 6 mdr.", "Trend, 6 mo."), (c) => c.trendDays == null ? "–" : `<span class="${c.trendDays >= 2 ? "trend-up" : c.trendDays <= -2 ? "trend-down" : ""}">${c.trendDays >= 2 ? L("▲ langsommere ", "▲ slower ") : c.trendDays <= -2 ? L("▼ hurtigere ", "▼ faster ") : ""}${dage(c.trendDays)}</span>`],
    ["outstanding", L("Udestående", "Outstanding"), (c) => kr(c.outstanding)],
    ["overdue", L("Forfaldent", "Overdue"), (c) => c.overdue > 0 ? `<span class="status bad">${kr(c.overdue)}</span>` : kr(0)],
  ];
  const rows = [...data.customers].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (typeof x === "string") return x.localeCompare(y, LOC()) * sort.dir;
    return ((x ?? -Infinity) - (y ?? -Infinity)) * sort.dir;
  });
  $("custTable").innerHTML =
    `<thead><tr>${cols.map(([k, h]) => `<th${sort.key === k ? ` aria-sort="${sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button data-k="${k}">${h}${sort.key === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((c) => `<tr>${cols.map(([, , f]) => `<td>${f(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $("custTable").querySelectorAll("th button").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k;
    sort = { key: k, dir: sort.key === k ? -sort.dir : k === "name" ? 1 : -1 };
    table();
  }));
}

// Horizontal bars: one series, labels left, values at bar end.
function hbars(id, items, fmt) {
  const W = 560, rowH = 30, labelW = 150, valW = 70;
  const H = items.length * rowH + 6;
  const max = Math.max(...items.map((i) => i.value || 0), 1e-9);
  const plotW = W - labelW - valW;
  const svg = items.map((it, i) => {
    const y = i * rowH + 4;
    const w = Math.max(it.value > 0 ? 2 : 0, (it.value / max) * plotW);
    const label = it.label.length > 22 ? it.label.slice(0, 21) + "…" : it.label;
    return `<g data-tip="${esc(it.label)}|${esc(it.tip)}">
      <rect class="hit" x="0" y="${y - 3}" width="${W}" height="${rowH}"></rect>
      <text x="0" y="${y + 14}">${esc(label)}</text>
      <rect class="bar" x="${labelW}" y="${y + 2}" width="${w}" height="${rowH - 12}" rx="4"></rect>
      <text class="val" x="${labelW + w + 8}" y="${y + 14}">${fmt(it.value)}</text>
    </g>`;
  }).join("");
  $(id).innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(items.map((i) => `${i.label}: ${fmt(i.value)}`).join(", "))}">${svg}</svg>`;
  bindTips(id);
}

// Vertical bars with a zero line; negative values (paid early) go below the line.
function vbars(id, items, fmt = (v) => v, W = 560) {
  const H = 230, top = 16, bottom = 28;
  const vals = items.map((i) => i.value).filter((v) => v != null);
  const hi = Math.max(5, ...vals), lo = Math.min(0, ...vals);
  const step = niceStep((hi - lo) / 4);
  const yMax = Math.ceil(hi / step) * step, yMin = Math.floor(lo / step) * step;
  const left = Math.max(34, Math.max(String(fmt(yMax)).length, String(fmt(yMin)).length) * 7 + 12);
  const y = (v) => top + ((yMax - v) / (yMax - yMin)) * (H - top - bottom);
  const bw = (W - left) / items.length;
  let grid = "";
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    grid += `<line class="${v === 0 ? "axis" : "gridline"}" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"></line><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  const bars = items.map((it, i) => {
    const x = left + i * bw;
    const label = `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${it.label}</text>`;
    if (it.value == null) return label;
    const y0 = y(0), y1 = y(it.value);
    const h = Math.max(2, Math.abs(y1 - y0));
    const ry = it.value >= 0 ? y0 - h : y0;
    return `<g data-tip="${esc(it.title)}|${esc(it.tip)}">
      <rect class="hit" x="${x}" y="${top}" width="${bw}" height="${H - top - bottom}"></rect>
      <rect class="bar" x="${x + bw * 0.22}" y="${ry}" width="${bw * 0.56}" height="${h}" rx="4"></rect>
      ${label}</g>`;
  }).join("");
  $(id).innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(items.map((i) => `${i.title}: ${i.value == null ? L("ingen", "none") : dage(i.value)}`).join(", "))}">${grid}${bars}</svg>`;
  bindTips(id);
}

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x) || p * 10;
}

function bindTips(id) {
  const tip = $("tip");
  $(id).querySelectorAll("[data-tip]").forEach((g) => {
    g.addEventListener("mousemove", (e) => {
      const [title, body] = g.dataset.tip.split("|");
      tip.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
      tip.hidden = false;
      const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    g.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}
