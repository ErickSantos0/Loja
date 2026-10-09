import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  createPostgresDatabase,
  createPostgresStore,
  StorageError,
  ValidationError,
} from "../db/postgres-store.ts";

async function fixture(t) {
  const engine = await PGlite.create("memory://", { debug: 0 });
  const server = new PGLiteSocketServer({ db: engine, host: "127.0.0.1", port: 0, maxConnections: 8 });
  const connections = [];
  t.after(async () => {
    try {
      await Promise.all(connections.map((connection) => connection.close()));
    } finally {
      try { await server.stop(); } finally { await engine.close(); }
    }
  });
  await server.start();
  const connectionString = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  function open() {
    const connection = createPostgresDatabase(connectionString);
    connections.push(connection);
    return { connection, store: createPostgresStore(connection) };
  }
  return { ...open(), open };
}

const run = (store, action, input, requestId = randomUUID()) =>
  store.mutateState(action, input, "Operador TCP", requestId);

async function shop(store, stock = 2) {
  await run(store, "product.save", {
    name: "Camiseta", barcode: "001234", category: "Camisetas", size: "M", color: "Preta",
    price: 1999, cost: 900, stock, minimum: 1,
  });
  await run(store, "cash.open", { opening: 10000 });
  const state = await store.loadState();
  return {
    sessionId: state.sessions[0].id,
    customerId: "",
    items: [{ productId: state.products[0].id, quantity: 1, price: 1999 }],
    discountType: "amount", discount: 0, expectedTotal: 1999, note: "TCP regression",
    payments: [{ method: "cash", amount: 2000, installments: 1 }],
  };
}

test("real postgres.js TCP bootstrap stores JSONB objects and round-trips sale/idempotency", { timeout: 30000 }, async (t) => {
  const { store, connection, open } = await fixture(t);
  const initial = await store.loadState();
  assert.equal(initial.settings[0].id, "store-settings");
  assert.equal(initial.products.length, 0);
  const settings = await connection.query("SELECT jsonb_typeof(payload) AS type, payload FROM fio_records WHERE kind = 'settings'");
  assert.equal(settings[0].type, "object");
  assert.equal(settings[0].payload.storeName, "Minha loja");

  const sale = await shop(store);
  const requestId = randomUUID();
  const first = await run(store, "sale.create", sale, requestId);
  const other = open();
  const [retry, loaded] = await Promise.all([
    run(other.store, "sale.create", sale, requestId),
    store.loadState(),
  ]);
  assert.deepEqual(retry.result, first.result);
  assert.equal(loaded.sales.length, 1);
  assert.equal(loaded.products[0].stock, 1);
  assert.equal(loaded.products[0].barcode, "001234");
  assert.equal(loaded.sales[0].change, 1);
  assert.equal(loaded.cashEntries.length, 1);
  const raw = await connection.query("SELECT payload FROM fio_records WHERE kind = 'sales'");
  assert.equal(raw[0].payload.id, first.result.saleId);
  assert.equal(raw[0].payload.payments[0].amount, 2000);
  assert.equal(raw[0].payload.items[0].productId, loaded.products[0].id);
  assert.equal((await connection.query("SELECT value::int AS value FROM fio_revision WHERE id = 1"))[0].value, 3);
  await assert.rejects(() => run(other.store, "sale.create", { ...sale, note: "Changed" }, requestId), ValidationError);
});

test("real TCP persistence error rolls back every record and keeps requestId available for retry", { timeout: 30000 }, async (t) => {
  const { store, connection } = await fixture(t);
  const sale = await shop(store, 1);
  const before = await store.loadState();
  const requestId = randomUUID();
  await connection.query(`CREATE FUNCTION reject_payment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.kind = 'cashEntries' THEN RAISE EXCEPTION 'intentional TCP write failure'; END IF;
      RETURN NEW;
    END; $$`);
  await connection.query("CREATE TRIGGER reject_payment BEFORE INSERT ON fio_records FOR EACH ROW EXECUTE FUNCTION reject_payment()");
  await assert.rejects(() => run(store, "sale.create", sale, requestId), StorageError);
  assert.deepEqual(await store.loadState(), before);
  assert.equal((await connection.query("SELECT value::int AS value FROM fio_revision WHERE id = 1"))[0].value, 2);
  await connection.query("DROP TRIGGER reject_payment ON fio_records");
  await connection.query("DROP FUNCTION reject_payment()");
  const completed = await run(store, "sale.create", sale, requestId);
  assert.equal(completed.state.sales.length, 1);
  assert.equal(completed.state.products[0].stock, 0);
  assert.equal(completed.state.cashEntries.length, 1);
});
