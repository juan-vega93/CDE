import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type { ViewerSource } from "@/features/viewer-ifc/lib/resolve-viewer-source";

type LoadViewerModelParams = {
  components: OBC.Components;
  world: OBC.World;
  source: ViewerSource;
  modelName?: string;
};

type InitializedFragments = {
  fragments: OBC.FragmentsManager;
  workerUrl: string;
};

const fragmentsInitCache = new WeakMap<OBC.Components, Promise<InitializedFragments>>();
type ControlsWithUpdateListener = {
  addEventListener: (type: "update", listener: () => void) => void;
};

const controlsHooked = new WeakSet<object>();

async function ensureFragmentsInitialized(
  components: OBC.Components,
  world: OBC.World
): Promise<InitializedFragments> {
  const cached = fragmentsInitCache.get(components);
  if (cached) return cached;

  const initPromise = (async () => {
    const fragments = components.get(OBC.FragmentsManager);

    const workerResponse = await fetch(
      "https://thatopen.github.io/engine_fragment/resources/worker.mjs"
    );

    if (!workerResponse.ok) {
      throw new Error(
        `No se pudo descargar el worker de fragments: ${workerResponse.status}`
      );
    }

    const workerBlob = await workerResponse.blob();
    const workerUrl = URL.createObjectURL(
      new File([workerBlob], "worker.mjs", {
        type: "text/javascript"
      })
    );

    fragments.init(workerUrl);

    const controls = world.camera.controls as ControlsWithUpdateListener | null;

    if (controls && !controlsHooked.has(controls)) {
      controls.addEventListener("update", () => {
        fragments.core.update();
      });

      controlsHooked.add(controls);
    }

    return {
      fragments,
      workerUrl
    };
  })();

  fragmentsInitCache.set(components, initPromise);
  return initPromise;
}

function getResolvedModelName(source: ViewerSource, modelName?: string) {
  return (
    modelName?.trim() ||
    source.documentName?.trim() ||
    decodeURIComponent(source.modelUrl.split("/").pop() || "").split("?")[0] ||
    "bim-model"
  );
}

export async function loadViewerModel({
  components,
  world,
  source,
  modelName
}: LoadViewerModelParams) {
  const { fragments, workerUrl } = await ensureFragmentsInitialized(
    components,
    world
  );

  const resolvedModelName = getResolvedModelName(source, modelName);

  if (source.kind === "frag") {
    const response = await fetch(source.modelUrl);

    if (!response.ok) {
      throw new Error(`No se pudo descargar el FRAG: ${response.status}`);
    }

    const buffer = new Uint8Array(await response.arrayBuffer());

    const model = await fragments.core.load(buffer, {
      modelId: resolvedModelName
    });

    model.useCamera(
      world.camera.three as
        | THREE.PerspectiveCamera
        | THREE.OrthographicCamera
    );

    world.scene.three.add(model.object);
    await fragments.core.update(true);

    return {
      model,
      fragments,
      workerUrl
    };
  }

  const ifcLoader = components.get(OBC.IfcLoader);

  await ifcLoader.setup({
    autoSetWasm: false,
    wasm: {
      path: "https://unpkg.com/web-ifc@0.0.77/",
      absolute: true
    }
  });

  const response = await fetch(source.modelUrl);

  if (!response.ok) {
    throw new Error(`No se pudo descargar el IFC: ${response.status}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const model = await ifcLoader.load(buffer, false, resolvedModelName);

  model.useCamera(
    world.camera.three as
      | THREE.PerspectiveCamera
      | THREE.OrthographicCamera
  );

  world.scene.three.add(model.object);
  await fragments.core.update(true);

  return {
    model,
    fragments,
    workerUrl
  };
}