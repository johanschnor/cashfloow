// Builds dist/cashfloow-<version>.mcpb, a one-file Claude Desktop extension.
// Stages the runtime files with production dependencies only, fills in the version and the tool list
// from the running server (so the manifest never drifts from the code), then validates and packs.
//   npm run build:mcpb
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stage = path.join(root, "build", "mcpb");
const dist = path.join(root, "dist");
const mcpb = path.join(root, "node_modules", ".bin", "mcpb");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of ["mcp-server.js", "lib", "package.json", "package-lock.json", "LICENSE", "README.md"]) {
  fs.cpSync(path.join(root, f), path.join(stage, f), { recursive: true });
}
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit" });

// Tool names and descriptions straight from the server.
const client = new Client({ name: "build", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(stage, "mcp-server.js")], cwd: stage,
  env: { ...process.env, ECONOMIC_APP_SECRET_TOKEN: "demo", ECONOMIC_AGREEMENT_GRANT_TOKEN: "demo" } }));
const { tools } = await client.listTools();
await client.close();

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
manifest.tools = tools.map((t) => ({ name: t.name, description: t.description }));
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const out = path.join(dist, `cashfloow-${pkg.version}.mcpb`);
execFileSync(mcpb, ["validate", path.join(stage, "manifest.json")], { stdio: "inherit" });
execFileSync(mcpb, ["pack", stage, out], { stdio: "inherit" });
console.log(`\n${tools.length} værktøjer, ${out}`);
