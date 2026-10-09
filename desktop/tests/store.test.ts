import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { createStore, ValidationError, type LocalStore } from "../main/store.ts";
import { expectedCash, monthDate, todayBR } from "../../lib/pos.ts";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "fio-sqlite-test-"));
  const connections: LocalStore[] = [];
  function open() {
    const store = createStore(directory);
    connections.push(store);
    return store;
  }
  t.after(() => {
    for (const store of connections) store.close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("fio-sqlite-test-"))
      throw new Error("Pasta de testes fora do diretório temporário esperado.");
    rmSync(target, { recursive: true, force: true });
  });
  return { directory, open, store: open() };
}

function run(store: LocalStore, action: string, input: unknown, requestId = randomUUID()) {
  return store.mutate(action, input, "Operador local", requestId);
}
function shop(store: LocalStore, stock = 3, price = 1999) {
  run(store, "product.save", {
    name: "Camiseta",
    barcode: "001234",
    category: "Camisetas",
    size: "M",
    color: "Preta",
    cost: 900,
    price,
    stock,
    minimum: 1,
  });
  run(store, "cash.open", { opening: 10000 });
  const state = store.readState();
  return {
    productId: state.products[0].id,
    sessionId: state.sessions[0].id,
    sale: {
      sessionId: state.sessions[0].id,
      items: [{ productId: state.products[0].id, quantity: 1, price }],
      customerId: "",
      discountType: "amount",
      discount: 0,
      expectedTotal: price,
      note: "",
      payments: [{ method: "cash", amount: price, installments: 1 }],
    },
  };
}

test("new database has settings, separate records and no seeded clothes", (t) => {
  const { store, directory } = fixture(t);
  assert.equal(store.databasePath, join(directory, "fio-caixa.sqlite3"));
  const state = store.readState();
  assert.equal(state.settings[0].storeName, "Minha loja");
  assert.equal(state.products.length, 0);
  assert.equal(state.sales.length, 0);
  assert.ok(!("operations" in state));
  const raw = new DatabaseSync(store.databasePath, { readOnly: true });
  try {
    assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM records").get()?.count, 1);
    assert.equal(raw.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
  } finally {
    raw.close();
  }
});

test("sale, discounts, change and operator persist after reopening", (t) => {
  const { store, open } = fixture(t);
  const initial = shop(store, 3);
  run(store, "sale.create", {
    ...initial.sale,
    items: [{ productId: initial.productId, quantity: 3, price: 1999 }],
    discountType: "percent",
    discount: 1000,
    expectedTotal: 5397,
    payments: [{ method: "cash", amount: 10000, installments: 1 }],
  });
  store.close();
  const state = open().readState();
  assert.equal(state.products[0].stock, 0);
  assert.equal(state.products[0].barcode, "001234");
  assert.equal(state.sales[0].total, 5397);
  assert.equal(state.sales[0].change, 4603);
  assert.equal(state.sales[0].operator, "Operador local");
  assert.equal(expectedCash(state, state.sessions[0]), 15397);
});

test("invalid refund rolls back draft stock movements and cash changes", (t) => {
  const { store } = fixture(t);
  const initial = shop(store, 1);
  run(store, "sale.create", initial.sale);
  run(store, "cash.move", {
    sessionId: initial.sessionId,
    type: "withdrawal",
    amount: 11999,
    note: "Dinheiro retirado",
  });
  const snapshot = store.exportJSON();
  assert.throws(
    () => run(store, "sale.return", {
      id: store.readState().sales[0].id,
      sessionId: initial.sessionId,
      reason: "Cancelamento",
      method: "cash",
      items: [{ productId: initial.productId, quantity: 1, restock: true }],
    }),
    /Dinheiro insuficiente/,
  );
  assert.equal(store.exportJSON(), snapshot);
});

test("SQL failure after partial writes rolls back all records and permits safe retry", (t) => {
  const { store } = fixture(t);
  const initial = shop(store, 1);
  const requestId = randomUUID();
  const before = store.exportJSON();
  const raw = new DatabaseSync(store.databasePath);
  try {
    raw.exec(`CREATE TRIGGER reject_cash_entry BEFORE INSERT ON records
      WHEN NEW.kind = 'cashEntries' BEGIN SELECT RAISE(ABORT, 'test-write-failure'); END;`);
    assert.throws(() => run(store, "sale.create", initial.sale, requestId), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof ValidationError));
      assert.match(error.message, /test-write-failure/);
      return true;
    });
    assert.equal(store.exportJSON(), before);
    raw.exec("DROP TRIGGER reject_cash_entry");
    run(store, "sale.create", initial.sale, requestId);
    assert.equal(store.readState().sales.length, 1);
    assert.equal(store.readState().products[0].stock, 0);
  } finally {
    raw.close();
  }
});

