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

  function deleteAll() {
    clipper.deleteAll();
  }

  function isEnabled() {
    return clipper.enabled;
  }

  return {
    setEnabled,
    toggle,
    create,
    deleteAll,
    isEnabled
  };
}