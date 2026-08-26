import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type { ViewerSource } from "@/features/viewer-ifc/lib/resolve-viewer-source";
import { bffAssetFetch } from "@/services/bff-client";

type LoadViewerModelParams = {
  components: OBC.Components;
  world: OBC.World;
  source: ViewerSource;
  modelName?: string;
  accessToken?: string;
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
const FRAGMENTS_WORKER_URL = "/vendor/thatopen/fragments-worker.mjs";
const WEB_IFC_WASM_PATH = "/vendor/web-ifc/";

async function ensureFragmentsInitialized(
  components: OBC.Components,
  world: OBC.World
): Promise<InitializedFragments> {
  const cached = fragmentsInitCache.get(components);
  if (cached) return cached;

  const initPromise = (async () => {
    const fragments = components.get(OBC.FragmentsManager);
    const workerUrl = FRAGMENTS_WORKER_URL;

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

type BufferLikeAttribute = {
  array?: { byteLength?: number };
  data?: { array?: { byteLength?: number } };
};

function hasUsableBuffer(attribute: unknown) {
  const bufferAttribute = attribute as BufferLikeAttribute | undefined;
  const array = bufferAttribute?.array ?? bufferAttribute?.data?.array;
  return typeof array?.byteLength === "number";
}

function sanitizeRenderableGeometry(object: THREE.Object3D, label: string) {
  const invalidObjects: THREE.Object3D[] = [];
  let removedAttributes = 0;

  object.traverse((child) => {
    const renderable = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
    };
    const geometry = renderable.geometry;
    if (!geometry?.isBufferGeometry) return;

    if (!hasUsableBuffer(geometry.attributes.position)) {
      invalidObjects.push(child);
      return;
    }

    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (hasUsableBuffer(attribute)) continue;
      geometry.deleteAttribute(name);
      removedAttributes += 1;
    }

    if (geometry.index && !hasUsableBuffer(geometry.index)) {
      geometry.setIndex(null);
      removedAttributes += 1;
    }

    const morphAttributes = geometry.morphAttributes as Record<string, unknown[]>;
    for (const [name, attributes] of Object.entries(morphAttributes)) {
      const validAttributes = attributes.filter(hasUsableBuffer);
      if (validAttributes.length === attributes.length) continue;
      morphAttributes[name] = validAttributes;
      removedAttributes += attributes.length - validAttributes.length;
    }
  });

  for (const child of invalidObjects) {
    const renderable = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
    };
    renderable.geometry?.dispose();
    child.parent?.remove(child);
  }

  if (invalidObjects.length > 0 || removedAttributes > 0) {
    console.warn("[viewer-ifc] Geometria BIM invalida omitida antes de renderizar", {
      model: label,
      objects: invalidObjects.length,
      attributes: removedAttributes
    });
  }
}

async function updateFragmentsSafely(
  fragments: OBC.FragmentsManager,
  object: THREE.Object3D,
  label: string
) {
  try {
    await fragments.core.update(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("byteLength")) throw error;

    sanitizeRenderableGeometry(object, label);
    await fragments.core.update(true);
  }
}

export async function loadViewerModel({
  components,
  world,
  source,
  modelName,
  accessToken
}: LoadViewerModelParams) {
  const { fragments, workerUrl } = await ensureFragmentsInitialized(
    components,
    world
  );

  const resolvedModelName = getResolvedModelName(source, modelName);

  if (source.kind === "frag") {
    const response = await bffAssetFetch(source.modelUrl, { accessToken });

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

    sanitizeRenderableGeometry(model.object, resolvedModelName);
    world.scene.three.add(model.object);
    await updateFragmentsSafely(fragments, model.object, resolvedModelName);

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
      path: WEB_IFC_WASM_PATH,
      absolute: true
    }
  });

  const response = await bffAssetFetch(source.modelUrl, { accessToken });

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

  sanitizeRenderableGeometry(model.object, resolvedModelName);
  world.scene.three.add(model.object);
  await updateFragmentsSafely(fragments, model.object, resolvedModelName);

  return {
    model,
    fragments,
    workerUrl
  };
}
