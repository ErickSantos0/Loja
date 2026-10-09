-- Optional manual bootstrap. The application also creates this schema idempotently.
-- Run against the dedicated database selected by DATABASE_URL, never the local desktop SQLite file.
BEGIN;
SELECT pg_advisory_xact_lock(1179209521);

CREATE TABLE IF NOT EXISTS fio_records (
  kind TEXT NOT NULL CHECK (kind IN (
    'products', 'customers', 'sales', 'sessions', 'cashEntries', 'movements',
    'receivables', 'refunds', 'audit', 'settings', 'operations'
  )),
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  payload JSONB NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND payload ? 'id'
    AND jsonb_typeof(payload -> 'id') = 'string' AND payload ->> 'id' = id
  ),
  ordinal BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
  PRIMARY KEY (kind, id)
);

CREATE TABLE IF NOT EXISTS fio_revision (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  value BIGINT NOT NULL DEFAULT 0 CHECK (value >= 0)
);

INSERT INTO fio_revision (id, value) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
INSERT INTO fio_records (kind, id, payload) VALUES (
  'settings', 'store-settings',
  '{"id":"store-settings","storeName":"Minha loja","contact":"","footer":"Obrigado pela preferência. Volte sempre!"}'::jsonb
) ON CONFLICT (kind, id) DO NOTHING;

COMMIT;

-- Every mutation must SELECT value FROM fio_revision WHERE id = 1 FOR UPDATE
-- before reading fio_records, validating stock or checking an operation's requestId.
-- Upserts, stock movements, payment records, audit and revision increment belong
-- to that same transaction, so any failed statement rolls back the whole operation.
