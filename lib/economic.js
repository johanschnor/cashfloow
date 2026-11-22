// Reads the data the analysis needs from the e-conomic REST API.
// Auth: two header tokens. "demo"/"demo" gives read access to e-conomic's public demo account.
// Docs: https://restdocs.e-conomic.com/

const BASE = "https://restapi.e-conomic.com";

async function getJson(path, tokens) {
  const res = await fetch(BASE + path, {
    headers: {
      "X-AppSecretToken": tokens.appSecretToken,
      "X-AgreementGrantToken": tokens.agreementGrantToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`e-conomic ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Follows e-conomic's paging (max 1000 per page) until the collection is complete.
async function getAll(path, tokens) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 0; page < 500; page++) {
    const data = await getJson(`${path}${sep}pagesize=1000&skippages=${page}`, tokens);
    const items = data.collection || [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

export async function loadFromEconomic(tokens) {
  const [self, invoices, customers, suppliers, years, accounts] = await Promise.all([
    getJson("/self", tokens).catch(() => null), // optional: only used for the company name
    getAll("/invoices/booked", tokens),
    getAll("/customers", tokens),
    getAll("/suppliers", tokens),
    getAll("/accounting-years", tokens),
    getAll("/accounts", tokens).catch(() => []),
  ]);

  // Entries hold customer payments (with invoiceNumber) and supplier invoices/payments.
  const entryLists = await Promise.all(
    years.map((y) => getAll(`/accounting-years/${encodeURIComponent(y.year)}/entries`, tokens).catch(() => []))
  );
  const entries = entryLists.flat();

  return {
    company: self?.company?.name || "e-conomic",
    source: tokens.appSecretToken === "demo" ? "e-conomic demokonto" : "e-conomic",
    invoices: invoices.map((i) => ({
      number: i.bookedInvoiceNumber,
      date: i.date,
      dueDate: i.dueDate || i.date,
      amount: i.grossAmountInBaseCurrency ?? i.grossAmount,
      remainder: i.remainderInBaseCurrency ?? i.remainder ?? 0,
      customer: i.customer?.customerNumber,
    })),
    customers: customers.map((c) => ({ number: c.customerNumber, name: c.name, country: c.country })),
    suppliers: suppliers.map((s) => ({ number: s.supplierNumber, name: s.name, country: s.country, currency: s.currency })),
    entries: entries.map((e) => ({
      type: e.entryType,
      date: e.date,
      dueDate: e.dueDate,
      amount: e.amountInBaseCurrency ?? e.amount,
      remainder: e.remainderInBaseCurrency ?? e.remainder ?? 0,
      currency: e.currency,
      customer: e.customer?.customerNumber,
      supplier: e.supplier?.supplierNumber,
      invoiceNumber: e.invoiceNumber,
      account: e.account?.accountNumber,
    })),
    // Chart of accounts with balances: used for the bank balance and VAT owed.
    accounts: accounts.map((a) => ({ number: a.accountNumber, name: a.name, type: a.accountType, balance: a.balance ?? 0 })),
  };
}

// Products, stock and invoice lines for the inventory tools. Only loaded when an inventory tool is used,
// because e-conomic has no endpoint for invoice lines in bulk: each booked invoice is fetched on its own.
// Stock figures (product.inventory) are only there when e-conomic's inventory module is enabled.
// Lead times are not in e-conomic; the tools take them as a parameter.
const LINE_MONTHS = 24, MAX_INVOICES = 3000, PARALLEL = 8;

export async function loadInventoryFromEconomic(tokens, invoices, asOf = new Date()) {
  const products = await getAll("/products", tokens);
  const from = new Date(asOf.getTime() - LINE_MONTHS * 30.44 * 86400000).toISOString().slice(0, 10);
  let recent = invoices.filter((i) => i.date >= from).sort((a, b) => b.date.localeCompare(a.date));
  const notes = [];
  if (recent.length > MAX_INVOICES) {
    notes.push(`Kun de seneste ${MAX_INVOICES} fakturaer er læst (fra ${recent[MAX_INVOICES - 1].date}).`);
    recent = recent.slice(0, MAX_INVOICES);
  }
  const lines = [];
  let failed = 0;
  for (let i = 0; i < recent.length; i += PARALLEL) {
    const batch = await Promise.all(recent.slice(i, i + PARALLEL).map((inv) =>
      getJson(`/invoices/booked/${inv.number}`, tokens).then((d) => ({ inv, d })).catch(() => { failed++; return null; })));
    for (const b of batch) {
      if (!b) continue;
      for (const l of b.d.lines || []) {
        if (!l.product?.productNumber) continue;
        lines.push({ date: b.inv.date, invoice: b.inv.number, customer: b.inv.customer, product: String(l.product.productNumber),
          quantity: l.quantity ?? 0, unitNetPrice: l.unitNetPrice ?? 0, unitCostPrice: l.unitCostPrice ?? 0 });
      }
    }
  }
  if (failed) notes.push(`${failed} fakturaer kunne ikke læses og er sprunget over.`);
  const mapped = products.map((p) => ({
    number: String(p.productNumber), name: p.name, group: p.productGroup?.name, costPrice: p.costPrice ?? 0, salesPrice: p.salesPrice ?? 0,
    barred: !!p.barred, inventoryEnabled: !!p.productGroup?.inventoryEnabled,
    inventory: p.inventory ? { inStock: p.inventory.inStock ?? 0, available: p.inventory.available ?? 0,
      orderedByCustomers: p.inventory.orderedByCustomers ?? 0, orderedFromSuppliers: p.inventory.orderedFromSuppliers ?? 0 } : null,
  }));
  return { products: mapped, lines, hasStock: mapped.some((p) => p.inventory), notes };
}
