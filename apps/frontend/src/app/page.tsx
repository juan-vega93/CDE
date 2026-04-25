import Link from "next/link";
import { PortalShell } from "@/components/layout/portal-shell";

export default function HomePage() {
  return (
    <PortalShell>
      <div className="mx-auto max-w-6xl">
        <header className="rounded-2xl border bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-blue-700">Portal CDE BIM</p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-900">
            Common Data Environment
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-gray-600">
            Portal unificado para explorar documentos, revisar estados de
            workflow y preparar la integración con Nextcloud y OpenProject.
          </p>
        </header>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900">Módulos</h2>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Link
              href="/documents"
              className="rounded-2xl border bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    Documentos
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Explora archivos del CDE, revisa estados y navega al detalle
                    de cada documento.
                  </p>
                </div>

                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  MVP
                </span>
              </div>

              <p className="mt-6 text-sm font-medium text-blue-700">
                Abrir módulo →
              </p>
            </Link>

            <div className="rounded-2xl border border-dashed bg-white p-6 shadow-sm">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Workflows
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Próximo módulo para revisión documental, vinculación con work
                  packages y seguimiento.
                </p>
              </div>

              <p className="mt-6 text-sm font-medium text-gray-400">
                Próximamente
              </p>
            </div>

            <div className="rounded-2xl border border-dashed bg-white p-6 shadow-sm">
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  Visor BIM
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Espacio reservado para integrar visor IFC/BIM en una fase
                  posterior.
                </p>
              </div>

              <p className="mt-6 text-sm font-medium text-gray-400">
                Futuro
              </p>
            </div>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}