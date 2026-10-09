import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { kinds, validDate, type State } from "../../lib/pos.ts";

const APPLICATION_ID = 0x46494f31;
const SCHEMA_VERSION = 1;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS = 200000;
const actions = [
  "product.save", "stock.move", "customer.save", "cash.open", "cash.move",
  "cash.close", "sale.create", "receivable.receive", "sale.return", "settings.save",
] as const;
const methods = ["cash", "pix", "debit", "credit", "store"] as const;
type Rule = (value: unknown, path: string) => void;

function reject(path: string, message = "dados inválidos"): never {
  throw new Error(`Arquivo do Fio inválido: ${path}: ${message}.`);
}
function insist(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) reject(path, message);
}
function object(value: unknown, path: string): Record<string, unknown> {
  insist(value !== null && typeof value === "object" && !Array.isArray(value), path, "objeto esperado");
  return value as Record<string, unknown>;
}
function text(maximum = 200, required = false): Rule {
  return (value, path) => {
    insist(typeof value === "string" && value.length <= maximum && (!required || value.trim().length > 0), path, "texto inválido");
  };
}
const id = text(200, true);
function integer(minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Rule {
  return (value, path) => insist(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum, path, "número inteiro fora do limite");
}
const positive = integer(1);
const cents = integer();
const signed = integer(-Number.MAX_SAFE_INTEGER);
const boolean: Rule = (value, path) => insist(typeof value === "boolean", path, "valor booleano esperado");
function oneOf(values: readonly string[]): Rule {
  return (value, path) => insist(typeof value === "string" && values.includes(value), path, "opção desconhecida");
}
const method = oneOf(methods);
const date: Rule = (value, path) => insist(typeof value === "string" && validDate(value), path, "data inválida");
const instant: Rule = (value, path) => {
  insist(typeof value === "string" && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)), path, "data e hora inválidas");
};
function optional(rule: Rule): Rule {
  return (value, path) => { if (value !== undefined) rule(value, path); };
}
function nullable(rule: Rule): Rule {
  return (value, path) => { if (value !== null) rule(value, path); };
}
function array(rule: Rule, minimum = 0, maximum = MAX_RECORDS): Rule {
  return (value, path) => {
    insist(Array.isArray(value) && value.length >= minimum && value.length <= maximum, path, "lista fora do limite");
    value.forEach((item, index) => rule(item, `${path}[${index}]`));
  };
}
function shape(required: Record<string, Rule>, extra: Record<string, Rule> = {}): Rule {
  return (value, path) => {
    const record = object(value, path);
    for (const key of Object.keys(record)) insist(Object.hasOwn(required, key) || Object.hasOwn(extra, key), `${path}.${key}`, "campo desconhecido");
    for (const [key, rule] of Object.entries(required)) {
      insist(Object.hasOwn(record, key), `${path}.${key}`, "campo ausente");
      rule(record[key], `${path}.${key}`);
    }
    for (const [key, rule] of Object.entries(extra)) if (Object.hasOwn(record, key)) rule(record[key], `${path}.${key}`);
  };
}

const payment = shape({ method, amount: positive, installments: integer(1, 12) }, { dueDate: date });
const inputPayment: Rule = (value, path) => {
  const record = object(value, path);
  method(record.method, `${path}.method`);
  positive(record.amount, `${path}.amount`);
  if (record.method === "credit" || record.method === "store") integer(1, 12)(record.installments, `${path}.installments`);
  if (record.method === "store") date(record.dueDate, `${path}.dueDate`);
};
const returnItem = shape({ productId: id, quantity: positive, restock: boolean });
const saleItem = shape({
  productId: id, name: text(200, true), barcode: text(64, true), size: text(30, true), color: text(50, true),
  quantity: positive, returned: cents, price: positive, cost: cents, net: cents, refunded: cents,
});
const schemas: Record<(typeof kinds)[number], Rule> = {
  products: shape({ id, name: text(200, true), barcode: text(64, true), category: text(), size: text(30, true), color: text(50, true), cost: cents, price: positive, stock: cents, minimum: cents, active: boolean, version: positive }),
  customers: shape({ id, name: text(200, true), phone: text(40), email: text(100), document: text(30), version: positive }),
  sales: shape({ id, number: positive, createdAt: instant, sessionId: id, operator: text(200, true), customerId: text(), customerName: text(200, true), items: array(saleItem, 1, 200), subtotal: positive, discount: cents, total: positive, change: cents, payments: array(payment, 1, 10), status: oneOf(["completed", "returned", "partial"]), note: text(500), requestId: id }),
  sessions: shape({ id, openedAt: instant, operator: text(200, true), opening: cents, closedAt: nullable(instant), counted: nullable(cents), expected: nullable(cents), difference: nullable(signed) }),
  cashEntries: shape({ id, sessionId: id, createdAt: instant, type: oneOf(["sale", "refund", "supply", "withdrawal", "receive"]), amount: signed, method, note: text(1000) }, { saleId: id }),
  movements: shape({ id, productId: id, name: text(300, true), createdAt: instant, quantity: signed, balance: cents, reason: text(1000, true), operator: text(200, true) }),
  receivables: shape({ id, saleId: id, customerId: id, customerName: text(200, true), number: integer(1, 12), amount: positive, paid: cents, dueDate: date, status: oneOf(["open", "paid", "cancelled"]) }),
  refunds: shape({ id, saleId: id, createdAt: instant, value: cents, amount: cents, method, reason: text(200, true), items: array(returnItem, 1, 200) }),
  audit: shape({ id, createdAt: instant, operator: text(200, true), action: oneOf(actions) }),
  settings: shape({ id, storeName: text(200, true), contact: text(), footer: text(300) }),
  operations: shape({ id, action: oneOf(actions), input: text(100000, true), result: (value, path) => { object(value, path); } }),
};

