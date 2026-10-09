import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { applyOperation, emptyState, expectedCash, kinds, monthDate, todayBR, type PublicState, type State } from "../../lib/pos.ts";
import { parseWebExport, readBackup } from "../main/transfer.ts";

function run(state: State, action: string, input: unknown) {
  return applyOperation(state, action, input, "Operadora", randomUUID());
}
function domainFixture(): State {
  const state = emptyState();
  run(state, "product.save", { name: "Camiseta", barcode: "000123", category: "Roupas", size: "M", color: "Azul", cost: 1000, price: 3333, stock: 20, minimum: 2 });
  run(state, "customer.save", { name: "Ana", phone: "", email: "", document: "" });
  run(state, "cash.open", { opening: 10000 });
  const product = state.products[0];
  const session = state.sessions[0];
  run(state, "sale.create", {
    sessionId: session.id, customerId: "", items: [{ productId: product.id, quantity: 2, price: 3333 }],
    discountType: "amount", discount: 333, expectedTotal: 6333, note: "Venda à vista",
    payments: [{ method: "cash", amount: 7000, installments: 1 }],
  });
  run(state, "sale.return", { id: state.sales[0].id, sessionId: session.id, reason: "Troca parcial", method: "cash", items: [{ productId: product.id, quantity: 1, restock: true }] });
  // Current metadata and prices differ from the immutable snapshots in the first sale.
  run(state, "product.save", { ...product, name: "Camiseta nova", barcode: "000999", size: "G", price: 4000 });
  run(state, "sale.create", {
    sessionId: session.id, customerId: state.customers[0].id,
    items: [{ productId: product.id, quantity: 3, price: 4000 }],
    discountType: "amount", discount: 0, expectedTotal: 12000, note: "Venda parcelada",
    payments: [{ method: "cash", amount: 3000, installments: 1 }, { method: "store", amount: 9000, installments: 3, dueDate: monthDate(todayBR(), 1) }],
  });
  run(state, "receivable.receive", { id: state.receivables[0].id, sessionId: session.id, amount: 3000, method: "cash" });
  run(state, "receivable.receive", { id: state.receivables[1].id, sessionId: session.id, amount: 1000, method: "pix" });
  run(state, "sale.return", { id: state.sales[1].id, sessionId: session.id, reason: "Devolução integral", method: "cash", items: [{ productId: product.id, quantity: 3, restock: false }] });
  run(state, "customer.save", { ...state.customers[0], name: "Ana atualizada" });
  run(state, "cash.move", { sessionId: session.id, type: "supply", amount: 2000, note: "Suprimento" });
  run(state, "cash.move", { sessionId: session.id, type: "withdrawal", amount: 1000, note: "Sangria" });
  run(state, "cash.close", { id: session.id, counted: expectedCash(state, session) - 100 });
  return state;
}
function publicState(state: State): PublicState {
  const { operations: _operations, ...result } = JSON.parse(JSON.stringify(state)) as State;
  return result;
}
function exported(state: State) {
  return JSON.stringify({ format: "fio-pos-export", version: 1, exportedAt: new Date().toISOString(), data: publicState(state) });
}
function directoryFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "fio-transfer-test-"));
  t.after(() => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("fio-transfer-test-")) throw new Error("Diretório de testes inválido.");
    rmSync(target, { recursive: true, force: true });
  });
  return directory;
}
function writeSnapshot(path: string, state: State) {
  const database = new DatabaseSync(path);
  try {
    database.exec("CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (kind,id)); PRAGMA application_id = 1179209521; PRAGMA user_version = 1;");
    const insert = database.prepare("INSERT INTO records (kind,id,payload) VALUES (?,?,?)");
    for (const kind of kinds) for (const record of state[kind]) insert.run(kind, record.id, JSON.stringify(record));
  } finally { database.close(); }
}
function alter(path: string, change: (database: DatabaseSync) => void) {
  const database = new DatabaseSync(path);
  try { change(database); } finally { database.close(); }
}

test("web export accepts complete cash, credit and refund history without internal tokens", () => {
  const state = domainFixture();
  const parsed = parseWebExport(exported(state));
  assert.deepEqual(parsed, { ...publicState(state), operations: [] });
  assert.equal(parsed.sales[0].items[0].barcode, "000123");
  assert.equal(parsed.products[0].barcode, "000999");
  assert.equal(parsed.sales[0].status, "partial");
  assert.equal(parsed.sales[1].status, "returned");
  assert.equal(parsed.receivables[0].status, "paid");
  assert.equal(parsed.receivables[1].status, "cancelled");
  assert.equal(parsed.sessions[0].difference, -100);
  assert.deepEqual(parseWebExport(exported(emptyState())), emptyState());
});

