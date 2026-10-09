import { createHmac } from "node:crypto";
import { createPostgresDatabase, type PostgresDatabase } from "../db/postgres-store.ts";

const WINDOW_SECONDS = 15 * 60;
let database: PostgresDatabase | undefined;
let initialized: Promise<unknown> | undefined;

/** Shared PostgreSQL counters keep login limits across serverless instances. */
export async function consumeLoginAttempt(ip: string, secret: string): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Authentication storage is unavailable");
  database ??= createPostgresDatabase(url);
  const db = database;
  initialized ??= db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(1179209522::bigint)");
    await tx.query("CREATE TABLE IF NOT EXISTS fio_login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)");
  }).catch(() => { initialized = undefined; throw new Error("Authentication storage is unavailable"); });
  await initialized;
  const key = createHmac("sha256", secret).update(ip.slice(0, 200)).digest("hex");
  const rows = await db.query(`INSERT INTO fio_login_limits (key, attempts, expires_at)
    VALUES ($1, 1, CURRENT_TIMESTAMP + $2::int * INTERVAL '1 second')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN fio_login_limits.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE fio_login_limits.attempts + 1 END,
      expires_at = CASE WHEN fio_login_limits.expires_at <= CURRENT_TIMESTAMP THEN EXCLUDED.expires_at ELSE fio_login_limits.expires_at END
    RETURNING attempts`, [key, WINDOW_SECONDS]);
  await db.query("DELETE FROM fio_login_limits WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'");
  return Number(rows[0]?.attempts) <= 10;
}
