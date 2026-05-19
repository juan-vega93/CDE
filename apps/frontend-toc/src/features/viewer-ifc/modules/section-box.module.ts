import * as THREE from "three";
import * as OBC from "@thatopen/components";

type SetupSectionBoxParams = {
  components: OBC.Components;
  world: OBC.World;
};

type CreateSectionBoxOptions = {
  paddingFactor?: number;
  minPadding?: number;
};

const SECTION_BOX_TYPE = "section-box";

export function setupSectionBox({
  components,
  world
}: SetupSectionBoxParams) {
  const boxer = components.get(OBC.BoundingBoxer);
  const clipper = components.get(OBC.Clipper);

  function clear() {
    clipper.deleteAll(new Set([SECTION_BOX_TYPE]));
  }

  async function createFromSelection(
    modelIdMap: OBC.ModelIdMap,
    options: CreateSectionBoxOptions = {}
  ) {
    if (Object.keys(modelIdMap).length === 0) {
      return false;
    }

    const paddingFactor = options.paddingFactor ?? 0.2;
    const minPadding = options.minPadding ?? 0.5;

    boxer.list.clear();
    await boxer.addFromModelIdMap(modelIdMap);
    const box = boxer.get();
    boxer.list.clear();

    if (box.isEmpty()) {
      return false;
    }

    clear();

    const size = new THREE.Vector3();
    box.getSize(size);

    const longestSide = Math.max(size.x, size.y, size.z, 0);
    const padding = Math.max(longestSide * paddingFactor, minPadding);

    const min = box.min.clone().addScalar(-padding);
    const max = box.max.clone().addScalar(padding);

    const centerX = (min.x + max.x) / 2;
    const centerY = (min.y + max.y) / 2;
    const centerZ = (min.z + max.z) / 2;

    const planes = [
      {
        normal: new THREE.Vector3(1, 0, 0),
        point: new THREE.Vector3(min.x, centerY, centerZ)
      },
      {
        normal: new THREE.Vector3(-1, 0, 0),
        point: new THREE.Vector3(max.x, centerY, centerZ)
      },
      {
        normal: new THREE.Vector3(0, 1, 0),
        point: new THREE.Vector3(centerX, min.y, centerZ)
      },
      {
        normal: new THREE.Vector3(0, -1, 0),
        point: new THREE.Vector3(centerX, max.y, centerZ)
      },
      {
        normal: new THREE.Vector3(0, 0, 1),
        point: new THREE.Vector3(centerX, centerY, min.z)
      },
      {
        normal: new THREE.Vector3(0, 0, -1),
        point: new THREE.Vector3(centerX, centerY, max.z)
      }
    ];

    for (const definition of planes) {
      const planeId = clipper.createFromNormalAndCoplanarPoint(
        world,
        definition.normal,
        definition.point
      );

      const plane = clipper.list.get(planeId);
      if (!plane) continue;

      plane.type = SECTION_BOX_TYPE;
      plane.visible = false;
      plane.enabled = true;
    }

    return true;
  }

  return {
    createFromSelection,
    clear
  };
}