import { IfcViewerCanvas } from "@/features/viewer-ifc/components/ifc-viewer-canvas";
import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";

type ViewerPageSearchParams = {
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

export default async function ViewerPage({ searchParams }: ViewerPageProps) {
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
    <div className="h-full min-h-0 bg-zinc-100">
      <IfcViewerCanvas
        sources={sources}
        documentNames={documentNames}
        documentPaths={documentPaths}
      />
    </div>
  );
}