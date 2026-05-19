"use client";

import { useEffect, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import { loadViewerModel } from "@/features/viewer-ifc/lib/load-ifc-model";
import type { ViewerSource } from "@/features/viewer-ifc/lib/resolve-viewer-source";
import { viewportGridTemplate } from "@/ui-templates/grids/viewport";

type ViewerTocCanvasProps = {
  sources: ViewerSource[];
};

function getDisplayName(source: ViewerSource, index: number) {
  return (
    source.documentName?.trim() ||
    decodeURIComponent(source.modelUrl.split("/").pop() || "").split("?")[0] ||
    `Modelo ${index + 1}`
  );
}

export function ViewerTocCanvas({ sources }: ViewerTocCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Inicializando...");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;

    const setup = async () => {
      try {
        setStatus("Cargando UI...");

        host.innerHTML = "";
        BUI.Manager.init();

        // Crear el viewport
        const viewport = document.createElement("bim-viewport");
        viewport.style.width = "100%";
        viewport.style.height = "100%";
        viewport.style.display = "block";
        host.appendChild(viewport);

        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        if (disposed) return;

        setStatus("Creando escena...");

        // Seguir el mismo patrón que createWorld pero con fondo transparente (estilo TOC)
        const components = new OBC.Components();
        const worlds = components.get(OBC.Worlds);

        const world = worlds.create<
          OBC.SimpleScene,
          OBC.OrthoPerspectiveCamera,
          OBF.PostproductionRenderer
        >();

        world.name = "TOC";
        world.scene = new OBC.SimpleScene(components);
        world.scene.setup();
        world.scene.three.background = null; // transparente, estilo TOC original

        const renderer = new OBF.PostproductionRenderer(components, viewport);
        const camera = new OBC.OrthoPerspectiveCamera(components);

        camera.threePersp.near = 0.01;
        camera.threePersp.updateProjectionMatrix();

        world.renderer = renderer;
        world.camera = camera;

        components.get(OBC.Grids).create(world);
        components.get(OBC.Raycasters).get(world);
        components.init();

        const rendererDirty = renderer as OBF.PostproductionRenderer & {
          needsUpdate?: boolean;
        };

        const markDirty = () => {
          rendererDirty.needsUpdate = true;
        };

        camera.controls.addEventListener("update", markDirty);
        renderer.onResize.add(markDirty);

        // Toolbar flotante (viewport grid)
        const [viewportGrid] = BUI.Component.create(viewportGridTemplate, {
          components,
          world,
        });

        viewport.appendChild(viewportGrid);

        // Cargar modelos
        if (sources.length > 0) {
          setStatus(
            sources.length > 1
              ? `Cargando ${sources.length} modelos...`
              : "Cargando modelo..."
          );

          for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            const name = getDisplayName(source, i);

            await loadViewerModel({
              components,
              world,
              source,
              modelName: name,
            });

            setStatus(`Modelo ${i + 1} de ${sources.length} cargado`);
          }

          // Enfocar todos los modelos
          try {
            await camera.fitToItems();
          } catch (error) {
            console.warn("Error fitting view:", error);
          }
        } else {
          setStatus("Sin modelos para cargar");
        }

        renderer.resize();
        camera.updateAspect();
        markDirty();

        setStatus(
          sources.length > 1
            ? `${sources.length} modelos cargados`
            : "Modelo cargado"
        );
      } catch (error) {
        console.error("Error inicializando ViewerTocCanvas:", error);
        setStatus(
          error instanceof Error
            ? `Error: ${error.message}`
            : "Error desconocido"
        );
      }
    };

    setup();

    return () => {
      disposed = true;
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full bg-zinc-900">
      <div ref={hostRef} className="h-full w-full" />
      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white/80">
        {status}
      </div>
    </div>
  );
}