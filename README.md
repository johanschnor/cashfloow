# Cashfloow

English · **[Dansk](README.da.md)**

A free, open-source [MCP](https://modelcontextprotocol.io) server that gives Claude finished analyses of a company's cash flow, customers, suppliers, sales and stock from the Danish accounting system [e-conomic](https://www.e-conomic.dk). Instead of raw bookkeeping data, Claude gets answers like *"Konferencecenteret has become 6 days slower to pay, and this is not chance"* or *"Order 40 office chairs now: 98% risk of selling out before the next delivery"*.

- **Free and open:** MIT licence. No account, no server, no payment.
- **Runs on your machine:** The server runs locally with your own e-conomic tokens. Data only moves between e-conomic, your computer and the Claude client you use.
- **Read-only:** Nothing is ever written to e-conomic.
- **Try it without accounts:** A made-up sample company with 36 months of data and a sample webshop with freight data are included.
- **English or Danish:** Tool names, parameters, field names and findings in either language (`CASHFLOOW_LANG=en`). Danish is the default.

Not affiliated with, endorsed by or developed by e-conomic or Visma.

## Get started

**Claude Desktop, easiest:** Download `cashfloow-<version>.mcpb` from [Releases](../../releases) and double-click it (or Settings → Extensions → Advanced settings → Install Extension). Claude Desktop shows fields for your e-conomic tokens and an **English** checkbox. Leave the tokens empty to try with sample data. Nothing else to install.

**Claude Desktop, manually:** Needs [Node.js](https://nodejs.org) 18 or later. Add under `mcpServers` in `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cashfloow": {
      "command": "npx",
      "args": ["-y", "cashfloow"],
      "env": {
        "CASHFLOOW_LANG": "en",
        "ECONOMIC_APP_SECRET_TOKEN": "...",
        "ECONOMIC_AGREEMENT_GRANT_TOKEN": "..."
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add cashfloow -e CASHFLOOW_LANG=en -e ECONOMIC_APP_SECRET_TOKEN=... -e ECONOMIC_AGREEMENT_GRANT_TOKEN=... -- npx -y cashfloow
```

Without tokens everything works on sample data and on e-conomic's public demo account. Ask for example *"Who is tying up our cash?"*, *"Will we run out of money before the summer?"* or *"What should we reorder?"*.

**From source:**

```bash
git clone https://github.com/<owner>/cashfloow.git
cd cashfloow
npm install
```

Open the folder in Claude Code, which finds the server in `.mcp.json`, or use `node /full/path/to/cashfloow/mcp-server.js` as the command in the configuration above.

## Use your own accounts

1. Create a free developer agreement and an app at https://www.e-conomic.com/developer. That gives you an *AppSecretToken*.
2. Open the app's installation link and approve access in your e-conomic. That gives you an *AgreementGrantToken*.
3. Put both tokens in the extension's fields in Claude Desktop, in `env` in the configuration above, or (from source) in a `.env` file copied from `.env.example`.

Every tool takes `source`: `"sample"` (default) or `"e-conomic"`. Ask Claude to use e-conomic when you want your own figures.

Your tokens give access to your accounts. Do not share them, and never commit `.env` (it is in `.gitignore`).

## Language

Set `CASHFLOOW_LANG=en` for English, or tick **English** in the extension's settings. Without it, Cashfloow answers in Danish. The choice changes tool names, descriptions, parameter names, field names in the answers, category values (e.g. demand pattern `smooth`), findings, assumptions and number formats (`DKK 12,500` instead of `12.500 kr.`). Amounts are always in DKK. Names of customers, suppliers and products are left as they are in the accounts. The dashboard follows the same setting.

## Tools

All are read-only. Names in English, with the Danish name in brackets.

| Tool | Answers |
|---|---|
| `company_overview` (`virksomhedsoverblik`) | Key figures for customers and suppliers plus the main findings |
| `customers_tying_up_cash` (`kunder_der_binder_penge`) | Customers ranked by overdue amount, delay, trend or revenue |
| `customer` (`kunde`) | One customer's payment behaviour and unpaid invoices |
| `unpaid_invoices` (`ubetalte_fakturaer`) | Who to send a reminder to, and outstanding by age |
| `payment_time_by_month` (`betalingstid_pr_maaned`) | Are customers getting slower to pay? |
| `suppliers` (`leverandoerer`) | Dependence on suppliers and countries, and whether you pay too early |
| `cash_forecast` (`likviditetsprognose`) | Will we run out of money, when and why? Bank balance week by week with scenarios |
| `cash_risk` (`likviditetsrisiko`) | How big is the risk? Monte Carlo simulation, 80% intervals and a backtest of the forecast |
| `sales_forecast` (`salgsprognose`) | Sales for the coming months with intervals; several models tested against each other with error metrics |
| `anomalies` (`afvigelser`) | Possible duplicate invoices, unusual amounts and unusually late payments |
| `inventory_overview` (`lageroverblik`) | Inventory value, ABC, demand patterns, dead stock, overstock and forecast accuracy |
| `reorder` (`genbestilling`) | What to order now, and how much? Safety stock, reorder point and EOQ per product |
| `product` (`vare`) | One product's sales, forecast, model errors and stock status |
| `freight_overview` (`fragtoverblik`) | Sample webshop: parcels on time, return rate, reviews and what delays cost |
| `compare_carriers` (`sammenlign_fragtfirmaer`) | Sample webshop: carriers compared on precision, returns and real price per parcel |
| `delay_effect` (`forsinkelsens_effekt`) | Sample webshop: do delays cause more returns and worse reviews? |
| `delivery_where_and_when` (`levering_hvor_og_hvornaar`) | Sample webshop: delivery precision by region and weekday |
| `freight_statistics` (`fragt_statistik`) | Sample webshop: statistical tests of carriers and the effect of delays |

The freight tools only run on the made-up webshop. They show which questions freight data can answer. Real freight data needs an integration that has not been built yet.

## Dashboard

```bash
npm run dashboard
```

Opens a local dashboard at http://localhost:4400 with the cash forecast, customers and suppliers. It uses the same data, tokens and language setting.

## How the cash forecast works

- **Opening balance:** The balance of bank and cash accounts in e-conomic's chart of accounts.
- **Customers:** Open invoices are expected to be paid on the due date plus *that customer's* own average delay. New sales follow the average of the last 12 weeks and are paid after the usual payment time.
- **Suppliers:** Open invoices are paid the way the company usually pays that supplier. New purchases follow the average of the last 12 weeks.
- **Salaries and fixed costs:** An estimate from the last 3 months' other bank payments. The sample company has them set directly.
- **VAT:** Danish quarterly settlement (1 March, 1 June, 1 September and 1 December). The next deadline uses the balance of the VAT accounts; later deadlines are estimated from sales and Danish purchases.

All assumptions are returned with the forecast, so it is always clear what is an estimate.

## Forecasts and statistics

All methods are written without external libraries (`lib/stats.js`) and tested against table values.

- **Sales forecast** (`lib/salesforecast.js`): Monthly invoiced sales. Naive, seasonal naive, 3-month average, Holt with damped trend and Holt-Winters (additive and multiplicative, needs two full years) are tested in a rolling-origin backtest over up to the last 12 months, all on the same origins. The model with the lowest WAPE is chosen. Error metrics: WAPE, MAPE, MAE, RMSE, bias and MASE (relative to seasonal naive). The 80% and 95% intervals are built on the chosen model's own relative errors per horizon in the backtest.
- **Cash risk** (`lib/cashrisk.js`): Monte Carlo with 2,000 paths on top of the cash forecast. Each open customer invoice is paid after a delay drawn from *that customer's* own payments in the last year. An overdue invoice is only drawn from delays longer than it has already waited. New sales and purchases per week are drawn from the last 26 weeks and scaled to the forecast level. The balance is followed day by day. The forecast of customer payments is backtested from 8 earlier dates, measuring how often actual payments fell inside the simulation's 80% interval (calibration).
- **Payment behaviour** (`lib/analyze.js`): Linear regression of days after due date on payment date per customer (at least 8 payments) and overall. Slope per month, 95% interval and p-value. A customer is only called "slower" when p < 0.05.
- **Anomalies** (`lib/anomalies.js`): Robust z-score (median and MAD) on the logarithm of invoice amounts per customer and supplier, possible duplicate invoices, and open invoices beyond the customer's 95th percentile of delay.
- **Inventory** (`lib/inventory.js`): Sales per product from invoice lines, adjusted with a shared seasonal index (classical decomposition of monthly revenue, needs 24 full months). Demand pattern by Syntetos–Boylan (ADI and CV²) and ABC by revenue (80/15/5%). Three models (13-week average, exponential smoothing with fitted α, Croston/SBA) are backtested from 26 weeks on what matters for purchasing: sales during the lead time. The model with the lowest MAE is chosen. Safety stock = the chosen model's RMSE in the backtest × the t-quantile for the service level with a prediction correction, so the buffer matches how far the forecast has actually missed. The reorder point is rounded up to whole units and the order quantity is EOQ. Safety stocks are checked out of sample (each check only uses errors from earlier, non-overlapping periods), also per pattern. On the sample data they covered 96% of lead times against a 95% target, but only 93% for lumpy products against a 97% target.
- **Freight statistics** (`lib/fragt/stats.js`): Wilson intervals for share on time, chi² test across carriers, pairwise tests against the best with Holm correction, logistic regression of returns on delay adjusted for product category (odds ratio), Welch t-test on stars and p control charts of weekly delivery precision.

The sample company has 36 months of data with seasonality and about 8% annual growth. It has a built-in customer who is getting slower (Konferencecenteret), an oversized supplier invoice and a possible duplicate invoice, so you can see the methods find them. It also has 31 products with stock and invoice lines (`lib/sample-inventory.js`): some must be ordered now, a discontinued coffee table still has stock, a few products are overstocked and one is new.

## Tests

```bash
npm test
```

Starts the MCP server over stdio the way Claude does, calls every tool in both Danish and English, and checks that the methods find what was built into the sample data and that every field name is translated. Also runs against e-conomic's public demo account (needs network; skip with `OFFLINE=1 npm test`). No tokens needed. The tests run on every push and pull request via GitHub Actions.

## What the data can and cannot tell

- **Customer payments** are booked with the invoice number, so the payment date per invoice is exact.
- **Supplier payments** are not linked to a specific invoice in e-conomic. They are matched first-in-first-out per supplier, so they are an estimate.
- **Supplier invoices** have no product lines in e-conomic. Price trends per product need e-invoices (Peppol/NemHandel).
- **Stock:** Stock levels (`inventory` on the product) only exist when e-conomic's inventory module is enabled. Without it, the inventory tools give sales patterns and reorder points but cannot say what to order. Supplier lead times are not in e-conomic: the default is 14 days and Claude can give another. Invoice lines are fetched one invoice at a time (the last 24 months, at most 3,000 invoices), and only when an inventory tool is used. The first call can therefore take a minute for a large company; after that it is cached for 30 minutes.

## Releasing

For maintainers:

```bash
npm test
npm run build:mcpb        # dist/cashfloow-<version>.mcpb
npm publish               # runs the tests first
```

`build:mcpb` bundles the server with production dependencies, takes the tool list straight from the running server, validates the manifest and packs it. A tag like `v1.1.0` makes GitHub Actions build the `.mcpb` file and attach it to a release. The build script takes the version from `package.json`.

## Structure

```
mcp-server.js            The MCP server (stdio)
server.js, public/       Local dashboard
lib/economic.js          Reads from e-conomic's REST API
lib/sample*.js           The sample company and its stock
lib/analyze.js           Customers, suppliers and payment behaviour
lib/forecast.js          Cash forecast
lib/cashrisk.js          Monte Carlo risk and backtest
lib/salesforecast.js     Sales forecast
lib/anomalies.js         Anomalies
lib/inventory.js         Inventory management
lib/stats.js             Statistics without external libraries
lib/tools.js             The MCP tools
lib/i18n.js, register.js Danish and English
lib/fragt/               Freight analysis on the sample webshop
test/mcp.test.mjs        End-to-end test over stdio
manifest.json            Manifest for the Claude Desktop extension (.mcpb)
scripts/build-mcpb.mjs   Builds the .mcpb file
```

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## Disclaimer

The analyses are decision support, not advice. Forecasts and estimates can be wrong, and the tools say how uncertain they are. Check the figures before making decisions about purchasing, credit or financing.

## Licence

[MIT](LICENSE)
