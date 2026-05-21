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