import postgres, { type Sql } from "postgres";
import {
  applyOperation,
  emptyState,
  kinds,
  type PublicState,
  type State,
} from "../lib/pos.ts";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export type SQLRow = Record<string, unknown>;
export interface PostgresExecutor {
  query(text: string, parameters?: readonly unknown[]): Promise<SQLRow[]>;
}
export interface PostgresDatabase extends PostgresExecutor {
  /** The callback must use one reserved connection; reject and roll back if it throws. */
  transaction<T>(callback: (transaction: PostgresExecutor) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
export type MutationResult = { result: unknown; state: PublicState };
export interface PostgresStore {
  loadState(): Promise<PublicState>;
  mutateState(action: string, input: unknown, operator: string, requestId: string): Promise<MutationResult>;
  close(): Promise<void>;
}

type Kind = (typeof kinds)[number];
type StoredRecord = { id: string };
const BOOTSTRAP_LOCK = 1179209521;
const RECORDS_DDL = `CREATE TABLE IF NOT EXISTS fio_records (
  kind TEXT NOT NULL CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(", ")})),
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  payload JSONB NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND payload ? 'id'
    AND jsonb_typeof(payload -> 'id') = 'string' AND payload ->> 'id' = id
  ),
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
  PRIMARY KEY (kind, id)
)`;
const REVISION_DDL = `CREATE TABLE IF NOT EXISTS fio_revision (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0)
)`;

export function publicState(state: State): PublicState {
  const { operations: _operations, ...result } = state;
  return result;
}

function storageFailure(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  // Do not attach driver details: they can contain query parameters or connection information.
  return new StorageError("Não foi possível acessar o banco PostgreSQL. Confira a operação pendente antes de repetir.");
}

function validateMutation(action: string, input: unknown, operator: string, requestId: string): unknown {
  if (typeof action !== "string" || !action || action.length > 64 || !input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("Dados de operação inválidos.");
  if (typeof operator !== "string" || !operator.trim() || operator.trim().length > 200)
    throw new ValidationError("Informe o nome do operador.");
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
  return safeInput;
}

async function readState(executor: PostgresExecutor): Promise<State> {
  const rows = await executor.query("SELECT kind, id, payload FROM fio_records ORDER BY ordinal");
  const state = emptyState();
  for (const kind of kinds) (state[kind] as StoredRecord[]) = [];
  for (const row of rows) {
    if (typeof row.kind !== "string" || !kinds.includes(row.kind as Kind) || typeof row.id !== "string")
      throw new StorageError("O banco contém um tipo de registro desconhecido.");
    const item = row.payload;
    if (!item || typeof item !== "object" || Array.isArray(item) || (item as StoredRecord).id !== row.id)
      throw new StorageError("O banco contém um registro inconsistente.");
    (state[row.kind as Kind] as StoredRecord[]).push(structuredClone(item) as StoredRecord);
  }
  if (state.settings.length !== 1 || state.settings[0].id !== "store-settings")
    throw new StorageError("As configurações da loja estão ausentes ou inconsistentes.");
  return state;
}

async function persist(executor: PostgresExecutor, before: State, after: State) {
  for (const kind of kinds) {
    const previous = new Map((before[kind] as StoredRecord[]).map((record) => [record.id, JSON.stringify(record)]));
    const remaining = new Set<string>();
    const changed: StoredRecord[] = [];
    for (const record of after[kind] as StoredRecord[]) {
      remaining.add(record.id);
      if (previous.get(record.id) !== JSON.stringify(record)) changed.push(record);
    }
    if (changed.length) {
      await executor.query(`
        INSERT INTO fio_records (kind, id, payload)
        SELECT $1, entry.payload ->> 'id', entry.payload
        FROM jsonb_array_elements($2::text::jsonb) AS entry(payload)
        ON CONFLICT (kind, id) DO UPDATE SET payload = EXCLUDED.payload
      `, [kind, JSON.stringify(changed)]);
    }
    const removed = [...previous.keys()].filter((id) => !remaining.has(id));
    if (removed.length) {
      await executor.query(`
        DELETE FROM fio_records WHERE kind = $1
        AND id IN (SELECT jsonb_array_elements_text($2::text::jsonb))
      `, [kind, JSON.stringify(removed)]);
    }
  }
}

/** Injectable SQL boundary for postgres.js in production and isolated PostgreSQL engines in tests. */
export function createPostgresStore(database: PostgresDatabase): PostgresStore {
  let initialized: Promise<void> | undefined;
  let closed = false;
  function assertOpen() {
    if (closed) throw new StorageError("A conexão com o banco foi encerrada.");
  }
  async function initialize() {
    assertOpen();
    if (!initialized) {
      initialized = database.transaction(async (transaction) => {
        // Concurrent serverless cold starts must not race while creating the same PostgreSQL tables.
        await transaction.query("SELECT pg_advisory_xact_lock($1::bigint)", [BOOTSTRAP_LOCK]);
        await transaction.query(RECORDS_DDL);
        await transaction.query(REVISION_DDL);
        await transaction.query("INSERT INTO fio_revision (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
        const settings = emptyState().settings[0];
        await transaction.query(
          "INSERT INTO fio_records (kind, id, payload) VALUES ($1, $2, $3::text::jsonb) ON CONFLICT (kind, id) DO NOTHING",
          ["settings", settings.id, JSON.stringify(settings)],
        );
      }).catch((error: unknown) => {
        initialized = undefined;
        throw storageFailure(error);
      });
    }
    await initialized;
  }
  return {
    async loadState() {
      await initialize();
      try {
        // One SELECT observes one committed PostgreSQL snapshot of all record kinds.
        return publicState(await readState(database));
      } catch (error) {
        throw storageFailure(error);
      }
    },
    async mutateState(action, input, operator, requestId) {
      const safeInput = validateMutation(action, input, operator, requestId);
      await initialize();
      try {
        return await database.transaction(async (transaction) => {
          // Every application instance takes this lock before reading stock or checking idempotency.
          const lock = await transaction.query("SELECT value FROM fio_revision WHERE id = 1 FOR UPDATE");
          if (lock.length !== 1) throw new StorageError("O controle de transações do banco está ausente.");
          const before = await readState(transaction);
          const draft = structuredClone(before);
          let result: unknown;
          try {
            result = applyOperation(draft, action, safeInput, operator.trim(), requestId);
          } catch (error) {
            throw new ValidationError(error instanceof Error ? error.message : "Operação inválida.");
          }
          if (!before.operations.some((operation) => operation.id === requestId)) {
            await persist(transaction, before, draft);
            await transaction.query("UPDATE fio_revision SET value = value + 1 WHERE id = 1");
          }
          return { result, state: publicState(draft) };
        });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw storageFailure(error);
      }
    },
    async close() {
      if (!closed) {
        closed = true;
        await database.close?.();
      }
    },
  };
}

function driverExecutor(sql: Pick<Sql, "unsafe">): PostgresExecutor {
  return {
    async query(text, parameters = []) {
      // Serialized JSON parameters are cast through text in the SQL above.
      // A direct ::jsonb cast makes postgres.js JSON-serialize an already serialized string twice.
      return await sql.unsafe(text, [...parameters] as Parameters<Sql["unsafe"]>[1]) as unknown as SQLRow[];
    },
  };
}

/** DATABASE_URL is only consumed server-side; this adapter never prints it or driver errors. */
export function createPostgresDatabase(connectionString: string): PostgresDatabase {
  let url: URL;
  try {
    url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error();
  } catch {
    throw new StorageError("DATABASE_URL inválida. Configure a conexão PostgreSQL no servidor.");
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 10,
    ssl: local ? false : "require",
    onnotice: () => {},
    connection: { application_name: "fio-caixa" },
  });
  return {
    ...driverExecutor(sql),
    async transaction(callback) {
      return await sql.begin(async (transaction) => callback(driverExecutor(transaction))) as Awaited<ReturnType<typeof callback>>;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

let defaultStore: PostgresStore | undefined;
function configuredStore(): PostgresStore {
  if (!defaultStore) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString?.trim())
      throw new StorageError("Configure DATABASE_URL com um banco PostgreSQL para salvar os dados da loja.");
    defaultStore = createPostgresStore(createPostgresDatabase(connectionString));
  }
  return defaultStore;
}

export async function loadState(): Promise<PublicState> {
  return configuredStore().loadState();
}
export async function mutateState(action: string, input: unknown, operator: string, requestId: string): Promise<MutationResult> {
  return configuredStore().mutateState(action, input, operator, requestId);
}
