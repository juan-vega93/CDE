import "dotenv/config";
import { getDatabasePool, isDatabaseEnabled } from "../db/client";
import { indexDocumentBimProperties } from "../services/documents.service";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();

  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1]?.trim();

  return undefined;
}

async function main() {
  const documentPath = readArg("documentPath") ?? process.argv[2]?.trim();

  if (!documentPath) {
    throw new Error(
      "Uso: npm run bim:reindex -w bff -- --documentPath /PROYECTO/ruta/modelo.ifc"
    );
  }

  if (!isDatabaseEnabled()) {
    throw new Error("DATABASE_URL no esta configurado");
  }

  console.log(`[bim:reindex] indexando ${documentPath}`);
  const result = await indexDocumentBimProperties(documentPath);
  console.log(`[bim:reindex] resultado ${JSON.stringify(result)}`);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[bim:reindex] fallo: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!isDatabaseEnabled()) return;
    await getDatabasePool().end().catch(() => undefined);
  });
