"use client";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type FormEvent,
  type CSSProperties,
} from "react";
import {
  ShoppingBag,
  Boxes,
  Users,
  Wallet,
  ChartNoAxesCombined,
  Settings2,
  ScanBarcode,
  Search,
  Plus,
  Minus,
  Trash2,
  Shirt,
  Check,
  ChevronRight,
  Printer,
  RotateCcw,
  Download,
  RefreshCw,
  CircleHelp,
  X,
  CircleAlert,
  PackagePlus,
  Pencil,
  Banknote,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  LogOut,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Checkbox } from "@/components/ui/checkbox";
import { Toaster, toast } from "sonner";
import {
  emptyState,
  money,
  parseMoney,
  totals,
  dateBR,
  todayBR,
  expectedCash,
  methodNames,
  splitInstallments,
  roundedRatio,
  type PublicState,
  type Product,
  type Sale,
  type Method,
  type Payment,
  type Customer,
  type Receivable,
} from "@/lib/pos";
import "./pos.css";

const navigation = [
  { id: "pos", label: "Frente de caixa", icon: ShoppingBag },
  { id: "inventory", label: "Estoque", icon: Boxes },
  { id: "sales", label: "Vendas", icon: Wallet },
  { id: "customers", label: "Clientes", icon: Users },
  { id: "receivables", label: "Crediário", icon: CreditCard },
  { id: "cash", label: "Controle de caixa", icon: Banknote },
  { id: "reports", label: "Relatórios", icon: ChartNoAxesCombined },
];
type Modal = { type: string; data?: any; sessionId?: string } | null;
type CartLine = { productId: string; quantity: number; price: number };
type PayRow = {
  uid: string;
  method: Method;
  amount: string;
  installments: string;
  dueDate: string;
};
const decimal = (n: number) => (n / 100).toFixed(2).replace(".", ",");
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const stockLabel = (p: Product) =>
  !p.active
    ? "Inativa"
    : p.stock === 0
      ? "Esgotada"
      : p.stock <= p.minimum
        ? "Estoque baixo"
        : "Disponível";
const saleLabel = (s: Sale) =>
  s.status === "returned"
    ? "Devolvida"
    : s.status === "partial"
      ? "Devolução parcial"
      : "Concluída";
