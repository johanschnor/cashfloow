#!/usr/bin/env node
// Regnskab MCP: gives Claude finished analyses of a company's cash flow, sales and stock
// from e-conomic, instead of raw accounting data. Runs locally over stdio; see README.md.
//
// Data source per call: "eksempel" (made-up company) or "e-conomic" (your own tokens from .env or
// the environment, otherwise e-conomic's public demo account). Read-only: nothing is ever written to e-conomic.
// NOTE: stdout is the MCP channel, so this file must never console.log.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadFromEconomic, loadInventoryFromEconomic } from "./lib/economic.js";
import { loadSample } from "./lib/sample.js";
import { analyze } from "./lib/analyze.js";
import { createServer } from "./lib/tools.js";
import { loadSample as loadSampleShop } from "./lib/fragt/sample.js";
import { analyze as analyzeFragt } from "./lib/fragt/analyze.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(root, ".env"));
const tokens = {
  appSecretToken: process.env.ECONOMIC_APP_SECRET_TOKEN || "demo",
  agreementGrantToken: process.env.ECONOMIC_AGREEMENT_GRANT_TOKEN || "demo",
};

const cache = new Map(); // kilde -> { at, result }
async function getAnalysis(kilde = "eksempel") {
  const hit = cache.get(kilde);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.result;
  const data = kilde === "e-conomic" ? await loadFromEconomic(tokens) : loadSample();
  const result = analyze(data);
  Object.defineProperty(result, "_data", { value: data }); // kept for the forecast, not serialised
  cache.set(kilde, { at: Date.now(), result });
  return result;
}

// Products and invoice lines from e-conomic, only fetched when an inventory tool is used (one call per invoice).
const inventoryCache = new Map();
async function loadInventory(kilde, analysis) {
  const hit = inventoryCache.get(kilde);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.inv;
  const inv = await loadInventoryFromEconomic(tokens, analysis._data.invoices, new Date(analysis.asOf + "T00:00:00Z"));
  inventoryCache.set(kilde, { at: Date.now(), inv });
  return inv;
}

// Freight tools run on a made-up webshop: they show what freight data can answer.
let shop;
const getFragt = (returnCost = 250) => analyzeFragt((shop ||= loadSampleShop()), { returnCost });

const server = createServer({ getAnalysis, getFragt, loadInventory });

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

await server.connect(new StdioServerTransport());
