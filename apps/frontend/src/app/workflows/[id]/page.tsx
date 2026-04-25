import Link from "next/link";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { getWorkPackageById } from "@/services/documents.service";

type WorkflowDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatStatus(status: string): string {
  switch (status) {
    case "new":
      return "Nuevo";
    case "in_review":
      return "En revisión";
    case "approved":
      return "Aprobado";
    case "rejected":
      return "Rechazado";
    case "closed":
      return "Cerrado";
    default:
      return status;
  }
}

export default async function WorkflowDetailPage({
  params
}: WorkflowDetailPageProps) {
  const { id } = await params;
  const workflow = await getWorkPackageById(Number(id));

  return (
    <PortalShell>
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs
          items={[
            { label: "Inicio", href: "/" },
            { label: "Workflows" },
            { label: `WP #${workflow.id}` }
          ]}
        />

        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Detalle de workflow</h1>
            <p className="mt-2 text-sm text-gray-600">
              Work Package #{workflow.id}
            </p>
          </div>

          <Link
            href="/documents"
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Volver a documentos
          </Link>
        </div>

        <div className="mt-6 rounded-xl border bg-white p-6">
          <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">ID</dt>
              <dd className="font-medium">#{workflow.id}</dd>
            </div>

            <div>
              <dt className="text-sm text-gray-500">Estado</dt>
              <dd className="font-medium">{formatStatus(workflow.status)}</dd>
            </div>

            <div className="md:col-span-2">
              <dt className="text-sm text-gray-500">Asunto</dt>
              <dd className="font-medium">{workflow.subject}</dd>
            </div>

            <div className="md:col-span-2">
              <dt className="text-sm text-gray-500">Descripción</dt>
              <dd>{workflow.description}</dd>
            </div>

            <div>
              <dt className="text-sm text-gray-500">Responsable</dt>
              <dd>{workflow.assigneeId ?? "-"}</dd>
            </div>

            <div>
              <dt className="text-sm text-gray-500">Fecha objetivo</dt>
              <dd>{workflow.dueDate ?? "-"}</dd>
            </div>

            <div>
              <dt className="text-sm text-gray-500">Creado</dt>
              <dd>{new Date(workflow.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      </div>
    </PortalShell>
  );
}