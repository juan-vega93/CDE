import * as THREE from "three";
import * as OBC from "@thatopen/components";
import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";
import { createWorld } from "@/features/viewer-ifc/lib/create-world";
import { setupViewerModules } from "@/features/viewer-ifc/modules";

type ViewerRuntime = ReturnType<typeof createWorld>;
type ViewerModules = ReturnType<typeof setupViewerModules>;

type CaptureViewpointExtra = {
  loadedModels?: Array<{
    key: string;
    name: string;
    documentPath?: string;
    documentName?: string;
    visible: boolean;
    isolated: boolean;
  }>;
  selectedColor?: string;
  sectionBoxPadding?: number;
  snapshot?: string | null;
  coloredSelection?: {
    modelId: string;
    expressIds: number[];
  }[];
};

type ApplyViewpointExtra = {
  applyModelsState?: (
    modelsState: NonNullable<ViewerViewpoint["federated"]>["modelsState"]
  ) => Promise<void> | void;
};

export async function captureViewpoint(
  viewer: ViewerRuntime,
  modules: ViewerModules,
  extra?: CaptureViewpointExtra
): Promise<ViewerViewpoint | null> {
  const controls = viewer.camera.controls;
  const threeCamera = viewer.camera.three;

  if (!controls) return null;

  const targetVec = new THREE.Vector3();
  controls.getTarget(targetVec);

  const hidden = await modules.visibility.getHiddenMap();  
  const clippingEnabled = modules.clipper?.isEnabled?.() ?? false;    
  const selectionMap = modules.selection.getSelectionModelIdMap();
  
  console.log("[captureViewpoint] hidden", hidden);
  console.log("[captureViewpoint] selectionMap", selectionMap);

  return {
    id: crypto.randomUUID(),
    name: "Vista nueva",
    camera: {
      position: [
        threeCamera.position.x,
        threeCamera.position.y,
        threeCamera.position.z
      ],
      target: [targetVec.x, targetVec.y, targetVec.z]
    },
    visibility: {
      hidden
    },
    federated: {
      loadedModels:
        extra?.loadedModels?.map((model) => ({
          documentPath: model.documentPath,
          documentName: model.documentName ?? model.name
        })) ?? [],
      modelsState:
        extra?.loadedModels?.map((model) => ({
          key: model.key,
          name: model.name,
          documentPath: model.documentPath,
          documentName: model.documentName ?? model.name,
          visible: model.visible,
          isolated: model.isolated
        })) ?? []
    },
    selection: Object.entries(selectionMap).map(([modelId, ids]) => ({
      modelId,
      expressIds: Array.from(ids)
    })),
    clippingEnabled,
    display: {
      selectedColor: extra?.selectedColor,
      sectionBoxPadding: extra?.sectionBoxPadding
    },
    snapshot: extra?.snapshot ?? null,
    coloring: {
      color: extra?.selectedColor,
      selection: extra?.coloredSelection ?? []
    }
  };
}

export async function applyViewpoint(
  viewer: ViewerRuntime,
  modules: ViewerModules,
  viewpoint: ViewerViewpoint,
  extra?: ApplyViewpointExtra
) {
  const controls = viewer.camera.controls;
  if (!controls) return;

  const [x, y, z] = viewpoint.camera.position;
  const [tx, ty, tz] = viewpoint.camera.target;

  await controls.setLookAt(x, y, z, tx, ty, tz, true);

  if (modules.clipper) {
    try {
      modules.clipper.setEnabled(viewpoint.clippingEnabled ?? false);
    } catch (error) {
      console.warn("[viewpoint] error restoring clipping state:", error);
    }
  }

  await modules.visibility.applyHiddenMap(viewpoint.visibility.hidden);

  if (viewpoint.federated?.modelsState && extra?.applyModelsState) {
    await extra.applyModelsState(viewpoint.federated.modelsState);
  }
}

export async function fitObjectInView(
  viewer: ViewerRuntime,
  object: THREE.Object3D
) {
  const controls = viewer.camera.controls;
  if (!controls) return;

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  await controls.fitToSphere(sphere, true);
}

export async function fitSelectionInView(
  viewer: ViewerRuntime,
  components: OBC.Components,
  modelIdMap: OBC.ModelIdMap
) {
  const controls = viewer.camera.controls;
  if (!controls) return;

  if (Object.keys(modelIdMap).length === 0) return;

  const boxer = components.get(OBC.BoundingBoxer);
  boxer.list.clear();

  await boxer.addFromModelIdMap(modelIdMap);

  const box = boxer.get();
  boxer.list.clear();

  if (box.isEmpty()) return;

  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  await controls.fitToSphere(sphere, true);
}