test("old due dates, renamed customers and card installments remain valid historical data", () => {
  const state = domainFixture();
  const data = publicState(state);
  data.sales[1].payments[1].dueDate = "2020-01-31";
  data.receivables.forEach((record, index) => { record.dueDate = monthDate("2020-01-31", index); });
  assert.doesNotThrow(() => parseWebExport(JSON.stringify({ format: "fio-pos-export", version: 1, data })));
  const fresh = emptyState();
  run(fresh, "product.save", { name: "Calça", barcode: "000001", category: "", size: "P", color: "Preta", cost: 0, price: 10001, stock: 1, minimum: 0 });
  run(fresh, "cash.open", { opening: 0 });
  run(fresh, "sale.create", { sessionId: fresh.sessions[0].id, items: [{ productId: fresh.products[0].id, quantity: 1, price: 10001 }], discountType: "amount", discount: 0, expectedTotal: 10001, payments: [{ method: "credit", amount: 10001, installments: 3 }] });
  assert.doesNotThrow(() => parseWebExport(exported(fresh)));
});

test("export format, version, missing collections and internal operation injection are rejected", () => {
  const state = domainFixture();
  const valid = JSON.parse(exported(state));
  const variants = [
    { ...valid, format: "another-app" },
    { ...valid, version: 2 },
    { ...valid, data: { ...valid.data, operations: [] } },
    { ...valid, data: { ...valid.data, products: null } },
    { ...valid, data: { ...valid.data, mystery: [] } },
    { ...valid, exportedAt: "ontem" },
    valid.data,
  ];
  for (const value of variants) assert.throws(() => parseWebExport(JSON.stringify(value)), /inválido/);
  assert.throws(() => parseWebExport("{broken"), /JSON inválido/);
  assert.throws(() => parseWebExport(JSON.stringify({ format: "fio-pos-export", version: 1, data: {} })), /lista ausente/);
});

test("all numeric domain fields require safe integers and the correct sign", () => {
  const state = domainFixture();
  const invalid: ((data: PublicState) => void)[] = [
    (data) => { data.products[0].stock = -1; },
    (data) => { data.products[0].cost = 0.5; },
    (data) => { data.products[0].price = Number.MAX_SAFE_INTEGER + 1; },
    (data) => { data.products[0].active = "true" as unknown as boolean; },
    (data) => { data.sales[0].items[0].quantity = 1.1; },
    (data) => { data.sales[0].payments[0].installments = 13; },
    (data) => { data.receivables[0].paid = data.receivables[0].amount + 1; },
    (data) => { data.movements[0].balance = -1; },
    (data) => { data.refunds[0].items[0].restock = 1 as unknown as boolean; },
    (data) => { data.sessions[0].counted = null; },
  ];
  for (const mutate of invalid) {
    const data = publicState(state);
    mutate(data);
    assert.throws(() => parseWebExport(JSON.stringify({ format: "fio-pos-export", version: 1, data })), /inválido/);
  }
});

test("identities, unique barcodes, references, singleton settings and open sessions are checked", () => {
  const state = domainFixture();
  const invalid: ((data: PublicState) => void)[] = [
    (data) => { data.products.push(structuredClone(data.products[0])); },
    (data) => { data.products.push({ ...data.products[0], id: randomUUID() }); },
    (data) => { data.sales[0].items[0].productId = "missing"; },
    (data) => { data.sales[0].sessionId = "missing"; },
    (data) => { data.receivables[0].customerId = "missing"; },
    (data) => { data.movements[0].productId = "missing"; },
    (data) => { data.refunds[0].saleId = "missing"; },
    (data) => { data.settings = []; },
    (data) => { data.settings[0].id = "another-settings"; },
    (data) => {
      data.sessions.push({ ...data.sessions[0], id: randomUUID(), closedAt: null, counted: null, expected: null, difference: null });
      data.sessions.push({ ...data.sessions[0], id: randomUUID(), closedAt: null, counted: null, expected: null, difference: null });
    },
  ];
  for (const mutate of invalid) {
    const data = publicState(state);
    mutate(data);
    assert.throws(() => parseWebExport(JSON.stringify({ format: "fio-pos-export", version: 1, data })), /inválido/);
  }
});

test("financial and return inconsistencies are rejected instead of recomputed silently", () => {
  const state = domainFixture();
  const invalid: ((data: PublicState) => void)[] = [
    (data) => { data.sales[0].payments[0].amount++; },
    (data) => { data.sales[0].items[0].net++; },
    (data) => { data.sales[0].subtotal++; },
    (data) => { data.sales[0].items[0].returned = 3; },
    (data) => { data.sales[0].status = "completed"; },
    (data) => { data.receivables[0].amount++; },
    (data) => { data.refunds[0].value++; },
    (data) => { data.cashEntries.find((entry) => entry.type === "sale")!.amount++; },
    (data) => { data.sessions[0].difference = 0; },
  ];
  for (const mutate of invalid) {
    const data = publicState(state);
    mutate(data);
    assert.throws(() => parseWebExport(JSON.stringify({ format: "fio-pos-export", version: 1, data })), /inconsistente|diferem|difere|supera|saldo/);
  }
});

