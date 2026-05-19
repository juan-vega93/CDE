import Link from "next/link";
import type { DocumentItem, DocumentUiStatus } from "@/types/documents";

type DocumentsTableProps = {
  documents: DocumentItem[];
  currentPath: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUiStatus(status: DocumentUiStatus): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "in_progress":
      return "En progreso";
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

function getStatusBadgeClass(status: DocumentUiStatus): string {
  switch (status) {
    case "pending":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "in_progress":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "in_review":
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "approved":
      return "bg-green-100 text-green-700 border-green-200";
    case "rejected":
      return "bg-red-100 text-red-700 border-red-200";
    case "closed":
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function StatusBadge({ status }: { status: DocumentUiStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
        status
      )}`}
    >
      {formatUiStatus(status)}
    </span>
  );
}

export function DocumentsTable({
  documents,
  currentPath
}: DocumentsTableProps) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border bg-white">
      <table className="min-w-full border-collapse">
        <thead className="bg-gray-50">
          <tr className="text-left text-sm">
            <th className="border-b px-4 py-3">Nombre</th>
            <th className="border-b px-4 py-3">Extensión</th>
            <th className="border-b px-4 py-3">Tamaño</th>
            <th className="border-b px-4 py-3">Estado</th>
            <th className="border-b px-4 py-3">Workflow</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc.id} className="text-sm hover:bg-gray-50">
              <td className="border-b px-4 py-3">
                <Link
                  href={`/documents/${doc.id}?path=${encodeURIComponent(
                    currentPath
                  )}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {doc.name}
                </Link>
              </td>
              <td className="border-b px-4 py-3 uppercase">{doc.extension}</td>
              <td className="border-b px-4 py-3">{formatBytes(doc.size)}</td>
              <td className="border-b px-4 py-3">
                <StatusBadge status={doc.uiStatus} />
              </td>
              <td className="border-b px-4 py-3">
                {doc.workflowStatus ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}