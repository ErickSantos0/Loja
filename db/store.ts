import { env } from "cloudflare:workers";
import {
  emptyState,
  kinds,
  applyOperation,
  type State,
  type PublicState,
} from "@/lib/pos";
function database() {
  if (!env.DB) throw new Error("Banco de dados indisponível.");
  return env.DB.withSession("first-primary");
}
async function read(db: D1DatabaseSession) {
  await db
    .prepare("INSERT OR IGNORE INTO revision (id, value) VALUES (1, 0)")
    .run();
  const [version, rows] = await db.batch([
    db.prepare("SELECT value FROM revision WHERE id = 1"),
    db.prepare("SELECT id, kind, payload FROM records"),
  ]);
  const state = emptyState();
  for (const row of rows.results as {
    id: string;
    kind: string;
    payload: string;
  }[]) {
    if (kinds.includes(row.kind as any)) {
      const list = state[row.kind as (typeof kinds)[number]] as {
        id: string;
      }[];
      const item = JSON.parse(row.payload);
      const existing = list.findIndex((x) => x.id === row.id);
      if (existing >= 0) list[existing] = item;
      else list.push(item);
    }
  }
  return { revision: (version.results[0] as { value: number }).value, state };
}
export function publicState(state: State): PublicState {
  const { operations: _operations, ...result } = state;
  return result;
}
export async function loadState() {
  return publicState((await read(database())).state);
}
export async function mutateState(
  action: string,
  input: unknown,
  operator: string,
  requestId: string,
) {
  const db = database();
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await read(db);
    const state = structuredClone(before.state);
    const result = applyOperation(state, action, input, operator, requestId);
    if (before.state.operations.some((o) => o.id === requestId))
      return { result, state: publicState(state) };
    const statements = [
      db
        .prepare(
          "UPDATE revision SET value = CASE WHEN value = ? THEN value + 1 ELSE -1 END WHERE id = 1",
        )
        .bind(before.revision),
    ];
    for (const kind of kinds) {
      const previous = new Map(
        (before.state[kind] as { id: string }[]).map((r) => [
          r.id,
          JSON.stringify(r),
        ]),
      );
      for (const r of state[kind] as { id: string }[]) {
        const json = JSON.stringify(r);
        if (previous.get(r.id) !== json)
          statements.push(
            db
              .prepare(
                "INSERT INTO records (id, kind, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload",
              )
              .bind(r.id, kind, json),
          );
      }
    }
    try {
      await db.batch(statements);
      return { result, state: publicState(state) };
    } catch (error) {
      if (!String(error).includes("revision_nonnegative")) throw error;
    }
  }
  throw new Error(
    "Outro dispositivo está atualizando o caixa. Tente novamente.",
  );
}
