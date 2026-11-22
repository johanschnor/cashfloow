const $ = (id) => document.getElementById(id);
const kr = (x) => (x == null ? "–" : Math.round(x).toLocaleString("da-DK") + " kr.");
const krShort = (x) => {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toLocaleString("da-DK", { maximumFractionDigits: 1 }) + " mio.";
  if (a >= 1e3) return Math.round(x / 1e3).toLocaleString("da-DK") + "k";
  return Math.round(x).toLocaleString("da-DK");
};
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + " %");
const dage = (x) => (x == null ? "–" : (x > 0 ? "+" : "") + x.toLocaleString("da-DK", { maximumFractionDigits: 1 }) + " d");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

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
    render();
  } catch (err) {
    $("insights").innerHTML = `<li class="error">Kunne ikke hente data: ${esc(err.message)}</li>`;
  } finally {
    $("app").setAttribute("aria-busy", "false");
  }
}

function render() {
  const d = data;
  $("company").textContent = `${d.company} · ${d.source} · ${d.counts.invoices} fakturaer, ${d.counts.customers} kunder, ${d.counts.suppliers} leverandører`;
  $("asof").textContent = `Pr. ${new Date(d.asOf).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}`;
  $("asofNote").hidden = !d.asOfNote;
  $("asofNote").textContent = d.asOfNote || "";

  renderCash(d.forecast);
  const r = d.receivables;
  tiles("custTiles", [
    ["Udestående hos kunder", kr(r.outstanding), "Ubetalte fakturaer i alt"],
    ["Heraf forfaldent", kr(r.overdue), r.outstanding ? pct(r.overdue / r.outstanding) + " af det udestående" : ""],
    ["Betalt til tiden", pct(r.onTimeShare), "Andel af fakturaer betalt senest på forfaldsdagen"],
    ["Når der betales for sent", r.avgDaysLateWhenLate == null ? "–" : Math.round(r.avgDaysLateWhenLate) + " dage", "Gennemsnitlig forsinkelse"],
  ]);
  $("insights").innerHTML = d.insights.map((t) => `<li>${esc(t)}</li>`).join("");

  hbars("agingChart", r.buckets.map((b) => ({ label: b.label, value: b.amount, tip: `${kr(b.amount)} · ${b.count} fakturaer` })), krShort);
  vbars("lateChart", r.lateByMonth.map((m) => {
    const [y, mm] = m.month.split("-");
    return { label: MONTHS[+mm - 1], value: m.avgDaysLate, tip: m.avgDaysLate == null ? "Ingen betalinger" : `${dage(m.avgDaysLate)} i snit · ${m.payments} betalinger · ${kr(m.amount)}`, title: `${MONTHS[+mm - 1]} ${y}` };
  }));
  table();

  const p = d.payables;
  tiles("supTiles", [
    ["Indkøb, 12 måneder", kr(p.spend12m), `${d.suppliers.length} leverandører`],
    ["De 3 største leverandører", pct(p.top3Share), "Andel af indkøbet"],
    ["Fra udlandet", pct(p.foreignShare), "Andel af indkøbet"],
    ["Betalt mere end 3 dage før forfald", p.paidCount ? `${p.paidEarlyCount} af ${p.paidCount}` : "–", "Leverandørfakturaer, skøn"],
  ]);
  hbars("supChart", d.suppliers.slice(0, 8).map((s) => ({ label: s.name, value: s.share, tip: `${kr(s.spend12m)} · ${s.country}${s.avgPaidVsDue != null ? ` · I betaler ${dage(s.avgPaidVsDue)} ift. forfald` : ""}` })), pct);
  hbars("countryChart", d.countries.map((c) => ({ label: c.country, value: c.share, tip: kr(c.spend) })), pct);
  $("matchNote").textContent = p.matchingNote;
}

