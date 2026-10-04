import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOperation,
  emptyState,
  expectedCash,
  parseMoney,
  totals,
  splitInstallments,
  monthDate,
  validDate,
  roundedRatio,
  todayBR,
} from "../lib/pos.ts";
function shop(stock = 10, price = 1999) {
  let state = emptyState();
  function run(action, input, requestId = crypto.randomUUID()) {
    const draft = structuredClone(state);
    const result = applyOperation(draft, action, input, "Teste", requestId);
    state = draft;
    return result;
  }
  run("product.save", {
    name: "Camiseta",
    barcode: "001234",
    category: "Camisetas",
    size: "M",
    color: "Preta",
    price,
    cost: 900,
    stock,
    minimum: 2,
  });
  run("cash.open", { opening: 10000 });
  return {
    run,
    get state() {
      return state;
    },
    sale(overrides = {}, requestId) {
      return run(
        "sale.create",
        {
          sessionId: state.sessions.at(-1).id,
          items: [{ productId: state.products[0].id, quantity: 1, price }],
          discountType: "amount",
          discount: 0,
          expectedTotal: price,
          payments: [{ method: "cash", amount: price, installments: 1 }],
          ...overrides,
        },
        requestId,
      );
    },
  };
}
test("valores brasileiros, desconto, troco e baixa", () => {
  assert.equal(parseMoney("1.234,56"), 123456);
  assert.equal(parseMoney("19.99"), 1999);
  assert.ok(Number.isNaN(parseMoney("-10")));
  assert.ok(Number.isNaN(parseMoney("1,001")));
  const t = totals(5997, "percent", 1000);
  assert.deepEqual(t, { subtotal: 5997, discount: 600, total: 5397 });
  const q = shop();
  q.sale({
    items: [{ productId: q.state.products[0].id, quantity: 3, price: 1999 }],
    discountType: "percent",
    discount: 1000,
    expectedTotal: 5397,
    payments: [{ method: "cash", amount: 10000, installments: 1 }],
  });
  assert.equal(q.state.sales[0].change, 4603);
  assert.equal(q.state.products[0].stock, 7);
  assert.equal(expectedCash(q.state, q.state.sessions[0]), 15397);
});
test("centavos das parcelas e datas mensais", () => {
  assert.deepEqual(splitInstallments(10000, 3), [3334, 3333, 3333]);
  assert.equal(monthDate("2027-01-31", 1), "2027-02-28");
  assert.equal(monthDate("2028-01-31", 1), "2028-02-29");
  assert.equal(validDate("2027-02-31"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(roundedRatio(999999998, 500000000, 999999999), 499999999);
});
test("pagamento misto retorna troco apenas em dinheiro", () => {
  const q = shop(10, 10000);
  q.sale({
    payments: [
      { method: "credit", amount: 6000, installments: 3 },
      { method: "cash", amount: 5000, installments: 1 },
    ],
  });
  assert.equal(q.state.sales[0].change, 1000);
  assert.equal(expectedCash(q.state, q.state.sessions[0]), 14000);
  assert.equal(
    q.state.cashEntries.find((x) => x.method === "credit").amount,
    6000,
  );
});
test("última unidade, idempotência e payload divergente", () => {
  const q = shop(1);
  const id = crypto.randomUUID();
  const a = q.sale({}, id);
  const b = q.sale({}, id);
  assert.deepEqual(a, b);
  assert.equal(q.state.sales.length, 1);
  assert.equal(q.state.products[0].stock, 0);
  assert.throws(() => q.sale(), /Estoque insuficiente/);
  assert.throws(() => q.run("cash.move", { amount: 1 }, id), /identificador/);
  assert.equal(q.state.sales.length, 1);
});
test("falhas não gravam parte da venda", () => {
  const q = shop(2);
  const snapshot = JSON.stringify(q.state);
  assert.throws(
    () =>
      q.sale({ payments: [{ method: "pix", amount: 5000, installments: 1 }] }),
    /Troco/,
  );
  assert.equal(JSON.stringify(q.state), snapshot);
  assert.throws(
    () =>
      q.sale({
        items: [
          { productId: q.state.products[0].id, quantity: 3, price: 1999 },
        ],
      }),
    /Estoque insuficiente/,
  );
  assert.equal(JSON.stringify(q.state), snapshot);
});
test("devoluções parciais somam o desconto exato e não duplicam estoque", () => {
  const q = shop(3, 100);
  q.sale({
    items: [{ productId: q.state.products[0].id, quantity: 3, price: 100 }],
    discount: 100,
    expectedTotal: 200,
    payments: [{ method: "cash", amount: 200, installments: 1 }],
  });
  const data = {
    id: q.state.sales[0].id,
    sessionId: q.state.sessions[0].id,
    reason: "Troca",
    method: "cash",
    items: [{ productId: q.state.products[0].id, quantity: 1, restock: true }],
  };
  const refunds = [];
  for (let i = 0; i < 3; i++) refunds.push(q.run("sale.return", data).refunded);
  assert.deepEqual(refunds, [67, 66, 67]);
  assert.equal(q.state.products[0].stock, 3);
  assert.equal(q.state.sales[0].status, "returned");
  assert.throws(() => q.run("sale.return", data), /já devolvida/);
  assert.equal(expectedCash(q.state, q.state.sessions[0]), 10000);
});
test("crediário, recebimento parcial, devolução integral e dívida cancelada", () => {
  const q = shop(1, 10000);
  q.run("customer.save", { name: "Ana", phone: "", email: "", document: "" });
  q.sale({
    customerId: q.state.customers[0].id,
    payments: [
      { method: "cash", amount: 4000, installments: 1 },
      {
        method: "store",
        amount: 6000,
        installments: 3,
        dueDate: monthDate(todayBR(), 1),
      },
    ],
  });
  assert.equal(q.state.receivables.length, 3);
  q.run("receivable.receive", {
    sessionId: q.state.sessions[0].id,
    id: q.state.receivables[0].id,
    method: "cash",
    amount: 1000,
  });
  const r = q.run("sale.return", {
    id: q.state.sales[0].id,
    sessionId: q.state.sessions[0].id,
    reason: "Cancelamento",
    method: "cash",
    items: [{ productId: q.state.products[0].id, quantity: 1, restock: true }],
  });
  assert.equal(r.refunded, 5000);
  assert.ok(q.state.receivables.every((r) => r.status === "cancelled"));
  assert.equal(q.state.products[0].stock, 1);
  assert.equal(expectedCash(q.state, q.state.sessions[0]), 10000);
});
test("crediário rejeita cliente ausente e dia inexistente", () => {
  const q = shop();
  assert.throws(
    () =>
      q.sale({
        payments: [
          {
            method: "store",
            amount: 1999,
            installments: 1,
            dueDate: "2027-02-31",
          },
        ],
      }),
    /cliente/,
  );
  q.run("customer.save", { name: "Ana", phone: "", email: "", document: "" });
  assert.throws(
    () =>
      q.sale({
        customerId: q.state.customers[0].id,
        payments: [
          {
            method: "store",
            amount: 1999,
            installments: 1,
            dueDate: "2027-02-31",
          },
        ],
      }),
    /vencimento/,
  );
});
test("caixa, sangria, suprimento e fechamento", () => {
  const q = shop(2, 4000);
  q.sale();
  const sessionId = q.state.sessions[0].id;
  q.run("cash.move", {
    sessionId,
    type: "supply",
    amount: 2000,
    note: "Troco",
  });
  q.run("cash.move", {
    sessionId,
    type: "withdrawal",
    amount: 1500,
    note: "Depósito",
  });
  assert.equal(expectedCash(q.state, q.state.sessions[0]), 14500);
  q.run("cash.close", { id: sessionId, counted: 14400 });
  assert.equal(q.state.sessions[0].difference, -100);
  assert.throws(() => q.sale(), /Abra o caixa/);
});
test("operações de uma sessão antiga não entram no caixa seguinte", () => {
  const q = shop();
  const old = q.state.sessions[0].id;
  q.sale();
  q.run("cash.close", { id: old, counted: 11999 });
  q.run("cash.open", { opening: 0 });
  assert.throws(
    () =>
      q.run("cash.move", {
        sessionId: old,
        type: "supply",
        amount: 10,
        note: "Troco",
      }),
    /caixa foi alterado/,
  );
  assert.throws(
    () => q.run("sale.return", { sessionId: old, id: q.state.sales[0].id }),
    /caixa foi alterado/,
  );
  assert.throws(
    () => q.run("receivable.receive", { sessionId: old, id: "anything" }),
    /caixa foi alterado/,
  );
});
test("código mantém zeros; cadastros rejeitam conflitos e versões antigas", () => {
  const q = shop();
  assert.equal(q.state.products[0].barcode, "001234");
  assert.throws(
    () => q.run("product.save", { ...q.state.products[0], id: undefined }),
    /código de barras/,
  );
  const old = structuredClone(q.state.products[0]);
  q.run("product.save", { ...old, name: "Nome atualizado" });
  assert.throws(() => q.run("product.save", old), /foi alterada/);
  q.run("customer.save", { name: "Ana", phone: "", email: "", document: "" });
  const customer = structuredClone(q.state.customers[0]);
  q.run("customer.save", { ...customer, phone: "123" });
  assert.throws(() => q.run("customer.save", customer), /foi alterado/);
});
