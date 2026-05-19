"use client";

import { useEffect, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import * as THREE from "three";
import { loadViewerModel } from "@/features/viewer-ifc/lib/load-ifc-model";
import type { ViewerSource } from "@/features/viewer-ifc/lib/resolve-viewer-source";
import { viewportGridTemplate } from "@/ui-templates/grids/viewport";

type ViewerTocCanvasProps = {
  sources: ViewerSource[];
};

export function ViewerTocCanvas({ sources }: ViewerTocCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Inicializando...");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let components: OBC.Components | null = null;

    const setup = async () => {
      try {
        setStatus("Inicializando visor...");

        // 1. Inicializar UI de ThatOpen
        BUI.Manager.init();

        // 2. Crear el viewport web component
        const viewport = document.createElement("bim-viewport") as unknown as BUI.Viewport;
        viewport.style.width = "100%";
        viewport.style.height = "100%";
        viewport.style.display = "block";
        host.appendChild(viewport as unknown as Node);

        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (disposed) return;

        // 3. Crear el mundo al estilo TOC: SimpleRenderer + OrthoPerspectiveCamera
        const comps = new OBC.Components();
        components = comps;

        const worldsManager = comps.get(OBC.Worlds);
        const world = worldsManager.create<
          OBC.SimpleScene,
          OBC.OrthoPerspectiveCamera,
          OBC.SimpleRenderer
        >();

        world.scene = new OBC.SimpleScene(comps);
        world.scene.setup();
        world.scene.three.background = null; // transparente como el TOC

        world.renderer = new OBC.SimpleRenderer(comps, viewport as unknown as HTMLElement);
        world.camera = new OBC.OrthoPerspectiveCamera(comps);

        const resizeWorld = () => {
          try {
            world.renderer?.resize();
            world.camera.updateAspect();
          } catch (error) {
            console.warn("Resize error:", error);
          }
        };

        (viewport as unknown as HTMLElement).addEventListener("resize", resizeWorld);

        comps.get(OBC.Raycasters).get(world);
        comps.get(OBC.Grids).create(world);
        comps.init();

        // 4. Crear el grid con la toolbar flotante (TOC style)
        const [viewportGrid] = BUI.Component.create(viewportGridTemplate, {
          components: comps,
          world,
        });

        viewport.appendChild(viewportGrid);

        // 5. Cargar modelos
        if (sources.length > 0) {
          setStatus(
            sources.length > 1
              ? `Cargando ${sources.length} modelos...`
              : "Cargando modelo..."
          );

          for (let i = 0; i < sources.length; i++) {
            const result = await loadViewerModel({
              components: comps,
              world,
              source: sources[i],
              modelName: sources[i].documentName,
            });

            world.scene.three.add(result.model.object);
            setStatus(`Modelo ${i + 1} de ${sources.length} cargado`);
          }

          // Enfocar todos los modelos
          try {
            await world.camera.fitToItems();
          } catch (error) {
            console.warn("Error fitting view:", error);
          }
        } else {
          setStatus("Sin modelos para cargar");
        }

        world.renderer.resize();
        world.camera.updateAspect();

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
      if (components) {
        try {
          components.dispose();
        } catch (error) {
          console.warn("Error disposing components:", error);
        }
      }
      host.replaceChildren();
    };
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