function sum(values: number[], path: string): number {
  const total = values.reduce((result, value) => result + BigInt(value), 0n);
  insist(total >= -BigInt(Number.MAX_SAFE_INTEGER) && total <= BigInt(Number.MAX_SAFE_INTEGER), path, "soma fora do limite seguro");
  return Number(total);
}
function gross(price: number, quantity: number, path: string): number {
  const result = BigInt(price) * BigInt(quantity);
  insist(result <= BigInt(Number.MAX_SAFE_INTEGER), path, "valor fora do limite seguro");
  return Number(result);
}
function unique<T>(values: T[], key: (value: T) => string | number, path: string) {
  const seen = new Set<string | number>();
  for (const item of values) {
    const value = key(item);
    insist(!seen.has(value), path, "identificador duplicado");
    seen.add(value);
  }
}
function reference<T>(records: Map<string, T>, value: string, path: string): T {
  const record = records.get(value);
  insist(record, path, "referência inexistente");
  return record;
}
function group<T>(records: T[], key: (record: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const value = key(record);
    const existing = grouped.get(value);
    if (existing) existing.push(record);
    else grouped.set(value, [record]);
  }
  return grouped;
}

// Input is historical: current product versions/prices and today's due-date are not constraints.
function operationInput(action: string, value: unknown, path: string) {
  const record = object(value, path);
  const required: Record<string, Record<string, Rule>> = {
    "product.save": { name: text(200, true), barcode: text(64, true), category: text(), size: text(30, true), color: text(50, true), cost: cents, price: positive, minimum: cents },
    "stock.move": { id, quantity: positive, direction: oneOf(["in", "out"]), reason: text(200, true) },
    "customer.save": { name: text(200, true), phone: text(40), email: text(100), document: text(30) },
    "cash.open": { opening: cents },
    "cash.move": { sessionId: id, type: oneOf(["supply", "withdrawal"]), amount: positive, note: text(200, true) },
    "cash.close": { id, counted: cents },
    "sale.create": { sessionId: id, items: array(shape({ productId: id, quantity: positive, price: positive }), 1, 200), discountType: oneOf(["amount", "percent"]), discount: cents, expectedTotal: positive, payments: array(inputPayment, 1, 10) },
    "receivable.receive": { id, sessionId: id, amount: positive, method: oneOf(["cash", "pix", "debit"]) },
    "sale.return": { id, sessionId: id, reason: text(200, true), method: oneOf(["cash", "pix", "debit", "credit"]), items: array(returnItem, 1, 200) },
    "settings.save": { storeName: text(200, true), contact: text(), footer: text(300) },
  };
  for (const [key, rule] of Object.entries(required[action])) rule(record[key], `${path}.${key}`);
  if (action === "product.save" || action === "customer.save") {
    optional(id)(record.id, `${path}.id`);
    optional(positive)(record.version, `${path}.version`);
    if (record.id !== undefined) positive(record.version, `${path}.version`);
    if (action === "product.save") {
      optional(boolean)(record.active, `${path}.active`);
      if (!record.id) cents(record.stock, `${path}.stock`);
      else optional(cents)(record.stock, `${path}.stock`);
    }
  }
  if (action === "sale.create") {
    optional(text())(record.customerId, `${path}.customerId`);
    optional(text(500))(record.note, `${path}.note`);
  }
}

