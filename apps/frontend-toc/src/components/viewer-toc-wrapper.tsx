"use client";

import dynamic from "next/dynamic";
import type { ViewerSource } from "@/features/viewer-ifc/lib/resolve-viewer-source";

const DynamicViewerTocCanvas = dynamic(
  () =>
    import("@/features/viewer-toc/components/viewer-toc-canvas").then(
      (mod) => mod.ViewerTocCanvas
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-white">
        <div className="text-center">
          <div className="mb-2 h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent mx-auto" />
          <p className="text-sm text-zinc-400">Cargando visor 3D...</p>
        </div>
      </div>
    ),
  }
);

type ViewerTocWrapperProps = {
  sources: ViewerSource[];
};

export function ViewerTocWrapper({ sources }: ViewerTocWrapperProps) {
  return <DynamicViewerTocCanvas sources={sources} />;
}