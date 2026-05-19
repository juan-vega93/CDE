import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

export type ViewerWorld = {
  components: OBC.Components;
  world: OBC.World;
  renderer: OBF.PostproductionRenderer;
  camera: OBC.OrthoPerspectiveCamera;
};

export function createWorld(viewport: HTMLElement): ViewerWorld {
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);

  const world = worlds.create<
    OBC.SimpleScene,
    OBC.OrthoPerspectiveCamera,
    OBF.PostproductionRenderer
  >();

  world.name = "Main";

  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = new THREE.Color(0x1a1d23);

  const renderer = new OBF.PostproductionRenderer(components, viewport);
  const camera = new OBC.OrthoPerspectiveCamera(components);

  camera.threePersp.near = 0.01;
  camera.threePersp.updateProjectionMatrix();

  world.renderer = renderer;
  world.camera = camera;

  components.get(OBC.Grids).create(world);
  components.init();

  const rendererWithDirty = renderer as OBF.PostproductionRenderer & {
    needsUpdate?: boolean;
  };

  const markDirty = () => {
    rendererWithDirty.needsUpdate = true;
  };

  camera.controls.addEventListener("update", markDirty);
  renderer.onResize.add(markDirty);

  camera.controls.setLookAt(12, 10, 12, 0, 0, 0);
  renderer.resize();
  camera.updateAspect();
  markDirty();

  return {
    components,
    world,
    renderer,
    camera
  };
}