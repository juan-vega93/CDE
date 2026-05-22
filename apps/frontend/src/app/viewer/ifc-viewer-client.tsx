"use client";

import dynamic from "next/dynamic";

function ensureWebGpuGlobals() {
  const target = globalThis as typeof globalThis & {
    GPUShaderStage?: {
      VERTEX: number;
      FRAGMENT: number;
      COMPUTE: number;
    };
  };

  if (!target.GPUShaderStage) {
    target.GPUShaderStage = {
      VERTEX: 1,
      FRAGMENT: 2,
      COMPUTE: 4
    };
  }
}

export const IfcViewerClient = dynamic(
  async () => {
    ensureWebGpuGlobals();

    const mod = await import(
      "@/features/viewer-ifc/components/ifc-viewer-canvas"
    );

    return mod.IfcViewerCanvas;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-slate-100 text-slate-600">
        Cargando visor BIM...
      </div>
    )
  }
);
