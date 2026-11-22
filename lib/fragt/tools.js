// Freight tools on the sample webshop. getFragt() returns the freight analysis (lib/fragt/analyze.js).
import { z } from "zod";
import { fragtStats } from "./stats.js";
import { tr } from "../i18n.js";
import { reg, json, enumValues } from "../register.js";

const readOnly = { readOnlyHint: true, openWorldHint: true };
const header = (f) => ({ webshop: f.shop, kilde: f.source, opgjort_pr: f.asOf, beløb_i: "DKK", ...(f.notes?.length ? { bemærkninger: f.notes } : {}) });

const carrierRow = (c) => ({
  fragtfirma: c.name,
  pakker: c.parcels,
  andel_af_pakker: c.share,
  andel_til_tiden: c.onTime,
  gns_dage_for_sent_når_for_sent: c.avgLateWhenLate,
  gns_leveringstid_hverdage: c.avgTransit,
  returrate: c.returnRate,
  gns_stjerner: c.avgStars,
  anmeldelser: c.reviews,
  fragtpris_pr_pakke: c.avgPrice,
  ekstra_returneringer_pga_forsinkelse: c.extraReturns,
  forsinkelsesomkostning_pr_pakke: c.delayCostPerParcel,
  reel_pris_pr_pakke: c.realPricePerParcel,
  til_tiden_pakkeshop: c.servicePointOnTime,
  til_tiden_hjemlevering: c.homeOnTime,
});

// When no freight data is available, getFragt returns null.
const notConnected = () => json({ fejl: tr("Der er ingen fragtdata.", "There is no freight data.") });

