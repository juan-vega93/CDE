import * as THREE from "three";
import * as OBC from "@thatopen/components";

type SetupMeasurementParams = {
  components: OBC.Components;
  world: OBC.World;
};

export type ViewerMeasurementMode = "distance" | "area" | "volume";

export type ViewerMeasurementRecord = {
  id: string;
  type: ViewerMeasurementMode;
  points: [number, number, number][];
  value: number;
  unit: "m" | "m2" | "m3";
  createdAt: string;
};

const MEASURE_COLOR = "#e30613";
const AREA_COLOR = "#f97316";
const VOLUME_COLOR = "#2563eb";
const SNAP_COLOR = "#facc15";
const MAX_CUSTOM_MEASUREMENTS = 80;
const AREA_CLOSE_DISTANCE = 0.35;

function createMeasurementId() {
  return `measurement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function vectorToTuple(point: THREE.Vector3): [number, number, number] {
  return [point.x, point.y, point.z];
}

function formatValue(value: number, unit: ViewerMeasurementRecord["unit"]) {
  return `${value.toFixed(value >= 10 ? 2 : 3)} ${unit}`;
}

function createLabelSprite(text: string, color: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const width = 256;
  const height = 72;

  canvas.width = width;
  canvas.height = height;

  if (context) {
    context.fillStyle = "rgba(8, 8, 10, 0.86)";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.strokeRect(2, 2, width - 4, height - 4);
    context.font = "600 28px Arial";
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.2, 0.62, 1);

  return sprite;
}

function disposeObject(object: THREE.Object3D) {
  type MaterialWithMap = THREE.Material & {
    map?: THREE.Texture | null;
  };

  function disposeMaterial(material: THREE.Material) {
    const materialWithMap = material as MaterialWithMap;
    materialWithMap.map?.dispose();
    material.dispose();
  }

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;

    geometry?.dispose();

    if (Array.isArray(material)) {
      for (const entry of material) {
        disposeMaterial(entry);
      }
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function getCentroid(points: THREE.Vector3[]) {
  const centroid = new THREE.Vector3();

  for (const point of points) {
    centroid.add(point);
  }

  return centroid.divideScalar(Math.max(points.length, 1));
}

function getPolygonArea(points: THREE.Vector3[]) {
  if (points.length < 3) return 0;

  const origin = points[0];
  let area = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index].clone().sub(origin);
    const b = points[index + 1].clone().sub(origin);
    area += a.cross(b).length() / 2;
  }

  return area;
}

function getBoxVolume(points: THREE.Vector3[]) {
  if (points.length < 3) return 0;

  const [baseA, baseB, heightPoint] = points;
  const width = Math.abs(baseB.x - baseA.x);
  const depth = Math.abs(baseB.z - baseA.z);
  const height = Math.abs(heightPoint.y - baseA.y);

  return width * depth * height;
}

function createLine(points: THREE.Vector3[], color: string, closed = false) {
  const linePoints = closed && points.length > 1 ? [...points, points[0]] : points;
  const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false
  });
  return new THREE.Line(geometry, material);
}

function createPointMarker(point: THREE.Vector3, color: string) {
  const geometry = new THREE.SphereGeometry(0.06, 12, 12);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false
  });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(point);
  return marker;
}

function createSnapMarker(point: THREE.Vector3) {
  const group = new THREE.Group();
  const ringGeometry = new THREE.TorusGeometry(0.11, 0.01, 8, 24);
  const sphereGeometry = new THREE.SphereGeometry(0.035, 10, 10);
  const material = new THREE.MeshBasicMaterial({
    color: SNAP_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95
  });
  const ring = new THREE.Mesh(ringGeometry, material);
  const sphere = new THREE.Mesh(sphereGeometry, material.clone());

  ring.position.copy(point);
  sphere.position.copy(point);
  ring.renderOrder = 999;
  sphere.renderOrder = 1000;
  group.add(ring, sphere);

  return group;
}

function createAreaMesh(points: THREE.Vector3[], color: string) {
  const shape = new THREE.Shape();
  const origin = points[0];
  const axisX = points[1].clone().sub(origin).normalize();
  const normal = new THREE.Vector3();

  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index].clone().sub(origin);
    const b = points[index + 1].clone().sub(origin);
    normal.add(a.cross(b));
  }

  normal.normalize();
  const axisY = normal.clone().cross(axisX).normalize();

  points.forEach((point, index) => {
    const relative = point.clone().sub(origin);
    const x = relative.dot(axisX);
    const y = relative.dot(axisY);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshBasicMaterial({
    color,
    opacity: 0.24,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);

  const matrix = new THREE.Matrix4().makeBasis(axisX, axisY, normal);
  mesh.applyMatrix4(matrix);
  mesh.position.copy(origin);

  return mesh;
}

function createVolumeBox(points: THREE.Vector3[], color: string) {
  const [baseA, baseB, heightPoint] = points;
  const min = new THREE.Vector3(
    Math.min(baseA.x, baseB.x),
    Math.min(baseA.y, heightPoint.y),
    Math.min(baseA.z, baseB.z)
  );
  const max = new THREE.Vector3(
    Math.max(baseA.x, baseB.x),
    Math.max(baseA.y, heightPoint.y),
    Math.max(baseA.z, baseB.z)
  );
  const size = max.clone().sub(min);
  const center = min.clone().add(max).multiplyScalar(0.5);
  const geometry = new THREE.BoxGeometry(
    Math.max(size.x, 0.01),
    Math.max(size.y, 0.01),
    Math.max(size.z, 0.01)
  );
  const material = new THREE.MeshBasicMaterial({
    color,
    opacity: 0.18,
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);

  const edges = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({ color, depthTest: false });
  const wireframe = new THREE.LineSegments(edges, edgeMaterial);
  wireframe.position.copy(center);

  const group = new THREE.Group();
  group.add(mesh, wireframe);
  return group;
}

export function setupMeasurement({ world }: SetupMeasurementParams) {
  const root = new THREE.Group();
  const activePreview = new THREE.Group();
  const snapPreview = new THREE.Group();
  const records: ViewerMeasurementRecord[] = [];
  const committedObjects: THREE.Object3D[] = [];
  let mode: ViewerMeasurementMode | null = null;
  let pendingPoints: THREE.Vector3[] = [];

  root.name = "typsa-measurements";
  activePreview.name = "typsa-measurement-preview";
  snapPreview.name = "typsa-measurement-snap-preview";
  world.scene.three.add(root);
  world.scene.three.add(activePreview);
  world.scene.three.add(snapPreview);

  function clearGroup(group: THREE.Group) {
    for (const object of [...group.children]) {
      group.remove(object);
      disposeObject(object);
    }
  }

  function commitGroup(group: THREE.Object3D, record: ViewerMeasurementRecord) {
    root.add(group);
    committedObjects.push(group);
    records.push(record);

    while (committedObjects.length > MAX_CUSTOM_MEASUREMENTS) {
      const oldest = committedObjects.shift();
      const removedRecord = records.shift();

      if (oldest) {
        root.remove(oldest);
        disposeObject(oldest);
      }

      if (!removedRecord) break;
    }

    return record;
  }

  function renderPendingPreview() {
    clearGroup(activePreview);

    const color = mode === "volume" ? VOLUME_COLOR : AREA_COLOR;

    for (const point of pendingPoints) {
      activePreview.add(createPointMarker(point, color));
    }

    if (pendingPoints.length > 1) {
      activePreview.add(createLine(pendingPoints, color, mode === "area"));
    }
  }

  function commitDistance(points: THREE.Vector3[]) {
    const value = points[0].distanceTo(points[1]);
    const group = new THREE.Group();
    group.add(createLine(points, MEASURE_COLOR));
    for (const point of points) group.add(createPointMarker(point, MEASURE_COLOR));

    const label = createLabelSprite(formatValue(value, "m"), MEASURE_COLOR);
    label.position.copy(getCentroid(points));
    group.add(label);
    return commitGroup(group, {
      id: createMeasurementId(),
      type: "distance" as const,
      points: points.map(vectorToTuple),
      value,
      unit: "m" as const,
      createdAt: new Date().toISOString()
    });
  }

  function commitArea(points: THREE.Vector3[]) {
    const value = getPolygonArea(points);
    const group = new THREE.Group();
    group.add(createAreaMesh(points, AREA_COLOR));
    group.add(createLine(points, AREA_COLOR, true));
    for (const point of points) group.add(createPointMarker(point, AREA_COLOR));

    const label = createLabelSprite(formatValue(value, "m2"), AREA_COLOR);
    label.position.copy(getCentroid(points));
    group.add(label);
    return commitGroup(group, {
      id: createMeasurementId(),
      type: "area" as const,
      points: points.map(vectorToTuple),
      value,
      unit: "m2" as const,
      createdAt: new Date().toISOString()
    });
  }

  function commitVolume(points: THREE.Vector3[]) {
    const value = getBoxVolume(points);
    const group = new THREE.Group();
    group.add(createVolumeBox(points, VOLUME_COLOR));
    for (const point of points) group.add(createPointMarker(point, VOLUME_COLOR));

    const label = createLabelSprite(formatValue(value, "m3"), VOLUME_COLOR);
    label.position.copy(getCentroid(points));
    group.add(label);
    return commitGroup(group, {
      id: createMeasurementId(),
      type: "volume" as const,
      points: points.map(vectorToTuple),
      value,
      unit: "m3" as const,
      createdAt: new Date().toISOString()
    });
  }

  function commitGeometryMetric(
    type: "area" | "volume",
    value: number,
    center: THREE.Vector3
  ) {
    const color = type === "area" ? AREA_COLOR : VOLUME_COLOR;
    const unit = type === "area" ? "m2" : "m3";
    const group = new THREE.Group();
    group.add(createPointMarker(center, color));

    const label = createLabelSprite(formatValue(value, unit), color);
    label.position.copy(center);
    group.add(label);

    return commitGroup(group, {
      id: createMeasurementId(),
      type,
      points: [vectorToTuple(center)],
      value,
      unit,
      createdAt: new Date().toISOString()
    });
  }

  function resetPending() {
    pendingPoints = [];
    clearGroup(activePreview);
  }

  return {
    get mode() {
      return mode;
    },

    start(nextMode: ViewerMeasurementMode) {
      mode = nextMode;
      resetPending();
    },

    startLength() {
      this.start("distance");
    },

    addPoint(point: THREE.Vector3) {
      if (!mode) return null;

      if (
        mode === "area" &&
        pendingPoints.length >= 3 &&
        pendingPoints[0].distanceTo(point) <= AREA_CLOSE_DISTANCE
      ) {
        const record = commitArea([...pendingPoints]);
        resetPending();
        return record;
      }

      pendingPoints.push(point.clone());
      renderPendingPreview();

      if (mode === "distance" && pendingPoints.length >= 2) {
        const record = commitDistance(pendingPoints.slice(0, 2));
        resetPending();
        return record;
      }

      if (mode === "volume" && pendingPoints.length >= 3) {
        const record = commitVolume(pendingPoints.slice(0, 3));
        resetPending();
        return record;
      }

      return null;
    },

    getPendingPointCount() {
      return pendingPoints.length;
    },

    finishArea() {
      if (mode !== "area" || pendingPoints.length < 3) return null;

      const record = commitArea([...pendingPoints]);
      resetPending();
      return record;
    },

    addGeometryArea(value: number, center: THREE.Vector3) {
      return commitGeometryMetric("area", value, center);
    },

    addGeometryVolume(value: number, center: THREE.Vector3) {
      return commitGeometryMetric("volume", value, center);
    },

    showSnapCandidate(point: THREE.Vector3 | null) {
      clearGroup(snapPreview);
      if (point) {
        snapPreview.add(createSnapMarker(point));
      }
    },

    clearSnapCandidate() {
      clearGroup(snapPreview);
    },

    cancel() {
      mode = null;
      resetPending();
      clearGroup(snapPreview);
    },

    deleteHovered() {},

    deleteAll() {
      this.cancel();
      records.splice(0, records.length);
      committedObjects.splice(0, committedObjects.length);

      clearGroup(root);
      clearGroup(activePreview);
      clearGroup(snapPreview);
    },

    dispose() {
      this.deleteAll();
      world.scene.three.remove(root);
      world.scene.three.remove(activePreview);
      world.scene.three.remove(snapPreview);
    },

    getValues() {
      return records.map((record) => record.value);
    },

    getRecords() {
      return [...records];
    }
  };
}
