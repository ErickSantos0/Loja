import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  screen,
} from "electron";
import type { IpcMainInvokeEvent } from "electron";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createStore, ValidationError, type LocalStore } from "./store.ts";
import { parseWebExport, readBackup } from "./transfer.ts";
import type { State } from "../../lib/pos.ts";

app.setName("Fio Caixa");
const testArgument = process.argv.find((arg) =>
  arg.startsWith("--fio-test-data-dir="),
);
const testMode = !!testArgument;
const testDirectory = testArgument?.slice("--fio-test-data-dir=".length);
if (testDirectory && !path.isAbsolute(testDirectory))
  throw new Error("A pasta de teste precisa ser absoluta.");
const userDirectory = testDirectory
  ? path.resolve(testDirectory)
  : path.join(app.getPath("appData"), "Fio Caixa");
mkdirSync(userDirectory, { recursive: true });
app.setPath("userData", userDirectory);
const dataDirectory = path.join(userDirectory, "data");
const pendingPath = path.join(dataDirectory, "pending-operation.json");
const configPath = path.join(dataDirectory, "operator.json");
const logPath = path.join(userDirectory, "fio-errors.log");
const rendererFile = path.join(__dirname, "renderer/index.html");
const rendererUrl = pathToFileURL(rendererFile).href;
let store: LocalStore;
let window: BrowserWindow | null = null;
let maintenance = false;
let filesBusy = false;
let operator = "Operador";

function log(error: unknown) {
  try {
    appendFileSync(
      logPath,
      `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`,
      "utf8",
    );
  } catch {}
}
function atomicWrite(destination: string, raw: string) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, raw, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, destination);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
function parseMutation(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ValidationError("Operação inválida.");
  const value = body as {
    action: string;
    input: Record<string, unknown>;
    requestId: string;
  };
  if (
    typeof value.action !== "string" ||
    value.action.length > 64 ||
    !value.input ||
    typeof value.input !== "object" ||
    Array.isArray(value.input) ||
    typeof value.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{20,80}$/.test(value.requestId) ||
    Buffer.byteLength(JSON.stringify(value), "utf8") > 100000
  )
    throw new ValidationError("Dados de operação inválidos ou muito grandes.");
  return value;
}
function getPending() {
  if (!existsSync(pendingPath)) return null;
  if (statSync(pendingPath).size > 100000)
    throw new Error(
      "Confirmação pendente inválida. Preserve os dados e contate o suporte.",
    );
  const raw = readFileSync(pendingPath, "utf8");
  parseMutation(JSON.parse(raw));
  return raw;
}
function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url.split("#")[0] !== rendererUrl
  )
    throw new Error("Origem não autorizada.");
}
function register(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    try {
      return await handler(event, ...args);
    } catch (error) {
      log(error);
      throw error;
    }
  });
}
function failure(error: unknown) {
  if (error instanceof ValidationError)
    return { error: error.message, status: 400 };
  log(error);
  return {
    error:
      "Não foi possível acessar o banco local. Verifique o espaço em disco e tente conferir a operação pendente.",
    status: 500,
  };
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
function safetyBackup() {
  const destination = path.join(
    dataDirectory,
    "backups",
    `antes-restaurar-${stamp()}-${randomUUID().slice(0, 8)}.sqlite3`,
  );
  return store.backup(destination);
}
async function replaceWithConfirmation(state: State, verb: string) {
  if (getPending())
    throw new Error(
      "Confira a operação pendente no caixa antes de substituir os dados.",
    );
  const answer = await dialog.showMessageBox(window!, {
    type: "warning",
    title: `${verb} dados da loja`,
    buttons: ["Cancelar", `${verb} dados`],
    defaultId: 0,
    cancelId: 0,
    message: `${verb} substituirá os dados atuais deste computador.`,
    detail: `O arquivo contém ${state.products.length} peças cadastradas, ${state.sales.length} vendas e ${state.customers.length} clientes.\n\nUma cópia dos dados atuais será guardada automaticamente na pasta de backups antes da substituição.`,
    noLink: true,
  });
  if (answer.response !== 1) return { cancelled: true };
  maintenance = true;
  try {
    // Recheck after the native dialog: a sale could have been initiated before it opened.
    if (getPending())
      throw new Error(
        "Confira a operação pendente antes de substituir os dados.",
      );
    safetyBackup();
    store.replaceState(state);
    return { cancelled: false };
  } finally {
    maintenance = false;
  }
}
async function withFiles<T>(operation: () => Promise<T>): Promise<T> {
  if (filesBusy)
    throw new Error("Aguarde a operação de arquivo atual terminar.");
  filesBusy = true;
  try {
    return await operation();
  } finally {
    filesBusy = false;
  }
}

function registerBridge() {
  register("fio:info", () => ({
    operator,
    databasePath: store.databasePath,
    version: app.getVersion(),
  }));
  register("fio:load", () => {
    try {
      return store.readState();
    } catch (error) {
      return failure(error);
    }
  });
  register("fio:mutate", (_event, body: unknown) => {
    try {
      if (maintenance)
        throw new ValidationError("Aguarde a restauração dos dados terminar.");
      const value = parseMutation(body);
      return store.mutate(value.action, value.input, operator, value.requestId);
    } catch (error) {
      return failure(error);
    }
  });
  register("fio:operator", (_event, name: unknown) => {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
      throw new Error("Informe um nome com até 80 caracteres.");
    const next = name.trim();
    atomicWrite(configPath, JSON.stringify({ operator: next }));
    operator = next;
    return { operator };
  });
  register("fio:pending:get", () => getPending());
  register("fio:pending:set", (_event, raw: unknown) => {
    if (maintenance) throw new Error("Aguarde a restauração terminar.");
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 100000)
      throw new Error("Confirmação pendente inválida.");
    parseMutation(JSON.parse(raw));
    atomicWrite(pendingPath, raw);
  });
  register("fio:pending:clear", () => {
    rmSync(pendingPath, { force: true });
  });
  register("fio:backup", () =>
    withFiles(async () => {
      const answer = await dialog.showSaveDialog(window!, {
        title: "Salvar backup completo da loja",
        defaultPath: path.join(
          app.getPath("documents"),
          `Fio-backup-${stamp()}.sqlite3`,
        ),
        filters: [{ name: "Backup do Fio", extensions: ["sqlite3"] }],
      });
      if (answer.canceled || !answer.filePath) return { cancelled: true };
      const destination = path.resolve(answer.filePath);
      // The application database and internal state must never be overwritten by an export.
      const insideData = path.relative(dataDirectory, destination);
      if (!insideData.startsWith("..") && !path.isAbsolute(insideData))
        throw new Error(
          "Salve o backup fora da pasta interna dos dados, em Documentos ou em um pendrive.",
        );
      const temporary = path.join(
        path.dirname(destination),
        `.fio-export-${randomUUID()}.sqlite3`,
      );
      try {
        store.backup(temporary);
        renameSync(temporary, destination);
        return { cancelled: false, path: destination };
      } finally {
        rmSync(temporary, { force: true });
      }
    }),
  );
  register("fio:restore", () =>
    withFiles(async () => {
      const answer = await dialog.showOpenDialog(window!, {
        title: "Selecionar backup da loja",
        properties: ["openFile"],
        filters: [
          { name: "Backup do Fio", extensions: ["sqlite3", "sqlite", "db"] },
        ],
      });
      if (answer.canceled || !answer.filePaths[0]) return { cancelled: true };
      return replaceWithConfirmation(
        readBackup(answer.filePaths[0]),
        "Restaurar",
      );
    }),
  );
  register("fio:import", () =>
    withFiles(async () => {
      const answer = await dialog.showOpenDialog(window!, {
        title: "Importar exportação da versão web",
        properties: ["openFile"],
        filters: [{ name: "Exportação Fio JSON", extensions: ["json"] }],
      });
      if (answer.canceled || !answer.filePaths[0]) return { cancelled: true };
      const file = answer.filePaths[0];
      if (statSync(file).size > 50 * 1024 * 1024)
        throw new Error("A exportação excede o limite de 50 MB.");
      return replaceWithConfirmation(
        parseWebExport(readFileSync(file, "utf8")),
        "Importar",
      );
    }),
  );
  register("fio:folder", () => {
    shell.showItemInFolder(store.databasePath);
  });
  register(
    "fio:print",
    async () =>
      new Promise<void>((resolve, reject) => {
        window!.webContents.print(
          { silent: false, printBackground: true },
          (success, reason) => {
            if (success || /cancel/i.test(reason || "")) resolve();
            else
              reject(
                new Error(
                  `Não foi possível imprimir: ${reason || "verifique a impressora"}.`,
                ),
              );
          },
        );
      }),
  );
}