export function registerFragtTools(server, getFragt) {
  const CSORT = { reel_pris: "real_price", til_tiden: "on_time", stjerner: "stars", pakker: "parcels" };
  const BREAKDOWN = { region: "region", ugedag: "weekday" };
  reg(server, ["fragtoverblik", "freight_overview"], {
    title: ["Fragtoverblik", "Freight overview"],
    description: [
      "Overblik over webshoppens fragt det seneste år: hvor mange pakker kom til tiden, returrate, anmeldelser, hvad forsinkelser koster i ekstra returneringer, og de vigtigste fund i klart sprog. Brug dette først ved spørgsmål om fragt, levering eller fragtfirmaer.",
      "Overview of the webshop's freight over the last year: how many parcels arrived on time, return rate, reviews, what delays cost in extra returns, and the main findings in plain language. Use this first for questions about freight, delivery or carriers."],
    annotations: readOnly,
  }, { returomkostning: { en: "return_cost", schema: z.number().min(0).default(250).describe(tr("Hvad én returnering koster webshoppen i kr. (fragt, håndtering, tabt salg)", "What one return costs the webshop in DKK (freight, handling, lost sale)")) } }, async ({ returomkostning }) => {
    const f = await getFragt(returomkostning);
    if (!f) return notConnected();
    return json({
      ...header(f),
      returomkostning_kr: f.returnCost,
      pakker: f.totals.parcels,
      andel_til_tiden: f.totals.onTime,
      returrate: f.totals.returnRate,
      gns_stjerner: f.totals.avgStars,
      anmeldelser: f.totals.reviews,
      forsinkelsesomkostning_i_alt: f.totals.delayCost,
      fund: f.insights,
      metode: f.method,
    });
  });

  reg(server, ["sammenlign_fragtfirmaer", "compare_carriers"], {
    title: ["Sammenlign fragtfirmaer", "Compare carriers"],
    description: [
      "PostNord, GLS, DAO, Bring m.fl. side om side: andel leveret til tiden, forsinkelse, returrate, anmeldelser, fragtpris og den reelle pris pr. pakke, når ekstra returneringer fra forsinkelser regnes med. Brug til \"hvem er bedst/billigst?\" og \"skal vi skifte fragtfirma?\".",
      "PostNord, GLS, DAO, Bring etc. side by side: share delivered on time, delay, return rate, reviews, freight price and the real price per parcel when extra returns from delays are included. Use for \"who is best/cheapest?\" and \"should we switch carrier?\"."],
    annotations: readOnly,
  }, {
    sorter_efter: { en: "sort_by", values: CSORT, schema: z.enum(enumValues(CSORT)).default(tr("reel_pris", "real_price")) },
    returomkostning: { en: "return_cost", schema: z.number().min(0).default(250).describe(tr("Hvad én returnering koster webshoppen i kr. (fragt, håndtering, tabt salg)", "What one return costs the webshop in DKK (freight, handling, lost sale)")) },
  }, async ({ sorter_efter, returomkostning }) => {
    const f = await getFragt(returomkostning);
    if (!f) return notConnected();
    const key = { reel_pris: (c) => c.realPricePerParcel, til_tiden: (c) => -c.onTime, stjerner: (c) => -c.avgStars, pakker: (c) => -c.parcels }[sorter_efter];
    return json({ ...header(f), sorteret_efter: sorter_efter, returomkostning_kr: f.returnCost, fragtfirmaer: [...f.carriers].sort((a, b) => key(a) - key(b)).map(carrierRow) });
  });

  reg(server, ["forsinkelsens_effekt", "delay_effect"], {
    title: ["Hvad forsinkelser koster", "What delays cost"],
    description: [
      "Hvordan returrate og anmeldelser ændrer sig, når pakken kommer til tiden, 1, 2 eller 3+ dage for sent. Returraten er justeret for produktkategori. Brug til \"betyder forsinkelser noget for vores kunder?\".",
      "How return rate and reviews change when the parcel arrives on time, 1, 2 or 3+ days late. The return rate is adjusted for product category. Use for \"do delays matter to our customers?\"."],
    annotations: readOnly,
  }, {}, async () => {
    const f = await getFragt();
    if (!f) return notConnected();
    return json({
      ...header(f),
      forsinkelse: f.delayEffect.map((d) => ({
        levering: d.label,
        pakker: d.parcels,
        returrate_justeret: d.returnRate,
        returrate_rå: d.returnRateRaw,
        gns_stjerner: d.avgStars,
        anmeldelser: d.reviews,
        andel_1_2_stjerner: d.lowReviewShare,
      })),
    });
  });

  reg(server, ["fragt_statistik", "freight_statistics"], {
    title: ["Fragtstatistik", "Freight statistics"],
    description: [
      "Statistiske tests på fragtdata: er forskellen mellem fragtfirmaerne reel (95 %-intervaller, chi²-test, parvise tests mod det bedste firma), hvor meget forsinkelser øger returneringer justeret for produktkategori (logistisk regression med odds ratio), om forsinkede pakker får færre stjerner (Welch t-test), og kontrolkort over ugentlig leveringspræcision, der viser, hvornår et fragtfirma er blevet usædvanligt dårligt. Brug til \"er forskellen signifikant?\", \"kan det være tilfældigt?\" og \"er PostNord blevet dårligere?\".",
      "Statistical tests on freight data: is the difference between carriers real (95% intervals, chi² test, pairwise tests against the best carrier), how much delays increase returns adjusted for product category (logistic regression with odds ratio), whether late parcels get fewer stars (Welch t-test), and control charts of weekly delivery precision that show when a carrier has become unusually bad. Use for \"is the difference significant?\", \"could it be chance?\" and \"has PostNord got worse?\"."],
    annotations: readOnly,
  }, {}, async () => {
    const f = await getFragt();
    if (!f) return notConnected();
    return json({ ...header(f), ...fragtStats(f) });
  });

  reg(server, ["levering_hvor_og_hvornaar", "delivery_where_and_when"], {
    title: ["Levering efter region og ugedag", "Delivery by region and weekday"],
    description: [
      "Andel leveret til tiden pr. fragtfirma fordelt på region (Hovedstaden, Sjælland, Fyn, Syd-, Midt- og Nordjylland) og afsendelsesdag. Brug til \"hvor er PostNord dårligst?\" eller \"hvilken dag skal vi ikke sende med DAO?\".",
      "Share delivered on time per carrier by region (Capital Region, Zealand, Funen, Southern, Central and Northern Jutland) and shipping day. Use for \"where is PostNord worst?\" or \"which day should we not ship with DAO?\"."],
    annotations: readOnly,
  }, { fordeling: { en: "breakdown", values: BREAKDOWN, schema: z.enum(enumValues(BREAKDOWN)).default("region") } }, async ({ fordeling }) => {
    const f = await getFragt();
    if (!f) return notConnected();
    const names = Object.fromEntries(f.carriers.map((c) => [c.code, c.name]));
    const rows = (fordeling === "region" ? f.byRegion : f.byWeekday).map((r) => ({
      [fordeling]: r.label,
      fragtfirmaer: r.values.map((v) => ({ fragtfirma: names[v.carrier], andel_til_tiden: v.onTime, pakker: v.parcels })),
    }));
    return json({ ...header(f), fordeling, rækker: rows });
  });
}
