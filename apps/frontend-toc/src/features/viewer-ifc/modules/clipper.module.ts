import * as THREE from "three";
import * as OBC from "@thatopen/components";

type SetupClipperParams = {
  components: OBC.Components;
  world: OBC.World;
};

export function setupClipper({ components, world }: SetupClipperParams) {
  components.get(OBC.Raycasters).get(world);

  const clipper = components.get(OBC.Clipper);
  clipper.enabled = false;

  console.log("[viewer-ifc] Clipper module ready");

  function setEnabled(value: boolean) {
    clipper.enabled = value;
  }

  function toggle() {
    clipper.enabled = !clipper.enabled;
    return clipper.enabled;
  }

  async function create() {
    if (!clipper.enabled) return null;
    return await clipper.create(world);
  }
  async function createFromState(state: {
    normal: [number, number, number];
    origin: [number, number, number];
  }) {
    if (!clipper.enabled) {
      clipper.enabled = true;
    }

    const plane = await clipper.create(world);

    if (!plane) return null;

    plane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(...state.normal),
      new THREE.Vector3(...state.origin)
    );

    return plane;
  }

  function deleteAll() {
    clipper.deleteAll();
  }

  function isEnabled() {
    return clipper.enabled;
  }

  function debugPlanes() {
    const entries = Array.from(clipper.list);

    console.log(
      "[clipper] plane ids",
      entries.map(([id]) => id)
    );

    console.log(
      "[clipper] plane methods",
      entries.map(([id, plane]) => ({
        id,
        keys: Object.keys(plane),
        protoKeys: Object.getOwnPropertyNames(Object.getPrototypeOf(plane))
      }))
    );

    return entries;
  }

  return {
    setEnabled,
    toggle,
    create,
    createFromState,
    deleteAll,
    isEnabled,
    debugPlanes
  };
}