function createWindow() {
  const available = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    title: "Fio · Caixa e estoque",
    width: Math.min(1440, available.width),
    height: Math.min(940, available.height),
    minWidth: Math.min(900, available.width),
    minHeight: Math.min(650, available.height),
    show: false,
    backgroundColor: "#f5f6fa",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged || testMode,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (destination.split("#")[0] !== rendererUrl) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    const parsed = new URL(details.url);
    callback({
      cancel: !["file:", "data:", "blob:", "devtools:"].includes(
        parsed.protocol,
      ),
    });
  });
  session.on("will-download", (_event, item) => {
    if (!item.getURL().startsWith("blob:")) {
      item.cancel();
      return;
    }
    item.setSaveDialogOptions({
      title: "Salvar exportação da loja",
      defaultPath: path.join(
        app.getPath("downloads"),
        path.basename(item.getFilename()),
      ),
    });
  });
  window.once("ready-to-show", () => {
    if (!testMode) window?.show();
  });
  window.on("closed", () => {
    window = null;
  });
  void window.loadFile(rendererFile).catch((error) => {
    log(error);
    if (!testMode)
      dialog.showErrorBox(
        "Não foi possível abrir o Fio",
        "Os arquivos do aplicativo não puderam ser carregados. Reinstale o aplicativo; os dados da loja permanecem na pasta de dados.",
      );
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window && !testMode) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    try {
      store = createStore(dataDirectory);
      if (existsSync(configPath)) {
        try {
          const saved = JSON.parse(readFileSync(configPath, "utf8"));
          if (
            typeof saved.operator === "string" &&
            saved.operator.trim() &&
            saved.operator.trim().length <= 80
          )
            operator = saved.operator.trim();
        } catch (error) {
          log(error);
        }
      }
      Menu.setApplicationMenu(null);
      registerBridge();
      createWindow();
    } catch (error) {
      log(error);
      if (!testMode)
        dialog.showErrorBox(
          "Não foi possível abrir os dados da loja",
          `${error instanceof Error ? error.message : "Erro ao abrir os dados."}\n\nSeus dados ficam em:\n${dataDirectory}\n\nPreserve esta pasta e use um backup se necessário.`,
        );
      app.exit(1);
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    try {
      store?.close();
    } catch (error) {
      log(error);
    }
  });
}
