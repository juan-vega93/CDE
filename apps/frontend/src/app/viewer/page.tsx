import { Suspense } from "react";
import { ViewerPageClient } from "./viewer-page-client";

export default function ViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-slate-100 text-slate-600">
          Cargando visor BIM...
        </div>
      }
    >
      <ViewerPageClient />
    </Suspense>
  );
}
