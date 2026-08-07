import { Suspense } from "react";
import { DocumentDetailClient } from "./document-detail-client";

export default function DocumentDetailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-100 p-8">
          <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Cargando documento...
          </section>
        </main>
      }
    >
      <DocumentDetailClient />
    </Suspense>
  );
}
