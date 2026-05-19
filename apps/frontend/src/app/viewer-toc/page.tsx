import { ViewerTocCanvas } from "@/features/viewer-toc/components/viewer-toc-canvas";
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
    <div className="h-full min-h-0">
      <ViewerTocCanvas sources={sources} />
    </div>
  );
}