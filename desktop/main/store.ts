import { DatabaseSync } from "node:sqlite";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  applyOperation,
  emptyState,
  kinds,
  type PublicState,
  type State,
} from "../../lib/pos.ts";

const APPLICATION_ID = 0x46494f31; // FIO1: reject unrelated SQLite databases.
const SCHEMA_VERSION = 1;
const DATABASE_NAME = "fio-caixa.sqlite3";
type Kind = (typeof kinds)[number];
type RecordRow = { id: string; kind: string; payload: string };
type StoredRecord = { id: string };

export type MutationResult = { result: unknown; state: PublicState };
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
export interface LocalStore {
  readonly databasePath: string;
  readState(): PublicState;
  readFullState(): State;
  mutate(
    action: string,
    input: unknown,
    operator: string,
    requestId: string,
  ): MutationResult;
  backup(destination: string): string;
  replaceState(state: State): PublicState;
  exportJSON(): string;
  close(): void;
}

function publicState(state: State): PublicState {
  const { operations: _operations, ...result } = state;
  return result;
}

/** Structural boundary; transfer.ts additionally validates domain values and cross-record invariants. */
function replacementState(input: State): State {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("Dados de restauração inválidos.");
  const keys = Object.keys(input);
  if (keys.length !== kinds.length || keys.some((key) => !kinds.includes(key as Kind)))
    throw new ValidationError("A restauração deve conter todos os tipos de registros do Fio.");
  const result = emptyState();
  for (const kind of kinds) {
    if (!Array.isArray(input[kind]))
      throw new ValidationError(`A lista de registros ${kind} é inválida.`);
    const identifiers = new Set<string>();
    const records: StoredRecord[] = [];
    for (const item of input[kind] as StoredRecord[]) {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id || item.id.length > 200)
        throw new ValidationError(`Há um identificador inválido em ${kind}.`);
      if (identifiers.has(item.id))
        throw new ValidationError(`Há identificadores repetidos em ${kind}.`);
      identifiers.add(item.id);
      let copy: StoredRecord;
      try {
        copy = JSON.parse(JSON.stringify(item));
      } catch {
        throw new ValidationError(`Há um registro que não pode ser importado em ${kind}.`);
      }
      if (!copy || typeof copy !== "object" || Array.isArray(copy) || copy.id !== item.id)
        throw new ValidationError(`Há um registro inconsistente em ${kind}.`);
      records.push(copy);
    }
    (result[kind] as StoredRecord[]) = records;
  }
  if (result.settings.length !== 1 || result.settings[0].id !== "store-settings")
    throw new ValidationError("A restauração deve conter as configurações da loja.");
  return result;
}

function pragmaNumber(database: DatabaseSync, name: string): number {
  const row = database.prepare(`PRAGMA ${name}`).get();
  return Number(row?.[name]);
}

function initialize(database: DatabaseSync) {
  const applicationId = pragmaNumber(database, "application_id");
  const version = pragmaNumber(database, "user_version");
  const tables = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  if (applicationId !== APPLICATION_ID) {
    if (applicationId !== 0 || version !== 0 || tables.length > 0)
      throw new Error("O arquivo não é um banco de dados local do Fio.");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE records (
          kind TEXT NOT NULL CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(",")})),
          id TEXT NOT NULL,
          payload TEXT NOT NULL CHECK (
            json_valid(payload) AND json_type(payload, '$.id') = 'text'
            AND json_extract(payload, '$.id') = id
          ),
          PRIMARY KEY (kind, id)
        );
        CREATE INDEX idx_records_kind ON records(kind);
        PRAGMA application_id = ${APPLICATION_ID};
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
      const settings = emptyState().settings[0];
      database
        .prepare("INSERT INTO records (kind, id, payload) VALUES (?, ?, ?)")
        .run("settings", settings.id, JSON.stringify(settings));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } else if (version !== SCHEMA_VERSION) {
    throw new Error("Esta versão do banco local não é compatível com o aplicativo.");
  }
  const checked = database.prepare("PRAGMA quick_check").all();
  if (checked.length !== 1 || checked[0].quick_check !== "ok")
    throw new Error("O banco local está danificado. Preserve o arquivo e use uma cópia de segurança.");
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF;");
}

