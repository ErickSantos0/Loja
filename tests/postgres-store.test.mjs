import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createPostgresStore,
  createPostgresDatabase,
  loadState,
  ValidationError,
  StorageError,
} from "../db/postgres-store.ts";
import { expectedCash, monthDate, todayBR } from "../lib/pos.ts";

function adapter(database, queries = []) {
  function executor(connection) {
    return {
      async query(text, parameters = []) {
        queries.push(text);
        return (await connection.query(text, [...parameters])).rows;
      },
    };
  }
  return {
    ...executor(database),
    transaction: (callback) => database.transaction((transaction) => callback(executor(transaction))),
  };
}

async function fixture(t) {
  // No directory or connection credentials: each test owns a fresh in-memory PostgreSQL engine.
  const database = new PGlite();
  const queries = [];
  const client = adapter(database, queries);
  const store = createPostgresStore(client);
  t.after(async () => { await store.close(); await database.close(); });
  return { database, store, queries, client };
}
const run = (store, action, input, requestId = randomUUID()) =>
  store.mutateState(action, input, "Operador de teste", requestId);

async function shop(store, stock = 3, price = 1999) {
  await run(store, "product.save", {
    name: "Camiseta", barcode: "001234", category: "Camisetas", size: "M", color: "Preta",
    cost: 900, price, stock, minimum: 1,
  });
  await run(store, "cash.open", { opening: 10000 });
  const state = await store.loadState();
  return {
    productId: state.products[0].id,
    sessionId: state.sessions[0].id,
    sale: {
      sessionId: state.sessions[0].id,
      customerId: "",
      items: [{ productId: state.products[0].id, quantity: 1, price }],
      discountType: "amount", discount: 0, expectedTotal: price, note: "",
      payments: [{ method: "cash", amount: price, installments: 1 }],
    },
  };
}

test("PostgreSQL initializes once without demo products and manual SQL matches the schema", async (t) => {
  const { database, store, client } = await fixture(t);
  const state = await store.loadState();
  assert.equal(state.settings[0].storeName, "Minha loja");
  assert.equal(state.products.length, 0);
  assert.ok(!("operations" in state));
  await run(store, "settings.save", { storeName: "Loja real", contact: "Contato", footer: "Obrigada" });
  const sql = await readFile(new URL("../db/postgres.sql", import.meta.url), "utf8");
  await database.exec(sql);
  const second = createPostgresStore(client);
  assert.equal((await second.loadState()).settings[0].storeName, "Loja real");
  const count = await database.query("SELECT count(*)::int AS count FROM fio_records WHERE kind = 'settings'");
  assert.equal(count.rows[0].count, 1);
});

test("JSONB records preserve stock, leading zeros, cents, discount and cash change", async (t) => {
  const { database, store, client } = await fixture(t);
  const initial = await shop(store, 3);
  await run(store, "sale.create", {
    ...initial.sale,
    items: [{ productId: initial.productId, quantity: 3, price: 1999 }],
    discountType: "percent", discount: 1000, expectedTotal: 5397,
    payments: [{ method: "cash", amount: 10000, installments: 1 }],
  });
  const reopened = createPostgresStore(client);
  const state = await reopened.loadState();
  assert.equal(state.products[0].stock, 0);
  assert.equal(state.products[0].barcode, "001234");
  assert.equal(state.sales[0].total, 5397);
  assert.equal(state.sales[0].change, 4603);
  assert.equal(expectedCash(state, state.sessions[0]), 15397);
  assert.equal(state.sales[0].operator, "Operador de teste");
  const raw = await database.query("SELECT payload, jsonb_typeof(payload) AS kind FROM fio_records WHERE kind = 'sales'");
  assert.equal(raw.rows[0].kind, "object");
  assert.equal(raw.rows[0].payload.id, state.sales[0].id);
});

