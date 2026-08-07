import { Pool } from "pg";

let pool: Pool | null = null;

export function isDatabaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDatabasePool(): Pool {
  if (!isDatabaseEnabled()) {
    throw new Error("DATABASE_URL no esta configurado");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
  }

  return pool;
}

