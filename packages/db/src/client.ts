import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;
export type Sql = ReturnType<typeof postgres>;

export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db: Db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
