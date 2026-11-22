// Language support. Cashfloow answers in Danish (default) or English: CASHFLOOW_LANG=en.
// The analysis code builds Danish field names; localize() renames them (and a fixed set of category
// values) at the edge, so the calculations stay language-free. Sentences are written in both languages
// where they are made, with tr(danish, english). Numbers and dates follow the language too.

// Read on every call: mcp-server.js loads .env after the imports have run.
// "en", "english" or "true" (the Claude Desktop extension's checkbox) mean English.
export const isEn = () => /^(en|true)/i.test((process.env.CASHFLOOW_LANG || "").trim());
export const tr = (da, en) => (isEn() ? en : da);

const locale = () => (isEn() ? "en-GB" : "da-DK");
export const num = (x, maxDigits = 1) => x.toLocaleString(locale(), { maximumFractionDigits: maxDigits });
// "-12.500 kr." / "-DKK 12,500"
export const kr = (x, digits = 0) => {
  const v = (digits ? x : Math.round(x)).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (!isEn()) return v + " kr.";
  return /^[-−]/.test(v) ? "-DKK " + v.slice(1) : "DKK " + v;
};
export const pct = (x, d = 0) => (x * 100).toLocaleString(locale(), { maximumFractionDigits: d }) + (isEn() ? "%" : " %");
const MON_DA = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const months = () => (isEn() ? MON_EN : MON_DA);
// "3. dec." / "3 Dec"
export const dayMonth = (ms) => { const d = new Date(ms); return isEn() ? `${d.getUTCDate()} ${MON_EN[d.getUTCMonth()]}` : `${d.getUTCDate()}. ${MON_DA[d.getUTCMonth()]}`; };
// "dec. 2026" / "Dec 2026"
export const monthYear = (ms) => { const d = new Date(ms); return `${months()[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const list = (xs) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + (isEn() ? " and " : " og ") + xs.at(-1));

// Danish field name -> English field name.
const KEYS = {
  abc: "abc", adi: "adi", alder: "age", andel: "share", andel_1_2_stjerner: "share_1_2_stars", andel_af_omsætning: "share_of_revenue",
  andel_af_pakker: "share_of_parcels", andel_betalt_til_tiden_12m: "share_paid_on_time_12m", andel_fra_udlandet: "share_from_abroad",
  andel_til_tiden: "share_on_time", anmeldelser: "reviews", anmeldelser_forsinket: "reviews_late", anmeldelser_til_tiden: "reviews_on_time",
  antagelser: "assumptions", antal: "count", backtest: "backtest", backtest_oprindelser: "backtest_origins", bedste: "best", beløb: "amount",
  beløb_i: "currency", beløb_i_alt: "total_amount", bemærkning: "note", bemærkninger: "notes", bestil_nu: "order_now",
  betaler_dage_ift_forfald_skøn: "pays_days_vs_due_estimate", betaler_normalt_dage_efter_forfald: "usually_pays_days_after_due",
  betalinger: "payments", betalinger_bag: "payments_behind", betalt_mere_end_3_dage_før_forfald: "paid_more_than_3_days_before_due",
  bevægelser_frem_til_laveste_punkt: "movements_until_lowest_point", bias: "bias", bias_stk: "bias_units", bundet_kapital_kr: "tied_up_capital_dkk",
  chi2: "chi2", chi2_test: "chi2_test", cramers_v: "cramers_v", cv2: "cv2", dage_over_forfald: "days_overdue", dage_pr_måned: "days_per_month",
  dage_siden_salg: "days_since_sale", dage_til_genbestillingspunkt: "days_to_reorder_point", dages_dækning: "days_of_cover", dato: "date",
  datoer: "dates", disponibelt: "available", dækning: "coverage", dækning_80_interval: "coverage_80_interval", dækning_pr_mønster: "coverage_by_pattern",
  død_beholdning: "dead_stock", efterspørgselsmønstre: "demand_patterns", ekstra_returneringer_pga_forsinkelse: "extra_returns_due_to_delay",
  faktura: "invoice", fakturadato: "invoice_date", fakturaer: "invoices", fakturaer_12m: "invoices_12m", faktureret_indtil_nu: "invoiced_so_far",
  fast_prognose: "point_forecast", fast_prognose_dato: "point_forecast_date", fejl: "error", flere_varer_matcher: "several_products_match",
  forbedring: "improvement", fordeling: "breakdown", fordeling_efter_alder: "breakdown_by_age", foreslået_antal: "suggested_quantity",
  forfald: "due_date", forfaldent: "overdue", forklaring: "explanation", forsinkelse: "delay", forsinkelsesomkostning_i_alt: "delay_cost_total",
  forsinkelsesomkostning_pr_pakke: "delay_cost_per_parcel", forskel_procentpoint: "difference_percentage_points",
  forskel_stjerner_forsinket_minus_til_tiden: "star_difference_late_minus_on_time", forudsætninger: "assumptions", fra: "from",
  fragtfirma: "carrier", fragtfirmaer: "carriers", fragtpris_pr_pakke: "freight_price_per_parcel", frihedsgrader: "degrees_of_freedom",
  fund: "findings", første: "first", gange_normalt: "times_normal", genbestillingspunkt: "reorder_point", genbestillingspunkter: "reorder_points",
  gennemsnit: "average", gns_dage_efter_forfald: "avg_days_after_due", gns_dage_for_sent_når_for_sent: "avg_days_late_when_late",
  gns_dage_fra_faktura_til_betaling: "avg_days_from_invoice_to_payment", gns_dage_ift_forfald: "avg_days_vs_due", gns_fejl_stk: "avg_error_units",
  gns_leveringstid_hverdage: "avg_transit_business_days", gns_stjerner: "avg_stars", gruppe: "group", heraf_forfaldent: "of_which_overdue",
  historik_seneste_12: "history_last_12", horisont: "horizon", horisont_måneder: "horizon_months", højest_risiko_for_udsolgt: "highest_stockout_risk",
  i_bestilling_hos_leverandør: "on_order_from_supplier", i_forhold_til_bedste: "vs_best", ind_kunder_forventede: "in_customers_expected",
  ind_kunder_kendte: "in_customers_known", indkøb_12m: "purchases_12m", indkøbspris: "purchase_cost", interval_80: "interval_80",
  interval_95: "interval_95", intervaller: "intervals", kilde: "source", klasse: "class", kontrolkort: "control_chart", kontroller: "checks",
  kostpris: "cost_price", kunde: "customer", kundens_95_percentil_dage: "customer_95th_percentile_days", kunder: "customers",
  lagerdage: "days_of_inventory", lagerposition: "inventory_position", lagertal: "stock_figures", lagerværdi: "inventory_value",
  lagerværdi_kostpris: "inventory_value_at_cost", land: "country", lande: "countries", laveste: "lowest", laveste_saldo: "lowest_balance",
  laveste_saldo_dagsniveau: "lowest_balance_daily", leverandør: "supplier", leverandører: "suppliers", levering: "delivery",
  leveringstid_dage: "lead_time_days", mae_kr: "mae_dkk", manglende_beløb_hvis_under: "shortfall_if_below", mape: "mape", mase: "mase",
  median: "median", metode: "method", minimum: "minimum", model: "model", modeller: "models", mulige_dobbeltfakturaer: "possible_duplicate_invoices",
  mål: "target", måned: "month", måneder: "months", måneder_med_data: "months_with_data", mønster: "pattern", navn: "name",
  nedre_grænse: "lower_limit", normalt_beløb: "normal_amount", odds_ratio: "odds_ratio", omsætning_12m: "revenue_12m",
  omsætningshastighed: "inventory_turnover", opgjort_pr: "as_of", oprindelser: "origins", overlager: "overstock", overskud_kr: "excess_dkk",
  overskud_stk: "excess_units", p10: "p10", p10_p90: "p10_p90", p5: "p5", p90: "p90", p_værdi: "p_value", p_værdi_holm: "p_value_holm",
  pakker: "parcels", periode: "period", post: "item", pr_horisont: "by_horizon", prognose: "forecast", prognosens_træfsikkerhed: "forecast_accuracy",
  prognoser_målt: "forecasts_measured", på_lager: "in_stock", reel_pris_pr_pakke: "real_price_per_parcel", regel: "rule", region: "region",
  reserveret_til_kunder: "reserved_for_customers", returneringer: "returns", returomkostning_kr: "return_cost_dkk", returrate: "return_rate",
  returrate_justeret: "return_rate_adjusted", returrate_rå: "return_rate_raw", risiko: "risk", risiko_udsolgt_før_levering: "stockout_risk_before_delivery",
  risiko_under_minimum: "risk_below_minimum", rmse_kr: "rmse_dkk", rmse_stk: "rmse_units", robust_z: "robust_z", rækker: "rows", saldo: "balance",
  salg: "sales", salg_i_leveringstiden: "sales_during_lead_time", salg_pr_uge: "sales_per_week", salg_seneste_26_uger: "sales_last_26_weeks",
  salgspris: "sales_price", samlet_13_uger: "total_13_weeks", samlet_4_uger: "total_4_weeks", samlet_indkøb_kr: "total_purchase_dkk",
  samme_måned_sidste_år: "same_month_last_year", sammenligninger: "comparisons", sandsynlighed_under_minimum: "probability_below_minimum",
  scenarier: "scenarios", servicegrad: "service_level", sidste: "last", signaler: "signals", sikker_effekt: "significant_effect",
  sikker_forskel: "significant_difference", sikkerhedslager: "safety_stock", sikkerhedslager_dækning: "safety_stock_coverage",
  simulerede_forløb: "simulated_paths", slut: "end", snart: "soon", sorteret_efter: "sorted_by", start: "start", startsaldo: "opening_balance",
  store_poster: "large_items", største_usikkerhed: "largest_uncertainty", sæson: "season", til: "to", til_tiden: "on_time",
  til_tiden_hjemlevering: "on_time_home_delivery", til_tiden_pakkeshop: "on_time_parcel_shop", tilstrækkelige_data: "enough_data",
  tre_største_andel: "top_3_share", træfsikkerhed: "accuracy", type: "type", ubetalt: "unpaid", ubetalte_fakturaer: "unpaid_invoices",
  ud_faste_udgifter: "out_fixed_costs", ud_leverandører: "out_suppliers", ud_moms: "out_vat", udestående: "outstanding", udvikling: "trend",
  udvikling_95_interval: "trend_95_interval", udvikling_dage: "trend_days", udvikling_pr_måned_dage: "trend_per_month_days",
  udvikling_vurdering: "trend_assessment", uge: "week", ugedag: "weekday", ugeplan: "weekly_plan", uger: "weeks", uger_målt: "weeks_measured",
  uger_under_minimum: "weeks_below_minimum", ugevis: "by_week", usædvanlige_beløb: "unusual_amounts", usædvanligt_sene_betalinger: "unusually_late_payments",
  valgt: "chosen", valgt_model: "chosen_model", valuta: "currency", vareforbrug_12m: "cost_of_goods_sold_12m", varenr: "product_number",
  varer: "products", virksomhed: "company", vurdering: "assessment", værdi: "value", wape: "wape", wape_13_ugers_gennemsnit: "wape_13_week_average",
  wape_1_måned_frem: "wape_1_month_ahead", webshop: "webshop", ældste_forfaldne_dage: "oldest_overdue_days", økonomisk_ordrestørrelse: "economic_order_quantity",
  øvre_grænse: "upper_limit",
  // demand patterns and months used as keys
  jævn: "smooth", svingende: "erratic", sporadisk: "intermittent", klumpet: "lumpy", "intet salg": "no sales",
  "jan.": "Jan", "feb.": "Feb", "mar.": "Mar", "apr.": "Apr", maj: "May", "jun.": "Jun", "jul.": "Jul", "aug.": "Aug", "sep.": "Sep",
  "okt.": "Oct", "nov.": "Nov", "dec.": "Dec",
};

// Danish category value -> English (exact whole-string matches only; names of customers and products are left alone).
const VALUES = {
  jævn: "smooth", svingende: "erratic", sporadisk: "intermittent", klumpet: "lumpy", "intet salg": "no sales",
  langsommere: "slower", hurtigere: "faster", "ingen sikker ændring": "no significant change", "for få data": "too little data",
  "Ikke forfalden": "Not yet due", "1–15 dage": "1–15 days", "16–30 dage": "16–30 days", "31–60 dage": "31–60 days", "Over 60 dage": "Over 60 days",
  kundefaktura: "customer invoice", leverandørfaktura: "supplier invoice", forfaldent: "overdue", forsinkelse: "delay", udvikling: "trend",
  omsætning: "revenue", reel_pris: "real_price", til_tiden: "on_time", stjerner: "stars", pakker: "parcels", region: "region", ugedag: "weekday",
  man: "Mon", tir: "Tue", ons: "Wed", tor: "Thu", fre: "Fri", lør: "Sat", søn: "Sun",
  "Til tiden": "On time", "1 dag for sent": "1 day late", "2 dage for sent": "2 days late", "3+ dage for sent": "3+ days late",
  "uge 1": "week 1", "uge 2–4": "weeks 2–4", "uge 5–13": "weeks 5–13", "seneste 90 dage": "last 90 days", "rullende oprindelse": "rolling origin",
  "Eksempelvirksomhed": "Sample company", "Eksempeldata": "Sample data", "e-conomic demokonto": "e-conomic demo account",
  "Demo Møbler ApS (eksempeldata)": "Demo Møbler ApS (sample data)", "Demo Webshop ApS (eksempeldata)": "Demo Webshop ApS (sample data)",
  "Indbetalinger fra kunder": "Payments from customers", "Betalinger til leverandører": "Payments to suppliers",
  "Faste udgifter (løn, husleje mv.)": "Fixed costs (salaries, rent etc.)", Moms: "VAT", "Begge dele": "Both",
  "Kunderne betaler til tiden": "Customers pay on time", "I betaler leverandører på forfaldsdagen, ikke før": "You pay suppliers on the due date, not before",
  "Naiv (sidste måned)": "Naive (last month)", "Sæsonnaiv (samme måned sidste år)": "Seasonal naive (same month last year)",
  "Gennemsnit af de seneste 3 måneder": "Average of the last 3 months", "Holt (dæmpet trend)": "Holt (damped trend)",
  "Holt-Winters (trend og sæson, additiv)": "Holt-Winters (trend and season, additive)", "Holt-Winters (trend og sæson, multiplikativ)": "Holt-Winters (trend and season, multiplicative)",
  "Gennemsnit af de seneste 13 uger": "Average of the last 13 weeks", "Eksponentiel udjævning": "Exponential smoothing",
  "Croston (SBA, til varer der sælger ind imellem)": "Croston (SBA, for products that sell now and then)",
  Danmark: "Denmark", Tyskland: "Germany", Sverige: "Sweden", Kina: "China", Litauen: "Lithuania", Belgien: "Belgium", Norge: "Norway", Polen: "Poland",
  Stole: "Chairs", Borde: "Tables", Belysning: "Lighting", "Polstrede møbler": "Upholstered furniture", Kontor: "Office", Tilbehør: "Accessories",
  Opbevaring: "Storage", Tekstiler: "Textiles", Tøj: "Clothing", Sko: "Shoes", Holland: "Netherlands", "Varer m/moms": "Goods incl. VAT", "Ydelser m/moms": "Services incl. VAT",
};

// One category value in the chosen language, for use inside sentences.
export const val = (x) => (isEn() ? VALUES[x] ?? x : x);

export function localize(x) {
  if (!isEn()) return x;
  if (Array.isArray(x)) return x.map(localize);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [KEYS[k] ?? k, localize(v)]));
  if (typeof x === "string") return VALUES[x] ?? x;
  return x;
}

// For the test: field names that were not translated.
export const knownKeys = () => new Set(Object.values(KEYS));
export const danishKeys = () => new Set(Object.keys(KEYS).filter((k) => KEYS[k] !== k));
