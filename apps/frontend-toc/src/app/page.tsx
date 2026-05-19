import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";
import { ViewerTocWrapper } from "@/components/viewer-toc-wrapper";

type HomeSearchParams = {
  ifcUrl?: string | string[];
  documentId?: string | string[];
  documentName?: string | string[];
  documentPath?: string | string[];
};

type HomePageProps = {
  searchParams: Promise<HomeSearchParams>;
};

function toArray(value?: string | string[]) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function HomePage({ searchParams }: HomePageProps) {
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
      <ViewerTocWrapper sources={sources} />
    </div>
  );
}