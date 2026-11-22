// Local dashboard. Run: npm run dashboard  →  http://localhost:4400
// Tokens are read from .env (see .env.example). Without .env it uses e-conomic's public demo account.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFromEconomic } from "./lib/economic.js";
import { loadSample } from "./lib/sample.js";
import { analyze } from "./lib/analyze.js";
import { forecast } from "./lib/forecast.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(root, ".env"));

const PORT = Number(process.env.PORT || 4400);
const tokens = {
  appSecretToken: process.env.ECONOMIC_APP_SECRET_TOKEN || "demo",
  agreementGrantToken: process.env.ECONOMIC_AGREEMENT_GRANT_TOKEN || "demo",
};
const cache = new Map(); // source -> { at, result }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/analysis") {
      const source = url.searchParams.get("source") === "economic" ? "economic" : "sample";
      const fresh = url.searchParams.get("refresh") === "1";
      const hit = cache.get(source);
      if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return send(res, 200, hit.result);
      const data = source === "economic" ? await loadFromEconomic(tokens) : loadSample();
      const result = analyze(data);
      result.forecast = forecast(data, result);
      cache.set(source, { at: Date.now(), result });
      return send(res, 200, result);
    }
    // Static files from /public only.
    const file = path.normalize(path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(path.join(root, "public"))) return send(res, 403, { error: "Forbidden" });
    const body = await fs.promises.readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT") return send(res, 404, { error: "Not found" });
    console.error(err);
    send(res, 502, { error: String(err.message || err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Cashfloow kører på http://localhost:${PORT}`);
  console.log(`e-conomic: ${tokens.appSecretToken === "demo" ? "demokonto (ingen .env fundet)" : "egne tokens fra .env"}`);
});

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
