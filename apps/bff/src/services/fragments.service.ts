import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";
import path from "path";
import { getDocumentContent } from "./documents.service";

function resolveWebIfcWasmPath(): string {
  const wasmFile = require.resolve("web-ifc/web-ifc-node.wasm");
  return path.dirname(wasmFile) + path.sep;
}

function configureImporterClasses(serializer: FRAGS.IfcImporter) {
  // Mantén lo que venga por defecto y agrega clases que suelen faltar
  const extraClasses = [
    // Estructura
    WEBIFC.IFCSLAB,
    WEBIFC.IFCPLATE,
    WEBIFC.IFCMEMBER,
    WEBIFC.IFCBUILDINGELEMENTPROXY,

    // Eléctricas / MEP
    WEBIFC.IFCCABLECARRIERSEGMENT,
    WEBIFC.IFCCABLECARRIERFITTING,
    WEBIFC.IFCCABLESEGMENT,
    WEBIFC.IFCCABLEFITTING,
    WEBIFC.IFCFLOWSEGMENT,
    WEBIFC.IFCFLOWFITTING
  ];

  for (const ifcClass of extraClasses) {
    serializer.classes.elements.add(ifcClass);
  }
}

export async function generateFragFromDocument(
  documentPath: string
): Promise<Uint8Array> {
  if (!documentPath.trim()) {
    throw new Error("documentPath es requerido");
  }

  const ifcFile = await getDocumentContent(documentPath);

  const serializer = new FRAGS.IfcImporter();
  serializer.wasm = {
    absolute: true,
    path: resolveWebIfcWasmPath()
  };

  configureImporterClasses(serializer);

  const fragBytes = await serializer.process({
    bytes: new Uint8Array(ifcFile.buffer)
  });

  return fragBytes;
}