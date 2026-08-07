import { Suspense } from "react";
import { DocumentsPageClient } from "./documents-page-client";

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-100 p-8">
          <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Cargando documentos...
          </section>
        </main>
      }
    >
      <DocumentsPageClient />
    </Suspense>
  );
}
