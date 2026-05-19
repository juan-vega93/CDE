import Link from "next/link";
import { ViewerTocWrapper } from "@/components/viewer-toc-wrapper";
import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";

type ViewerTocSearchParams = {
  ifcUrl?: string | string[];
  documentId?: string | string[];
  documentName?: string | string[];
  documentPath?: string | string[];
};

type ViewerTocPageProps = {
  searchParams: Promise<ViewerTocSearchParams>;
};

function toArray(value?: string | string[]) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function ViewerTocPage({ searchParams }: ViewerTocPageProps) {
  const params = await searchParams;

  const documentPaths = toArray(params.documentPath);
  const documentNames = toArray(params.documentName);
  const documentIds = toArray(params.documentId);
  const ifcUrls = toArray(params.ifcUrl);

  const maxLength = Math.max(
    documentPaths.length,
    documentNames.length,
    documentIds.length,
    ifcUrls.length,
    1
  );

  const sources: ViewerSource[] = await Promise.all(
    Array.from({ length: maxLength }, async (_, index) => {
      return resolveViewerSource({
        documentId: documentIds[index],
        ifcUrl: ifcUrls[index],
        documentPath: documentPaths[index],
        documentName: documentNames[index]
      });
    })
  );

  return (
    <div className="relative h-full min-h-0">
      {/* Botón de regresar flotante */}
      <Link
        href="/documents"
        className="absolute left-4 top-4 z-50 flex items-center gap-2 rounded-lg bg-black/60 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-sm transition-all hover:bg-black/80"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        Regresar a Documentos
      </Link>

      <ViewerTocWrapper sources={sources} />
    </div>
  );
}