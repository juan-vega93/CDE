import "dotenv/config";
import { getDatabasePool, isDatabaseEnabled } from "./client";

const REQUIRED_TABLES = [
  "cde_issues",
  "cde_bim_models",
  "cde_bim_model_derivatives",
  "cde_bim_elements",
  "cde_bim_property_sets",
  "cde_bim_properties",
  "cde_bim_property_values",
  "cde_bim_index_jobs",
  "cde_bim_property_index_snapshots",
  "cde_project_modules",
  "cde_pma_mappings",
  "cde_pma_requirements",
  "cde_pma_sources"
];

async function countTable(tableName: string): Promise<number> {
  const result = await getDatabasePool().query<{ count: string }>(
    `select count(*)::text as count from ${tableName}`
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function main() {
  if (!isDatabaseEnabled()) {
    throw new Error("DATABASE_URL no esta configurado");
  }

  const pool = getDatabasePool();
  const ping = await pool.query<{ now: Date }>("select now() as now");
  console.log(`[db:check] connected ${ping.rows[0]?.now?.toISOString?.() ?? "ok"}`);

  const tables = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name`,
    [REQUIRED_TABLES]
  );

  const present = new Set(tables.rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

  if (missing.length > 0) {
    throw new Error(`Faltan tablas. Ejecuta db:migrate. Tablas faltantes: ${missing.join(", ")}`);
  }

  for (const tableName of REQUIRED_TABLES) {
    const count = await countTable(tableName);
    console.log(`[db:check] ${tableName}: ${count}`);
  }

  await pool.end();
}

main().catch(async (error) => {
  console.error("[db:check] failed:", error);
  try {
    await getDatabasePool().end();
  } catch {
    // ignore cleanup errors
  }
  process.exitCode = 1;
});