// The MCP tools: finished analyses of a company's cash flow, sales and stock, built on e-conomic data.
// Every tool exists in Danish and English (CASHFLOOW_LANG=en); see lib/register.js and lib/i18n.js.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { forecast } from "./forecast.js";
import { salesForecast } from "./salesforecast.js";
import { cashRisk } from "./cashrisk.js";
import { anomalies } from "./anomalies.js";
import { inventoryAnalysis, inventoryOverview, reorderList, productDetail } from "./inventory.js";
import { registerFragtTools } from "./fragt/tools.js";
import { tr } from "./i18n.js";
import { reg, json, enumValues } from "./register.js";

const readOnly = { readOnlyHint: true, openWorldHint: true };
const header = (a) => ({ virksomhed: a.company, kilde: a.source, opgjort_pr: a.asOf, ...(a.asOfNote ? { bemærkning: a.asOfNote } : {}), beløb_i: "DKK" });

// getAnalysis(kilde) returns the analysis for a data source ("eksempel" or "e-conomic"); each tool takes "kilde".
// getFragt (optional): returns the freight analysis of the sample webshop; when given, the freight tools are added.
// loadInventory(kilde, analysis) (optional): products, stock and invoice lines for the inventory tools when the
// data source does not carry them already (e-conomic: fetched only when an inventory tool is used).
export function createServer({ getAnalysis, getFragt, loadInventory }) {
  const SOURCES = { eksempel: "sample", "e-conomic": "e-conomic" };
  const src = {
    kilde: {
      en: "source", values: SOURCES,
      schema: z.enum(enumValues(SOURCES)).default(tr("eksempel", "sample")).describe(tr(
        '"eksempel" = opdigtet demovirksomhed med 36 måneders data. "e-conomic" = live regnskabsdata (egne nøgler, ellers e-conomics demokonto med meget lidt data).',
        '"sample" = made-up demo company with 36 months of data. "e-conomic" = live accounting data (your own tokens, otherwise e-conomic\'s demo account with very little data).')),
    },
  };
  const weeks = { en: "weeks", schema: z.number().int().min(4).max(26).default(13) };
  const minimum = { en: "minimum_balance", schema: z.number().default(0).describe(tr(
    "Saldo, virksomheden ikke vil under, fx kassekreditens grænse eller en buffer",
    "Balance the company does not want to go below, e.g. the overdraft limit or a buffer")) };

  const server = new McpServer({ name: "cashfloow", version: "1.1.3" }, {
    instructions: tr(
      "Cashfloow analyserer en virksomheds pengestrøm med kunder og leverandører ud fra regnskabssystemet e-conomic. " +
      "Start med virksomhedsoverblik. Spørgsmål om likviditet, kassebeholdning eller \"løber vi tør for penge\" besvares med likviditetsprognose; spørgsmål om risiko, sandsynlighed eller hvor sikker prognosen er, med likviditetsrisiko. Salgsprognoser med salgsprognose, og noget der ser forkert eller usædvanligt ud med afvigelser. Lager, varer og indkøb besvares med lageroverblik, genbestilling og vare. Svar på dansk med konkrete navne og beløb. " +
      "Når et værktøj giver intervaller, p-værdier eller fejlmål, så nævn usikkerheden i klart sprog (fx \"med 80 % sandsynlighed mellem …\"), og påstå ikke en udvikling, som testen kalder usikker. " +
      "Skeln tydeligt mellem præcise tal og skøn: leverandørbetalinger er parret først-ind-først-ud og er et skøn. " +
      "Brug kilde \"eksempel\" medmindre brugeren beder om e-conomic." +
      (getFragt ? " Fragtværktøjerne (fragtoverblik m.fl.) bruger en opdigtet eksempel-webshop og viser, hvilke spørgsmål fragtdata kan besvare." : ""),
      "Cashfloow analyses a company's cash flow with customers and suppliers from the accounting system e-conomic (amounts in DKK). " +
      "Start with company_overview. Questions about liquidity, cash or \"will we run out of money\" are answered with cash_forecast; questions about risk, probability or how certain the forecast is, with cash_risk. Sales forecasts with sales_forecast, and anything that looks wrong or unusual with anomalies. Stock, products and purchasing are answered with inventory_overview, reorder and product. Answer with concrete names and amounts. " +
      "When a tool gives intervals, p-values or error metrics, state the uncertainty in plain language (e.g. \"with 80% probability between …\"), and do not claim a trend that the test calls uncertain. " +
      "Distinguish clearly between exact figures and estimates: supplier payments are matched first-in-first-out and are an estimate. " +
      "Use source \"sample\" unless the user asks for e-conomic." +
      (getFragt ? " The freight tools (freight_overview etc.) use a made-up sample webshop and show which questions freight data can answer." : "")),
  });

  reg(server, ["virksomhedsoverblik", "company_overview"], {
    title: ["Virksomhedsoverblik", "Company overview"],
    description: [
      "Nøgletal for kunder og leverandører plus de vigtigste fund i klart sprog: udestående, forfaldent, andel betalt til tiden, gennemsnitlig forsinkelse, indkøb, leverandørkoncentration og tidlige betalinger. Brug dette først.",
      "Key figures for customers and suppliers plus the main findings in plain language: outstanding, overdue, share paid on time, average delay, purchases, supplier concentration and early payments. Use this first."],
    annotations: readOnly,
  }, { ...src }, async ({ kilde }) => {
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
        betalt_mere_end_3_dage_før_forfald: tr(`${p.paidEarlyCount} af ${p.paidCount} (skøn)`, `${p.paidEarlyCount} of ${p.paidCount} (estimate)`),
      },
      fund: a.insights,
    });
  });

  const SORT = { forfaldent: "overdue", forsinkelse: "delay", udvikling: "trend", omsætning: "revenue" };
  reg(server, ["kunder_der_binder_penge", "customers_tying_up_cash"], {
    title: ["Kunder der binder penge", "Customers tying up cash"],
    description: [
      "Rangerer kunder efter forfaldent beløb, forsinkelse eller udvikling i betalingsadfærd (seneste 6 måneder mod de 6 før). Viser omsætning, andel til tiden, gennemsnitlige dage ift. forfald, udestående og ældste forfaldne faktura.",
      "Ranks customers by overdue amount, delay or trend in payment behaviour (last 6 months against the 6 before). Shows revenue, share on time, average days vs. due date, outstanding and oldest overdue invoice."],
    annotations: readOnly,
  }, {
    ...src,
    sorter_efter: { en: "sort_by", values: SORT, schema: z.enum(enumValues(SORT)).default(tr("forfaldent", "overdue")) },
    antal: { en: "count", schema: z.number().int().min(1).max(100).default(10) },
  }, async ({ kilde, sorter_efter, antal }) => {
    const a = await getAnalysis(kilde);
    const key = { forfaldent: "overdue", forsinkelse: "avgDaysLate", udvikling: "trendDays", omsætning: "revenue12m" }[sorter_efter];
    const rows = [...a.customers].sort((x, y) => (y[key] ?? -Infinity) - (x[key] ?? -Infinity)).slice(0, antal);
    return json({
      ...header(a),
      sorteret_efter: sorter_efter,
      forklaring: tr(
        "gns_dage_ift_forfald: positiv = betaler efter forfald. udvikling_dage: positiv = er blevet langsommere det seneste halve år. udvikling_pr_måned_dage: hældning fra regression over 12 måneder; udvikling_vurdering siger, om den er statistisk sikker (p < 0,05) eller kan være tilfældig.",
        "avg_days_vs_due: positive = pays after the due date. trend_days: positive = has become slower over the last six months. trend_per_month_days: slope from a regression over 12 months; trend_assessment says whether it is statistically significant (p < 0.05) or may be chance."),
      kunder: rows.map(customerRow),
    });
  });

  reg(server, ["kunde", "customer"], {
    title: ["Én kunde", "One customer"],
    description: [
      "Betalingsadfærd og ubetalte fakturaer for én kunde. Navnet behøver ikke være præcist.",
      "Payment behaviour and unpaid invoices for one customer. The name does not have to be exact."],
    annotations: readOnly,
  }, { ...src, navn: { en: "name", schema: z.string().min(1).describe(tr("Kundens navn eller en del af det", "The customer's name or part of it")) } },
  async ({ kilde, navn }) => {
    const a = await getAnalysis(kilde);
    const q = navn.toLowerCase();
    const matches = a.customers.filter((c) => c.name.toLowerCase().includes(q));
    if (!matches.length) {
      return json({ ...header(a), fejl: tr(`Ingen kunde matcher "${navn}".`, `No customer matches "${navn}".`), kunder: a.customers.map((c) => c.name) });
    }
    return json({
      ...header(a),
      kunder: matches.map((c) => ({
        ...customerRow(c),
        ubetalte_fakturaer: a.openInvoices.filter((i) => i.customer === c.name).map(invoiceRow),
      })),
    });
  });

  reg(server, ["ubetalte_fakturaer", "unpaid_invoices"], {
    title: ["Ubetalte fakturaer", "Unpaid invoices"],
    description: [
      "Ubetalte kundefakturaer sorteret efter flest dage over forfald, samt fordeling af udestående efter alder. Brug til fx at finde, hvem der skal rykkes.",
      "Unpaid customer invoices sorted by most days overdue, plus outstanding broken down by age. Use e.g. to find who to send a reminder to."],
    annotations: readOnly,
  }, { ...src, min_dage_over_forfald: { en: "min_days_overdue", schema: z.number().int().default(1).describe(tr("0 = også ikke-forfaldne fakturaer", "0 = include invoices not yet due")) } },
  async ({ kilde, min_dage_over_forfald }) => {
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

  reg(server, ["betalingstid_pr_maaned", "payment_time_by_month"], {
    title: ["Betalingstid pr. måned", "Payment time by month"],
    description: [
      "Gennemsnitligt antal dage, kunderne har betalt efter forfald, måned for måned de seneste 12 måneder (efter betalingsmåned). Negativ = før forfald.",
      "Average number of days customers paid after the due date, month by month for the last 12 months (by payment month). Negative = before the due date."],
    annotations: readOnly,
  }, { ...src }, async ({ kilde }) => {
    const a = await getAnalysis(kilde);
    return json({
      ...header(a),
      måneder: a.receivables.lateByMonth.map((m) => ({ måned: m.month, gns_dage_efter_forfald: m.avgDaysLate, betalinger: m.payments, beløb: m.amount })),
      ...(a.receivables.trend ? { udvikling: {
        dage_pr_måned: a.receivables.trend.perMonth,
        interval_95: a.receivables.trend.ci,
        p_værdi: a.receivables.trend.p,
        vurdering: a.receivables.trend.verdict,
        forklaring: tr(
          "Lineær regression af dage efter forfald på betalingsdato for alle betalte fakturaer de seneste 12 måneder. \"Ingen sikker ændring\" betyder, at udviklingen kan skyldes tilfældig variation (p ≥ 0,05).",
          "Linear regression of days after due date on payment date for all paid invoices in the last 12 months. \"No significant change\" means the trend may be due to chance (p ≥ 0.05)."),
      } } : {}),
    });
  });

  reg(server, ["leverandoerer", "suppliers"], {
    title: ["Leverandører", "Suppliers"],
    description: [
      "Indkøb pr. leverandør og land de seneste 12 måneder, andel af indkøbet, hvor mange dage før eller efter forfald virksomheden selv betaler, og hvad der står ubetalt. Betalingsdatoer er et skøn (først-ind-først-ud), fordi e-conomic ikke kobler leverandørbetalinger til en bestemt faktura.",
      "Purchases by supplier and country for the last 12 months, share of purchases, how many days before or after the due date the company itself pays, and what is unpaid. Payment dates are an estimate (first-in-first-out), because e-conomic does not link supplier payments to a specific invoice."],
    annotations: readOnly,
  }, { ...src }, async ({ kilde }) => {
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

  reg(server, ["likviditetsprognose", "cash_forecast"], {
    title: ["Likviditetsprognose", "Cash forecast"],
    description: [
      "Banksaldo uge for uge de næste uger (standard 13): hvornår saldoen er lavest, hvorfor (kunder, leverandører, løn og faste udgifter, moms), og hvad det ville ændre, hvis kunderne betalte til tiden, eller hvis virksomheden betalte leverandørerne på forfaldsdagen i stedet for før. Brug til spørgsmål som \"løber vi tør for penge?\" og \"hvorfor er likviditeten presset?\". Returnerer også alle antagelser; nævn de vigtigste i svaret.",
      "Bank balance week by week for the coming weeks (default 13): when the balance is lowest, why (customers, suppliers, salaries and fixed costs, VAT), and what would change if customers paid on time, or if the company paid suppliers on the due date instead of before. Use for questions like \"will we run out of money?\" and \"why is cash tight?\". Also returns all assumptions; mention the most important ones in the answer."],
    annotations: readOnly,
  }, { ...src, uger: weeks, minimum_saldo: minimum }, async ({ kilde, uger, minimum_saldo }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...forecast(a._data, a, { weeks: uger, minimum: minimum_saldo }) });
  });

  reg(server, ["salgsprognose", "sales_forecast"], {
    title: ["Salgsprognose", "Sales forecast"],
    description: [
      "Prognose for det fakturerede salg måned for måned (standard 6 måneder) med 80 %- og 95 %-intervaller. Flere modeller (naiv, sæsonnaiv, gennemsnit, Holt, Holt-Winters) testes mod hinanden i en backtest med rullende oprindelse, og den mest præcise vælges. Returnerer fejlmål for hver model (WAPE, MAPE, MAE, RMSE, bias, MASE). Brug til \"hvad sælger vi de næste måneder?\", \"hvor præcis er prognosen?\" og \"forecast error\".",
      "Forecast of invoiced sales month by month (default 6 months) with 80% and 95% intervals. Several models (naive, seasonal naive, average, Holt, Holt-Winters) are tested against each other in a rolling-origin backtest, and the most accurate is chosen. Returns error metrics for each model (WAPE, MAPE, MAE, RMSE, bias, MASE). Use for \"what will we sell in the coming months?\", \"how accurate is the forecast?\" and \"forecast error\"."],
    annotations: readOnly,
  }, { ...src, maaneder: { en: "months", schema: z.number().int().min(1).max(12).default(6) } }, async ({ kilde, maaneder }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...salesForecast(a._data.invoices, a.asOf, { months: maaneder }) });
  });

  reg(server, ["likviditetsrisiko", "cash_risk"], {
    title: ["Likviditetsrisiko", "Cash risk"],
    description: [
      "Sandsynligheden for at banksaldoen kommer under et minimum de næste uger, beregnet med Monte Carlo-simulation (2.000 forløb) ud fra hver kundes egen betalingsadfærd og variationen i salg og indkøb. Giver 80 %-intervaller for saldoen uge for uge, fordelingen af den laveste saldo, hvilke kunder der skaber mest usikkerhed, og hvor præcis prognosen for kundeindbetalinger har været i en backtest (inkl. om intervallerne er kalibrerede). Brug til \"hvor stor er risikoen?\", \"hvor sikker er prognosen?\" og \"hvad er worst case?\".",
      "The probability that the bank balance drops below a minimum in the coming weeks, computed with Monte Carlo simulation (2,000 paths) from each customer's own payment behaviour and the variation in sales and purchases. Gives 80% intervals for the balance week by week, the distribution of the lowest balance, which customers create the most uncertainty, and how accurate the forecast of customer payments has been in a backtest (incl. whether the intervals are calibrated). Use for \"how big is the risk?\", \"how certain is the forecast?\" and \"what is the worst case?\"."],
    annotations: readOnly,
  }, { ...src, uger: weeks, minimum_saldo: minimum }, async ({ kilde, uger, minimum_saldo }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...cashRisk(a._data, a, { weeks: uger, minimum: minimum_saldo }) });
  });

  reg(server, ["afvigelser", "anomalies"], {
    title: ["Afvigelser", "Anomalies"],
    description: [
      "Finder det usædvanlige de seneste 90 dage: mulige dobbeltfakturaer (samme modpart og beløb inden for 7 dage), fakturabeløb der afviger markant fra kundens eller leverandørens normale (robust z-score), og åbne fakturaer der er senere end kunden plejer (over kundens 95. percentil). Brug til \"er der noget, der ser forkert ud?\" og ved gennemgang af debitorer og kreditorer.",
      "Finds the unusual in the last 90 days: possible duplicate invoices (same counterparty and amount within 7 days), invoice amounts that differ markedly from the customer's or supplier's normal (robust z-score), and open invoices that are later than the customer usually is (above the customer's 95th percentile). Use for \"does anything look wrong?\" and when reviewing receivables and payables."],
    annotations: readOnly,
  }, { ...src }, async ({ kilde }) => {
    const a = await getAnalysis(kilde);
    return json({ ...header(a), ...anomalies(a._data, a) });
  });

  // ---------------- Inventory ----------------
  const inventoryFor = async (kilde) => {
    const a = await getAnalysis(kilde);
    const inv = a._data.inventory || (loadInventory ? await loadInventory(kilde, a) : null);
    return { a, inv };
  };
  const noLines = (a) => json({ ...header(a), fejl: tr(
    "Der er ingen fakturalinjer med varenumre i regnskabet, så lageret kan ikke analyseres. Lagerværktøjerne kræver, at fakturaerne bruger varer (produkter) i e-conomic.",
    "There are no invoice lines with product numbers in the accounts, so the stock cannot be analysed. The inventory tools require invoices to use products in e-conomic.") });
  const lead = { en: "lead_time_days", schema: z.number().int().min(1).max(365).optional().describe(tr(
    "Leveringstid fra leverandør i dage, for alle varer. Udelades: leverandørens leveringstid pr. vare, hvis den kendes, ellers 14 dage.",
    "Supplier lead time in days, for all products. If omitted: the supplier's lead time per product if known, otherwise 14 days.")) };
  const service = { en: "service_level", schema: z.number().min(0.5).max(0.999).optional().describe(tr(
    "Ønsket sandsynlighed for ikke at løbe tør i en leveringsperiode, fx 0.95. Udelades: A-varer 0.97, B 0.95, C 0.90.",
    "Desired probability of not running out during a lead time, e.g. 0.95. If omitted: A products 0.97, B 0.95, C 0.90.")) };

  reg(server, ["lageroverblik", "inventory_overview"], {
    title: ["Lageroverblik", "Inventory overview"],
    description: [
      "Overblik over lageret ud fra varer, beholdning og fakturalinjer: lagerværdi, lagerdage og omsætningshastighed, ABC-analyse (hvilke varer bærer omsætningen), efterspørgselsmønstre (jævn, svingende, sporadisk, klumpet), hvor mange varer der bør bestilles nu, risiko for udsolgt, død beholdning og overlager (bundet kapital), og hvor præcise prognoserne og sikkerhedslagrene har været i en backtest. Brug til \"hvordan står det til med lageret?\", \"binder vi for mange penge på lager?\" og \"hvilke varer sælger?\".",
      "Overview of the stock from products, stock levels and invoice lines: inventory value, days of inventory and turnover, ABC analysis (which products carry the revenue), demand patterns (smooth, erratic, intermittent, lumpy), how many products should be ordered now, stockout risk, dead stock and overstock (tied-up capital), and how accurate the forecasts and safety stocks have been in a backtest. Use for \"how is our stock doing?\", \"do we tie up too much money in stock?\" and \"which products sell?\"."],
    annotations: readOnly,
  }, { ...src, leveringstid_dage: lead }, async ({ kilde, leveringstid_dage }) => {
    const { a, inv } = await inventoryFor(kilde);
    if (!inv?.lines?.length) return noLines(a);
    return json({ ...header(a), ...inventoryOverview(inventoryAnalysis(inv, a.asOf, { leadTimeDays: leveringstid_dage })) });
  });

  reg(server, ["genbestilling", "reorder"], {
    title: ["Genbestilling", "Reorder"],
    description: [
      "Hvilke varer der skal bestilles nu, og hvor mange: sikkerhedslager, genbestillingspunkt og økonomisk ordrestørrelse (EOQ) pr. vare ud fra en sæsonjusteret prognose, der er backtestet på salget i leveringstiden. Giver risikoen for at blive udsolgt før en ny levering, hvornår lageret slipper op, hvilke varer der snart skal bestilles, og hvad indkøbet koster samlet (vigtigt for likviditeten). Brug til \"hvad skal vi bestille?\", \"løber vi tør for noget?\" og indkøbsplanlægning.",
      "Which products to order now, and how many: safety stock, reorder point and economic order quantity (EOQ) per product from a seasonally adjusted forecast that is backtested on sales during the lead time. Gives the risk of selling out before a new delivery, when the stock runs out, which products must be ordered soon, and what the purchase costs in total (important for cash). Use for \"what should we order?\", \"are we running out of anything?\" and purchase planning."],
    annotations: readOnly,
  }, {
    ...src,
    leveringstid_dage: lead,
    servicegrad: service,
    bestillingsomkostning_kr: { en: "order_cost_dkk", schema: z.number().min(0).optional().describe(tr(
      "Omkostning pr. indkøbsordre (tid, fragt, håndtering). Standard 500 kr.", "Cost per purchase order (time, freight, handling). Default DKK 500.")) },
    lageromkostning_procent: { en: "holding_cost_percent", schema: z.number().min(1).max(60).optional().describe(tr(
      "Årlig omkostning ved at have varer på lager i procent af kostprisen (kapital, plads, svind). Standard 20.",
      "Annual cost of holding stock as a percentage of cost price (capital, space, shrinkage). Default 20.")) },
  }, async ({ kilde, leveringstid_dage, servicegrad, bestillingsomkostning_kr, lageromkostning_procent }) => {
    const { a, inv } = await inventoryFor(kilde);
    if (!inv?.lines?.length) return noLines(a);
    const r = inventoryAnalysis(inv, a.asOf, { leadTimeDays: leveringstid_dage, service: servicegrad, orderCost: bestillingsomkostning_kr,
      holdingRate: lageromkostning_procent != null ? lageromkostning_procent / 100 : undefined });
    return json({ ...header(a), ...reorderList(r) });
  });

  reg(server, ["vare", "product"], {
    title: ["Vare", "Product"],
    description: [
      "Alt om én vare: salg uge for uge (seneste 26 uger), efterspørgselsmønster, ABC-klasse, beholdning, sikkerhedslager, genbestillingspunkt, ordrestørrelse og de tre prognosemodellers fejl i backtesten. Søg på varenummer eller en del af navnet.",
      "Everything about one product: sales week by week (last 26 weeks), demand pattern, ABC class, stock, safety stock, reorder point, order quantity and the three forecast models' errors in the backtest. Search by product number or part of the name."],
    annotations: readOnly,
  }, {
    ...src,
    navn: { en: "name", schema: z.string().describe(tr("Varenummer eller en del af varenavnet", "Product number or part of the product name")) },
    leveringstid_dage: lead,
    servicegrad: service,
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