test("idempotency survives restart and rejects a different payload", (t) => {
  const { store, open } = fixture(t);
  const initial = shop(store, 1);
  const requestId = randomUUID();
  const first = run(store, "sale.create", initial.sale, requestId);
  store.close();
  const reopened = open();
  const repeated = run(reopened, "sale.create", initial.sale, requestId);
  assert.deepEqual(repeated, first);
  assert.equal(reopened.readState().sales.length, 1);
  assert.equal(reopened.readState().products[0].stock, 0);
  assert.throws(
    () => run(reopened, "sale.create", { ...initial.sale, note: "Outra venda" }, requestId),
    /identificador/,
  );
});

test("store credit receipts and full refund remain consistent in SQLite", (t) => {
  const { store } = fixture(t);
  const initial = shop(store, 1, 10000);
  run(store, "customer.save", { name: "Ana", phone: "", email: "", document: "" });
  const customerId = store.readState().customers[0].id;
  run(store, "sale.create", {
    ...initial.sale,
    customerId,
    payments: [
      { method: "cash", amount: 4000, installments: 1 },
      { method: "store", amount: 6000, installments: 3, dueDate: monthDate(todayBR(), 1) },
    ],
  });
  const state = store.readState();
  assert.deepEqual(state.receivables.map((r) => r.amount), [2000, 2000, 2000]);
  run(store, "receivable.receive", {
    id: state.receivables[0].id,
    sessionId: initial.sessionId,
    amount: 1000,
    method: "cash",
  });
  const returned = run(store, "sale.return", {
    id: state.sales[0].id,
    sessionId: initial.sessionId,
    reason: "Devolução",
    method: "cash",
    items: [{ productId: initial.productId, quantity: 1, restock: true }],
  });
  assert.deepEqual(returned.result, { refunded: 5000 });
  assert.ok(returned.state.receivables.every((r) => r.status === "cancelled"));
  assert.equal(returned.state.products[0].stock, 1);
  assert.equal(expectedCash(returned.state, returned.state.sessions[0]), 10000);
});

test("backup includes committed WAL records and never overwrites an existing file", (t) => {
  const { store, directory } = fixture(t);
  const initial = shop(store, 2);
  run(store, "sale.create", initial.sale);
  const destination = join(directory, "backups", "copia.sqlite3");
  assert.equal(store.backup(destination), destination);
  assert.ok(existsSync(destination));
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(snapshot.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
    const product = snapshot.prepare("SELECT payload FROM records WHERE kind = 'products'").get();
    assert.equal(JSON.parse(String(product?.payload)).stock, 1);
    assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM records WHERE kind = 'sales'").get()?.count, 1);
    assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM records WHERE kind = 'operations'").get()?.count, 3);
  } finally {
    snapshot.close();
  }
  const content = readFileSync(destination);
  assert.throws(() => store.backup(destination), /Já existe/);
  assert.deepEqual(readFileSync(destination), content);
  assert.throws(() => store.backup(store.databasePath), /diferente/);
});

test("read results cannot mutate persisted data and JSON omits internal operation tokens", (t) => {
  const { store } = fixture(t);
  shop(store);
  const state = store.readState();
  state.products[0].stock = -99;
  assert.equal(store.readState().products[0].stock, 3);
  const exported = JSON.parse(store.exportJSON());
  assert.equal(exported.products[0].barcode, "001234");
  assert.ok(!("operations" in exported));
});

test("full-state replacement preserves history and idempotency while removing newer records", (t) => {
  const { store, open } = fixture(t);
  const initial = shop(store, 2);
  const requestId = randomUUID();
  const sale = run(store, "sale.create", initial.sale, requestId);
  const snapshot = store.readFullState();
  run(store, "customer.save", { name: "Cliente posterior", phone: "", email: "", document: "" });
  run(store, "stock.move", { id: initial.productId, direction: "in", quantity: 3, reason: "Entrada posterior" });
  assert.equal(store.readState().customers.length, 1);
  assert.equal(store.readState().products[0].stock, 4);
  store.replaceState(snapshot);
  snapshot.products[0].stock = 99;
  assert.equal(store.readState().customers.length, 0);
  assert.equal(store.readState().products[0].stock, 1);
  assert.deepEqual(run(store, "sale.create", initial.sale, requestId), sale);
  store.close();
  assert.equal(open().readFullState().operations.length, 3);
});

