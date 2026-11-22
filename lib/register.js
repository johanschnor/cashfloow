// Registers a tool in the chosen language. Each tool has a Danish and an English name, title, description
// and parameter names; enum values can differ too. The handler always gets the Danish parameter names and
// values, and its result is localized (lib/i18n.js), so the analysis code only knows one language.
import { isEn, localize } from "./i18n.js";

export const json = (obj) => ({ content: [{ type: "text", text: JSON.stringify(localize(obj), null, 2) }] });

// params: { danishName: { en: "englishName", schema: zodSchema, values: { danishValue: "englishValue" } } }
// The schema must already be built in the chosen language (enum values, describe text).
export function reg(server, [nameDa, nameEn], { title, description, annotations }, params, handler) {
  const en = isEn();
  const pick = (x) => (Array.isArray(x) ? (en ? x[1] : x[0]) : x);
  const inputSchema = {};
  for (const [da, p] of Object.entries(params)) inputSchema[en ? p.en : da] = p.schema;
  server.registerTool(en ? nameEn : nameDa, { title: pick(title), description: pick(description), inputSchema, annotations }, async (args) => {
    const a = {};
    for (const [da, p] of Object.entries(params)) {
      let v = args[en ? p.en : da];
      if (en && p.values && typeof v === "string") v = Object.keys(p.values).find((k) => p.values[k] === v) ?? v;
      a[da] = v;
    }
    return handler(a);
  });
}

// Enum values in the chosen language, from a { danish: english } map.
export const enumValues = (values) => (isEn() ? Object.values(values) : Object.keys(values));