function validate(candidate: unknown, withOperations: boolean): State {
  const raw = object(candidate, "data");
  const accepted: readonly (typeof kinds)[number][] = withOperations ? kinds : kinds.filter((kind) => kind !== "operations");
  for (const key of Object.keys(raw)) insist(accepted.includes(key as (typeof kinds)[number]), `data.${key}`, "tipo desconhecido");
  let count = 0;
  for (const kind of accepted) {
    insist(Object.hasOwn(raw, kind), `data.${kind}`, "lista ausente");
    array(schemas[kind])(raw[kind], `data.${kind}`);
    const records = raw[kind] as { id: string }[];
    count += records.length;
    insist(count <= MAX_RECORDS, "data", "quantidade de registros excedida");
    unique(records, (record) => record.id, `data.${kind}`);
  }
  const state = { ...raw, operations: withOperations ? raw.operations : [] } as State;
  insist(state.settings.length === 1 && state.settings[0].id === "store-settings", "data.settings", "configuração única da loja ausente");
  unique(state.products, (product) => product.barcode, "data.products.barcode");
  unique(state.sales, (sale) => sale.number, "data.sales.number");
  unique(state.sales, (sale) => sale.requestId, "data.sales.requestId");
  insist(state.sessions.filter((session) => session.closedAt === null).length <= 1, "data.sessions", "mais de um caixa aberto");
  const products = new Map(state.products.map((record) => [record.id, record]));
  const customers = new Map(state.customers.map((record) => [record.id, record]));
  const sessions = new Map(state.sessions.map((record) => [record.id, record]));
  const sales = new Map(state.sales.map((record) => [record.id, record]));
  const receivables = new Map(state.receivables.map((record) => [record.id, record]));
  const debtBySale = group(state.receivables, (record) => record.saleId);
  const refundsBySale = group(state.refunds, (record) => record.saleId);
  const entriesBySale = group(state.cashEntries, (record) => record.saleId || "");
  const entriesBySession = group(state.cashEntries, (record) => record.sessionId);

  for (const sale of state.sales) {
    const path = `venda ${sale.id}`;
    reference(sessions, sale.sessionId, path);
    if (sale.customerId) reference(customers, sale.customerId, path);
    unique(sale.items, (item) => item.productId, `${path}.items`);
    for (const item of sale.items) {
      reference(products, item.productId, `${path}.items`);
      insist(item.returned <= item.quantity && item.refunded <= item.net, path, "devolução supera a venda");
      insist(item.net <= gross(item.price, item.quantity, path), path, "valor líquido supera o bruto");
      insist(item.returned > 0 || item.refunded === 0, path, "reembolso sem peça devolvida");
    }
    insist(sum(sale.items.map((item) => gross(item.price, item.quantity, path)), path) === sale.subtotal, path, "subtotal inconsistente");
    insist(sale.discount <= sale.subtotal && sale.total === sale.subtotal - sale.discount, path, "desconto ou total inconsistente");
    insist(sum(sale.items.map((item) => item.net), path) === sale.total, path, "soma dos itens líquidos difere do total");
    insist(sum(sale.payments.map((payment) => payment.amount), path) === sum([sale.total, sale.change], path), path, "pagamentos diferem do total e troco");
    insist(sale.change <= sum(sale.payments.filter((payment) => payment.method === "cash").map((payment) => payment.amount), path), path, "troco sem dinheiro suficiente");
    insist(sale.payments.filter((payment) => payment.method === "store").length <= 1, path, "crediário duplicado");
    for (const payment of sale.payments) {
      insist(payment.amount >= payment.installments, path, "parcela inferior a um centavo");
      if (payment.method !== "credit" && payment.method !== "store") insist(payment.installments === 1, path, "parcelamento inválido");
      if (payment.method === "store") {
        insist(Boolean(sale.customerId), path, "crediário sem cliente");
        date(payment.dueDate, `${path}.dueDate`);
      } else insist(payment.dueDate === undefined, path, "vencimento em pagamento sem crediário");
    }
    const anyReturned = sale.items.some((item) => item.returned > 0);
    const allReturned = sale.items.every((item) => item.returned === item.quantity);
    insist(sale.status === (allReturned ? "returned" : anyReturned ? "partial" : "completed"), path, "situação da devolução inconsistente");
  }
  for (const entry of state.cashEntries) {
    const path = `lançamento ${entry.id}`;
    reference(sessions, entry.sessionId, path);
    insist(entry.amount !== 0, path, "lançamento com valor zero");
    insist(entry.method !== "store", path, "crediário lançado como recebimento");
    if (entry.type === "withdrawal" || entry.type === "refund") insist(entry.amount < 0, path, "saída deve ser negativa");
    else insist(entry.amount > 0, path, "entrada deve ser positiva");
    if (entry.type === "supply" || entry.type === "withdrawal") {
      insist(entry.method === "cash" && entry.saleId === undefined, path, "movimentação de caixa inválida");
    } else {
      const sale = reference(sales, entry.saleId || "", path);
      if (entry.type === "sale") insist(sale.sessionId === entry.sessionId, path, "entrada de venda em outro caixa");
      if (entry.type === "receive") insist(entry.method !== "credit", path, "recebimento de parcela inválido");
    }
  }
  for (const session of state.sessions) {
    const path = `caixa ${session.id}`;
    if (session.closedAt === null) insist(session.counted === null && session.expected === null && session.difference === null, path, "fechamento de caixa aberto");
    else {
      insist(session.counted !== null && session.expected !== null && session.difference !== null, path, "fechamento incompleto");
      insist(session.difference === session.counted - session.expected, path, "diferença do caixa inconsistente");
      const expected = sum([session.opening, ...(entriesBySession.get(session.id) || []).filter((entry) => entry.method === "cash").map((entry) => entry.amount)], path);
      insist(session.expected === expected, path, "saldo registrado no fechamento inconsistente");
    }
  }
  for (const movement of state.movements) {
    reference(products, movement.productId, `movimentação ${movement.id}`);
    insist(movement.quantity !== 0, `movimentação ${movement.id}`, "quantidade zero");
  }
  for (const receivable of state.receivables) {
    const path = `parcela ${receivable.id}`;
    const sale = reference(sales, receivable.saleId, path);
    reference(customers, receivable.customerId, path);
    insist(receivable.customerId === sale.customerId && sale.payments.some((payment) => payment.method === "store"), path, "parcela sem crediário correspondente");
    insist(receivable.paid <= receivable.amount, path, "recebimento supera o valor da parcela");
    if (receivable.status === "paid") insist(receivable.paid === receivable.amount, path, "parcela quitada com saldo");
    else insist(receivable.paid < receivable.amount, path, "parcela com saldo inexistente");
    if (receivable.status === "cancelled") insist(sale.status === "returned", path, "parcela cancelada sem devolução integral");
  }
  for (const refund of state.refunds) {
    const path = `devolução ${refund.id}`;
    const sale = reference(sales, refund.saleId, path);
    insist(refund.method !== "store" && refund.amount <= refund.value, path, "reembolso inválido");
    unique(refund.items, (item) => item.productId, path);
    for (const item of refund.items) insist(sale.items.some((line) => line.productId === item.productId), path, "peça não pertence à venda");
    if (!sale.payments.some((payment) => payment.method === "store")) insist(refund.amount === refund.value, path, "reembolso difere do valor devolvido");
  }
  for (const sale of state.sales) {
    const path = `venda ${sale.id}`;
    const debt = debtBySale.get(sale.id) || [];
    const refunds = refundsBySale.get(sale.id) || [];
    const storePayment = sale.payments.find((payment) => payment.method === "store");
    unique(debt, (record) => record.number, `${path}.parcelas`);
    insist(debt.length === (storePayment?.installments || 0) && sum(debt.map((record) => record.amount), path) === (storePayment?.amount || 0), path, "parcelas diferem do crediário original");
    insist(debt.every((record) => record.number <= debt.length), path, "numeração das parcelas inconsistente");
    for (const item of sale.items) {
      const returned = refunds.flatMap((record) => record.items).filter((record) => record.productId === item.productId);
      insist(sum(returned.map((record) => record.quantity), path) === item.returned, path, "quantidades devolvidas inconsistentes");
    }
    insist(sum(refunds.map((record) => record.value), path) === sum(sale.items.map((item) => item.refunded), path), path, "valores devolvidos inconsistentes");
    const entries = entriesBySale.get(sale.id) || [];
    insist(sum(entries.filter((entry) => entry.type === "sale").map((entry) => entry.amount), path) === sale.total - (storePayment?.amount || 0), path, "lançamentos da venda inconsistentes");
    insist(sum(entries.filter((entry) => entry.type === "refund").map((entry) => -entry.amount), path) === sum(refunds.map((record) => record.amount), path), path, "lançamentos de reembolso inconsistentes");
    insist(sum(entries.filter((entry) => entry.type === "receive").map((entry) => entry.amount), path) === sum(debt.map((record) => record.paid), path), path, "lançamentos de parcelas inconsistentes");
  }
  for (const operation of state.operations) {
    const path = `operação ${operation.id}`;
    let input: unknown;
    try { input = JSON.parse(operation.input); } catch { reject(path, "JSON de entrada inválido"); }
    operationInput(operation.action, input, path);
    const historical = object(input, path);
    if (historical.sessionId) reference(sessions, historical.sessionId as string, path);
    if (operation.action === "product.save" && historical.id) reference(products, historical.id as string, path);
    if (operation.action === "customer.save" && historical.id) reference(customers, historical.id as string, path);
    if (operation.action === "stock.move") reference(products, historical.id as string, path);
    if (operation.action === "cash.close") reference(sessions, historical.id as string, path);
    if (operation.action === "receivable.receive") reference(receivables, historical.id as string, path);
    if (operation.action === "sale.return") {
      const sale = reference(sales, historical.id as string, path);
      for (const item of historical.items as { productId: string }[]) insist(sale.items.some((line) => line.productId === item.productId), path, "peça da operação não pertence à venda");
    }
    if (operation.action === "sale.create") {
      if (historical.customerId) reference(customers, historical.customerId as string, path);
      for (const item of historical.items as { productId: string }[]) reference(products, item.productId, path);
    }
    const result = object(operation.result, path);
    if (["product.save", "customer.save", "cash.open"].includes(operation.action)) {
      shape({ id })(result, `${path}.result`);
      reference<{ id: string }>(operation.action === "product.save" ? products : operation.action === "customer.save" ? customers : sessions, result.id as string, path);
    } else if (operation.action === "sale.create") {
      shape({ saleId: id })(result, `${path}.result`);
      const sale = reference(sales, result.saleId as string, path);
      insist(sale.requestId === operation.id, path, "identificador da venda inconsistente");
    } else if (operation.action === "sale.return") shape({ refunded: cents })(result, `${path}.result`);
    else {
      shape({ ok: boolean })(result, `${path}.result`);
      insist(result.ok === true, path, "resultado da operação inválido");
    }
  }
  return state;
}

