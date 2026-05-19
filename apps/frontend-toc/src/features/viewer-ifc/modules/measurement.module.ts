import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";

type SetupMeasurementParams = {
  components: OBC.Components;
  world: OBC.World;
};

export function setupMeasurement({ components, world }: SetupMeasurementParams) {
  const length = components.get(OBF.LengthMeasurement);  

  length.world = world;
  length.color = new THREE.Color("#494cb6");
  length.rounding = 2;
  length.delay = 120;
  length.enabled = false;
  length.pickerSize = 10;
  const vertexPicker = (
    length as unknown as {
      _vertexPicker?: {
        maxDistance: number;
        pickerSize: number;
      };
    }
  )._vertexPicker;

  if (vertexPicker) {
    vertexPicker.maxDistance = 2;
    vertexPicker.pickerSize = 14;
  }
  length.snappings = [
    FRAGS.SnappingClass.POINT,
    FRAGS.SnappingClass.LINE,
    FRAGS.SnappingClass.FACE
  ];
  

  console.log("[viewer-ifc] Measurement module ready");

  return {
    enabled: false,

    startLength() {
      length.enabled = true;
    },
    createLength() {
      if (!length.enabled) return;
      length.create();
    },

    cancel() {
      try {
        length.cancelCreation?.();
      } catch {}

      try {
        length.endCreation?.();
      } catch {}

      length.enabled = false;
    },

    deleteHovered() {
      length.delete();
    },

    deleteAll() {
      this.cancel();

      try {
        length.list.clear();
      } catch {}     
    },

    getValues() {
      return Array.from(length.list).map((line) => line.value);
    }
  };
}