test("mutations lock revision before reading records and concurrent sale requests cannot oversell", async (t) => {
  const { database, store, client, queries } = await fixture(t);
  const initial = await shop(store, 1);
  const second = createPostgresStore(client);
  await second.loadState();
  queries.length = 0;
  const results = await Promise.allSettled([
    run(store, "sale.create", initial.sale),
    run(second, "sale.create", initial.sale),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected");
  assert.ok(failed.reason instanceof ValidationError);
  assert.match(failed.reason.message, /Estoque insuficiente/);
  assert.match(queries[0], /FOR UPDATE/);
  assert.match(queries[1], /SELECT kind, id, payload/);
  const state = await store.loadState();
  assert.equal(state.sales.length, 1);
  assert.equal(state.products[0].stock, 0);
  const revision = await database.query("SELECT value::int AS value FROM fio_revision WHERE id = 1");
  assert.equal(revision.rows[0].value, 3);
});

test("idempotency survives new instances and concurrent retries without duplicate payments", async (t) => {
  const { database, store, client } = await fixture(t);
  const initial = await shop(store, 1);
  const other = createPostgresStore(client);
  await other.loadState();
  const requestId = randomUUID();
  const [first, repeated] = await Promise.all([
    run(store, "sale.create", initial.sale, requestId),
    run(other, "sale.create", initial.sale, requestId),
  ]);
  assert.deepEqual(first.result, repeated.result);
  assert.equal(repeated.state.sales.length, 1);
  assert.equal(repeated.state.cashEntries.length, 1);
  assert.equal(repeated.state.products[0].stock, 0);
  await assert.rejects(() => run(other, "sale.create", { ...initial.sale, note: "Alterada" }, requestId), ValidationError);
  const revision = await database.query("SELECT value::int AS value FROM fio_revision WHERE id = 1");
  assert.equal(revision.rows[0].value, 3);
});

test("late SQL failure rolls back product, sale, payment, audit and operation records", async (t) => {
  const { database, store } = await fixture(t);
  const initial = await shop(store, 1);
  const before = await store.loadState();
  const requestId = randomUUID();
  await database.exec(`
    CREATE FUNCTION reject_cash_entry() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.kind = 'cashEntries' THEN RAISE EXCEPTION 'intentional-storage-failure'; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER reject_cash_entry BEFORE INSERT ON fio_records
    FOR EACH ROW EXECUTE FUNCTION reject_cash_entry();
  `);
  await assert.rejects(() => run(store, "sale.create", initial.sale, requestId), StorageError);
  assert.deepEqual(await store.loadState(), before);
  const operations = await database.query("SELECT count(*)::int AS count FROM fio_records WHERE kind = 'operations'");
  assert.equal(operations.rows[0].count, 2);
  await database.exec("DROP TRIGGER reject_cash_entry ON fio_records; DROP FUNCTION reject_cash_entry();");
  await run(store, "sale.create", initial.sale, requestId);
  assert.equal((await store.loadState()).sales.length, 1);
});

test("draft refund failure leaves persisted stock and cash untouched", async (t) => {
  const { store } = await fixture(t);
  const initial = await shop(store, 1);
  await run(store, "sale.create", initial.sale);
  await run(store, "cash.move", { sessionId: initial.sessionId, type: "withdrawal", amount: 11999, note: "Retirada" });
  const before = await store.loadState();
  await assert.rejects(() => run(store, "sale.return", {
    id: before.sales[0].id, sessionId: initial.sessionId, reason: "Devolução", method: "cash",
    items: [{ productId: initial.productId, quantity: 1, restock: true }],
  }), (error) => error instanceof ValidationError && /Dinheiro insuficiente/.test(error.message));
  assert.deepEqual(await store.loadState(), before);
});

test("store credit, partial receipt and complete refund cancel debt consistently", async (t) => {
  const { store } = await fixture(t);
  const initial = await shop(store, 1, 10000);
  await run(store, "customer.save", { name: "Ana", phone: "", email: "", document: "" });
  const customerId = (await store.loadState()).customers[0].id;
  await run(store, "sale.create", {
    ...initial.sale, customerId,
    payments: [
      { method: "cash", amount: 4000, installments: 1 },
      { method: "store", amount: 6000, installments: 3, dueDate: monthDate(todayBR(), 1) },
    ],
  });
  const initialState = await store.loadState();
  assert.deepEqual(initialState.receivables.map((row) => row.amount), [2000, 2000, 2000]);
  await run(store, "receivable.receive", {
    id: initialState.receivables[0].id, sessionId: initial.sessionId, method: "cash", amount: 1000,
  });
  const returned = await run(store, "sale.return", {
    id: initialState.sales[0].id, sessionId: initial.sessionId, reason: "Devolução", method: "cash",
    items: [{ productId: initial.productId, quantity: 1, restock: true }],
  });
  assert.deepEqual(returned.result, { refunded: 5000 });
  assert.ok(returned.state.receivables.every((row) => row.status === "cancelled"));
  assert.equal(returned.state.products[0].stock, 1);
  assert.equal(expectedCash(returned.state, returned.state.sessions[0]), 10000);
});

test("input failures are ValidationError and closed storage stays StorageError", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(() => run(store, "cash.open", { opening: 0 }, "short"), ValidationError);
  await assert.rejects(() => store.mutateState("cash.open", { opening: 0 }, "", randomUUID()), ValidationError);
  await assert.rejects(() => run(store, "cash.open", null), ValidationError);
  await assert.rejects(() => run(store, "cash.open", { opening: -1 }), ValidationError);
  await store.close();
  await assert.rejects(() => store.loadState(), StorageError);
});

test("default store rejects missing or malformed DATABASE_URL without attempting a connection", async () => {
  const existing = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(() => loadState(), (error) => error instanceof StorageError && /DATABASE_URL/.test(error.message));
    assert.throws(() => createPostgresDatabase("invalid-address"), StorageError);
    assert.throws(() => createPostgresDatabase("https://example.invalid/database"), StorageError);
  } finally {
    if (existing === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = existing;
  }
});
