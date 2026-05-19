import Link from "next/link";
import { IfcViewerCanvas } from "@/features/viewer-ifc/components/ifc-viewer-canvas";
import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";

type ViewerPageSearchParams = {
  projectCode?: string | string[];
  ifcUrl?: string | string[];
  documentId?: string | string[];
  documentName?: string | string[];
  documentPath?: string | string[];
};

type ViewerPageProps = {
  searchParams: Promise<ViewerPageSearchParams>;
};

function toArray(value?: string | string[]) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getSingleValue(value?: string | string[]) {
  if (!value) return "";
  return Array.isArray(value) ? value[0] || "" : value;
}

function cleanValue(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export default async function ViewerPage({ searchParams }: ViewerPageProps) {
  const params = await searchParams;

  const projectCodeFromUrl = getSingleValue(params.projectCode)
  .trim()
  .toUpperCase();

  const firstDocumentPath = getSingleValue(params.documentPath).trim();

  const projectCodeFromPath = firstDocumentPath
    .split("/")
    .filter(Boolean)[0]
    ?.trim()
    .toUpperCase() || "";

  const projectCode = projectCodeFromUrl || projectCodeFromPath;

  const documentPaths = toArray(params.documentPath);
  const documentNames = toArray(params.documentName);
  const documentIds = toArray(params.documentId);
  const ifcUrls = toArray(params.ifcUrl);

  const hasViewerSource =
    documentPaths.length > 0 ||
    documentIds.length > 0 ||
    ifcUrls.length > 0;

  const maxLength = Math.max(
    documentPaths.length,
    documentNames.length,
    documentIds.length,
    ifcUrls.length,
    1
  );

  const sources: ViewerSource[] = hasViewerSource
    ? await Promise.all(
        Array.from({ length: maxLength }, async (_, index) => {
          const documentId = cleanValue(documentIds[index]);
          const ifcUrl = cleanValue(ifcUrls[index]);
          const documentPath = cleanValue(documentPaths[index]);
          const documentName = cleanValue(documentNames[index]);

          return resolveViewerSource({
            ...(documentId ? { documentId } : {}),
            ...(ifcUrl ? { ifcUrl } : {}),
            ...(documentPath ? { documentPath } : {}),
            ...(documentName ? { documentName } : {})
          });
        })
      )
    : [];

  if (!hasViewerSource) {
    return (
      <div className="flex h-screen min-h-0 flex-col bg-slate-100">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Visor BIM {projectCode ? `- ${projectCode}` : ""}
            </div>
            <div className="text-xs text-slate-500">
              Selecciona un modelo desde documentos para abrirlo en el visor.
            </div>
          </div>

          <Link
            href={
              projectCode
                ? `/documents?projectCode=${encodeURIComponent(projectCode)}`
                : "/admin/project-cards"
            }
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Volver
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">
              No hay modelo seleccionado
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Abre un archivo IFC o FRAG desde Documentos para visualizarlo aquí.
            </p>

            <Link
              href={
                projectCode
                  ? `/documents?projectCode=${encodeURIComponent(projectCode)}`
                  : "/admin/project-cards"
              }
              className="mt-5 inline-flex rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
            >
              Ir a documentos
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-100">    
        <IfcViewerCanvas
          sources={sources}
          documentNames={documentNames}
          documentPaths={documentPaths}
          projectCode={projectCode}
        />
      
    </div>
  );
}