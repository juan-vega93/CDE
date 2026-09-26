import * as OBC from "@thatopen/components";

type ControlsWithUpdateListener = {
  addEventListener: (type: "update", listener: () => void) => void;
};

export type InitializedFragments = {
  fragments: OBC.FragmentsManager;
  workerUrl: string;
};

const FRAGMENTS_WORKER_URL = "/vendor/thatopen/fragments-worker.mjs";
const fragmentsInitCache = new WeakMap<OBC.Components, InitializedFragments>();
const controlsHooked = new WeakSet<ControlsWithUpdateListener>();

/**
 * Initializes Fragments once for each viewer Components instance.
 * It is safe to call before a model exists and before viewer modules are configured.
 */
export function initializeFragments(
  components: OBC.Components,
  world: OBC.World
): InitializedFragments {
  const cached = fragmentsInitCache.get(components);
  if (cached) return cached;

  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(FRAGMENTS_WORKER_URL);

  const controls = world.camera.controls as ControlsWithUpdateListener | null;
  if (controls && !controlsHooked.has(controls)) {
    controls.addEventListener("update", () => {
      fragments.core.update();
    });
    controlsHooked.add(controls);
  }

  const initialized = {
    fragments,
    workerUrl: FRAGMENTS_WORKER_URL
  };
  fragmentsInitCache.set(components, initialized);
  return initialized;
}
