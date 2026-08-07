import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { getDatabasePool } from "./client";

async function runMigration(fileName: string) {
  const sqlPath = path.join(__dirname, fileName);
  const sql = await fs.readFile(sqlPath, "utf-8");
  await getDatabasePool().query(sql);
  console.log(`[db:migrate] applied ${fileName}`);
}

async function main() {
  await runMigration("issue-schema.sql");
  await runMigration("metadata-schema.sql");
  await runMigration("bim-schema.sql");
  await getDatabasePool().end();
}

main().catch((error) => {
  console.error("[db:migrate] failed:", error);
  process.exitCode = 1;
});
