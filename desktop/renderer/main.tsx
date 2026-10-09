import "../../app/globals.css";
import {
  Component,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArchiveRestore,
  ChevronDown,
  Download,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Upload,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import PosApp from "../../app/pos-app";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { DesktopInfo } from "./types";
import { desktopTransport } from "./transport";
import "./desktop.css";

function Startup({ error }: { error?: string }) {
  return (
    <div className="desktop-startup">
      <div className="brand-symbol" aria-hidden="true">
        fi
      </div>
      <h1>Fio · Caixa e estoque</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button className="btn primary" onClick={() => location.reload()}>
            Tentar novamente
          </button>
        </>
      ) : (
        <p role="status">
          <LoaderCircle className="desktop-spinner" size={18} /> Abrindo os
          dados da loja…
        </p>
      )}
    </div>
  );
}

class AppBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Startup error="O aplicativo encontrou um problema ao abrir. Seus dados continuam salvos neste computador." />
    ) : (
      this.props.children
    );
  }
}

function DesktopApp() {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [startupError, setStartupError] = useState("");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [operatorDraft, setOperatorDraft] = useState("");
  const [operatorError, setOperatorError] = useState("");
  const [operatorSaving, setOperatorSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!window.fioDesktop) {
      setStartupError(
        "Abra o Fio pelo aplicativo instalado para acessar o banco da loja.",
      );
      return;
    }
    window.fioDesktop
      .getInfo()
      .then((value) => {
        if (!active) return;
        setInfo(value);
        setOperatorDraft(value.operator === "Operador" ? "" : value.operator);
        if (value.operator === "Operador") setOperatorOpen(true);
      })
      .catch(() => {
        if (active)
          setStartupError(
            "Não foi possível abrir os dados locais. Feche e abra o aplicativo ou tente novamente.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = operatorDraft.trim();
    if (!name || name.length > 80) {
      setOperatorError("Informe um nome com até 80 caracteres.");
      return;
    }
    setOperatorSaving(true);
    setOperatorError("");
    try {
      const result = await window.fioDesktop.setOperator(name);
      setInfo(
        (previous) => previous && { ...previous, operator: result.operator },
      );
      setOperatorOpen(false);
      toast.success("Nome do operador atualizado.");
    } catch (error) {
      setOperatorError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o nome.",
      );
    } finally {
      setOperatorSaving(false);
    }
  }

  async function fileAction(
    action: "backup" | "restoreBackup" | "importWebExport" | "revealData",
  ) {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "revealData") {
        await window.fioDesktop.revealData();
      } else if (action === "backup") {
        const result = await window.fioDesktop.backup();
        if (!result.cancelled)
          toast.success(
            "Backup salvo. Guarde uma cópia fora deste computador.",
          );
      } else if (action === "restoreBackup") {
        const result = await window.fioDesktop.restoreBackup();
        if (!result.cancelled && !result.restarted) location.reload();
      } else {
        const result = await window.fioDesktop.importWebExport();
        if (!result.cancelled) location.reload();
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <Startup error={startupError || undefined} />;

  return (
    <div className="fio-desktop">
      <header className="desktop-toolbar" aria-label="Aplicativo local">
        <div
          className="desktop-storage"
          title="Vendas e estoque são salvos no banco deste computador. O caixa funciona sem internet."
        >
          <HardDrive size={15} aria-hidden="true" />
          <span>Dados neste computador</span>
          <span className="desktop-offline">Funciona sem internet</span>
        </div>
        <div className="desktop-tools">
          <button
            type="button"
            className="desktop-tool"
            onClick={() => {
              setOperatorDraft(
                info.operator === "Operador" ? "" : info.operator,
              );
              setOperatorError("");
              setOperatorOpen(true);
            }}
            title="Alterar nome do operador"
          >
            <UserRound size={15} aria-hidden="true" />
            <span>{info.operator}</span>
          </button>
          <span className="desktop-divider" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="desktop-tool" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={15} className="desktop-spinner" />
                ) : (
                  <Download size={15} />
                )}
                <span>Arquivos e backup</span>
                <ChevronDown size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="desktop-file-menu">
              <DropdownMenuLabel>Banco da loja</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void fileAction("backup")}>
                <Download /> Salvar backup completo
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void fileAction("restoreBackup")}
              >
                <ArchiveRestore /> Restaurar backup…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void fileAction("importWebExport")}
              >
                <Upload /> Importar dados da versão web…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void fileAction("revealData")}>
                <FolderOpen /> Abrir pasta dos dados
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="desktop-menu-note">
                Fio {info.version} · Os dados ficam nesta instalação.
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="desktop-content">
        <PosApp
          operator={info.operator}
          userKey="desktop-local"
          desktop
          transport={desktopTransport}
        />
      </main>
      <Dialog
        open={operatorOpen}
        onOpenChange={(open) => {
          if (!operatorSaving) setOperatorOpen(open);
        }}
      >
        <DialogContent className="desktop-operator-dialog">
          <DialogTitle>Quem está no caixa?</DialogTitle>
          <DialogDescription>
            Este nome identifica o operador nas vendas e movimentações do caixa.
            Você pode alterá-lo pela barra superior.
          </DialogDescription>
          <form onSubmit={saveOperator} className="desktop-operator-form">
            <label className="field">
              <span>Nome do operador</span>
              <input
                autoFocus
                maxLength={80}
                value={operatorDraft}
                onChange={(event) => setOperatorDraft(event.target.value)}
                placeholder="Ex.: Ana"
                disabled={operatorSaving}
                aria-describedby={operatorError ? "operator-error" : undefined}
              />
            </label>
            {operatorError && (
              <p
                id="operator-error"
                role="alert"
                className="desktop-form-error"
              >
                {operatorError}
              </p>
            )}
            <div className="desktop-operator-actions">
              <button
                type="button"
                className="btn outline"
                disabled={operatorSaving}
                onClick={() => setOperatorOpen(false)}
              >
                Configurar depois
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={operatorSaving || !operatorDraft.trim()}
              >
                {operatorSaving ? "Salvando…" : "Salvar nome"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <AppBoundary>
    <DesktopApp />
  </AppBoundary>,
);