export function parseWebExport(raw: string): State {
  insist(typeof raw === "string" && Buffer.byteLength(raw, "utf8") <= MAX_BYTES, "arquivo", "exportação muito grande");
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { reject("arquivo", "JSON inválido"); }
  const envelope = object(value, "arquivo");
  insist(envelope.format === "fio-pos-export" && envelope.version === 1, "arquivo", "formato ou versão não suportados");
  for (const key of Object.keys(envelope)) insist(["format", "version", "exportedAt", "data"].includes(key), `arquivo.${key}`, "campo desconhecido");
  if (envelope.exportedAt !== undefined) instant(envelope.exportedAt, "arquivo.exportedAt");
  return validate(envelope.data, false);
}

export function readBackup(filePath: string): State {
  insist(typeof filePath === "string" && filePath.trim().length > 0, "arquivo", "caminho inválido");
  const stat = statSync(filePath);
  insist(stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES, "arquivo", "backup vazio ou fora do limite");
  const database = new DatabaseSync(filePath, { readOnly: true, allowExtension: false });
  try {
    database.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON;");
    insist(database.prepare("PRAGMA application_id").get()?.application_id === APPLICATION_ID, "arquivo", "banco não pertence ao Fio");
    insist(database.prepare("PRAGMA user_version").get()?.user_version === SCHEMA_VERSION, "arquivo", "versão do banco não suportada");
    const checked = database.prepare("PRAGMA integrity_check").all();
    insist(checked.length === 1 && checked[0].integrity_check === "ok", "arquivo", "banco danificado");
    const table = database.prepare("SELECT type FROM sqlite_schema WHERE name = 'records'").get();
    insist(table?.type === "table", "arquivo", "tabela de registros ausente");
    const count = database.prepare("SELECT COUNT(*) AS count FROM records").get()?.count;
    insist(typeof count === "number" && count <= MAX_RECORDS, "arquivo", "quantidade de registros excedida");
    const state: Record<string, unknown[]> = Object.fromEntries(kinds.map((kind) => [kind, []]));
    for (const row of database.prepare("SELECT kind, id, payload FROM records ORDER BY rowid").all()) {
      insist(typeof row.kind === "string" && kinds.includes(row.kind as (typeof kinds)[number]) && typeof row.id === "string" && typeof row.payload === "string", "registro", "tipo de registro inválido");
      let value: unknown;
      try { value = JSON.parse(row.payload); } catch { reject(`registro ${row.id}`, "JSON inválido"); }
      const record = object(value, `registro ${row.id}`);
      insist(record.id === row.id, `registro ${row.id}`, "identidade não corresponde ao registro");
      state[row.kind].push(value);
    }
    return validate(state, true);
  } finally {
    database.close();
  }
}
