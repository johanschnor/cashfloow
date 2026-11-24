# Cashfloow

**[English](README.md)** · Dansk

<a href="https://mcprush.com/to/cashfloow-mcp?ref=badge"><img width="380" height="200" src="https://mcprush.com/badge/cashfloow-mcp/card.svg" alt="Cashfloow MCP server" /></a>

En gratis MCP-server, der giver Claude færdige analyser af en virksomheds likviditet, kunder, leverandører, salg og lager ud fra e-conomic. I stedet for rå regnskabsdata får Claude svar som *"Konferencecenteret er statistisk sikkert blevet 4 dage langsommere til at betale"* eller *"Bestil 40 kontorstole nu: 98 % risiko for udsolgt før næste levering"*.

- **Gratis og åben:** MIT-licens. Ingen konto, ingen server, ingen betaling.
- **Kører hos dig:** Serveren kører lokalt på din computer med dine egne e-conomic-nøgler. Data går kun mellem e-conomic, din computer og den Claude-klient, du selv bruger.
- **Kun læsning:** Der skrives aldrig noget til e-conomic.
- **Prøv uden regnskab:** En opdigtet eksempelvirksomhed med 36 måneders data og en eksempel-webshop med fragtdata følger med.

Projektet er ikke tilknyttet, godkendt af eller udviklet af e-conomic eller Visma.

## Kom i gang