test("replacement rejects duplicate IDs or missing lists before touching data", (t) => {
  const { store } = fixture(t);
  shop(store);
  const before = store.exportJSON();
  const duplicate = store.readFullState();
  duplicate.products.push(structuredClone(duplicate.products[0]));
  assert.throws(() => store.replaceState(duplicate), ValidationError);
  const missing = store.readFullState();
  delete (missing as Partial<typeof missing>).audit;
  assert.throws(() => store.replaceState(missing), ValidationError);
  assert.equal(store.exportJSON(), before);
});

test("replacement rolls back after a SQL error and leaves current data intact", (t) => {
  const { store } = fixture(t);
  const initial = shop(store, 2);
  const old = store.readFullState();
  run(store, "sale.create", initial.sale);
  const before = store.readFullState();
  const raw = new DatabaseSync(store.databasePath);
  try {
    raw.exec(`CREATE TRIGGER reject_sale_delete BEFORE DELETE ON records
      WHEN OLD.kind = 'sales' BEGIN SELECT RAISE(ABORT, 'test-restore-failure'); END;`);
    assert.throws(() => store.replaceState(old), /test-restore-failure/);
    assert.deepEqual(store.readFullState(), before);
    raw.exec("DROP TRIGGER reject_sale_delete");
  } finally {
    raw.close();
  }
});

test("unrelated SQLite file and invalid inputs are rejected without replacement", (t) => {
  const { store, directory } = fixture(t);
  assert.throws(() => store.mutate("cash.open", { opening: 0 }, "", randomUUID()), ValidationError);
  assert.throws(() => store.mutate("cash.open", { opening: 0 }, "Ana", "bad"), /Identificador/);
  assert.throws(() => store.mutate("cash.open", null, "Ana", randomUUID()), /Dados/);
  store.close();
  assert.throws(() => store.readState(), /fechado/);
  const unrelatedDirectory = join(directory, "unrelated");
  const unrelated = createStore(unrelatedDirectory);
  unrelated.close();
  const raw = new DatabaseSync(join(unrelatedDirectory, "fio-caixa.sqlite3"));
  try {
    raw.exec("PRAGMA application_id = 1234");
  } finally {
    raw.close();
  }
  assert.throws(() => createStore(unrelatedDirectory), /não é um banco/);
  const original = new DatabaseSync(join(unrelatedDirectory, "fio-caixa.sqlite3"), { readOnly: true });
  try {
    assert.equal(original.prepare("PRAGMA application_id").get()?.application_id, 1234);
  } finally {
    original.close();
  }
});

async function competingWorkers(t: TestContext, directory: string, input: unknown, sameId = false) {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createStore } = await import(workerData.storeURL);
      const store = createStore(workerData.directory);
      parentPort.postMessage({ ready: true });
      parentPort.once('message', () => {
        try {
          const data = store.mutate('sale.create', workerData.input, 'Worker', workerData.requestId);
          parentPort.postMessage({ ok: true, result: data.result });
        } catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }
        finally { store.close(); }
      });
    })().catch(error => { parentPort.postMessage({ startupError: error.message }); });
  `;
  const common = randomUUID();
  const workers = [0, 1].map(() => new Worker(source, {
    eval: true,
    workerData: {
      directory,
      input,
      requestId: sameId ? common : randomUUID(),
      storeURL: new URL("../main/store.ts", import.meta.url).href,
    },
  }));
  t.after(async () => { await Promise.all(workers.map((worker) => worker.terminate())); });
  const prepared = workers.map((worker) => new Promise<void>((resolveReady, reject) => {
    worker.once("message", (message) => message.ready ? resolveReady() : reject(new Error(message.startupError)));
    worker.once("error", reject);
  }));
  await Promise.all(prepared);
  const completed = workers.map((worker) => new Promise<{ ok: boolean; error?: string; result?: unknown }>((resolveResult, reject) => {
    worker.once("message", resolveResult);
    worker.once("error", reject);
  }));
  for (const worker of workers) worker.postMessage("go");
  return Promise.all(completed);
}

test("two processes competing for the final unit commit exactly one sale", { timeout: 15000 }, async (t) => {
  const { store, directory } = fixture(t);
  const initial = shop(store, 1);
  const results = await competingWorkers(t, directory, initial.sale);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.match(results.find((r) => !r.ok)?.error || "", /Estoque insuficiente/);
  assert.equal(store.readState().sales.length, 1);
  assert.equal(store.readState().products[0].stock, 0);
});

test("simultaneous retry with the same identifier returns one persisted sale", { timeout: 15000 }, async (t) => {
  const { store, directory } = fixture(t);
  const initial = shop(store, 1);
  const results = await competingWorkers(t, directory, initial.sale, true);
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(results[0].result, results[1].result);
  assert.equal(store.readState().sales.length, 1);
  assert.equal(store.readState().cashEntries.length, 1);
});
