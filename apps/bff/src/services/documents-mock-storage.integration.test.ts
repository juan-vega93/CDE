import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearDocumentExplorerCache,
  getDocumentContent,
  getDocumentExplorer,
  getDocuments,
  uploadDocument
} from "./documents.service";

test("mock documental: upload persiste, lista, descarga, aísla y limpia su runtime temporal", async () => {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cde-mock-documents-test-"));
  const previousMock = process.env.USE_NEXTCLOUD_MOCK;
  const previousRuntime = process.env.BFF_RUNTIME_DIR;

  process.env.USE_NEXTCLOUD_MOCK = "true";
  process.env.BFF_RUNTIME_DIR = runtimeRoot;
  clearDocumentExplorerCache();

  try {
    const modelA = Buffer.from("TEST-MOCK-A-IFC-v1", "utf8");
    const modelB = Buffer.from("TEST-MOCK-B-IFC", "utf8");

    await uploadDocument("/TEST-MOCK-A/subcarpeta/model.ifc", modelA, "application/x-step");
    await uploadDocument("/TEST-MOCK-B/subcarpeta/model.ifc", modelB, "application/x-step");

    const projectA = await getDocumentExplorer("/TEST-MOCK-A");
    assert.deepEqual(projectA.folders, [
      { name: "subcarpeta", path: "/TEST-MOCK-A/subcarpeta", type: "folder" }
    ]);

    const listA = await getDocumentExplorer("/TEST-MOCK-A/subcarpeta");
    assert.equal(listA.documents.length, 1);
    assert.equal(listA.documents[0]?.name, "model.ifc");
    assert.equal(listA.documents[0]?.path, "/TEST-MOCK-A/subcarpeta/model.ifc");
    assert.equal(listA.documents[0]?.size, modelA.length);
    assert.equal(listA.documents[0]?.extension, "ifc");

    const documentsA = await getDocuments("/TEST-MOCK-A/subcarpeta");
    assert.equal(documentsA.items.length, 1);
    assert.equal(documentsA.items[0]?.path, "/TEST-MOCK-A/subcarpeta/model.ifc");

    const downloadA = await getDocumentContent("/TEST-MOCK-A/subcarpeta/model.ifc");
    assert.deepEqual(downloadA.buffer, modelA);
    assert.equal(downloadA.size, modelA.length);
    assert.equal(downloadA.fileName, "model.ifc");

    const downloadB = await getDocumentContent("/TEST-MOCK-B/subcarpeta/model.ifc");
    assert.deepEqual(downloadB.buffer, modelB);

    const overwritten = Buffer.from("TEST-MOCK-A-IFC-v2-with-new-size", "utf8");
    await uploadDocument("/TEST-MOCK-A/subcarpeta/model.ifc", overwritten, "application/x-step");
    clearDocumentExplorerCache();
    const overwrittenDownload = await getDocumentContent("/TEST-MOCK-A/subcarpeta/model.ifc");
    const overwrittenList = await getDocuments("/TEST-MOCK-A/subcarpeta");
    assert.deepEqual(overwrittenDownload.buffer, overwritten);
    assert.equal(overwrittenList.items[0]?.size, overwritten.length);

    await assert.rejects(
      uploadDocument("/TEST-MOCK-A/../../fuera.ifc", Buffer.from("blocked")),
      /ruta documental/i
    );
    await assert.rejects(
      uploadDocument("/TEST-MOCK-A\\fuera.ifc", Buffer.from("blocked")),
      /ruta documental/i
    );

    const blockedRuntimePath = path.join(runtimeRoot, "blocked-runtime");
    await fs.writeFile(blockedRuntimePath, "not a directory", "utf8");
    process.env.BFF_RUNTIME_DIR = blockedRuntimePath;
    await assert.rejects(
      uploadDocument("/TEST-MOCK-FAIL/write-failure.ifc", Buffer.from("must fail"))
    );

    process.env.BFF_RUNTIME_DIR = runtimeRoot;
    clearDocumentExplorerCache();
    const failedWriteList = await getDocumentExplorer("/TEST-MOCK-FAIL");
    assert.equal(failedWriteList.documents.length, 0);
  } finally {
    clearDocumentExplorerCache();
    if (previousMock === undefined) delete process.env.USE_NEXTCLOUD_MOCK;
    else process.env.USE_NEXTCLOUD_MOCK = previousMock;
    if (previousRuntime === undefined) delete process.env.BFF_RUNTIME_DIR;
    else process.env.BFF_RUNTIME_DIR = previousRuntime;
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
});
