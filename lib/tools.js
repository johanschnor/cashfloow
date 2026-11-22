// The MCP tools: finished analyses of a company's cash flow, sales and stock, built on e-conomic data.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { forecast } from "./forecast.js";
import { salesForecast } from "./salesforecast.js";
import { cashRisk } from "./cashrisk.js";
import { anomalies } from "./anomalies.js";
import { inventoryAnalysis, inventoryOverview, reorderList, productDetail } from "./inventory.js";
import { registerFragtTools } from "./fragt/tools.js";

const kildeSchema = z
  .enum(["eksempel", "e-conomic"])
  .default("eksempel")
  .describe('"eksempel" = opdigtet demovirksomhed med 36 måneders data. "e-conomic" = live regnskabsdata (egne nøgler fra .env, ellers e-conomics demokonto med meget lidt data).');

const readOnly = { readOnlyHint: true, openWorldHint: true };
const json = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const header = (a) => ({ virksomhed: a.company, kilde: a.source, opgjort_pr: a.asOf, ...(a.asOfNote ? { bemærkning: a.asOfNote } : {}), beløb_i: "DKK" });

// getAnalysis(kilde) returns the analysis for a data source; each tool takes "kilde".
// getFragt (optional): returns the freight analysis of the sample webshop; when given, the freight tools are added.
// loadInventory(kilde, analysis) (optional): products, stock and invoice lines for the inventory tools when the
// data source does not carry them already (e-conomic: fetched only when an inventory tool is used).
export function createServer({ getAnalysis, getFragt, loadInventory }) {
  const src = { kilde: kildeSchema };
  const server = new McpServer({ name: "regnskab-mcp", version: "1.0.0" }, {
    instructions:
    "Regnskab MCP analyserer en virksomheds pengestrøm med kunder og leverandører ud fra regnskabssystemet. " +
    "Start med virksomhedsoverblik. Spørgsmål om likviditet, kassebeholdning eller \"løber vi tør for penge\" besvares med likviditetsprognose; spørgsmål om risiko, sandsynlighed eller hvor sikker prognosen er, med likviditetsrisiko. Salgsprognoser med salgsprognose, og noget der ser forkert eller usædvanligt ud med afvigelser. Lager, varer og indkøb besvares med lageroverblik, genbestilling og vare. Svar på dansk med konkrete navne og beløb. " +
    "Når et værktøj giver intervaller, p-værdier eller fejlmål, så nævn usikkerheden i klart sprog (fx \"med 80 % sandsynlighed mellem …\"), og påstå ikke en udvikling, som testen kalder usikker. " +
    "Skeln tydeligt mellem præcise tal og skøn: leverandørbetalinger er parret først-ind-først-ud og er et skøn. " +
    "Brug kilde \"eksempel\" medmindre brugeren beder om e-conomic." +
    (getFragt ? " Fragtværktøjerne (fragtoverblik m.fl.) bruger en opdigtet eksempel-webshop og viser, hvilke spørgsmål fragtdata kan besvare." : ""),
  });

  server.registerTool("virksomhedsoverblik", {
    title: "Virksomhedsoverblik",
    description: "Nøgletal for kunder og leverandører plus de vigtigste fund i klart sprog: udestående, forfaldent, andel betalt til tiden, gennemsnitlig forsinkelse, indkøb, leverandørkoncentration og tidlige betalinger. Brug dette først.",
    inputSchema: { ...src },
    annotations: readOnly,
  }, async ({ kilde }) => {
    const a = await getAnalysis(kilde);
    const r = a.receivables, p = a.payables;
    return json({
      ...header(a),
      kunder: {
        udestående: r.outstanding,
        heraf_forfaldent: r.overdue,
        andel_betalt_til_tiden_12m: r.onTimeShare,
        gns_dage_for_sent_når_for_sent: r.avgDaysLateWhenLate,
        gns_dage_fra_faktura_til_betaling: r.avgDaysToPay,
      },
      leverandører: {
        indkøb_12m: p.spend12m,
        ubetalt: p.open,
        tre_største_andel: p.top3Share,
        andel_fra_udlandet: p.foreignShare,
        betalt_mere_end_3_dage_før_forfald: `${p.paidEarlyCount} af ${p.paidCount} (skøn)`,
      },
      fund: a.insights,
  });
  });

  server.registerTool("kunder_der_binder_penge", {
    title: "Kunder der binder penge",
    description: "Rangerer kunder efter forfaldent beløb, forsinkelse eller udvikling i betalingsadfærd (seneste 6 måneder mod de 6 før). Viser omsætning, andel til tiden, gennemsnitlige dage ift. forfald, udestående og ældste forfaldne faktura.",
    inputSchema: {
      ...src,
      sorter_efter: z.enum(["forfaldent", "forsinkelse", "udvikling", "omsætning"]).default("forfaldent"),
      antal: z.number().int().min(1).max(100).default(10),
    },
    annotations: readOnly,
  }, async ({ kilde, sorter_efter, antal }) => {
    const a = await getAnalysis(kilde);
    const key = { forfaldent: "overdue", forsinkelse: "avgDaysLate", udvikling: "trendDays", omsætning: "revenue12m" }[sorter_efter];
    const rows = [...a.customers].sort((x, y) => (y[key] ?? -Infinity) - (x[key] ?? -Infinity)).slice(0, antal);
    return json({
      ...header(a),
      sorteret_efter: sorter_efter,
      forklaring: "gns_dage_ift_forfald: positiv = betaler efter forfald. udvikling_dage: positiv = er blevet langsommere det seneste halve år. udvikling_pr_måned_dage: hældning fra regression over 12 måneder; udvikling_vurdering siger, om den er statistisk sikker (p < 0,05) eller kan være tilfældig.",
      kunder: rows.map(customerRow),
  });
  });

  server.registerTool("kunde", {
    title: "Én kunde",
    description: "Betalingsadfærd og ubetalte fakturaer for én kunde. Navnet behøver ikke være præcist.",
    inputSchema: { ...src, navn: z.string().min(1).describe("Kundens navn eller en del af det") },
    annotations: readOnly,
  }, async ({ kilde, navn }) => {
    const a = await getAnalysis(kilde);
    const q = navn.toLowerCase();
    const matches = a.customers.filter((c) => c.name.toLowerCase().includes(q));
    if (!matches.length) {
      return json({ ...header(a), fejl: `Ingen kunde matcher "${navn}".`, kunder: a.customers.map((c) => c.name) });
    }
    return json({
      ...header(a),
      kunder: matches.map((c) => ({
        ...customerRow(c),
        ubetalte_fakturaer: a.openInvoices.filter((i) => i.customer === c.name).map(invoiceRow),
      })),
  });
  });

  server.registerTool("ubetalte_fakturaer", {
    title: "Ubetalte fakturaer",
    description: "Ubetalte kundefakturaer sorteret efter flest dage over forfald, samt fordeling af udestående efter alder. Brug til fx at finde, hvem der skal rykkes.",
    inputSchema: {
      ...src,
      min_dage_over_forfald: z.number().int().default(1).describe("0 = også ikke-forfaldne fakturaer"),
    },
    annotations: readOnly,
  }, async ({ kilde, min_dage_over_forfald }) => {
    const a = await getAnalysis(kilde);
    const list = a.openInvoices.filter((i) => i.daysOverdue >= min_dage_over_forfald);
    return json({
      ...header(a),
      antal: list.length,
      beløb_i_alt: list.reduce((s, i) => s + i.open, 0),
      fordeling_efter_alder: a.receivables.buckets.map((b) => ({ alder: b.label, beløb: b.amount, fakturaer: b.count })),
      fakturaer: list.map(invoiceRow),
  });
  });

  server.registerTool("betalingstid_pr_maaned", {
    title: "Betalingstid pr. måned",
    description: "Gennemsnitligt antal dage, kunderne har betalt efter forfald, måned for måned de seneste 12 måneder (efter betalingsmåned). Negativ = før forfald.",
    inputSchema: { ...src },
    annotations: readOnly,
  }, async ({ kilde }) => {
    const a = await getAnalysis(kilde);
    return json({
      ...header(a),
      måneder: a.receivables.lateByMonth.map((m) => ({ måned: m.month, gns_dage_efter_forfald: m.avgDaysLate, betalinger: m.payments, beløb: m.amount })),
      ...(a.receivables.trend ? { udvikling: {
        dage_pr_måned: a.receivables.trend.perMonth,
        interval_95: a.receivables.trend.ci,
        p_værdi: a.receivables.trend.p,
        vurdering: a.receivables.trend.verdict,
        forklaring: "Lineær regression af dage efter forfald på betalingsdato for alle betalte fakturaer de seneste 12 måneder. \"Ingen sikker ændring\" betyder, at udviklingen kan skyldes tilfældig variation (p ≥ 0,05).",
      } } : {}),
  });
  });

  server.registerTool("leverandoerer", {
    title: "Leverandører",
    description: "Indkøb pr. leverandør og land de seneste 12 måneder, andel af indkøbet, hvor mange dage før eller efter forfald virksomheden selv betaler, og hvad der står ubetalt. Betalingsdatoer er et skøn (først-ind-først-ud), fordi e-conomic ikke kobler leverandørbetalinger til en bestemt faktura.",
    inputSchema: { ...src },
    annotations: readOnly,
  }, async ({ kilde }) => {
    const a = await getAnalysis(kilde);
    return json({
      ...header(a),
      metode: a.payables.matchingNote,
      leverandører: a.suppliers.map((s) => ({
        navn: s.name, land: s.country, valuta: s.currency,
        indkøb_12m: s.spend12m, andel: s.share,
        betaler_dage_ift_forfald_skøn: s.avgPaidVsDue,
        ubetalt: s.open,
      })),
      lande: a.countries.map((c) => ({ land: c.country, indkøb_12m: c.spend, andel: c.share })),
  });
  });

  server.registerTool("likviditetsprognose", {
    title: "Likviditetsprognose",
    description: "Banksaldo uge for uge de næste uger (standard 13): hvornår saldoen er lavest, hvorfor (kunder, leverandører, løn og faste udgifter, moms), og hvad det ville ændre, hvis kunderne betalte til tiden, eller hvis virksomheden betalte leverandørerne på forfaldsdagen i stedet for før. Brug til spørgsmål som \"løber vi tør for penge?\" og \"hvorfor er likviditeten presset?\". Returnerer også alle antagelser; nævn de vigtigste i svaret.",
    inputSchema: {
      ...src,
      uger: z.number().int().min(4).max(26).default(13),
      minimum_saldo: z.number().default(0).describe("Saldo, virksomheden ikke vil under, fx kassekreditens grænse eller en buffer"),
    },
    annotations: readOnly,
  }, async ({ kilde, uger, minimum_saldo }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...forecast(a._data, a, { weeks: uger, minimum: minimum_saldo }) });
  });

  server.registerTool("salgsprognose", {
    title: "Salgsprognose",
    description: "Prognose for det fakturerede salg måned for måned (standard 6 måneder) med 80 %- og 95 %-intervaller. Flere modeller (naiv, sæsonnaiv, gennemsnit, Holt, Holt-Winters) testes mod hinanden i en backtest med rullende oprindelse, og den mest præcise vælges. Returnerer fejlmål for hver model (WAPE, MAPE, MAE, RMSE, bias, MASE). Brug til \"hvad sælger vi de næste måneder?\", \"hvor præcis er prognosen?\" og \"forecast error\".",
    inputSchema: { ...src, måneder: z.number().int().min(1).max(12).default(6) },
    annotations: readOnly,
  }, async ({ kilde, måneder }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...salesForecast(a._data.invoices, a.asOf, { months: måneder }) });
  });

  server.registerTool("likviditetsrisiko", {
    title: "Likviditetsrisiko",
    description: "Sandsynligheden for at banksaldoen kommer under et minimum de næste uger, beregnet med Monte Carlo-simulation (2.000 forløb) ud fra hver kundes egen betalingsadfærd og variationen i salg og indkøb. Giver 80 %-intervaller for saldoen uge for uge, fordelingen af den laveste saldo, hvilke kunder der skaber mest usikkerhed, og hvor præcis prognosen for kundeindbetalinger har været i en backtest (inkl. om intervallerne er kalibrerede). Brug til \"hvor stor er risikoen?\", \"hvor sikker er prognosen?\" og \"hvad er worst case?\".",
    inputSchema: {
      ...src,
      uger: z.number().int().min(4).max(26).default(13),
      minimum_saldo: z.number().default(0).describe("Saldo, virksomheden ikke vil under, fx kassekreditens grænse eller en buffer"),
    },
    annotations: readOnly,
  }, async ({ kilde, uger, minimum_saldo }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...cashRisk(a._data, a, { weeks: uger, minimum: minimum_saldo }) });
  });

  server.registerTool("afvigelser", {
    title: "Afvigelser",
    description: "Finder det usædvanlige de seneste 90 dage: mulige dobbeltfakturaer (samme modpart og beløb inden for 7 dage), fakturabeløb der afviger markant fra kundens eller leverandørens normale (robust z-score), og åbne fakturaer der er senere end kunden plejer (over kundens 95. percentil). Brug til \"er der noget, der ser forkert ud?\" og ved gennemgang af debitorer og kreditorer.",
    inputSchema: { ...src },
    annotations: readOnly,
  }, async ({ kilde }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...anomalies(a._data, a) });
  });

  // ---------------- Inventory ----------------
  const inventoryFor = async (kilde) => {
    const a = await getAnalysis(kilde);
    const inv = a._data.inventory || (loadInventory ? await loadInventory(kilde, a) : null);
    return { a, inv };
  };
  const noLines = (a) => json({ ...header(a), fejl: "Der er ingen fakturalinjer med varenumre i regnskabet, så lageret kan ikke analyseres. Lagerværktøjerne kræver, at fakturaerne bruger varer (produkter) i e-conomic." });
  const leadParam = z.number().int().min(1).max(365).optional()
    .describe("Leveringstid fra leverandør i dage, for alle varer. Udelades: leverandørens leveringstid pr. vare, hvis den kendes, ellers 14 dage.");
  const serviceParam = z.number().min(0.5).max(0.999).optional()
    .describe("Ønsket sandsynlighed for ikke at løbe tør i en leveringsperiode, fx 0.95. Udelades: A-varer 0.97, B 0.95, C 0.90.");

  server.registerTool("lageroverblik", {
    title: "Lageroverblik",
    description: "Overblik over lageret ud fra varer, beholdning og fakturalinjer: lagerværdi, lagerdage og omsætningshastighed, ABC-analyse (hvilke varer bærer omsætningen), efterspørgselsmønstre (jævn, svingende, sporadisk, klumpet), hvor mange varer der bør bestilles nu, risiko for udsolgt, død beholdning og overlager (bundet kapital), og hvor præcise prognoserne og sikkerhedslagrene har været i en backtest. Brug til \"hvordan står det til med lageret?\", \"binder vi for mange penge på lager?\" og \"hvilke varer sælger?\".",
    inputSchema: { ...src, leveringstid_dage: leadParam },
    annotations: readOnly,
  }, async ({ kilde, leveringstid_dage }) => {
    const { a, inv } = await inventoryFor(kilde);
    if (!inv?.lines?.length) return noLines(a);
    return json({ ...header(a), ...inventoryOverview(inventoryAnalysis(inv, a.asOf, { leadTimeDays: leveringstid_dage })) });
  });

  server.registerTool("genbestilling", {
    title: "Genbestilling",
    description: "Hvilke varer der skal bestilles nu, og hvor mange: sikkerhedslager, genbestillingspunkt og økonomisk ordrestørrelse (EOQ) pr. vare ud fra en sæsonjusteret prognose, der er backtestet på salget i leveringstiden. Giver risikoen for at blive udsolgt før en ny levering, hvornår lageret slipper op, hvilke varer der snart skal bestilles, og hvad indkøbet koster samlet (vigtigt for likviditeten). Brug til \"hvad skal vi bestille?\", \"løber vi tør for noget?\" og indkøbsplanlægning.",
    inputSchema: {
      ...src,
      leveringstid_dage: leadParam,
      servicegrad: serviceParam,
      bestillingsomkostning_kr: z.number().min(0).optional().describe("Omkostning pr. indkøbsordre (tid, fragt, håndtering). Standard 500 kr."),
      lageromkostning_procent: z.number().min(1).max(60).optional().describe("Årlig omkostning ved at have varer på lager i procent af kostprisen (kapital, plads, svind). Standard 20."),
    },
    annotations: readOnly,
  }, async ({ kilde, leveringstid_dage, servicegrad, bestillingsomkostning_kr, lageromkostning_procent }) => {
    const { a, inv } = await inventoryFor(kilde);
    if (!inv?.lines?.length) return noLines(a);
    const r = inventoryAnalysis(inv, a.asOf, { leadTimeDays: leveringstid_dage, service: servicegrad, orderCost: bestillingsomkostning_kr,
      holdingRate: lageromkostning_procent != null ? lageromkostning_procent / 100 : undefined });
    return json({ ...header(a), ...reorderList(r) });
  });

  server.registerTool("vare", {
    title: "Vare",
    description: "Alt om én vare: salg uge for uge (seneste 26 uger), efterspørgselsmønster, ABC-klasse, beholdning, sikkerhedslager, genbestillingspunkt, ordrestørrelse og de tre prognosemodellers fejl i backtesten. Søg på varenummer eller en del af navnet.",
    inputSchema: { ...src, navn: z.string().describe("Varenummer eller en del af varenavnet"), leveringstid_dage: leadParam, servicegrad: serviceParam },
    annotations: readOnly,
  }, async ({ kilde, navn, leveringstid_dage, servicegrad }) => {
    const { a, inv } = await inventoryFor(kilde);
    if (!inv?.lines?.length) return noLines(a);
    return json({ ...header(a), ...productDetail(inventoryAnalysis(inv, a.asOf, { leadTimeDays: leveringstid_dage, service: servicegrad }), navn) });
  });

  if (getFragt) registerFragtTools(server, getFragt);

  return server;
}

function customerRow(c) {
  return {
    navn: c.name,
    omsætning_12m: c.revenue12m,
    fakturaer_12m: c.invoices12m,
    andel_til_tiden: c.onTimeShare,
    gns_dage_ift_forfald: c.avgDaysLate,
    udvikling_dage: c.trendDays,
    udvikling_pr_måned_dage: c.trendPerMonth,
    udvikling_95_interval: c.trendCI,
    udvikling_vurdering: c.trendVerdict,
    udestående: c.outstanding,
    forfaldent: c.overdue,
    ældste_forfaldne_dage: c.oldestOverdueDays,
  };
}
function invoiceRow(i) {
  return { faktura: i.number, kunde: i.customer, fakturadato: i.date, forfald: i.dueDate, ubetalt: i.open, dage_over_forfald: i.daysOverdue };
}

