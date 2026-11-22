// Freight tools on the sample webshop. getFragt() returns the freight analysis (lib/fragt/analyze.js).
import { z } from "zod";
import { fragtStats } from "./stats.js";

const readOnly = { readOnlyHint: true, openWorldHint: true };
const json = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
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
const notConnected = () => json({ fejl: "Der er ingen fragtdata." });

export function registerFragtTools(server, getFragt) {
  server.registerTool("fragtoverblik", {
    title: "Fragtoverblik",
    description: "Overblik over webshoppens fragt det seneste år: hvor mange pakker kom til tiden, returrate, anmeldelser, hvad forsinkelser koster i ekstra returneringer, og de vigtigste fund i klart sprog. Brug dette først ved spørgsmål om fragt, levering eller fragtfirmaer.",
    inputSchema: {
      returomkostning: z.number().min(0).default(250).describe("Hvad én returnering koster webshoppen i kr. (fragt, håndtering, tabt salg)"),
    },
    annotations: readOnly,
  }, async ({ returomkostning }) => {
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

  server.registerTool("sammenlign_fragtfirmaer", {
    title: "Sammenlign fragtfirmaer",
    description: "PostNord, GLS, DAO, Bring m.fl. side om side: andel leveret til tiden, forsinkelse, returrate, anmeldelser, fragtpris og den reelle pris pr. pakke, når ekstra returneringer fra forsinkelser regnes med. Brug til \"hvem er bedst/billigst?\" og \"skal vi skifte fragtfirma?\".",
    inputSchema: {
      sorter_efter: z.enum(["reel_pris", "til_tiden", "stjerner", "pakker"]).default("reel_pris"),
      returomkostning: z.number().min(0).default(250),
    },
    annotations: readOnly,
  }, async ({ sorter_efter, returomkostning }) => {
    const f = await getFragt(returomkostning);
    if (!f) return notConnected();
    const key = { reel_pris: (c) => c.realPricePerParcel, til_tiden: (c) => -c.onTime, stjerner: (c) => -c.avgStars, pakker: (c) => -c.parcels }[sorter_efter];
    return json({ ...header(f), sorteret_efter: sorter_efter, returomkostning_kr: f.returnCost, fragtfirmaer: [...f.carriers].sort((a, b) => key(a) - key(b)).map(carrierRow) });
  });

  server.registerTool("forsinkelsens_effekt", {
    title: "Hvad forsinkelser koster",
    description: "Hvordan returrate og anmeldelser ændrer sig, når pakken kommer til tiden, 1, 2 eller 3+ dage for sent. Returraten er justeret for produktkategori. Brug til \"betyder forsinkelser noget for vores kunder?\".",
    inputSchema: {},
    annotations: readOnly,
  }, async () => {
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

  server.registerTool("fragt_statistik", {
    title: "Fragtstatistik",
    description: "Statistiske tests på fragtdata: er forskellen mellem fragtfirmaerne reel (95 %-intervaller, chi²-test, parvise tests mod det bedste firma), hvor meget forsinkelser øger returneringer justeret for produktkategori (logistisk regression med odds ratio), om forsinkede pakker får færre stjerner (Welch t-test), og kontrolkort over ugentlig leveringspræcision, der viser, hvornår et fragtfirma er blevet usædvanligt dårligt. Brug til \"er forskellen signifikant?\", \"kan det være tilfældigt?\" og \"er PostNord blevet dårligere?\".",
    inputSchema: {},
    annotations: readOnly,
  }, async () => {
    const f = await getFragt();
    if (!f) return notConnected();
    return json({ ...header(f), ...fragtStats(f) });
  });

  server.registerTool("levering_hvor_og_hvornaar", {
    title: "Levering efter region og ugedag",
    description: "Andel leveret til tiden pr. fragtfirma fordelt på region (Hovedstaden, Sjælland, Fyn, Syd-, Midt- og Nordjylland) og afsendelsesdag. Brug til \"hvor er PostNord dårligst?\" eller \"hvilken dag skal vi ikke sende med DAO?\".",
    inputSchema: { fordeling: z.enum(["region", "ugedag"]).default("region") },
    annotations: readOnly,
  }, async ({ fordeling }) => {
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