function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
function Blank({
  title,
  text,
  icon: Icon = Shirt,
  children,
}: {
  title: string;
  text: string;
  icon?: typeof Shirt;
  children?: ReactNode;
}) {
  return (
    <Empty className="blank">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  );
}
function Metric({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Shirt;
}) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
      <span className="metric-icon">
        <Icon size={20} />
      </span>
    </div>
  );
}
function Nav({
  screen,
  change,
}: {
  screen: string;
  change: (s: string) => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {navigation.map((n) => (
        <SidebarMenuItem key={n.id}>
          <SidebarMenuButton
            className="nav-item"
            isActive={screen === n.id}
            onClick={() => {
              change(n.id);
              setOpenMobile(false);
            }}
          >
            <n.icon />
            <span>{n.label}</span>
            {screen === n.id && <ChevronRight className="nav-chevron" />}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
function download(name: string, content: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows: (string | number)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell);
            const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
            return '"' + safe.replace(/"/g, '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n")
  );
}

export default function PosApp({
  operator,
  userKey,
  desktop = false,
  transport,
}: {
  operator: string;
  userKey: string;
  desktop?: boolean;
  transport?: (path: string, options?: RequestInit) => Promise<Response>;
}) {
  const request = useCallback(
    (path: string, options?: RequestInit) =>
      transport ? transport(path, options) : fetch(path, options),
    [transport],
  );
  const pendingKey = `fio-pending-v1-${userKey}`;
  const [state, setState] = useState<PublicState | null>(null);
  const s = state || emptyState();
  const [screen, setScreen] = useState("pos");
  const [modal, setModal] = useState<Modal>(null);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState<{
    action: string;
    input: any;
    requestId: string;
  } | null>(null);
  const locked = useRef(false);
  const [pendingReady, setPendingReady] = useState(false);
  useEffect(() => {
    let active = true;
    setPendingReady(false);
    async function recover() {
      try {
        const raw = desktop
          ? await window.fioDesktop.pending.get()
          : sessionStorage.getItem(pendingKey);
        if (raw) {
          const pending = JSON.parse(raw);
          if (
            typeof pending.action === "string" &&
            pending.input &&
            typeof pending.requestId === "string"
          )
            if (active) setUncertain(pending);
        }
        if (active) setPendingReady(true);
      } catch {
        toast.error("Não foi possível recuperar a confirmação pendente.");
      }
    }
    void recover();
    return () => {
      active = false;
    };
  }, [pendingKey, desktop]);
  async function clearPending() {
    try {
      if (desktop) await window.fioDesktop.pending.clear();
      else sessionStorage.removeItem(pendingKey);
      setUncertain(null);
    } catch {
      toast.error(
        "A operação foi confirmada, mas a confirmação pendente não pôde ser removida. Tente conferi-la novamente.",
      );
    }
  }
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState("");
  const scan = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [inventoryFilter, setInventoryFilter] = useState("all");
  const [customerId, setCustomerId] = useState("none");
  const [discountType, setDiscountType] = useState("amount");
  const [discount, setDiscount] = useState("0");
  const [note, setNote] = useState("");
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [dateFrom, setDateFrom] = useState(todayBR());
  const [dateTo, setDateTo] = useState(todayBR());
  const [refundLines, setRefundLines] = useState<
    Record<string, { quantity: string; restock: boolean }>
  >({});
  const [refundMethod, setRefundMethod] = useState<Method>("cash");
  const session = s.sessions.find((x) => !x.closedAt);
  const store = s.settings[0];
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const response = await request("/api/pos", { cache: "no-store" });
        const data: any = await response.json();
        if (!response.ok) throw new Error(data.error);
        setState(data);
        setError("");
      } catch (e) {
        if (!quiet)
          setError(
            e instanceof Error ? e.message : "Não foi possível carregar.",
          );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [request],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (!locked.current) void load(true);
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  useEffect(() => {
    if (screen === "pos" && !modal) scan.current?.focus();
  }, [screen, modal]);
  async function mutate(
    action: string,
    input: any,
    existingId?: string,
  ): Promise<any> {
    if (locked.current) return null;
    if (!pendingReady) {
      toast.error(
        "Aguarde a recuperação das confirmações. Se não concluir, feche e abra o aplicativo.",
      );
      return null;
    }
    if (uncertain && !existingId) {
      toast.error("Confira a operação pendente antes de continuar.");
      return null;
    }
    locked.current = true;
    setSaving(true);
    const requestId = existingId || crypto.randomUUID();
    try {
      const raw = JSON.stringify({ action, input, requestId });
      if (desktop) await window.fioDesktop.pending.set(raw);
      else sessionStorage.setItem(pendingKey, raw);
    } catch {
      locked.current = false;
      setSaving(false);
      toast.error(
        desktop
          ? "Não foi possível guardar a confirmação no computador. Nenhuma operação foi enviada. Verifique o espaço em disco."
          : "Permita o armazenamento neste navegador para guardar a confirmação da operação. Nenhuma operação foi enviada.",
      );
      return null;
    }
    try {
      const response = await request("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, requestId }),
      });
      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error("Resposta incompleta do servidor.");
      }
      if (!response.ok) {
        if (response.status >= 500) {
          setUncertain({ action, input, requestId });
        } else await clearPending();
        toast.error(data.error || "Não foi possível salvar.");
        return null;
      }
      await clearPending();
      setState(data.state);
      toast.success(
        action === "sale.return"
          ? `Devolução registrada. Reembolso: ${money(data.result.refunded)}.`
          : "Operação registrada.",
      );
      return data;
    } catch {
      setUncertain({ action, input, requestId });
      toast.error(
        desktop
          ? "Não foi possível confirmar a operação. Confira a operação pendente para evitar duplicação."
          : "A conexão foi interrompida. Confira a operação pendente para evitar duplicação.",
      );
      return null;
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  function finishAction(action: string, data: any) {
    if (action === "sale.create") {
      setCart([]);
      setDiscount("0");
      setCustomerId("none");
      setNote("");
      setModal({ type: "receipt", data: data.result.saleId });
    } else setModal(null);
  }
  async function saveAction(action: string, input: any) {
    const data = await mutate(action, input);
    if (data) finishAction(action, data);
  }
  async function retryPending() {
    if (!uncertain) return;
    const data = await mutate(
      uncertain.action,
      uncertain.input,
      uncertain.requestId,
    );
    if (data) finishAction(uncertain.action, data);
  }
  function changeScreen(value: string) {
    setScreen(value);
    setQuery("");
    setCategory("all");
  }
  function add(p: Product) {
    if (saving || uncertain) return;
    if (!p.active || p.stock < 1) {
      toast.error("Esta peça está indisponível.");
      return;
    }
    setCart((old) => {
      const current = old.find((x) => x.productId === p.id);
      if ((current?.quantity || 0) >= p.stock) {
        toast.error("Quantidade máxima em estoque atingida.");
        return old;
      }
      return current
        ? old.map((x) =>
            x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x,
          )
        : [...old, { productId: p.id, price: p.price, quantity: 1 }];
    });
  }
  function readBarcode(e: FormEvent) {
    e.preventDefault();
    const code = barcode.trim();
    const p = s.products.find((p) => p.barcode === code);
    if (!p) {
      toast.error(`Código ${code || "vazio"} não cadastrado.`);
      scan.current?.select();
      return;
    }
    add(p);
    setBarcode("");
    scan.current?.focus();
  }
  function quantity(id: string, value: number) {
    if (saving || uncertain) return;
    const p = s.products.find((x) => x.id === id);
    if (!Number.isInteger(value) || value < 1) return;
    if (!p || value > p.stock) {
      toast.error("Quantidade supera o estoque disponível.");
      return;
    }
    setCart((old) =>
      old.map((x) => (x.productId === id ? { ...x, quantity: value } : x)),
    );
  }
  const subtotal = cart.reduce((n, x) => n + x.price * x.quantity, 0);
  let amounts = { subtotal, discount: 0, total: subtotal };
  let discountError = "";
  try {
    amounts = totals(subtotal, discountType, parseMoney(discount || "0"));
  } catch (e) {
    discountError = (e as Error).message;
  }
  function checkout() {
    if (!session || !cart.length || discountError || amounts.total < 1) return;
    if (cartNeedsReview) {
      toast.error("Revise os preços e quantidades da venda antes de receber.");
      return;
    }
    setPayments([
      {
        uid: crypto.randomUUID(),
        method: "cash",
        amount: decimal(amounts.total),
        installments: "1",
        dueDate: todayBR(),
      },
    ]);
    setModal({ type: "checkout", sessionId: session.id });
  }
  const cartNeedsReview = cart.some((line) => {
    const p = s.products.find((p) => p.id === line.productId);
    return !p || !p.active || p.price !== line.price || line.quantity > p.stock;
  });
  function reviewCart() {
    setCart((lines) =>
      lines.flatMap((line) => {
        const p = s.products.find((p) => p.id === line.productId);
        return p && p.active && p.stock > 0
          ? [
              {
                ...line,
                price: p.price,
                quantity: Math.min(line.quantity, p.stock),
              },
            ]
          : [];
      }),
    );
    toast.success("Venda atualizada com os preços e quantidades disponíveis.");
  }
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if (modal || uncertain || saving) return;
      if (e.key === "F2") {
        e.preventDefault();
        setScreen("pos");
        setTimeout(() => scan.current?.focus(), 0);
      }
      if (e.key === "F9" && screen === "pos") {
        e.preventDefault();
        checkout();
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    const tools = [
      {
        name: "search_clothing_stock",
        title: "Consultar estoque",
        description:
          "Consulta peças por código, nome, tamanho ou cor. Não altera dados.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async (input: any) => {
          if (typeof input?.query !== "string")
            throw new Error("Informe uma consulta.");
          const response = await request("/api/pos", { cache: "no-store" });
          if (!response.ok) throw new Error("Estoque indisponível.");
          const data: any = await response.json();
          setState(data);
          return data.products
            .filter((p: Product) =>
              normalize(
                [p.name, p.barcode, p.size, p.color].join(" "),
              ).includes(normalize(input.query)),
            )
            .map((p: Product) => ({
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              size: p.size,
              color: p.color,
              stock: p.stock,
              priceCents: p.price,
            }))
            .slice(0, 50);
        },
      },
      {
        name: "navigate_to_stock",
        title: "Abrir estoque",
        description: "Abre a tela de estoque sem alterar os dados.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: async () => {
          setScreen("inventory");
          setQuery("");
          return { screen: "inventory" };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => controller.abort();
  }, []);
  const today = todayBR();
  const salesToday = s.sales.filter(
    (x) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
      }).format(new Date(x.createdAt)) === today,
  );
  const todayRevenue =
    salesToday.reduce((n, x) => n + x.total, 0) -
    s.refunds
      .filter(
        (x) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
          }).format(new Date(x.createdAt)) === today,
      )
      .reduce((n, x) => n + x.value, 0);
  const activeProducts = s.products.filter((p) => p.active);
  const low = activeProducts.filter((p) => p.stock <= p.minimum);
  const stockTotal = activeProducts.reduce((n, p) => n + p.stock, 0);
  const filteredProducts = s.products.filter(
    (p) =>
      (screen === "pos"
        ? p.active
        : inventoryFilter === "low"
          ? p.active && p.stock <= p.minimum
          : inventoryFilter === "inactive"
            ? !p.active
            : true) &&
      (category === "all" || p.category === category) &&
      normalize(
        [p.name, p.barcode, p.category, p.size, p.color].join(" "),
      ).includes(normalize(query)),
  );
  function showReturn(sale: Sale) {
    const hasStore = sale.payments.some((p) => p.method === "store");
    setRefundLines(
      Object.fromEntries(
        sale.items
          .filter((i) => i.returned < i.quantity)
          .map((i) => [
            i.productId,
            {
              quantity: hasStore ? String(i.quantity - i.returned) : "0",
              restock: true,
            },
          ]),
      ),
    );
    setRefundMethod("cash");
    setModal({ type: "return", data: sale.id, sessionId: session?.id });
  }
  const viewedSale =
    modal?.type === "receipt" || modal?.type === "return"
      ? s.sales.find((x) => x.id === modal.data)
      : undefined;
  const selectedReturnValue =
    viewedSale?.items.reduce((total, item) => {
      const quantity = Number(refundLines[item.productId]?.quantity || 0);
      return (
        total +
        (Number.isInteger(quantity) &&
        quantity >= 0 &&
        quantity <= item.quantity - item.returned
          ? roundedRatio(item.net, item.returned + quantity, item.quantity) -
            item.refunded
          : 0)
      );
    }, 0) || 0;
  const refundPreview = Math.max(
    0,
    selectedReturnValue -
      (viewedSale?.payments.some((p) => p.method === "store")
        ? s.receivables
            .filter((r) => r.saleId === viewedSale.id && r.status === "open")
            .reduce((n, r) => n + r.amount - r.paid, 0)
        : 0),
  );
  const filteredSales = s.sales
    .filter((x) =>
      normalize(`${x.number} ${x.customerName} ${x.operator}`).includes(
        normalize(query),
      ),
    )
    .toReversed();
  const paySum = payments.reduce((n, p) => n + (parseMoney(p.amount) || 0), 0);
  const change = Math.max(0, paySum - amounts.total);
  const reportSales = s.sales.filter((x) => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date(x.createdAt));
    return day >= dateFrom && day <= dateTo;
  });
  const reportRefunds = s.refunds.filter((x) => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date(x.createdAt));
    return day >= dateFrom && day <= dateTo;
  });
  const reportGross = reportSales.reduce((n, x) => n + x.total, 0);
  const reportDiscount = reportSales.reduce((n, x) => n + x.discount, 0);
  const receipt = viewedSale;
  function submit(
    e: FormEvent<HTMLFormElement>,
    action: string,
    build: (f: FormData) => any,
  ) {
    e.preventDefault();
    if (saving || uncertain) return;
    const form = new FormData(e.currentTarget);
    void saveAction(action, build(form));
  }
  const methodOptions = (includeStore = false) =>
    (Object.entries(methodNames) as [Method, string][])
      .filter(([m]) => includeStore || m !== "store")
      .map(([value, label]) => ({ value, label }));
  return (
    <SidebarProvider style={{ "--sidebar-width": "230px" } as CSSProperties}>
      <Toaster position="top-right" richColors closeButton />
      <Sidebar className="fio-sidebar">
        <SidebarHeader>
          <div className="brand">
            <span className="brand-symbol">f.</span>
            <span>
              fio<span className="brand-caption">CAIXA & ESTOQUE</span>
            </span>
          </div>
          <div className="store-label">
            <span className="store-avatar">
              <ShoppingBag size={18} />
            </span>
            <span>
              {store.storeName}
              <small>Loja de roupas</small>
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">SUA LOJA</div>
          <Nav screen={screen} change={changeScreen} />
        </SidebarContent>
        <SidebarFooter>
          <button
            className={`nav-item footer-nav ${screen === "settings" ? "selected" : ""}`}
            onClick={() => changeScreen("settings")}
          >
            <Settings2 size={18} /> Configurações
          </button>
          <button
            className="nav-item footer-nav"
            onClick={() => setModal({ type: "help" })}
          >
            <CircleHelp size={18} /> Ajuda e atalhos
          </button>
          <div className="operator">
            <span>{operator.charAt(0).toUpperCase()}</span>
            <div title={operator}>
              {operator}
              <small>Operador</small>
            </div>
          </div>
          {!desktop && (
            <button className="nav-item footer-nav" disabled={saving || !!uncertain} onClick={async () => {
              try {
                const response = await fetch("/api/auth/logout", { method: "POST" });
                if (response.ok) window.location.assign("/login");
              } catch { setError("Não foi possível sair. Tente novamente."); }
            }}>
              <LogOut size={18} /> Sair
            </button>
          )}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="workspace">
        <header className="topbar">
          <div className="crumb">
            <SidebarTrigger className="mobile-menu" />
            <span>Minha loja</span>
            <ChevronRight size={14} />
            <b>
              {navigation.find((n) => n.id === screen)?.label ||
                "Configurações"}
            </b>
          </div>
          <div className="top-right">
            <span className={`status ${session ? "open" : ""}`}>
              <i />
              {session ? "Caixa aberto" : "Caixa fechado"}
            </span>
            <button
              className="icon-btn"
              aria-label="Atualizar dados"
              onClick={() => void load()}
              disabled={loading || saving}
            >
              <RefreshCw size={17} />
            </button>
            <span className="user-avatar">
              {operator.charAt(0).toUpperCase()}
            </span>
          </div>
        </header>
        <main className="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {new Intl.DateTimeFormat("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }).format(new Date())}
              </p>
              <h1>
                {screen === "pos"
                  ? "Frente de caixa"
                  : navigation.find((n) => n.id === screen)?.label ||
                    "Configurações"}
              </h1>
              <p>
                {screen === "pos"
                  ? "Tudo pronto para a próxima venda."
                  : screen === "inventory"
                    ? "Cada peça, tamanho e cor no lugar certo."
                    : screen === "cash"
                      ? "Acompanhe as entradas e saídas do seu caixa."
                      : screen === "sales"
                        ? "Consulte vendas, comprovantes e devoluções."
                        : screen === "customers"
                          ? "Os clientes da sua loja."
                          : screen === "receivables"
                            ? "Parcelas, vencimentos e recebimentos."
                            : screen === "reports"
                              ? "Veja os resultados da sua loja por período."
                              : "Personalize sua loja e exporte os dados."}
              </p>
            </div>
            <div>
              {screen === "inventory" && (
                <button
                  className="btn primary"
                  onClick={() => setModal({ type: "product" })}
                  disabled={!state}
                >
                  <Plus size={17} /> Nova peça
                </button>
              )}
              {screen === "customers" && (
                <button
                  className="btn primary"
                  onClick={() => setModal({ type: "customer" })}
                  disabled={!state}
                >
                  <Plus size={17} /> Novo cliente
                </button>
              )}
              {(screen === "pos" || screen === "cash") && (
                <button
                  className="btn outline"
                  disabled={!state || saving || !!uncertain}
                  onClick={() =>
                    session ? changeScreen("cash") : setModal({ type: "open" })
                  }
                >
                  <Wallet size={17} />
                  {session ? "Ver meu caixa" : "Abrir caixa"}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <CircleAlert size={20} />
              <span>{error}</span>
              <button onClick={() => void load()} className="btn outline">
                Tentar novamente
              </button>
            </div>
          )}
          {uncertain && (
            <div className="notice error" role="alert">
              <CircleAlert size={20} />
              <span>
                Uma operação aguarda confirmação. Confira antes de continuar; a
                tentativa usa o mesmo registro para evitar duplicação.
              </span>
              <button
                className="btn primary"
                onClick={() => void retryPending()}
                disabled={saving}
              >
                {saving ? "Conferindo…" : "Conferir operação"}
              </button>
            </div>
          )}
          {loading && !state ? (
            <div className="loading">
              <RefreshCw className="spin" /> Carregando sua loja…
            </div>
          ) : (
            state && (
              <>
                {(screen === "pos" || screen === "inventory") && (
                  <div className="metrics">
                    <Metric
                      label={
                        screen === "pos" ? "Vendas de hoje" : "Peças em estoque"
                      }
                      value={
                        screen === "pos"
                          ? money(todayRevenue)
                          : String(stockTotal)
                      }
                      sub={
                        screen === "pos"
                          ? `${salesToday.length} venda(s) registrada(s)`
                          : `${activeProducts.length} variações ativas`
                      }
                      icon={screen === "pos" ? ShoppingBag : Boxes}
                    />
                    <Metric
                      label={
                        screen === "pos"
                          ? "Dinheiro no caixa"
                          : "Custo do estoque"
                      }
                      value={
                        screen === "pos"
                          ? money(session ? expectedCash(s, session) : 0)
                          : money(
                              activeProducts.reduce(
                                (n, p) => n + p.stock * p.cost,
                                0,
                              ),
                            )
                      }
                      sub={
                        screen === "pos"
                          ? session
                            ? `Aberto às ${new Date(session.openedAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`
                            : "Abra o caixa para vender"
                          : "Quantidade × custo de compra"
                      }
                      icon={Banknote}
                    />
                    <button
                      className="metric metric-link"
                      onClick={() => {
                        changeScreen("inventory");
                        setInventoryFilter("low");
                      }}
                    >
                      <div>
                        <span>Precisam de reposição</span>
                        <strong>
                          {low.length}
                          <small className="inline-small">variações</small>
                        </strong>
                        <small>Peças no estoque mínimo ou esgotadas</small>
                      </div>
                      <span className="metric-icon amber">
                        <PackagePlus size={20} />
                      </span>
                    </button>
                  </div>
                )}
                {screen === "pos" && (
                  <div className="pos-layout">
                    <section className="panel catalog">
                      <div className="panel-heading">
                        <h2>Adicionar peças</h2>
                        <span className="meta">Leitor USB ou busca manual</span>
                      </div>
                      <form className="scan-box" onSubmit={readBarcode}>
                        <ScanBarcode size={25} />
                        <div>
                          <label htmlFor="barcode">Ler código de barras</label>
                          <input
                            id="barcode"
                            ref={scan}
                            value={barcode}
                            onChange={(e) => setBarcode(e.target.value)}
                            placeholder="Escaneie ou digite o código"
                            autoComplete="off"
                            disabled={saving || !!uncertain}
                          />
                        </div>
                        <button
                          className="scan-enter"
                          type="submit"
                          aria-label="Adicionar código lido"
                          disabled={saving || !!uncertain}
                        >
                          Enter <ChevronRight size={15} />
                        </button>
                      </form>
                      <div className="search-box">
                        <Search size={18} />
                        <input
                          aria-label="Buscar peças"
                          placeholder="Buscar nome, tamanho, cor ou código…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <div className="category-pills">
                        <button
                          className={category === "all" ? "active" : ""}
                          onClick={() => setCategory("all")}
                        >
                          Todas as peças
                        </button>
                        {[
                          ...new Set(
                            activeProducts
                              .map((p) => p.category)
                              .filter(Boolean),
                          ),
                        ].map((c) => (
                          <button
                            key={c}
                            className={category === c ? "active" : ""}
                            onClick={() => setCategory(c)}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      <div className="product-list">
                        {filteredProducts.length ? (
                          filteredProducts.map((p) => (
                            <button
                              className="product-row"
                              key={p.id}
                              onClick={() => add(p)}
                              disabled={p.stock === 0 || saving || !!uncertain}
                            >
                              <span
                                className={`piece-icon color-${p.name.length % 4}`}
                              >
                                <Shirt size={25} />
                              </span>
                              <span className="piece-info">
                                <b>{p.name}</b>
                                <small>
                                  {p.size} <span>·</span> {p.color}{" "}
                                  <span>·</span> {p.barcode}
                                </small>
                                <span
                                  className={`stock-text ${p.stock <= p.minimum ? "low" : ""}`}
                                >
                                  {p.stock} em estoque
                                </span>
                              </span>
                              <span className="piece-price">
                                {money(p.price)}
                                <span className="add-icon">
                                  <Plus size={17} />
                                </span>
                              </span>
                            </button>
                          ))
                        ) : (
                          <Blank
                            title={
                              activeProducts.length
                                ? "Nenhuma peça encontrada"
                                : "Seu estoque começa aqui"
                            }
                            text={
                              activeProducts.length
                                ? "Tente outro nome, tamanho ou código."
                                : "Cadastre suas roupas com tamanho, cor e código de barras para começar a vender."
                            }
                          >
                            {!activeProducts.length && (
                              <button
                                className="btn primary"
                                onClick={() => setModal({ type: "product" })}
                              >
                                <Plus size={17} /> Cadastrar primeira peça
                              </button>
                            )}
                          </Blank>
                        )}
                      </div>
                      <div className="catalog-foot">
                        <ScanBarcode size={16} /> Cada tamanho e cor usa um
                        código exclusivo.
                      </div>
                    </section>
                    <section className="panel sale-panel">
                      <div className="panel-heading">
                        <h2>
                          Venda atual{" "}
                          <span className="count">
                            {cart.reduce((n, x) => n + x.quantity, 0)}
                          </span>
                        </h2>
                        <button
                          className="icon-btn"
                          aria-label="Limpar venda"
                          disabled={!cart.length || saving || !!uncertain}
                          onClick={() => setConfirm(true)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                      <Choice
                        label="Cliente"
                        value={customerId}
                        onChange={setCustomerId}
                        options={[
                          { value: "none", label: "Consumidor" },
                          ...s.customers.map((c) => ({
                            value: c.id,
                            label: c.name,
                          })),
                        ]}
                      />
                      {cartNeedsReview && (
                        <div className="notice cart-notice">
                          <span>
                            Os preços ou o estoque mudaram. Revise a venda para
                            usar os valores atuais e ajustar as quantidades
                            disponíveis.
                          </span>
                          <button
                            className="btn outline small"
                            disabled={saving || !!uncertain}
                            onClick={reviewCart}
                          >
                            Atualizar itens da venda
                          </button>
                        </div>
                      )}
                      <div className="cart-items">
                        {cart.length ? (
                          cart.map((x) => {
                            const p = s.products.find(
                              (p) => p.id === x.productId,
                            );
                            return (
                              <div className="cart-item" key={x.productId}>
                                <div className="cart-line-top">
                                  <b>{p?.name || "Peça indisponível"}</b>
                                  <button
                                    className="icon-btn"
                                    aria-label={`Remover ${p?.name}`}
                                    disabled={saving || !!uncertain}
                                    onClick={() =>
                                      setCart((old) =>
                                        old.filter(
                                          (y) => y.productId !== x.productId,
                                        ),
                                      )
                                    }
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                                <small>
                                  {p?.size} · {p?.color} · {money(x.price)} /
                                  un.
                                </small>
                                <div className="cart-line-bottom">
                                  <div className="stepper">
                                    <button
                                      aria-label={`Diminuir ${p?.name}`}
                                      onClick={() =>
                                        quantity(x.productId, x.quantity - 1)
                                      }
                                      disabled={
                                        x.quantity <= 1 || saving || !!uncertain
                                      }
                                    >
                                      <Minus size={14} />
                                    </button>
                                    <input
                                      aria-label={`Quantidade de ${p?.name}`}
                                      value={x.quantity}
                                      type="number"
                                      min="1"
                                      max={p?.stock}
                                      onChange={(e) =>
                                        quantity(
                                          x.productId,
                                          Number(e.target.value),
                                        )
                                      }
                                      disabled={saving || !!uncertain}
                                    />
                                    <button
                                      aria-label={`Aumentar ${p?.name}`}
                                      onClick={() =>
                                        quantity(x.productId, x.quantity + 1)
                                      }
                                      disabled={saving || !!uncertain}
                                    >
                                      <Plus size={14} />
                                    </button>
                                  </div>
                                  <b>{money(x.price * x.quantity)}</b>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <Blank
                            title="Aguardando a primeira peça"
                            text="Leia um código de barras ou escolha uma peça ao lado."
                            icon={ShoppingBag}
                          />
                        )}
                      </div>
                      <div className="sale-summary">
                        <div className="summary-row">
                          <span>Subtotal</span>
                          <b>{money(subtotal)}</b>
                        </div>
                        <div className="discount-row">
                          <Choice
                            label="Desconto"
                            value={discountType}
                            onChange={setDiscountType}
                            options={[
                              { value: "amount", label: "Em reais (R$)" },
                              { value: "percent", label: "Percentual (%)" },
                            ]}
                          />
                          <Field
                            label="Valor"
                            inputMode="decimal"
                            value={discount}
                            onChange={(e) => setDiscount(e.target.value)}
                            disabled={saving || !!uncertain}
                          />
                        </div>
                        {discountError && (
                          <p className="field-error">{discountError}</p>
                        )}
                        <div className="summary-row muted">
                          <span>Desconto aplicado</span>
                          <span>− {money(amounts.discount)}</span>
                        </div>
                        <div className="total-row">
                          <span>Total da venda</span>
                          <strong>{money(amounts.total)}</strong>
                        </div>
                        <button
                          className="btn checkout-btn"
                          onClick={checkout}
                          disabled={
                            !session ||
                            !cart.length ||
                            !!discountError ||
                            amounts.total < 1 ||
                            saving ||
                            !!uncertain
                          }
                        >
                          <CreditCard size={20} /> Receber pagamento{" "}
                          <kbd>F9</kbd>
                        </button>
                        <p className="checkout-hint">
                          {session
                            ? "Dinheiro, Pix, cartão ou crediário"
                            : "Abra o caixa para finalizar a venda"}
                        </p>
                      </div>
                    </section>
                  </div>
                )}
                {screen === "inventory" && (
                  <section className="panel">
                    <Tabs defaultValue="products">
                      <div className="table-toolbar">
                        <TabsList>
                          <TabsTrigger value="products">
                            Peças e variações
                          </TabsTrigger>
                          <TabsTrigger value="movements">
                            Movimentações
                          </TabsTrigger>
                        </TabsList>
                        <button
                          className="btn outline small"
                          onClick={() =>
                            download(
                              `estoque-${today}.csv`,
                              csv([
                                [
                                  "Peça",
                                  "Código",
                                  "Categoria",
                                  "Tamanho",
                                  "Cor",
                                  "Custo",
                                  "Preço",
                                  "Estoque",
                                  "Mínimo",
                                  "Ativa",
                                ],
                                ...s.products.map((p) => [
                                  p.name,
                                  p.barcode,
                                  p.category,
                                  p.size,
                                  p.color,
                                  decimal(p.cost),
                                  decimal(p.price),
                                  p.stock,
                                  p.minimum,
                                  p.active ? "Sim" : "Não",
                                ]),
                              ]),
                              "text/csv;charset=utf-8",
                            )
                          }
                        >
                          <Download size={16} /> Exportar
                        </button>
                      </div>
                      <TabsContent value="products">
                        <div className="filter-toolbar">
                          <div className="search-box">
                            <Search size={17} />
                            <input
                              aria-label="Buscar no estoque"
                              placeholder="Nome, código, tamanho ou cor"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                            />
                          </div>
                          <Choice
                            label="Exibir"
                            value={inventoryFilter}
                            onChange={setInventoryFilter}
                            options={[
                              { value: "all", label: "Todas as peças" },
                              { value: "low", label: "Precisam de reposição" },
                              { value: "inactive", label: "Inativas" },
                            ]}
                          />
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Peça / código</TableHead>
                              <TableHead>Tamanho / cor</TableHead>
                              <TableHead>Preço</TableHead>
                              <TableHead>Estoque</TableHead>
                              <TableHead>Situação</TableHead>
                              <TableHead>Ações</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredProducts.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell>
                                  <b>{p.name}</b>
                                  <small className="cell-sub">
                                    {p.barcode} ·{" "}
                                    {p.category || "Sem categoria"}
                                  </small>
                                </TableCell>
                                <TableCell>
                                  <span className="size-tag">{p.size}</span>{" "}
                                  {p.color}
                                </TableCell>
                                <TableCell>
                                  <b>{money(p.price)}</b>
                                  <small className="cell-sub">
                                    Custo {money(p.cost)}
                                  </small>
                                </TableCell>
                                <TableCell>
                                  <b>{p.stock}</b>
                                  <small className="cell-sub">
                                    Mínimo {p.minimum}
                                  </small>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={`badge ${!p.active ? "neutral" : p.stock <= p.minimum ? "warning" : "success"}`}
                                  >
                                    {stockLabel(p)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="actions">
                                    <button
                                      className="icon-btn"
                                      title="Editar peça"
                                      aria-label={`Editar ${p.name}`}
                                      onClick={() =>
                                        setModal({ type: "product", data: p })
                                      }
                                    >
                                      <Pencil size={16} />
                                    </button>
                                    <button
                                      className="btn outline small"
                                      onClick={() =>
                                        setModal({ type: "stock", data: p })
                                      }
                                    >
                                      <Plus size={15} /> Movimentar
                                    </button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {!filteredProducts.length && (
                          <Blank
                            title="Nenhuma peça cadastrada nesta lista"
                            text="Cadastre uma roupa ou altere os filtros."
                          />
                        )}
                      </TabsContent>
                      <TabsContent value="movements">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Data</TableHead>
                              <TableHead>Peça</TableHead>
                              <TableHead>Movimento</TableHead>
                              <TableHead>Saldo</TableHead>
                              <TableHead>Motivo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {s.movements.toReversed().map((m) => (
                              <TableRow key={m.id}>
                                <TableCell>{dateBR(m.createdAt)}</TableCell>
                                <TableCell>{m.name}</TableCell>
                                <TableCell
                                  className={
                                    m.quantity > 0 ? "positive" : "negative"
                                  }
                                >
                                  {m.quantity > 0 ? "+" : ""}
                                  {m.quantity}
                                </TableCell>
                                <TableCell>{m.balance}</TableCell>
                                <TableCell>
                                  {m.reason}
                                  <small className="cell-sub">
                                    {m.operator}
                                  </small>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {!s.movements.length && (
                          <Blank
                            title="Nenhuma movimentação"
                            text="Entradas, saídas e vendas aparecerão aqui."
                            icon={Boxes}
                          />
                        )}
                      </TabsContent>
                    </Tabs>
                  </section>
                )}
                {screen === "sales" && (
                  <section className="panel">
                    <div className="table-toolbar">
                      <div className="search-box">
                        <Search size={18} />
                        <input
                          aria-label="Buscar vendas"
                          placeholder="Número da venda, cliente ou operador"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <span className="meta">
                        {filteredSales.length} venda(s)
                      </span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Venda</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Pagamento</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Situação</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSales.map((sale) => (
                          <TableRow key={sale.id}>
                            <TableCell>
                              <b>#{String(sale.number).padStart(4, "0")}</b>
                              <small className="cell-sub">
                                {dateBR(sale.createdAt)}
                              </small>
                            </TableCell>
                            <TableCell>{sale.customerName}</TableCell>
                            <TableCell>
                              {[
                                ...new Set(
                                  sale.payments.map(
                                    (p) => methodNames[p.method],
                                  ),
                                ),
                              ].join(" + ")}
                            </TableCell>
                            <TableCell>
                              <b>{money(sale.total)}</b>
                            </TableCell>
                            <TableCell>
                              <span
                                className={`badge ${sale.status === "completed" ? "success" : "neutral"}`}
                              >
                                {saleLabel(sale)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <button
                                className="btn outline small"
                                onClick={() =>
                                  setModal({ type: "receipt", data: sale.id })
                                }
                              >
                                Ver venda <ChevronRight size={15} />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!filteredSales.length && (
                      <Blank
                        title="As vendas aparecerão aqui"
                        text="Finalize a primeira venda na frente de caixa."
                        icon={Wallet}
                      />
                    )}
                  </section>
                )}
                {screen === "customers" && (
                  <section className="panel">
                    <div className="table-toolbar">
                      <div className="search-box">
                        <Search size={18} />
                        <input
                          aria-label="Buscar clientes"
                          placeholder="Buscar nome, telefone ou documento"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <span className="meta">
                        {s.customers.length} cliente(s)
                      </span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Contato</TableHead>
                          <TableHead>Compras</TableHead>
                          <TableHead>Crediário em aberto</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.customers
                          .filter((c) =>
                            normalize(
                              [c.name, c.phone, c.document].join(" "),
                            ).includes(normalize(query)),
                          )
                          .map((c) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                <b>{c.name}</b>
                                <small className="cell-sub">
                                  {c.document || "Sem documento"}
                                </small>
                              </TableCell>
                              <TableCell>
                                {c.phone || "—"}
                                <small className="cell-sub">{c.email}</small>
                              </TableCell>
                              <TableCell>
                                {
                                  s.sales.filter((x) => x.customerId === c.id)
                                    .length
                                }
                              </TableCell>
                              <TableCell>
                                {money(
                                  s.receivables
                                    .filter(
                                      (r) =>
                                        r.customerId === c.id &&
                                        r.status === "open",
                                    )
                                    .reduce((n, r) => n + r.amount - r.paid, 0),
                                )}
                              </TableCell>
                              <TableCell>
                                <button
                                  className="icon-btn"
                                  aria-label={`Editar ${c.name}`}
                                  onClick={() =>
                                    setModal({ type: "customer", data: c })
                                  }
                                >
                                  <Pencil size={16} />
                                </button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                    {!s.customers.length && (
                      <Blank
                        title="Conheça quem compra com você"
                        text="Cadastre clientes para identificar vendas e oferecer crediário."
                        icon={Users}
                      />
                    )}
                  </section>
                )}
                {screen === "receivables" && (
                  <>
                    <div className="metrics">
                      <Metric
                        label="A receber"
                        value={money(
                          s.receivables
                            .filter((r) => r.status === "open")
                            .reduce((n, r) => n + r.amount - r.paid, 0),
                        )}
                        icon={CreditCard}
                      />
                      <Metric
                        label="Em atraso"
                        value={money(
                          s.receivables
                            .filter(
                              (r) => r.status === "open" && r.dueDate < today,
                            )
                            .reduce((n, r) => n + r.amount - r.paid, 0),
                        )}
                        icon={CircleAlert}
                      />
                      <Metric
                        label="Parcelas em aberto"
                        value={String(
                          s.receivables.filter((r) => r.status === "open")
                            .length,
                        )}
                        icon={Users}
                      />
                    </div>
                    <section className="panel">
                      <div className="table-toolbar">
                        <div className="search-box">
                          <Search size={18} />
                          <input
                            aria-label="Buscar parcelas"
                            placeholder="Buscar cliente"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        <span className="meta">
                          Recebimentos exigem caixa aberto
                        </span>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Cliente / venda</TableHead>
                            <TableHead>Parcela</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead>Saldo</TableHead>
                            <TableHead>Situação</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {s.receivables
                            .filter((r) =>
                              normalize(r.customerName).includes(
                                normalize(query),
                              ),
                            )
                            .toSorted((a, b) =>
                              a.dueDate.localeCompare(b.dueDate),
                            )
                            .map((r) => (
                              <TableRow key={r.id}>
                                <TableCell>
                                  <b>{r.customerName}</b>
                                  <small className="cell-sub">
                                    Venda #
                                    {
                                      s.sales.find((x) => x.id === r.saleId)
                                        ?.number
                                    }
                                  </small>
                                </TableCell>
                                <TableCell>{r.number}</TableCell>
                                <TableCell>
                                  {dateBR(r.dueDate, false)}
                                </TableCell>
                                <TableCell>
                                  <b>
                                    {money(
                                      r.status === "cancelled"
                                        ? 0
                                        : r.amount - r.paid,
                                    )}
                                  </b>
                                  <small className="cell-sub">
                                    Original {money(r.amount)}
                                  </small>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={`badge ${r.status === "open" ? (r.dueDate < today ? "danger" : "warning") : "neutral"}`}
                                  >
                                    {r.status === "paid"
                                      ? "Paga"
                                      : r.status === "cancelled"
                                        ? "Cancelada"
                                        : r.dueDate < today
                                          ? "Em atraso"
                                          : "Em aberto"}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  {r.status === "open" && (
                                    <button
                                      className="btn outline small"
                                      disabled={
                                        !session || saving || !!uncertain
                                      }
                                      onClick={() =>
                                        setModal({
                                          type: "receive",
                                          data: r,
                                          sessionId: session?.id,
                                        })
                                      }
                                    >
                                      Receber
                                    </button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      {!s.receivables.length && (
                        <Blank
                          title="Nenhuma parcela por aqui"
                          text="Vendas no crediário geram parcelas com vencimento mensal."
                          icon={CreditCard}
                        />
                      )}
                    </section>
                  </>
                )}
                {screen === "cash" && (
                  <>
                    <div className="metrics">
                      <Metric
                        label="Dinheiro esperado"
                        value={money(session ? expectedCash(s, session) : 0)}
                        sub="Somente dinheiro físico"
                        icon={Banknote}
                      />
                      <Metric
                        label="Fundo inicial"
                        value={money(session?.opening || 0)}
                        sub={
                          session ? dateBR(session.openedAt) : "Caixa fechado"
                        }
                        icon={Wallet}
                      />
                      <Metric
                        label="Cartão e Pix no período"
                        value={money(
                          s.cashEntries
                            .filter(
                              (e) =>
                                e.sessionId === session?.id &&
                                e.method !== "cash",
                            )
                            .reduce((n, e) => n + e.amount, 0),
                        )}
                        sub="Entradas menos reembolsos"
                        icon={CreditCard}
                      />
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>
                          {session
                            ? "Movimentações do caixa aberto"
                            : "Nenhum caixa aberto"}
                        </h2>
                        <div className="actions">
                          {session ? (
                            <>
                              <button
                                className="btn outline small"
                                onClick={() =>
                                  setModal({
                                    type: "cash-move",
                                    data: "supply",
                                    sessionId: session?.id,
                                  })
                                }
                              >
                                <ArrowDownLeft size={16} /> Suprimento
                              </button>
                              <button
                                className="btn outline small"
                                onClick={() =>
                                  setModal({
                                    type: "cash-move",
                                    data: "withdrawal",
                                    sessionId: session?.id,
                                  })
                                }
                              >
                                <ArrowUpRight size={16} /> Sangria
                              </button>
                              <button
                                className="btn primary small"
                                onClick={() =>
                                  setModal({
                                    type: "close",
                                    sessionId: session?.id,
                                  })
                                }
                              >
                                Fechar caixa
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn primary"
                              onClick={() => setModal({ type: "open" })}
                            >
                              Abrir caixa
                            </button>
                          )}
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Movimentação</TableHead>
                            <TableHead>Forma</TableHead>
                            <TableHead>Valor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {s.cashEntries
                            .filter((e) => e.sessionId === session?.id)
                            .toReversed()
                            .map((e) => (
                              <TableRow key={e.id}>
                                <TableCell>{dateBR(e.createdAt)}</TableCell>
                                <TableCell>{e.note}</TableCell>
                                <TableCell>{methodNames[e.method]}</TableCell>
                                <TableCell
                                  className={
                                    e.amount >= 0 ? "positive" : "negative"
                                  }
                                >
                                  {money(e.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      {!s.cashEntries.some(
                        (e) => e.sessionId === session?.id,
                      ) && (
                        <Blank
                          title="Nenhuma movimentação neste caixa"
                          text="Vendas, recebimentos, sangrias e suprimentos aparecerão aqui."
                          icon={Banknote}
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Histórico de fechamentos</h2>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Abertura / fechamento</TableHead>
                            <TableHead>Operador</TableHead>
                            <TableHead>Esperado</TableHead>
                            <TableHead>Contado</TableHead>
                            <TableHead>Diferença</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {s.sessions
                            .filter((x) => x.closedAt)
                            .toReversed()
                            .map((x) => (
                              <TableRow key={x.id}>
                                <TableCell>
                                  {dateBR(x.openedAt)}
                                  <small className="cell-sub">
                                    {dateBR(x.closedAt!)}
                                  </small>
                                </TableCell>
                                <TableCell>{x.operator}</TableCell>
                                <TableCell>{money(x.expected!)}</TableCell>
                                <TableCell>{money(x.counted!)}</TableCell>
                                <TableCell
                                  className={
                                    x.difference === 0 ? "positive" : "negative"
                                  }
                                >
                                  {money(x.difference!)}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      {!s.sessions.some((x) => x.closedAt) && (
                        <p className="empty-note">
                          Os caixas fechados aparecerão aqui.
                        </p>
                      )}
                    </section>
                  </>
                )}
                {screen === "reports" && (
                  <>
                    <div className="report-filter">
                      <Field
                        label="De"
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                      />
                      <Field
                        label="Até"
                        type="date"
                        min={dateFrom}
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                      />
                      <button
                        className="btn outline"
                        onClick={() =>
                          download(
                            `vendas-${dateFrom}-${dateTo}.csv`,
                            csv([
                              [
                                "Venda",
                                "Data",
                                "Cliente",
                                "Subtotal",
                                "Desconto",
                                "Total",
                                "Situação",
                              ],
                              ...reportSales.map((x) => [
                                x.number,
                                dateBR(x.createdAt),
                                x.customerName,
                                decimal(x.subtotal),
                                decimal(x.discount),
                                decimal(x.total),
                                saleLabel(x),
                              ]),
                            ]),
                            "text/csv;charset=utf-8",
                          )
                        }
                      >
                        <Download size={16} /> Exportar vendas
                      </button>
                    </div>
                    <div className="metrics">
                      <Metric
                        label="Vendas no período"
                        value={money(reportGross)}
                        sub={`${reportSales.length} vendas antes de devoluções`}
                        icon={ShoppingBag}
                      />
                      <Metric
                        label="Vendas menos devoluções"
                        value={money(
                          reportGross -
                            reportRefunds.reduce((n, r) => n + r.value, 0),
                        )}
                        sub={`${money(reportDiscount)} em descontos no período`}
                        icon={Wallet}
                      />
                      <Metric
                        label="Ticket médio"
                        value={money(
                          reportSales.length
                            ? Math.round(reportGross / reportSales.length)
                            : 0,
                        )}
                        icon={ChartNoAxesCombined}
                      />
                    </div>
                    <div className="report-grid">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Peças vendidas · saldo após devoluções</h2>
                        </div>
                        {(() => {
                          const ranked = new Map<
                            string,
                            { name: string; qty: number; value: number }
                          >();
                          reportSales.forEach((sale) =>
                            sale.items.forEach((i) => {
                              const old = ranked.get(i.productId) || {
                                name: `${i.name} · ${i.size} · ${i.color}`,
                                qty: 0,
                                value: 0,
                              };
                              old.qty += i.quantity - i.returned;
                              old.value += i.net - i.refunded;
                              ranked.set(i.productId, old);
                            }),
                          );
                          const rows = [...ranked.values()]
                            .toSorted((a, b) => b.qty - a.qty)
                            .slice(0, 8);
                          return rows.length ? (
                            <div className="ranking">
                              {rows.map((x, i) => (
                                <div key={x.name}>
                                  <span className="rank-number">{i + 1}</span>
                                  <div>
                                    <b>{x.name}</b>
                                    <div className="bar-track">
                                      <i
                                        style={{
                                          width: `${(Math.max(0, x.qty) / Math.max(1, rows[0].qty)) * 100}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <span>
                                    {x.qty} un.<small>{money(x.value)}</small>
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Blank
                              title="Sem vendas no período"
                              text="Escolha outro intervalo ou registre sua primeira venda."
                              icon={ChartNoAxesCombined}
                            />
                          );
                        })()}
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Pagamentos registrados</h2>
                        </div>
                        <div className="payment-report">
                          {Object.entries(methodNames).map(([key, label]) => (
                            <div key={key}>
                              <span>{label}</span>
                              <b>
                                {money(
                                  key === "store"
                                    ? reportSales.reduce(
                                        (n, x) =>
                                          n +
                                          x.payments
                                            .filter((p) => p.method === "store")
                                            .reduce((a, p) => a + p.amount, 0),
                                        0,
                                      )
                                    : s.cashEntries
                                        .filter((e) => {
                                          const day = new Intl.DateTimeFormat(
                                            "en-CA",
                                            { timeZone: "America/Sao_Paulo" },
                                          ).format(new Date(e.createdAt));
                                          return (
                                            e.method === key &&
                                            [
                                              "sale",
                                              "refund",
                                              "receive",
                                            ].includes(e.type) &&
                                            day >= dateFrom &&
                                            day <= dateTo
                                          );
                                        })
                                        .reduce((n, e) => n + e.amount, 0),
                                )}
                              </b>
                            </div>
                          ))}
                        </div>
                        <p className="report-note">
                          Crediário mostra o valor contratado. Outros meios
                          incluem recebimentos e descontam reembolsos.{" "}
                          {reportRefunds.length} devolução(ões) no período.
                        </p>
                      </section>
                    </div>
                  </>
                )}
                {screen === "settings" && (
                  <div className="settings-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Dados da loja</h2>
                      </div>
                      <form
                        className="settings-form"
                        onSubmit={(e) =>
                          submit(e, "settings.save", (f) => ({
                            storeName: f.get("storeName"),
                            contact: f.get("contact"),
                            footer: f.get("footer"),
                          }))
                        }
                      >
                        <fieldset disabled={saving || !!uncertain}>
                          <Field
                            label="Nome da loja"
                            name="storeName"
                            defaultValue={store.storeName}
                            required
                            maxLength={200}
                          />
                          <Field
                            label="Contato / endereço no comprovante"
                            name="contact"
                            defaultValue={store.contact}
                            maxLength={200}
                          />
                          <Field
                            label="Mensagem do comprovante"
                            name="footer"
                            defaultValue={store.footer}
                            maxLength={300}
                          />
                          <button className="btn primary" type="submit">
                            {saving ? "Salvando…" : "Salvar dados"}
                          </button>
                        </fieldset>
                      </form>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Dados e equipamentos</h2>
                      </div>
                      <div className="settings-form">
                        <h3>Cópia dos dados</h3>
                        <p>
                          Exporte cadastros, vendas, estoque e caixa em um
                          arquivo JSON para guardar uma cópia.
                        </p>
                        <button
                          className="btn outline"
                          onClick={() =>
                            download(
                              `fio-backup-${today}.json`,
                              JSON.stringify(
                                {
                                  format: "fio-pos-export",
                                  version: 1,
                                  exportedAt: new Date().toISOString(),
                                  data: s,
                                },
                                null,
                                2,
                              ),
                            )
                          }
                        >
                          <Download size={17} /> Exportar todos os dados
                        </button>
                        <hr />
                        <h3>Leitor de códigos de barras</h3>
                        <p>
                          Use um leitor USB configurado como teclado (HID), com
                          Enter ao final da leitura. Clique no campo de código
                          ou pressione F2 antes de ler.
                        </p>
                        <p className="report-note">
                          {desktop
                            ? "Os dados ficam neste computador e o caixa funciona sem internet. Use Arquivos e backup para salvar uma cópia fora do computador. "
                            : "Os dados ficam no banco de dados da aplicação e exigem internet. "}
                          Cada tamanho e cor deve ter um código único. Cartão e
                          Pix são registros manuais. Comprovantes são não
                          fiscais.
                        </p>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            fio <span>·</span> Sua loja em dia.
          </span>
          <span>
            <kbd>F2</kbd> Ler código <span>·</span> <kbd>F9</kbd> Pagamento
          </span>
        </footer>
      </SidebarInset>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open && !saving && !uncertain) setModal(null);
        }}
      >
        <DialogContent
          className={`fio-dialog ${modal?.type === "checkout" ? "payment-dialog" : ""}`}
          showCloseButton={!saving && !uncertain}
        >
          <DialogTitle>
            {modal?.type === "product"
              ? modal.data
                ? "Editar peça"
                : "Cadastrar nova peça"
              : modal?.type === "stock"
                ? "Movimentar estoque"
                : modal?.type === "customer"
                  ? modal.data
                    ? "Editar cliente"
                    : "Cadastrar cliente"
                  : modal?.type === "checkout"
                    ? "Receber pagamento"
                    : modal?.type === "open"
                      ? "Abrir caixa"
                      : modal?.type === "close"
                        ? "Fechar caixa"
                        : modal?.type === "cash-move"
                          ? modal.data === "supply"
                            ? "Suprimento de caixa"
                            : "Sangria de caixa"
                          : modal?.type === "receipt"
                            ? `Venda #${String(receipt?.number || "").padStart(4, "0")}`
                            : modal?.type === "return"
                              ? "Devolver peças"
                              : modal?.type === "receive"
                                ? "Receber parcela"
                                : "Ajuda e atalhos"}
          </DialogTitle>
          <DialogDescription>
            {modal?.type === "checkout"
              ? "Confira o recebimento antes de concluir a venda."
              : modal?.type === "product"
                ? "Cadastre uma combinação de tamanho e cor por código."
                : modal?.type === "receipt"
                  ? receipt
                    ? saleLabel(receipt)
                    : "Venda indispon?vel"
                  : modal?.type === "return"
                    ? "Informe as peças recebidas e a forma de reembolso."
                    : modal?.type === "close"
                      ? "Conte o dinheiro físico e confira a diferença."
                      : "Preencha e confira os dados abaixo."}
          </DialogDescription>
          {uncertain && (
            <div className="notice error">
              <span>Confirme a operação pendente.</span>
              <button
                className="btn primary small"
                disabled={saving}
                onClick={() => void retryPending()}
              >
                Conferir operação
              </button>
            </div>
          )}
          {modal?.type === "product" && (
            <ProductForm
              key={modal.data?.id || "new"}
              product={modal.data}
              disabled={saving || !!uncertain}
              onSubmit={(e) =>
                submit(e, "product.save", (f) => ({
                  id: modal.data?.id,
                  version: modal.data?.version,
                  name: f.get("name"),
                  barcode: f.get("barcode"),
                  category: f.get("category"),
                  size: f.get("size"),
                  color: f.get("color"),
                  price: parseMoney(String(f.get("price"))),
                  cost: parseMoney(String(f.get("cost"))),
                  stock: Number(f.get("stock")),
                  minimum: Number(f.get("minimum")),
                  active: f.get("active") === "on",
                }))
              }
            />
          )}
          {modal?.type === "stock" && (
            <form
              onSubmit={(e) =>
                submit(e, "stock.move", (f) => ({
                  id: modal.data.id,
                  direction: f.get("direction"),
                  quantity: Number(f.get("quantity")),
                  reason: f.get("reason"),
                }))
              }
            >
              <fieldset disabled={saving || !!uncertain}>
                <div className="selected-piece">
                  <Shirt size={22} />
                  <div>
                    <b>{modal.data.name}</b>
                    <small>
                      {modal.data.size} · {modal.data.color} ·{" "}
                      {modal.data.stock} em estoque
                    </small>
                  </div>
                </div>
                <FormChoice
                  label="Movimentação"
                  name="direction"
                  initial="in"
                  options={[
                    { value: "in", label: "Entrada de peças" },
                    { value: "out", label: "Saída / perda / ajuste" },
                  ]}
                />
                <Field
                  label="Quantidade"
                  name="quantity"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue="1"
                  required
                />
                <Field
                  label="Motivo"
                  name="reason"
                  placeholder="Ex.: compra do fornecedor, peça danificada"
                  maxLength={200}
                  required
                />
                <button type="submit" className="btn primary full">
                  Registrar movimento
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "customer" && (
            <form
              onSubmit={(e) =>
                submit(e, "customer.save", (f) => ({
                  id: modal.data?.id,
                  version: modal.data?.version,
                  name: f.get("name"),
                  phone: f.get("phone"),
                  email: f.get("email"),
                  document: f.get("document"),
                }))
              }
            >
              <fieldset disabled={saving || !!uncertain}>
                <Field
                  label="Nome do cliente"
                  name="name"
                  defaultValue={modal.data?.name || ""}
                  required
                  maxLength={200}
                />
                <div className="form-grid">
                  <Field
                    label="Telefone"
                    name="phone"
                    type="tel"
                    defaultValue={modal.data?.phone || ""}
                    maxLength={40}
                  />
                  <Field
                    label="CPF / documento (opcional)"
                    name="document"
                    defaultValue={modal.data?.document || ""}
                    maxLength={30}
                  />
                </div>
                <Field
                  label="E-mail (opcional)"
                  name="email"
                  type="email"
                  defaultValue={modal.data?.email || ""}
                  maxLength={100}
                />
                <button className="btn primary full" type="submit">
                  Salvar cliente
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "open" && (
            <form
              onSubmit={(e) =>
                submit(e, "cash.open", (f) => ({
                  opening: parseMoney(String(f.get("opening"))),
                }))
              }
            >
              <fieldset disabled={saving || !!uncertain}>
                <Field
                  label="Fundo inicial em dinheiro (R$)"
                  name="opening"
                  defaultValue="0,00"
                  inputMode="decimal"
                  required
                />
                <p className="form-hint">
                  Informe o dinheiro disponível para troco no início do
                  expediente.
                </p>
                <button className="btn primary full" type="submit">
                  Abrir caixa
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "cash-move" && (
            <form
              onSubmit={(e) =>
                submit(e, "cash.move", (f) => ({
                  type: modal.data,
                  sessionId: modal.sessionId,
                  amount: parseMoney(String(f.get("amount"))),
                  note: f.get("note"),
                }))
              }
            >
              <fieldset disabled={saving || !!uncertain}>
                <Field
                  label="Valor em dinheiro (R$)"
                  name="amount"
                  inputMode="decimal"
                  required
                />
                <Field label="Motivo" name="note" required maxLength={200} />
                <p className="form-hint">
                  {modal.data === "supply"
                    ? "Suprimento adiciona dinheiro ao caixa."
                    : "Sangria retira dinheiro do caixa."}
                </p>
                <button className="btn primary full" type="submit">
                  Confirmar movimentação
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "close" && session && (
            <CloseForm
              expected={expectedCash(s, session)}
              disabled={saving || !!uncertain}
              onSubmit={(e) =>
                submit(e, "cash.close", (f) => ({
                  id: modal.sessionId,
                  counted: parseMoney(String(f.get("counted"))),
                }))
              }
            />
          )}
          {modal?.type === "receive" && (
            <form
              onSubmit={(e) =>
                submit(e, "receivable.receive", (f) => ({
                  id: modal.data.id,
                  sessionId: modal.sessionId,
                  amount: parseMoney(String(f.get("amount"))),
                  method: f.get("method"),
                }))
              }
            >
              <fieldset disabled={saving || !!uncertain}>
                <div className="selected-piece">
                  <Users size={22} />
                  <div>
                    <b>{modal.data.customerName}</b>
                    <small>
                      Parcela {modal.data.number} · Vencimento{" "}
                      {dateBR(modal.data.dueDate, false)}
                    </small>
                  </div>
                </div>
                <Field
                  label="Valor recebido (R$)"
                  name="amount"
                  defaultValue={decimal(modal.data.amount - modal.data.paid)}
                  inputMode="decimal"
                  required
                />
                <FormChoice
                  label="Forma de recebimento"
                  name="method"
                  initial="cash"
                  options={methodOptions().filter((o) => o.value !== "credit")}
                />
                <button className="btn primary full" type="submit">
                  Registrar recebimento
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "checkout" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (cartNeedsReview || saving || uncertain) {
                  toast.error("Revise a venda antes de confirmar.");
                  return;
                }
                void saveAction("sale.create", {
                  sessionId: modal.sessionId,
                  items: cart,
                  customerId: customerId === "none" ? "" : customerId,
                  discountType,
                  discount: parseMoney(discount || "0"),
                  expectedTotal: amounts.total,
                  note,
                  payments: payments.map((p) => ({
                    method: p.method,
                    amount: parseMoney(p.amount),
                    installments: Number(p.installments),
                    dueDate: p.dueDate,
                  })),
                });
              }}
            >
              <fieldset disabled={saving || !!uncertain}>
                {cartNeedsReview && (
                  <div className="notice">
                    <span>
                      Preços ou quantidades mudaram enquanto o pagamento estava
                      aberto.
                    </span>
                    <button
                      className="btn outline"
                      type="button"
                      onClick={() => setModal(null)}
                    >
                      Revisar venda
                    </button>
                  </div>
                )}
                <div className="payment-total">
                  <span>Total a receber</span>
                  <strong>{money(amounts.total)}</strong>
                  <small>
                    {cart.reduce((n, x) => n + x.quantity, 0)} peças ·{" "}
                    {s.customers.find((c) => c.id === customerId)?.name ||
                      "Consumidor"}
                  </small>
                </div>
                {payments.map((p, index) => (
                  <div className="payment-entry" key={p.uid}>
                    <div className="payment-fields">
                      <Choice
                        label="Forma de pagamento"
                        value={p.method}
                        onChange={(value) =>
                          setPayments((rows) =>
                            rows.map((row) =>
                              row.uid === p.uid
                                ? {
                                    ...row,
                                    method: value as Method,
                                    installments: "1",
                                  }
                                : row,
                            ),
                          )
                        }
                        options={methodOptions(true)}
                      />
                      <Field
                        label="Valor (R$)"
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) =>
                          setPayments((rows) =>
                            rows.map((row) =>
                              row.uid === p.uid
                                ? { ...row, amount: e.target.value }
                                : row,
                            ),
                          )
                        }
                        required
                      />
                      {payments.length > 1 && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remover pagamento ${index + 1}`}
                          onClick={() =>
                            setPayments((rows) =>
                              rows.filter((row) => row.uid !== p.uid),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    {(p.method === "credit" || p.method === "store") && (
                      <>
                        <div className="form-grid">
                          <Choice
                            label="Parcelas sem juros"
                            value={p.installments}
                            onChange={(value) =>
                              setPayments((rows) =>
                                rows.map((row) =>
                                  row.uid === p.uid
                                    ? { ...row, installments: value }
                                    : row,
                                ),
                              )
                            }
                            options={Array.from({ length: 12 }, (_, i) => ({
                              value: String(i + 1),
                              label: `${i + 1}x`,
                            }))}
                          />
                          {p.method === "store" && (
                            <Field
                              label="Primeiro vencimento"
                              type="date"
                              value={p.dueDate}
                              min={today}
                              onChange={(e) =>
                                setPayments((rows) =>
                                  rows.map((row) =>
                                    row.uid === p.uid
                                      ? { ...row, dueDate: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                              required
                            />
                          )}
                        </div>
                        <p className="installment-preview">
                          {(() => {
                            const cents = parseMoney(p.amount);
                            return Number.isSafeInteger(cents)
                              ? splitInstallments(cents, Number(p.installments))
                                  .map((v, i) => `${i + 1}ª: ${money(v)}`)
                                  .join(" · ")
                              : "Informe um valor válido";
                          })()}
                        </p>
                        {p.method === "store" && customerId === "none" && (
                          <p className="field-error">
                            Escolha um cliente na venda para usar crediário.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn outline small"
                  disabled={payments.length >= 10}
                  onClick={() =>
                    setPayments((rows) => [
                      ...rows,
                      {
                        uid: crypto.randomUUID(),
                        method: "pix",
                        amount: decimal(Math.max(0, amounts.total - paySum)),
                        installments: "1",
                        dueDate: today,
                      },
                    ])
                  }
                >
                  <Plus size={16} /> Dividir entre formas de pagamento
                </button>
                <Field
                  label="Observação (opcional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                />
                <div className="summary-row">
                  <span>
                    {paySum < amounts.total
                      ? "Falta receber"
                      : "Troco em dinheiro"}
                  </span>
                  <strong
                    className={paySum < amounts.total ? "negative" : "positive"}
                  >
                    {money(
                      paySum < amounts.total ? amounts.total - paySum : change,
                    )}
                  </strong>
                </div>
                <p className="form-hint">
                  Confira o dinheiro recebido e a aprovação de cartão/Pix no
                  equipamento antes de confirmar.
                </p>
                <button
                  type="submit"
                  className="btn primary full"
                  disabled={
                    paySum < amounts.total ||
                    payments.some(
                      (p) =>
                        !Number.isFinite(parseMoney(p.amount)) ||
                        parseMoney(p.amount) < 1 ||
                        (p.method === "store" && customerId === "none"),
                    )
                  }
                >
                  {saving
                    ? "Registrando…"
                    : "Confirmar recebimento e finalizar venda"}{" "}
                  <Check size={17} />
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "receipt" && receipt && (
            <>
              <div className="receipt">
                <div className="receipt-head">
                  <b>{store.storeName}</b>
                  <span>{store.contact}</span>
                  <small>COMPROVANTE NÃO FISCAL</small>
                </div>
                <p>
                  Venda #{String(receipt.number).padStart(4, "0")} ·{" "}
                  {dateBR(receipt.createdAt)}
                  <br />
                  Cliente: {receipt.customerName}
                  <br />
                  Operador: {receipt.operator}
                </p>
                <div className="receipt-items">
                  {receipt.items.map((i) => (
                    <div key={i.productId}>
                      <div>
                        <b>{i.name}</b>
                        <small>
                          {i.size} · {i.color} · {i.quantity} × {money(i.price)}
                        </small>
                        {i.returned > 0 && (
                          <small>{i.returned} unidade(s) devolvida(s)</small>
                        )}
                      </div>
                      <b>{money(i.price * i.quantity)}</b>
                    </div>
                  ))}
                </div>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <span>{money(receipt.subtotal)}</span>
                </div>
                <div className="summary-row">
                  <span>Desconto</span>
                  <span>− {money(receipt.discount)}</span>
                </div>
                <div className="total-row">
                  <b>Total</b>
                  <strong>{money(receipt.total)}</strong>
                </div>
                {receipt.payments.map((p, i) => (
                  <div className="summary-row" key={i}>
                    <span>
                      {methodNames[p.method]}
                      {p.installments > 1 ? ` · ${p.installments}x` : ""}
                    </span>
                    <span>{money(p.amount)}</span>
                  </div>
                ))}
                {receipt.change > 0 && (
                  <div className="summary-row">
                    <span>Troco</span>
                    <span>{money(receipt.change)}</span>
                  </div>
                )}
                {receipt.payments.some((p) => p.method === "store") && (
                  <div className="receipt-due">
                    {s.receivables
                      .filter((r) => r.saleId === receipt.id)
                      .map((r) => (
                        <small key={r.id}>
                          Parcela {r.number}: {money(r.amount)} ·{" "}
                          {dateBR(r.dueDate, false)} ·{" "}
                          {r.status === "paid"
                            ? "Paga"
                            : r.status === "cancelled"
                              ? "Cancelada"
                              : "Em aberto"}
                        </small>
                      ))}
                  </div>
                )}
                {receipt.note && <p>{receipt.note}</p>}
                {s.refunds
                  .filter((r) => r.saleId === receipt.id)
                  .map((r) => (
                    <div className="receipt-refund" key={r.id}>
                      <b>Devolução · {dateBR(r.createdAt)}</b>
                      <small>{r.reason}</small>
                      <small>
                        Reembolso: {money(r.amount)} · {methodNames[r.method]}
                      </small>
                      {r.value > r.amount && (
                        <small>
                          Dívida cancelada: {money(r.value - r.amount)}
                        </small>
                      )}
                    </div>
                  ))}
                <p className="receipt-foot">{store.footer}</p>
              </div>
              <div className="actions receipt-actions">
                <button
                  className="btn primary"
                  onClick={() => {
                    if (desktop)
                      void window.fioDesktop
                        .printReceipt()
                        .catch((e: Error) => toast.error(e.message));
                    else window.print();
                  }}
                >
                  <Printer size={17} /> Imprimir comprovante
                </button>
                {receipt.status !== "returned" && (
                  <button
                    className="btn outline"
                    disabled={!session || saving || !!uncertain}
                    onClick={() => showReturn(receipt)}
                  >
                    <RotateCcw size={16} /> Devolver / cancelar
                  </button>
                )}
              </div>
              {!session && receipt.status !== "returned" && (
                <p className="form-hint">
                  Abra o caixa para registrar uma devolução.
                </p>
              )}
            </>
          )}
          {modal?.type === "return" && viewedSale && (
            <form
              onSubmit={(e) =>
                submit(e, "sale.return", (f) => ({
                  id: viewedSale.id,
                  sessionId: modal.sessionId,
                  reason: f.get("reason"),
                  method: refundMethod,
                  items: Object.entries(refundLines)
                    .filter(([, x]) => Number(x.quantity) > 0)
                    .map(([productId, x]) => ({
                      productId,
                      quantity: Number(x.quantity),
                      restock: x.restock,
                    })),
                }))
              }
            >
              <fieldset disabled={saving || !!uncertain}>
                {viewedSale.payments.some((p) => p.method === "store") && (
                  <p className="notice">
                    No crediário, a devolução é integral. Parcelas em aberto são
                    canceladas e somente valores já recebidos são reembolsados.
                  </p>
                )}
                {viewedSale.items
                  .filter((i) => i.quantity > i.returned)
                  .map((i) => (
                    <div className="return-line" key={i.productId}>
                      <div>
                        <b>{i.name}</b>
                        <small>
                          {i.size} · {i.color} · {i.quantity - i.returned}{" "}
                          disponível(is)
                        </small>
                      </div>
                      <Field
                        label="Qtd. a devolver"
                        type="number"
                        min="0"
                        max={i.quantity - i.returned}
                        value={refundLines[i.productId]?.quantity || "0"}
                        disabled={viewedSale.payments.some(
                          (p) => p.method === "store",
                        )}
                        onChange={(e) =>
                          setRefundLines((old) => ({
                            ...old,
                            [i.productId]: {
                              ...old[i.productId],
                              quantity: e.target.value,
                            },
                          }))
                        }
                      />
                      <label className="check-field">
                        <Checkbox
                          checked={refundLines[i.productId]?.restock}
                          onCheckedChange={(checked) =>
                            setRefundLines((old) => ({
                              ...old,
                              [i.productId]: {
                                ...old[i.productId],
                                restock: !!checked,
                              },
                            }))
                          }
                        />{" "}
                        Voltar ao estoque
                      </label>
                    </div>
                  ))}
                <Field
                  label="Motivo da devolução / cancelamento"
                  name="reason"
                  required
                  maxLength={200}
                />
                <Choice
                  label="Forma de reembolso"
                  value={refundMethod}
                  onChange={(value) => setRefundMethod(value as Method)}
                  options={methodOptions()}
                />
                <div className="summary-row">
                  <span>Valor a reembolsar</span>
                  <strong>{money(refundPreview)}</strong>
                </div>
                <p className="form-hint">
                  Para trocar uma roupa, devolva a peça e registre uma nova
                  venda. Confira reembolsos de cartão/Pix no equipamento.
                </p>
                <button
                  type="submit"
                  className="btn danger full"
                  disabled={
                    !Object.values(refundLines).some(
                      (x) => Number(x.quantity) > 0,
                    )
                  }
                >
                  Confirmar devolução
                </button>
              </fieldset>
            </form>
          )}
          {modal?.type === "help" && (
            <div className="help-content">
              <h3>Comece em três passos</h3>
              <ol>
                <li>
                  Cadastre roupas em Estoque. Cada tamanho e cor tem seu próprio
                  código.
                </li>
                <li>Abra o caixa e informe o fundo inicial.</li>
                <li>Leia as peças, confira a venda e receba o pagamento.</li>
              </ol>
              <h3>Atalhos</h3>
              <p>
                <kbd>F2</kbd> Ir ao campo do leitor.
                <br />
                <kbd>Enter</kbd> Adicionar o código digitado.
                <br />
                <kbd>F9</kbd> Abrir pagamento.
                <br />
                <kbd>Esc</kbd> Fechar a janela.
              </p>
              <h3>Conectar o leitor</h3>
              <p>
                Conecte o leitor USB e configure-o como teclado HID, com sufixo
                Enter. Teste a leitura no Bloco de Notas: o código deve aparecer
                como texto. Depois, pressione F2 no sistema e leia uma etiqueta
                cadastrada.
              </p>
              <h3>
                {desktop ? "Dados e comprovantes" : "Internet e comprovantes"}
              </h3>
              <p>
                {desktop
                  ? "Esta versão salva os dados no computador e funciona sem internet. Faça backups frequentes em outro dispositivo. "
                  : "Esta versão usa dados compartilhados pela internet. "}
                Os pagamentos são registros manuais; o comprovante impresso é
                não fiscal.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogTitle>Limpar a venda atual?</AlertDialogTitle>
          <AlertDialogDescription>
            As peças serão removidas desta venda. Nenhuma venda foi registrada
            ainda.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar venda</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCart([]);
                setDiscount("0");
                setNote("");
              }}
            >
              Limpar venda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
function FormChoice({
  name,
  initial,
  ...props
}: {
  name: string;
  initial: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Choice {...props} value={value} onChange={setValue} />
    </>
  );
}
function ProductForm({
  product,
  disabled,
  onSubmit,
}: {
  product?: Product;
  disabled: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const [active, setActive] = useState(product?.active ?? true);
  return (
    <form onSubmit={onSubmit}>
      <fieldset disabled={disabled}>
        <Field
          label="Nome da peça"
          name="name"
          defaultValue={product?.name || ""}
          placeholder="Ex.: Camiseta básica"
          required
          maxLength={200}
        />
        <div className="form-grid">
          <Field
            label="Código de barras"
            name="barcode"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            defaultValue={product?.barcode || ""}
            placeholder="Leia a etiqueta neste campo"
            required
            maxLength={64}
            autoComplete="off"
          />
          <Field
            label="Categoria"
            name="category"
            defaultValue={product?.category || ""}
            placeholder="Ex.: Camisetas"
            maxLength={200}
          />
        </div>
        <div className="form-grid">
          <Field
            label="Tamanho"
            name="size"
            defaultValue={product?.size || ""}
            placeholder="Ex.: M, 40, único"
            required
            maxLength={30}
          />
          <Field
            label="Cor"
            name="color"
            defaultValue={product?.color || ""}
            placeholder="Ex.: Preto"
            required
            maxLength={50}
          />
        </div>
        <div className="form-grid">
          <Field
            label="Preço de venda (R$)"
            name="price"
            defaultValue={decimal(product?.price || 0)}
            inputMode="decimal"
            required
          />
          <Field
            label="Custo de compra (R$)"
            name="cost"
            defaultValue={decimal(product?.cost || 0)}
            inputMode="decimal"
            required
          />
        </div>
        <div className="form-grid">
          {!product && (
            <Field
              label="Estoque inicial"
              name="stock"
              type="number"
              min="0"
              step="1"
              defaultValue="0"
              required
            />
          )}
          <Field
            label="Estoque mínimo"
            name="minimum"
            type="number"
            min="0"
            step="1"
            defaultValue={product?.minimum ?? 2}
            required
          />
        </div>
        <input type="hidden" name="active" value={active ? "on" : "off"} />
        <label className="check-field">
          <Checkbox checked={active} onCheckedChange={(v) => setActive(!!v)} />{" "}
          Peça ativa para venda
        </label>
        {product && (
          <p className="form-hint">
            Para alterar a quantidade, use Movimentar no estoque.
          </p>
        )}
        <button className="btn primary full" type="submit">
          {disabled ? "Salvando…" : "Salvar peça"}
        </button>
      </fieldset>
    </form>
  );
}
function CloseForm({
  expected,
  disabled,
  onSubmit,
}: {
  expected: number;
  disabled: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const [counted, setCounted] = useState("");
  const amount = parseMoney(counted);
  return (
    <form onSubmit={onSubmit}>
      <fieldset disabled={disabled}>
        <div className="payment-total">
          <span>Dinheiro esperado</span>
          <strong>{money(expected)}</strong>
        </div>
        <Field
          label="Dinheiro contado (R$)"
          name="counted"
          inputMode="decimal"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          required
        />
        {Number.isFinite(amount) && (
          <div className="summary-row">
            <span>Diferença</span>
            <b className={amount === expected ? "positive" : "negative"}>
              {money(amount - expected)}
            </b>
          </div>
        )}
        <p className="form-hint">
          Cartão e Pix não entram na contagem de dinheiro físico. O fechamento
          será salvo no histórico.
        </p>
        <button className="btn primary full" type="submit">
          Confirmar fechamento
        </button>
      </fieldset>
    </form>
  );
}