/** One synchronous connection, owned by Electron's main process; never expose it to the renderer. */
export function createStore(dataDirectory: string): LocalStore {
  if (typeof dataDirectory !== "string" || !dataDirectory.trim())
    throw new Error("Informe a pasta dos dados locais.");
  const directory = resolve(dataDirectory);
  mkdirSync(directory, { recursive: true });
  const databasePath = join(directory, DATABASE_NAME);
  const database = new DatabaseSync(databasePath);
  let closed = false;
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    initialize(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const read = database.prepare("SELECT id, kind, payload FROM records ORDER BY rowid");
  const upsert = database.prepare(
    "INSERT INTO records (kind, id, payload) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload",
  );
  const remove = database.prepare("DELETE FROM records WHERE kind = ? AND id = ?");

  function assertOpen() {
    if (closed) throw new Error("O banco local está fechado.");
  }
  function readInternal(): State {
    assertOpen();
    const state = emptyState();
    for (const kind of kinds) (state[kind] as StoredRecord[]) = [];
    for (const row of read.all() as RecordRow[]) {
      if (!kinds.includes(row.kind as Kind))
        throw new Error("O banco local contém um tipo de registro desconhecido.");
      let item: StoredRecord;
      try {
        item = JSON.parse(row.payload);
      } catch {
        throw new Error("O banco local contém um registro inválido.");
      }
      if (!item || typeof item !== "object" || Array.isArray(item) || item.id !== row.id)
        throw new Error("O banco local contém um registro inconsistente.");
      (state[row.kind as Kind] as StoredRecord[]).push(item);
    }
    if (state.settings.length !== 1 || state.settings[0].id !== "store-settings")
      throw new Error("As configurações do banco local estão ausentes ou inconsistentes.");
    return state;
  }
  function persist(before: State, after: State) {
    for (const kind of kinds) {
      const previous = new Map(
        (before[kind] as StoredRecord[]).map((record) => [record.id, JSON.stringify(record)]),
      );
      const remaining = new Set<string>();
      for (const record of after[kind] as StoredRecord[]) {
        remaining.add(record.id);
        const serialized = JSON.stringify(record);
        if (previous.get(record.id) !== serialized) upsert.run(kind, record.id, serialized);
      }
      for (const id of previous.keys()) if (!remaining.has(id)) remove.run(kind, id);
    }
  }

  return {
    databasePath,
    readState() {
      return publicState(readInternal());
    },
    readFullState() {
      return readInternal();
    },
    mutate(action, input, operator, requestId) {
      assertOpen();
      if (typeof action !== "string" || action.length > 64 || !input || typeof input !== "object" || Array.isArray(input))
        throw new ValidationError("Dados de operação inválidos.");
      if (typeof operator !== "string" || !operator.trim() || operator.trim().length > 200)
        throw new ValidationError("Informe o nome do operador local.");
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{20,80}$/.test(requestId))
        throw new ValidationError("Identificador da operação inválido.");
      let serialized: string;
      try {
        serialized = JSON.stringify(input);
      } catch {
        throw new ValidationError("Dados de operação inválidos.");
      }
      if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > 100000)
        throw new ValidationError("Os dados da operação são muito grandes.");
      const safeInput: unknown = JSON.parse(serialized);
      if (!safeInput || typeof safeInput !== "object" || Array.isArray(safeInput))
        throw new ValidationError("Dados de operação inválidos.");
      database.exec("BEGIN IMMEDIATE");
      try {
        const before = readInternal();
        const draft = structuredClone(before);
        let result: unknown;
        try {
          result = applyOperation(draft, action, safeInput, operator.trim(), requestId);
        } catch (error) {
          throw new ValidationError(error instanceof Error ? error.message : "Operação inválida.");
        }
        persist(before, draft);
        database.exec("COMMIT");
        return { result, state: publicState(draft) };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    backup(destination) {
      assertOpen();
      if (typeof destination !== "string" || !destination.trim())
        throw new ValidationError("Informe o destino da cópia de segurança.");
      const target = resolve(destination);
      if (target.toLowerCase() === databasePath.toLowerCase())
        throw new ValidationError("A cópia deve ter um destino diferente do banco em uso.");
      if (existsSync(target)) throw new ValidationError("Já existe um arquivo no destino da cópia.");
      mkdirSync(dirname(target), { recursive: true });
      const temporary = join(dirname(target), `.fio-backup-${randomUUID()}.sqlite3`);
      try {
        // VACUUM reads a consistent SQLite snapshot, including uncheckpointed WAL pages.
        database.prepare("PRAGMA wal_checkpoint(PASSIVE)").all();
        database.prepare("VACUUM INTO ?").run(temporary);
        const snapshot = new DatabaseSync(temporary, { readOnly: true });
        try {
          const checked = snapshot.prepare("PRAGMA integrity_check").all();
          if (checked.length !== 1 || checked[0].integrity_check !== "ok")
            throw new Error("Não foi possível validar a cópia de segurança.");
        } finally {
          snapshot.close();
        }
        copyFileSync(temporary, target, constants.COPYFILE_EXCL);
        return target;
      } finally {
        rmSync(temporary, { force: true });
      }
    },
    exportJSON() {
      return JSON.stringify(publicState(readInternal()), null, 2);
    },
    replaceState(input) {
      assertOpen();
      const replacement = replacementState(input);
      database.exec("BEGIN IMMEDIATE");
      try {
        const before = readInternal();
        persist(before, replacement);
        database.exec("COMMIT");
        return publicState(replacement);
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      if (!closed) {
        database.close();
        closed = true;
      }
    },
  };
}