function renderCash(f) {
  if (!f) return;
  const below = f.uger_under_minimum.length;
  const s0 = f.scenarier[0], s2 = f.scenarier[2];
  tiles("cashTiles", [
    ["Banksaldo i dag", kr(f.startsaldo), "Udgangspunkt for prognosen"],
    ["Laveste forventede saldo", kr(f.laveste.saldo), `Uge ${f.laveste.uge}`],
    ["Uger under 0 kr.", String(below), below ? `Første gang i uge ${f.uger_under_minimum[0]}` : "Ingen i perioden"],
    ["Hvis kunderne betalte til tiden", kr(s0.laveste_saldo), s0.forbedring > 0 ? `${kr(s0.forbedring)} bedre på det laveste punkt` : "Ingen forskel"],
  ]);
  $("cashInsights").innerHTML = f.fund.map((x) => `<li>${esc(x)}</li>`).join("");
  vbars("cashChart", f.ugeplan.map((w) => ({
    label: String(w.uge), title: `Uge ${w.uge} (${w.fra} – ${w.til})`, value: w.slut,
    tip: `Saldo ${kr(w.slut)} · ind ${kr(w.ind_kunder_kendte + w.ind_kunder_forventede)} · ud ${kr(-(w.ud_leverandører + w.ud_faste_udgifter + w.ud_moms))}${w.store_poster.length ? " · " + w.store_poster.join(", ") : ""}`,
  })), krShort, 1100);
  $("cashAssumptions").innerHTML = f.antagelser.map((x) => `<li>${esc(x)}</li>`).join("");
  const cols = [["Uge", (w) => w.uge], ["Start", (w) => kr(w.start)], ["Kunder (kendte)", (w) => kr(w.ind_kunder_kendte)], ["Kunder (nyt salg)", (w) => kr(w.ind_kunder_forventede)],
    ["Leverandører", (w) => kr(w.ud_leverandører)], ["Løn og faste", (w) => kr(w.ud_faste_udgifter)], ["Moms", (w) => kr(w.ud_moms)],
    ["Slut", (w) => w.slut < f.minimum ? `<span class="status bad">${kr(w.slut)}</span>` : kr(w.slut)]];
  $("cashTable").innerHTML = `<thead><tr>${cols.map(([h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${f.ugeplan.map((w) => `<tr>${cols.map(([, fn]) => `<td>${fn(w)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function tiles(id, items) {
  $(id).innerHTML = items.map(([label, value, hint]) =>
    `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`).join("");
}

function table() {
  const cols = [
    ["name", "Kunde", (c) => esc(c.name)],
    ["revenue12m", "Omsætning", (c) => kr(c.revenue12m)],
    ["invoices12m", "Fakturaer", (c) => c.invoices12m],
    ["onTimeShare", "Til tiden", (c) => c.onTimeShare == null ? "–" : `<span class="status ${c.onTimeShare >= 0.7 ? "good" : c.onTimeShare < 0.4 ? "bad" : ""}">${pct(c.onTimeShare)}</span>`],
    ["avgDaysLate", "Gns. ift. forfald", (c) => dage(c.avgDaysLate)],
    ["trendDays", "Udvikling, 6 mdr.", (c) => c.trendDays == null ? "–" : `<span class="${c.trendDays >= 2 ? "trend-up" : c.trendDays <= -2 ? "trend-down" : ""}">${c.trendDays >= 2 ? "▲ langsommere " : c.trendDays <= -2 ? "▼ hurtigere " : ""}${dage(c.trendDays)}</span>`],
    ["outstanding", "Udestående", (c) => kr(c.outstanding)],
    ["overdue", "Forfaldent", (c) => c.overdue > 0 ? `<span class="status bad">${kr(c.overdue)}</span>` : kr(0)],
  ];
  const rows = [...data.customers].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (typeof x === "string") return x.localeCompare(y, "da") * sort.dir;
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
  $(id).innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(items.map((i) => `${i.title}: ${i.value == null ? "ingen" : dage(i.value)}`).join(", "))}">${grid}${bars}</svg>`;
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