**Claude Desktop, nemmest:** Hent `cashfloow-<version>.mcpb` under [Releases](https://github.com/johanschnor/cashfloow/releases/latest) og dobbeltklik på filen. Claude Desktop viser udvidelsen og felter til dine e-conomic-nøgler. Lad felterne stå tomme for at prøve med eksempeldata. Kræver ikke, at du installerer noget andet.

**Claude Desktop, manuelt:** Kræver [Node.js](https://nodejs.org) 18 eller nyere. Tilføj under `mcpServers` i `claude_desktop_config.json` (Indstillinger → Udvikler → Rediger konfiguration):

```json
{
  "mcpServers": {
    "cashfloow": {
      "command": "npx",
      "args": ["-y", "cashfloow"],
      "env": {
        "ECONOMIC_APP_SECRET_TOKEN": "...",
        "ECONOMIC_AGREEMENT_GRANT_TOKEN": "..."
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add cashfloow -e ECONOMIC_APP_SECRET_TOKEN=... -e ECONOMIC_AGREEMENT_GRANT_TOKEN=... -- npx -y cashfloow
```

Uden tokens virker alt på eksempeldata og på e-conomics offentlige demokonto. Spørg fx *"Hvem binder vores penge?"*, *"Løber vi tør for penge før sommerferien?"* eller *"Hvad skal vi bestille hjem?"*.

**Fra kildekoden:**

```bash
git clone https://github.com/johanschnor/cashfloow.git
cd cashfloow
npm install
```

Åbn mappen i Claude Code, som finder serveren i `.mcp.json`, eller brug `node /fuld/sti/til/cashfloow/mcp-server.js` som kommando i konfigurationen ovenfor.

## Brug dit eget regnskab

1. Opret en gratis udvikleraftale og en app på https://www.e-conomic.com/developer. Så får du et *AppSecretToken*.
2. Åbn appens installationslink og godkend adgangen i din e-conomic. Så får du et *AgreementGrantToken*.
3. Indsæt begge tokens i udvidelsens felter i Claude Desktop, i `env` i konfigurationen ovenfor, eller (fra kildekoden) i en `.env`-fil kopieret fra `.env.example`.

Hvert værktøj tager `kilde`: `"eksempel"` (standard) eller `"e-conomic"`. Bed Claude om at bruge e-conomic, når du vil have dine egne tal.

## Sprog

Værktøjerne svarer på dansk som standard. Sæt `CASHFLOOW_LANG=en` (eller slå "English / Engelsk" til i udvidelsens indstillinger), så får værktøjerne engelske navne, parametre, feltnavne og fund, og beløb vises som `DKK 12,500`. Dashboardet følger samme indstilling. De engelske værktøjsnavne står i [README.md](README.md).

Dine tokens giver adgang til dit regnskab. Del dem ikke, og commit aldrig `.env` (den står i `.gitignore`).

## Værktøjer

Alle er kun læsning.

| Værktøj | Svarer på |
|---|---|
| `virksomhedsoverblik` | Nøgletal for kunder og leverandører plus de vigtigste fund |
| `kunder_der_binder_penge` | Kunder rangeret efter forfaldent beløb, forsinkelse, udvikling eller omsætning |
| `kunde` | Én kundes betalingsadfærd og ubetalte fakturaer |
| `ubetalte_fakturaer` | Hvem skal rykkes, og udestående fordelt på alder |
| `betalingstid_pr_maaned` | Bliver kunderne langsommere til at betale? |
| `leverandoerer` | Afhængighed af leverandører og lande, og om I selv betaler for tidligt |
| `likviditetsprognose` | Løber vi tør for penge, hvornår og hvorfor? Banksaldo uge for uge med scenarier |
| `likviditetsrisiko` | Hvor stor er risikoen? Monte Carlo-simulation, 80 %-intervaller og backtest af prognosen |
| `salgsprognose` | Salget de næste måneder med intervaller; flere modeller testet mod hinanden med fejlmål |
| `afvigelser` | Mulige dobbeltfakturaer, usædvanlige beløb og usædvanligt sene betalinger |
| `lageroverblik` | Lagerværdi, ABC, efterspørgselsmønstre, død beholdning, overlager og prognosernes træfsikkerhed |
| `genbestilling` | Hvad skal bestilles nu, og hvor meget? Sikkerhedslager, genbestillingspunkt og EOQ pr. vare |
| `vare` | Én vares salg, prognose, modelfejl og lagerstatus |
| `fragtoverblik` | Eksempel-webshop: pakker til tiden, returrate, anmeldelser og hvad forsinkelser koster |
| `sammenlign_fragtfirmaer` | Eksempel-webshop: fragtfirmaer sammenlignet på præcision, returneringer og reel pris pr. pakke |
| `forsinkelsens_effekt` | Eksempel-webshop: giver forsinkelser flere returneringer og dårligere anmeldelser? |
| `levering_hvor_og_hvornaar` | Eksempel-webshop: leveringspræcision fordelt på region, ugedag og leveringsform |
| `fragt_statistik` | Eksempel-webshop: statistiske tests af fragtfirmaer og forsinkelsers effekt |

Fragtværktøjerne kører kun på den opdigtede webshop. De viser, hvilke spørgsmål fragtdata kan besvare. Rigtige fragtdata kræver en integration, som ikke er bygget endnu.

## Dashboard

```bash
npm run dashboard
```

Åbner et lokalt dashboard på http://localhost:4400 med likviditetsprognose, kunder og leverandører. Det bruger de samme data og tokens.

## Sådan virker likviditetsprognosen

- **Startsaldo:** Saldoen på bank- og kassekonti i e-conomics kontoplan.
- **Kunder:** Åbne fakturaer forventes betalt på forfaldsdagen plus *den kundes* egen gennemsnitlige forsinkelse. Nyt salg følger snittet for de seneste 12 uger og betales efter den normale betalingstid.
- **Leverandører:** Åbne fakturaer betales, som virksomheden plejer at betale den leverandør. Nye indkøb følger snittet for de seneste 12 uger.
- **Løn og faste udgifter:** Et skøn ud fra de seneste 3 måneders øvrige bankudbetalinger. Eksempelvirksomheden har dem angivet direkte.
- **Moms:** Kvartalsvis afregning (1. marts, 1. juni, 1. september og 1. december). Næste frist bruger saldoen på momskontiene, senere frister skønnes ud fra salg og danske indkøb.

Alle antagelser returneres sammen med prognosen, så det altid er tydeligt, hvad der er skøn.

## Prognoser og statistik

Alle metoder er skrevet uden eksterne biblioteker (`lib/stats.js`) og testet mod tabelværdier.

- **Salgsprognose** (`lib/salesforecast.js`): Månedligt faktureret salg. Modellerne naiv, sæsonnaiv, 3-måneders gennemsnit, Holt med dæmpet trend og Holt-Winters (additiv og multiplikativ, kræver to hele år) testes med en backtest med rullende oprindelse over de seneste op til 12 måneder, alle på de samme oprindelser. Den model med lavest WAPE vælges. Fejlmål: WAPE, MAPE, MAE, RMSE, bias og MASE (i forhold til sæsonnaiv). Intervallerne (80 % og 95 %) bygger på den valgte models egne relative fejl pr. horisont i backtesten.
- **Likviditetsrisiko** (`lib/cashrisk.js`): Monte Carlo med 2.000 forløb oven på likviditetsprognosen. Hver åben kundefaktura betales efter en forsinkelse trukket fra *den kundes* egne betalinger det seneste år. En forfalden faktura trækkes kun fra forsinkelser, der er længere end den allerede har ventet. Nyt salg og nye indkøb pr. uge trækkes fra de seneste 26 uger og skaleres til prognosens niveau. Saldoen følges dag for dag. Prognosen for kundeindbetalinger backtestes fra 8 tidligere datoer, og det måles, hvor ofte de faktiske indbetalinger lå i simulationens 80 %-interval (kalibrering).
- **Betalingsadfærd** (`lib/analyze.js`): Lineær regression af dage efter forfald på betalingsdato pr. kunde (mindst 8 betalinger) og samlet. Hældning pr. måned, 95 %-interval og p-værdi. En kunde kaldes kun "langsommere", når p < 0,05.
- **Afvigelser** (`lib/anomalies.js`): Robust z-score (median og MAD) på logaritmen af fakturabeløb pr. kunde og leverandør, mulige dobbeltfakturaer, og åbne fakturaer over kundens 95. percentil for forsinkelse.
- **Lagerstyring** (`lib/inventory.js`): Salg pr. vare fra fakturalinjerne, justeret med et fælles sæsonindeks (klassisk dekomponering af månedsomsætningen, kræver 24 hele måneder). Efterspørgselsmønster efter Syntetos–Boylan (ADI og CV²) og ABC efter omsætning (80/15/5 %). Tre modeller (13-ugers gennemsnit, eksponentiel udjævning med valgt α, Croston/SBA) backtestes fra 26 uger på det, der betyder noget for indkøb: salget i leveringstiden. Modellen med lavest MAE vælges. Sikkerhedslager = den valgte models RMSE i backtesten × t-fraktilen for servicegraden med prædiktionskorrektion, så bufferen svarer til, hvor meget prognosen faktisk har ramt ved siden af. Genbestillingspunktet rundes op til hele stk., og ordrestørrelsen er EOQ. Sikkerhedslagrene kontrolleres uden for stikprøven (hver kontrol bruger kun fejl fra tidligere, ikke-overlappende perioder), også pr. mønster. På eksempeldata dækkede de 96 % af leveringsperioderne mod et mål på 95 %, men kun 93 % for klumpede varer mod et mål på 97 %.
- **Fragtstatistik** (`lib/fragt/stats.js`): Wilson-intervaller for andel til tiden, chi²-test på tværs af fragtfirmaer, parvise tests mod det bedste med Holm-korrektion, logistisk regression af returnering på forsinkelse justeret for produktkategori (odds ratio), Welch t-test på stjerner og p-kontrolkort over ugentlig leveringspræcision.

Eksempelvirksomheden har 36 måneders data med sæsonudsving og cirka 8 % vækst om året. Den har indbygget en kunde, der bliver langsommere (Konferencecenteret), samt en for stor leverandørfaktura og en mulig dobbeltfaktura, så man kan se, at metoderne finder dem. Den har også 31 varer med lager og fakturalinjer (`lib/sample-inventory.js`): nogle skal bestilles nu, ét sofabord er udgået med lager tilbage, et par varer har overlager, og én vare er ny.

## Tests

```bash
npm test
```

Starter MCP-serveren over stdio som Claude gør, kalder alle værktøjer og tjekker, at metoderne finder det, der er lagt ind i eksempeldata. Kører også mod e-conomics offentlige demokonto (kræver netværk; spring over med `OFFLINE=1 npm test`). Ingen tokens nødvendige. Testene kører på hver push og pull request via GitHub Actions.

## Hvad data kan og ikke kan

- **Kundebetalinger** er bogført med fakturanummer. Betalingsdatoen pr. faktura er derfor præcis.
- **Leverandørbetalinger** er ikke koblet til en bestemt faktura i e-conomic. De parres efter først-ind-først-ud pr. leverandør, så de er et skøn.
- **Leverandørfakturaer** har ingen varelinjer i e-conomic. Prisudvikling pr. vare kræver e-fakturaer (Peppol/NemHandel).
- **Lager:** Beholdningen (`inventory` på varen) findes kun, når e-conomics lagermodul er slået til. Uden den giver lagerværktøjerne salgsmønstre og genbestillingspunkter, men kan ikke sige, hvad der skal bestilles. Leverandørers leveringstider findes ikke i e-conomic: standard er 14 dage, og Claude kan angive en anden. Fakturalinjer hentes én faktura ad gangen (de seneste 24 måneder, højst 3.000 fakturaer), og kun når et lagerværktøj bruges. Første kald kan derfor tage et minut for en stor virksomhed, derefter caches det i 30 minutter.

## Udgivelse

For vedligeholdere:

```bash
npm test
npm run build:mcpb        # dist/cashfloow-<version>.mcpb
npm publish               # kører testene først
```

`build:mcpb` samler serveren med produktionsafhængighederne, tager værktøjslisten direkte fra den kørende server, validerer manifestet og pakker. Et tag som `v1.0.1` får GitHub Actions til at bygge `.mcpb`-filen og lægge den på en release. Hold `version` i `package.json` og `manifest.json` ens; build-scriptet bruger versionen fra `package.json`.

## Struktur

```
mcp-server.js            MCP-serveren (stdio)
server.js, public/       Lokalt dashboard
lib/economic.js          Læser fra e-conomics REST API
lib/sample*.js           Eksempelvirksomheden og dens lager
lib/analyze.js           Kunder, leverandører og betalingsadfærd
lib/forecast.js          Likviditetsprognose
lib/cashrisk.js          Monte Carlo-risiko og backtest
lib/salesforecast.js     Salgsprognose
lib/anomalies.js         Afvigelser
lib/inventory.js         Lagerstyring
lib/stats.js             Statistikfunktioner uden eksterne biblioteker
lib/tools.js             MCP-værktøjerne
lib/i18n.js, register.js Dansk og engelsk
lib/fragt/               Fragtanalyse på eksempel-webshoppen
test/mcp.test.mjs        End-to-end test over stdio
manifest.json            Manifest til Claude Desktop-udvidelsen (.mcpb)
scripts/build-mcpb.mjs   Bygger .mcpb-filen
```

## Bidrag

Fejlrapporter og pull requests er velkomne. Se [CONTRIBUTING.md](CONTRIBUTING.md). Sikkerhedshuller meldes som beskrevet i [SECURITY.md](SECURITY.md).

## Ansvarsfraskrivelse

Analyserne er beslutningsstøtte, ikke rådgivning. Prognoser og skøn kan tage fejl, og værktøjerne siger selv, hvor usikre de er. Tjek tallene, før du træffer beslutninger om indkøb, kredit eller finansiering.

## Licens

[MIT](LICENSE)
