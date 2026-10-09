export type Method = "cash" | "pix" | "debit" | "credit" | "store";
export const methodNames: Record<Method, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit: "Débito",
  credit: "Crédito",
  store: "Crediário",
};
export type Product = {
  id: string;
  name: string;
  barcode: string;
  category: string;
  size: string;
  color: string;
  cost: number;
  price: number;
  stock: number;
  minimum: number;
  active: boolean;
  version: number;
};
export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  document: string;
  version: number;
};
export type SaleItem = {
  productId: string;
  name: string;
  barcode: string;
  size: string;
  color: string;
  quantity: number;
  returned: number;
  price: number;
  cost: number;
  net: number;
  refunded: number;
};
export type Payment = {
  method: Method;
  amount: number;
  installments: number;
  dueDate?: string;
};
export type Sale = {
  id: string;
  number: number;
  createdAt: string;
  sessionId: string;
  operator: string;
  customerId: string;
  customerName: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  change: number;
  payments: Payment[];
  status: "completed" | "returned" | "partial";
  note: string;
  requestId: string;
};
export type Session = {
  id: string;
  openedAt: string;
  operator: string;
  opening: number;
  closedAt: string | null;
  counted: number | null;
  expected: number | null;
  difference: number | null;
};
export type CashEntry = {
  id: string;
  sessionId: string;
  createdAt: string;
  type: "sale" | "refund" | "supply" | "withdrawal" | "receive";
  amount: number;
  method: Method;
  note: string;
  saleId?: string;
};
export type Movement = {
  id: string;
  productId: string;
  name: string;
  createdAt: string;
  quantity: number;
  balance: number;
  reason: string;
  operator: string;
};
export type Receivable = {
  id: string;
  saleId: string;
  customerId: string;
  customerName: string;
  number: number;
  amount: number;
  paid: number;
  dueDate: string;
  status: "open" | "paid" | "cancelled";
};
export type Refund = {
  id: string;
  saleId: string;
  createdAt: string;
  value: number;
  amount: number;
  method: Method;
  reason: string;
  items: { productId: string; quantity: number; restock: boolean }[];
};
export type Audit = {
  id: string;
  createdAt: string;
  operator: string;
  action: string;
};
export type Settings = {
  id: string;
  storeName: string;
  contact: string;
  footer: string;
};
export type State = {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  sessions: Session[];
  cashEntries: CashEntry[];
  movements: Movement[];
  receivables: Receivable[];
  refunds: Refund[];
  audit: Audit[];
  settings: Settings[];
  operations: { id: string; action: string; input: string; result: unknown }[];
};
export type PublicState = Omit<State, "operations">;
export const kinds = [
  "products",
  "customers",
  "sales",
  "sessions",
  "cashEntries",
  "movements",
  "receivables",
  "refunds",
  "audit",
  "settings",
  "operations",
] as const;
export function emptyState(): State {
  return {
    products: [],
    customers: [],
    sales: [],
    sessions: [],
    cashEntries: [],
    movements: [],
    receivables: [],
    refunds: [],
    audit: [],
    settings: [
      {
        id: "store-settings",
        storeName: "Minha loja",
        contact: "",
        footer: "Obrigado pela preferência. Volte sempre!",
      },
    ],
    operations: [],
  };
}
export const money = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function parseMoney(value: string): number {
  const clean = value.trim().replace(/\s|R\$/g, "");
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  const [whole, decimal = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
export function splitInstallments(amount: number, count: number): number[] {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12
  )
    throw new Error("Parcelamento inválido.");
  return Array.from(
    { length: count },
    (_, i) => Math.floor(amount / count) + (i < amount % count ? 1 : 0),
  );
}
export function totals(subtotal: number, discountType: string, value: number) {
  const discount =
    discountType === "percent" ? Math.round((subtotal * value) / 10000) : value;
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal < 0 ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    discount < 0 ||
    discount > subtotal ||
    (discountType === "percent" && value > 10000)
  )
    throw new Error("O desconto deve estar entre zero e o valor da venda.");
  return { subtotal, discount, total: subtotal - discount };
}
export function roundedRatio(a: number, b: number, denominator: number) {
  const n = BigInt(a) * BigInt(b),
    d = BigInt(denominator);
  return Number((2n * n + d) / (2n * d));
}
export function validDate(value: string) {
  const d = new Date(value + "T12:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value
  );
}
export function dateBR(date: string, time = true) {
  return new Date(
    date.length === 10 ? date + "T12:00:00-03:00" : date,
  ).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    ...(time
      ? { dateStyle: "short", timeStyle: "short" }
      : { dateStyle: "short" }),
  });
}
export function todayBR() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function monthDate(date: string, offset: number) {
  const [y, m, d] = date.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function expectedCash(s: Pick<State, "cashEntries">, session: Session) {
  return (
    session.opening +
    s.cashEntries
      .filter((e) => e.sessionId === session.id && e.method === "cash")
      .reduce((n, e) => n + e.amount, 0)
  );
}
function insist(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function integer(n: unknown, label: string, minimum = 0): number {
  insist(
    typeof n === "number" &&
      Number.isSafeInteger(n) &&
      n >= minimum &&
      n <= 1000000000,
    `${label} inválido.`,
  );
  return n;
}
function text(v: unknown, label: string, required = false, max = 200): string {
  insist(typeof v === "string", `${label} inválido.`);
  const r = v.trim();
  insist(
    r.length <= max && (!required || r.length > 0),
    `Confira ${label.toLowerCase()}.`,
  );
  return r;
}
function uuid() {
  return crypto.randomUUID();
}
function current(s: State) {
  const session = s.sessions.find((x) => !x.closedAt);
  insist(session, "Abra o caixa para realizar esta operação.");
  return session;
}
function method(v: unknown): Method {
  insist(
    typeof v === "string" && Object.hasOwn(methodNames, v),
    "Forma de pagamento inválida.",
  );
  return v as Method;
}
function move(
  s: State,
  p: Product,
  qty: number,
  reason: string,
  operator: string,
  now: string,
) {
  p.stock += qty;
  p.version++;
  insist(
    Number.isSafeInteger(p.stock) && p.stock >= 0 && p.stock <= 1000000000,
    `Estoque insuficiente: ${p.name}, ${p.size}, ${p.color}.`,
  );
  s.movements.push({
    id: uuid(),
    productId: p.id,
    name: `${p.name} · ${p.size} · ${p.color}`,
    createdAt: now,
    quantity: qty,
    balance: p.stock,
    reason,
    operator,
  });
}
function cash(
  s: State,
  session: Session,
  type: CashEntry["type"],
  amount: number,
  paymentMethod: Method,
  note: string,
  now: string,
  saleId?: string,
) {
  if (amount)
    s.cashEntries.push({
      id: uuid(),
      sessionId: session.id,
      createdAt: now,
      type,
      amount,
      method: paymentMethod,
      note,
      saleId,
    });
}
// Called on a draft. The persistence layer commits every change atomically.
export function applyOperation(
  s: State,
  action: string,
  input: any,
  operator: string,
  requestId: string,
  now = new Date().toISOString(),
): unknown {
  const repeat = s.operations.find((o) => o.id === requestId);
  if (repeat) {
    insist(
      repeat.action === action && repeat.input === JSON.stringify(input),
      "Este identificador já foi usado em outra operação.",
    );
    return repeat.result;
  }
  let result: unknown = { ok: true };
  switch (action) {
    case "product.save": {
      const existing = input.id
        ? s.products.find((p) => p.id === input.id)
        : undefined;
      if (input.id)
        insist(
          existing && existing.version === input.version,
          "Esta peça foi alterada. Atualize e tente novamente.",
        );
      const barcode = text(input.barcode, "Código de barras", true, 64);
      insist(
        !s.products.some((p) => p.barcode === barcode && p.id !== existing?.id),
        "Este código de barras já pertence a outra peça.",
      );
      const p: Product = {
        id: existing?.id || uuid(),
        name: text(input.name, "Nome", true),
        barcode,
        category: text(input.category, "Categoria"),
        size: text(input.size, "Tamanho", true, 30),
        color: text(input.color, "Cor", true, 50),
        cost: integer(input.cost, "Custo"),
        price: integer(input.price, "Preço", 1),
        minimum: integer(input.minimum, "Estoque mínimo"),
        stock: existing?.stock || 0,
        active: input.active !== false,
        version: (existing?.version || 0) + 1,
      };
      if (existing) Object.assign(existing, p);
      else {
        s.products.push(p);
        const qty = integer(input.stock, "Estoque inicial");
        if (qty) move(s, p, qty, "Cadastro: estoque inicial", operator, now);
      }
      result = { id: p.id };
      break;
    }
    case "stock.move": {
      const p = s.products.find((p) => p.id === input.id);
      insist(p, "Peça não encontrada.");
      const qty = integer(input.quantity, "Quantidade", 1);
      insist(["in", "out"].includes(input.direction), "Movimentação inválida.");
      move(
        s,
        p,
        input.direction === "in" ? qty : -qty,
        text(input.reason, "Motivo", true),
        operator,
        now,
      );
      break;
    }
    case "customer.save": {
      const existing = input.id
        ? s.customers.find((c) => c.id === input.id)
        : undefined;
      if (input.id)
        insist(
          existing && existing.version === input.version,
          "Este cliente foi alterado. Atualize e tente novamente.",
        );
      const c: Customer = {
        id: existing?.id || uuid(),
        name: text(input.name, "Nome", true),
        phone: text(input.phone, "Telefone", false, 40),
        email: text(input.email, "E-mail", false, 100),
        document: text(input.document, "Documento", false, 30),
        version: (existing?.version || 0) + 1,
      };
      if (existing) Object.assign(existing, c);
      else s.customers.push(c);
      result = { id: c.id };
      break;
    }
    case "cash.open": {
      insist(
        !s.sessions.some((x) => !x.closedAt),
        "Já existe um caixa aberto.",
      );
      const session: Session = {
        id: uuid(),
        openedAt: now,
        operator,
        opening: integer(input.opening, "Fundo inicial"),
        closedAt: null,
        counted: null,
        expected: null,
        difference: null,
      };
      s.sessions.push(session);
      result = { id: session.id };
      break;
    }
    case "cash.move": {
      const session = current(s);
      insist(
        session.id === input.sessionId,
        "O caixa foi alterado. Revise a movimentação.",
      );
      const value = integer(input.amount, "Valor", 1);
      insist(
        ["supply", "withdrawal"].includes(input.type),
        "Movimentação inválida.",
      );
      if (input.type === "withdrawal")
        insist(
          value <= expectedCash(s, session),
          "O valor supera o dinheiro disponível no caixa.",
        );
      cash(
        s,
        session,
        input.type,
        input.type === "supply" ? value : -value,
        "cash",
        text(input.note, "Motivo", true),
        now,
      );
      break;
    }
    case "cash.close": {
      const session = current(s);
      insist(
        session.id === input.id,
        "O caixa foi alterado. Atualize a página.",
      );
      const expected = expectedCash(s, session);
      const counted = integer(input.counted, "Dinheiro contado");
      Object.assign(session, {
        closedAt: now,
        expected,
        counted,
        difference: counted - expected,
      });
      break;
    }
    case "sale.create": {
      const session = current(s);
      insist(
        session.id === input.sessionId,
        "O caixa foi alterado. Revise a venda.",
      );
      insist(
        Array.isArray(input.items) &&
          input.items.length > 0 &&
          input.items.length <= 200,
        "Adicione peças à venda.",
      );
      const used = new Set<string>();
      const items: SaleItem[] = input.items.map((line: any) => {
        insist(!used.has(line.productId), "Peça repetida na lista.");
        used.add(line.productId);
        const p = s.products.find((p) => p.id === line.productId && p.active);
        insist(p, "Uma peça não está mais disponível.");
        const quantity = integer(line.quantity, "Quantidade", 1);
        insist(
          p.stock >= quantity,
          `Estoque insuficiente: ${p.name}, ${p.size}, ${p.color}.`,
        );
        insist(
          line.price === p.price,
          `O preço de ${p.name} mudou. Atualize e revise a venda.`,
        );
        return {
          productId: p.id,
          name: p.name,
          barcode: p.barcode,
          size: p.size,
          color: p.color,
          quantity,
          returned: 0,
          price: p.price,
          cost: p.cost,
          net: 0,
          refunded: 0,
        };
      });
      const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);
      integer(subtotal, "Subtotal");
      insist(
        ["amount", "percent"].includes(input.discountType),
        "Tipo de desconto inválido.",
      );
      const amounts = totals(
        subtotal,
        input.discountType,
        integer(input.discount, "Desconto"),
      );
      insist(amounts.total > 0, "O total da venda deve ser maior que zero.");
      insist(
        input.expectedTotal === amounts.total,
        "O total mudou. Revise a venda.",
      );
      const customer = input.customerId
        ? s.customers.find((c) => c.id === input.customerId)
        : undefined;
      if (input.customerId) insist(customer, "Cliente não encontrado.");
      insist(
        Array.isArray(input.payments) &&
          input.payments.length > 0 &&
          input.payments.length <= 10,
        "Informe o pagamento.",
      );
      const payments: Payment[] = input.payments.map((p: any) => {
        const m = method(p.method);
        const amount = integer(p.amount, "Pagamento", 1);
        const count =
          m === "credit" || m === "store"
            ? integer(p.installments, "Parcelas", 1)
            : 1;
        insist(
          count <= 12 && amount >= count,
          "Escolha de 1 a 12 parcelas de pelo menos um centavo.",
        );
        if (m === "store") {
          insist(customer, "Escolha um cliente para o crediário.");
          insist(
            typeof p.dueDate === "string" &&
              validDate(p.dueDate) &&
              p.dueDate >= todayBR(),
            "Informe um primeiro vencimento válido, a partir de hoje.",
          );
        }
        return {
          method: m,
          amount,
          installments: count,
          ...(m === "store" ? { dueDate: p.dueDate } : {}),
        };
      });
      insist(
        payments.filter((p) => p.method === "store").length <= 1,
        "Use uma única linha de pagamento para o crediário.",
      );
      const received = payments.reduce((n, p) => n + p.amount, 0);
      const change = received - amounts.total;
      const cashPaid = payments
        .filter((p) => p.method === "cash")
        .reduce((n, p) => n + p.amount, 0);
      insist(change >= 0, "O pagamento não cobre o total.");
      insist(
        change <= cashPaid,
        "Troco é permitido somente no pagamento em dinheiro.",
      );
      let running = 0,
        prior = 0;
      for (const i of items) {
        running += i.price * i.quantity;
        const allocated = roundedRatio(amounts.discount, running, subtotal);
        i.net = i.price * i.quantity - (allocated - prior);
        prior = allocated;
      }
      const sale: Sale = {
        id: uuid(),
        number: s.sales.reduce((n, x) => Math.max(n, x.number), 0) + 1,
        createdAt: now,
        sessionId: session.id,
        operator,
        customerId: customer?.id || "",
        customerName: customer?.name || "Consumidor",
        items,
        ...amounts,
        change,
        payments,
        status: "completed",
        note: text(input.note || "", "Observação", false, 500),
        requestId,
      };
      s.sales.push(sale);
      for (const item of items)
        move(
          s,
          s.products.find((p) => p.id === item.productId)!,
          -item.quantity,
          `Venda #${sale.number}`,
          operator,
          now,
        );
      let remainingChange = change;
      for (const p of payments) {
        const returned =
          p.method === "cash" ? Math.min(remainingChange, p.amount) : 0;
        remainingChange -= returned;
        if (p.method !== "store")
          cash(
            s,
            session,
            "sale",
            p.amount - returned,
            p.method,
            `Venda #${sale.number}`,
            now,
            sale.id,
          );
        if (p.method === "store")
          splitInstallments(p.amount, p.installments).forEach((amount, i) =>
            s.receivables.push({
              id: uuid(),
              saleId: sale.id,
              customerId: customer!.id,
              customerName: customer!.name,
              number: i + 1,
              amount,
              paid: 0,
              dueDate: monthDate(p.dueDate!, i),
              status: "open",
            }),
          );
      }
      result = { saleId: sale.id };
      break;
    }
    case "receivable.receive": {
      const session = current(s);
      insist(
        session.id === input.sessionId,
        "O caixa foi alterado. Revise o recebimento.",
      );
      const r = s.receivables.find((r) => r.id === input.id);
      insist(
        r && r.status === "open",
        "Parcela indisponível para recebimento.",
      );
      const m = method(input.method);
      insist(
        m !== "store" && m !== "credit",
        "Use dinheiro, Pix ou débito para receber uma parcela.",
      );
      const amount = integer(input.amount, "Valor recebido", 1);
      insist(amount <= r.amount - r.paid, "O valor supera o saldo da parcela.");
      r.paid += amount;
      if (r.paid === r.amount) r.status = "paid";
      cash(
        s,
        session,
        "receive",
        amount,
        m,
        `Parcela ${r.number} · ${r.customerName}`,
        now,
        r.saleId,
      );
      break;
    }
    case "sale.return": {
      const session = current(s);
      insist(
        session.id === input.sessionId,
        "O caixa foi alterado. Revise a devolução.",
      );
      const sale = s.sales.find((x) => x.id === input.id);
      insist(
        sale && sale.status !== "returned",
        "Venda já devolvida ou não encontrada.",
      );
      const reason = text(input.reason, "Motivo", true);
      const m = method(input.method);
      insist(m !== "store", "Escolha uma forma de reembolso.");
      const debt = s.receivables.filter((r) => r.saleId === sale.id);
      const hasStore = sale.payments.some((p) => p.method === "store");
      insist(
        Array.isArray(input.items) && input.items.length > 0,
        "Escolha ao menos uma peça.",
      );
      const used = new Set<string>();
      let refundTotal = 0;
      const returns = input.items.map((x: any) => {
        insist(!used.has(x.productId), "Peça repetida.");
        used.add(x.productId);
        const item = sale.items.find((i) => i.productId === x.productId);
        insist(item, "Peça não pertence à venda.");
        const qty = integer(x.quantity, "Quantidade", 1);
        insist(
          qty <= item.quantity - item.returned,
          "Quantidade supera as peças ainda não devolvidas.",
        );
        insist(
          typeof x.restock === "boolean",
          "Informe se a peça volta ao estoque.",
        );
        const refunded =
          roundedRatio(item.net, item.returned + qty, item.quantity) -
          item.refunded;
        refundTotal += refunded;
        item.returned += qty;
        item.refunded += refunded;
        if (x.restock) {
          const p = s.products.find((p) => p.id === item.productId);
          insist(p, "Peça não encontrada no cadastro.");
          move(
            s,
            p,
            qty,
            `Devolução #${sale.number}: ${reason}`,
            operator,
            now,
          );
        }
        return { productId: x.productId, quantity: qty, restock: x.restock };
      });
      const allReturned = sale.items.every((i) => i.returned === i.quantity);
      if (hasStore)
        insist(
          allReturned && sale.status === "completed",
          "Vendas com crediário permitem apenas devolução integral.",
        );
      const outstanding = hasStore
        ? debt.reduce(
            (n, r) => n + (r.status === "open" ? r.amount - r.paid : 0),
            0,
          )
        : 0;
      const cashRefund = refundTotal - outstanding;
      insist(cashRefund >= 0, "Reembolso inválido.");
      if (m === "cash")
        insist(
          expectedCash(s, session) >= cashRefund,
          "Dinheiro insuficiente no caixa para reembolsar.",
        );
      if (hasStore)
        debt.forEach((r) => {
          if (r.status === "open") r.status = "cancelled";
        });
      sale.status = allReturned ? "returned" : "partial";
      cash(
        s,
        session,
        "refund",
        -cashRefund,
        m,
        `Devolução #${sale.number}: ${reason}`,
        now,
        sale.id,
      );
      const refund: Refund = {
        id: uuid(),
        saleId: sale.id,
        createdAt: now,
        value: refundTotal,
        amount: cashRefund,
        method: m,
        reason,
        items: returns,
      };
      s.refunds.push(refund);
      result = { refunded: cashRefund };
      break;
    }
    case "settings.save": {
      s.settings[0] = {
        id: "store-settings",
        storeName: text(input.storeName, "Nome da loja", true),
        contact: text(input.contact, "Contato"),
        footer: text(input.footer, "Mensagem do comprovante", false, 300),
      };
      break;
    }
    default:
      throw new Error("Operação desconhecida.");
  }
  s.audit.push({ id: uuid(), createdAt: now, operator, action });
  s.operations.push({
    id: requestId,
    action,
    input: JSON.stringify(input),
    result,
  });
  return result;
}
