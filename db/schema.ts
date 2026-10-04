import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [index("idx_records_kind").on(table.kind)],
);
export const revision = sqliteTable(
  "revision",
  {
    id: integer("id").primaryKey(),
    value: integer("value").notNull(),
  },
  (table) => [check("revision_nonnegative", sql`${table.value} >= 0`)],
);
