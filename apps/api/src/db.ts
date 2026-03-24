import { existsSync } from "node:fs";
import pg, { type QueryResultRow } from "pg";
import { config } from "./config.js";

const { Pool } = pg;

function normalizeDatabaseUrl(connectionString: string) {
  if (existsSync("/.dockerenv")) {
    return connectionString;
  }

  try {
    const url = new URL(connectionString);

    if (url.hostname === "postgres") {
      url.hostname = "127.0.0.1";
    }

    return url.toString();
  } catch {
    return connectionString;
  }
}

export const pool = new Pool({
  connectionString: normalizeDatabaseUrl(config.DATABASE_URL),
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