test("SQLite backup preserves operation identities and does not modify the source file", (t) => {
  const path = join(directoryFixture(t), "backup.sqlite3");
  const state = domainFixture();
  writeSnapshot(path, state);
  const before = readFileSync(path);
  assert.deepEqual(readBackup(path), JSON.parse(JSON.stringify(state)));
  assert.deepEqual(readFileSync(path), before);
});

test("zero-value refunds and cash input without installments remain valid in real snapshots", (t) => {
  const directory = directoryFixture(t);
  for (const credit of [false, true]) {
    const state = emptyState();
    run(state, "product.save", { name: "Peça", barcode: "001", category: "", size: "M", color: "Azul", cost: 0, price: 1, stock: 1, minimum: 0 });
    run(state, "product.save", { name: "Outra peça", barcode: "002", category: "", size: "M", color: "Azul", cost: 0, price: 100, stock: 1, minimum: 0 });
    run(state, "customer.save", { name: "Ana", phone: "", email: "", document: "" });
    run(state, "cash.open", { opening: 0 });
    const items = credit
      ? [{ productId: state.products[0].id, quantity: 1, price: 1 }]
      : state.products.map((product) => ({ productId: product.id, quantity: 1, price: product.price }));
    run(state, "sale.create", {
      sessionId: state.sessions[0].id, customerId: credit ? state.customers[0].id : "", items,
      discountType: "amount", discount: credit ? 0 : 100, expectedTotal: 1,
      payments: credit ? [{ method: "store", amount: 1, installments: 1, dueDate: todayBR() }] : [{ method: "cash", amount: 1 }],
    });
    run(state, "sale.return", { id: state.sales[0].id, sessionId: state.sessions[0].id, reason: "Devolução", method: "cash", items: [{ productId: state.products[0].id, quantity: 1, restock: true }] });
    assert.equal(state.refunds[0].amount, 0);
    assert.ok(!state.cashEntries.some((entry) => entry.type === "refund"));
    assert.doesNotThrow(() => parseWebExport(exported(state)));
    const path = join(directory, `${credit ? "credit" : "discount"}.sqlite3`);
    writeSnapshot(path, state);
    assert.deepEqual(readBackup(path), JSON.parse(JSON.stringify(state)));
  }
});

test("unrelated SQLite files, newer schema and mismatched record identities are rejected", (t) => {
  const directory = directoryFixture(t);
  const changes: ((database: DatabaseSync) => void)[] = [
    (database) => database.exec("PRAGMA application_id = 0"),
    (database) => database.exec("PRAGMA user_version = 2"),
    (database) => database.prepare("UPDATE records SET kind = ? WHERE kind = 'audit'").run("unknown"),
    (database) => database.prepare("UPDATE records SET payload = ? WHERE kind = 'products'").run(JSON.stringify({ ...domainFixture().products[0], id: "wrong-id" })),
    (database) => database.prepare("DELETE FROM records WHERE kind = 'settings'").run(),
  ];
  for (const [index, change] of changes.entries()) {
    const path = join(directory, `invalid-${index}.sqlite3`);
    writeSnapshot(path, domainFixture());
    alter(path, change);
    const before = readFileSync(path);
    assert.throws(() => readBackup(path), /inválido/);
    assert.deepEqual(readFileSync(path), before);
  }
});

test("backup validates historical operation input, action, result and domain references", (t) => {
  const directory = directoryFixture(t);
  const invalid: ((state: State) => void)[] = [
    (state) => { state.operations[0].action = "shell.execute"; },
    (state) => { state.operations[0].input = "not-json"; },
    (state) => { state.operations[0].input = "{}"; },
    (state) => { state.operations[0].result = { id: "missing" }; },
    (state) => { state.operations.find((operation) => operation.action === "sale.create")!.id = randomUUID(); },
    (state) => { state.operations.find((operation) => operation.action === "sale.return")!.result = { refunded: -1 }; },
    (state) => { state.operations.find((operation) => operation.action === "cash.move")!.result = { ok: false }; },
    (state) => {
      const operation = state.operations.find((record) => record.action === "cash.move")!;
      operation.input = JSON.stringify({ ...JSON.parse(operation.input), sessionId: "missing" });
    },
  ];
  for (const [index, mutate] of invalid.entries()) {
    const state = domainFixture();
    mutate(state);
    const path = join(directory, `invalid-operation-${index}.sqlite3`);
    writeSnapshot(path, state);
    assert.throws(() => readBackup(path), /inválido/);
  }
});
