// End-to-end test: starts mcp-server.js over stdio the way Claude does, and calls every tool.
// Sample company and sample webshop (made-up data with known answers), plus e-conomic's public demo
// account (network; skip with OFFLINE=1). No tokens needed.  npm test
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "OK  " : "FAIL") + "  " + msg); if (!cond) failures++; };

// Run against the demo account even if the developer has their own tokens in the environment.
const env = { ...process.env, ECONOMIC_APP_SECRET_TOKEN: "demo", ECONOMIC_AGREEMENT_GRANT_TOKEN: "demo" };
const client = new Client({ name: "test", version: "1.0.0" });
// SERVER=/path/to/mcp-server.js tests an installed copy (npm package or unpacked .mcpb) instead of this folder.
const entry = process.env.SERVER || path.join(root, "mcp-server.js");
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env, cwd: path.dirname(entry) }));

async function ask(name, args = {}) {
  const t = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || "";
  let data; try { data = JSON.parse(text); } catch { data = { fejltekst: text }; }
  return { data, isError: !!r.isError, ms: Date.now() - t };
}

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
const expected = ["virksomhedsoverblik", "kunder_der_binder_penge", "kunde", "ubetalte_fakturaer", "betalingstid_pr_maaned", "leverandoerer",
  "likviditetsprognose", "salgsprognose", "likviditetsrisiko", "afvigelser", "lageroverblik", "genbestilling", "vare",
  "fragtoverblik", "sammenlign_fragtfirmaer", "forsinkelsens_effekt", "fragt_statistik", "levering_hvor_og_hvornaar"];
ok(expected.every((n) => names.includes(n)) && names.length === expected.length, `${names.length} værktøjer: ${names.join(", ")}`);
ok(tools.every((t) => t.annotations?.readOnlyHint === true), "alle værktøjer er markeret som kun-læsning");

// Every tool answers on the sample company without errors.
for (const name of expected) {
  const args = name === "kunde" ? { navn: "Konferencecenteret" } : name === "vare" ? { navn: "hynde" } : {};
  const r = await ask(name, args);
  ok(!r.isError && !r.data.fejl, `eksempel: ${name} (${r.ms} ms)${r.isError ? ": " + JSON.stringify(r.data).slice(0, 200) : ""}`);
}

let r = await ask("virksomhedsoverblik");
ok(!!r.data.virksomhed && r.data.kilde, `overblik: ${r.data.virksomhed}`);
r = await ask("salgsprognose");
ok(r.data.prognose?.length === 6 && r.data.modeller.every((m, i, xs) => i === 0 || xs[i - 1].wape <= m.wape), `salgsprognose: ${r.data.valgt_model}, modeller sorteret efter fejl`);
r = await ask("likviditetsrisiko", { minimum_saldo: 0 });
ok(r.data.ugevis?.length === 13 && r.data.ugevis.every((u) => u.p10 <= u.median && u.median <= u.p90), "likviditetsrisiko: 13 uger, p10 ≤ median ≤ p90");
ok((await ask("likviditetsrisiko", { minimum_saldo: -2000000 })).data.sandsynlighed_under_minimum < 0.01, "meget lavt minimum giver ~0 % risiko");
ok((await ask("likviditetsrisiko", { minimum_saldo: 2000000 })).data.sandsynlighed_under_minimum > 0.99, "meget højt minimum giver ~100 % risiko");
r = await ask("afvigelser");
ok(r.data.mulige_dobbeltfakturaer?.length === 1 && r.data.usædvanlige_beløb?.some((x) => x.navn === "Metalbeslag A/S"), "afvigelser finder den indlagte dobbeltfaktura og Metalbeslags store faktura");
r = await ask("kunder_der_binder_penge");
ok(r.data.kunder.some((k) => k.navn === "Konferencecenteret" && k.udvikling_vurdering === "langsommere"), "Konferencecenteret er statistisk sikkert blevet langsommere");
ok(r.data.kunder.some((k) => k.navn === "Bolighuset Vest" && k.udvikling_vurdering === "ingen sikker ændring"), "en stabil kunde får \"ingen sikker ændring\"");

r = await ask("lageroverblik");
ok(r.data.lagertal && r.data.død_beholdning?.some((x) => x.navn === "Sofabord Valnød") && r.data.overlager?.some((x) => x.navn === "Puf Rund"), "lageroverblik finder det udgåede sofabord og overlageret af puffer");
const acc = r.data.prognosens_træfsikkerhed;
ok(acc?.sikkerhedslager_dækning >= acc?.mål - 0.03, `sikkerhedslagrene er kalibrerede uden for stikprøven: ${acc?.sikkerhedslager_dækning} mod mål ${acc?.mål}`);
r = await ask("genbestilling");
const now = (r.data.bestil_nu || []).map((x) => x.varenr);
ok(["1003", "1006", "4004"].every((n) => now.includes(n)) && !now.includes("2004") && !now.includes("2005"), `genbestilling: ${now.join(", ")}`);
ok(r.data.bestil_nu.every((x) => x.foreslået_antal > 0 && x.lagerposition < x.genbestillingspunkt), "alle forslag er under genbestillingspunktet og har et antal");
const hi = await ask("genbestilling", { servicegrad: 0.99 }), lo = await ask("genbestilling", { servicegrad: 0.8 });
ok(hi.data.samlet_indkøb_kr > lo.data.samlet_indkøb_kr, `højere servicegrad giver større indkøb (${lo.data.samlet_indkøb_kr} → ${hi.data.samlet_indkøb_kr} kr.)`);
ok((await ask("vare", { navn: "konferencestol" })).data.flere_varer_matcher?.length === 2, "vare: flere match giver en liste at vælge fra");

r = await ask("fragt_statistik");
ok(r.data.til_tiden?.chi2_test?.p_værdi < 0.05, `fragt_statistik: chi² p ${r.data.til_tiden?.chi2_test?.p_værdi}`);

if (!process.env.OFFLINE) {
  for (const name of ["virksomhedsoverblik", "salgsprognose", "likviditetsrisiko", "afvigelser", "kunder_der_binder_penge", "betalingstid_pr_maaned", "lageroverblik", "genbestilling"]) {
    r = await ask(name, { kilde: "e-conomic" });
    ok(!r.isError, `e-conomic demokonto: ${name} (${r.ms} ms)${r.isError ? ": " + String(r.data.fejltekst).slice(0, 200) : ""}`);
  }
  ok(r.data.lagertal === false, "demokontoen har ikke lagermodulet: genbestilling svarer uden lagertal");
}

await client.close();
console.log(failures ? `\n${failures} test(s) fejlede.` : "\nAlle tests bestod.");
process.exit(failures ? 1 : 0);
