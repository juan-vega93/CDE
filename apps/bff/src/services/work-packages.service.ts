import type {
  WorkPackage,
  CreateWorkPackageInput
} from "../types/work-package.types";
import { readJsonFile, writeJsonFile } from "../utils/json-store";
import { OpenProjectAdapter } from "../adapters/openproject.adapter";

const WORK_PACKAGES_FILE = "data/work-packages.json";
const openProjectAdapter = new OpenProjectAdapter();

function readWorkPackages(): WorkPackage[] {
  return readJsonFile<WorkPackage[]>(WORK_PACKAGES_FILE, []);
}

function saveWorkPackages(workPackages: WorkPackage[]): void {
  writeJsonFile(WORK_PACKAGES_FILE, workPackages);
}

function createMockWorkPackage(input: CreateWorkPackageInput): WorkPackage {
  const workPackagesStore = readWorkPackages();

  const newWorkPackage: WorkPackage = {
    id: workPackagesStore.length + 1,
    subject: input.subject,
    description: input.description,
    status: "new",
    assigneeId: input.assigneeId,
    dueDate: input.dueDate,
    createdAt: new Date().toISOString(),
    openProjectId: workPackagesStore.length + 100,
    bcfTopicId: input.bcfTopicId,
    snapshotUrl: input.snapshotUrl,
    attachmentUrls: input.attachmentUrls,
    viewpointInfo: input.viewpointInfo,
  };

  workPackagesStore.push(newWorkPackage);
  saveWorkPackages(workPackagesStore);

  return newWorkPackage;
}

export async function createWorkPackage(
  input: CreateWorkPackageInput
): Promise<WorkPackage> {
  const useMock = process.env.USE_OPENPROJECT_MOCK !== "false";

  if (useMock) {
    return createMockWorkPackage(input);
  }

  try {
    const realWorkPackage = await openProjectAdapter.createWorkPackage(input);

    const workPackagesStore = readWorkPackages();
    const exists = workPackagesStore.some((wp) => wp.id === realWorkPackage.id);

    if (!exists) {
      const enriched: WorkPackage = {
        ...realWorkPackage,
        openProjectId: realWorkPackage.id,
        bcfTopicId: input.bcfTopicId,
        snapshotUrl: input.snapshotUrl,
        attachmentUrls: input.attachmentUrls,
        viewpointInfo: input.viewpointInfo,
      };
      workPackagesStore.push(enriched);
      saveWorkPackages(workPackagesStore);
      return enriched;
    }

    return realWorkPackage;
  } catch (error) {
    console.error(
      "[work-packages.service] OpenProject real failed, using mock:",
      error
    );

    return createMockWorkPackage(input);
  }
}

/**
 * Crea un WorkPackage en OpenProject desde un BCF topic con toda la metadata.
 */
export async function createWorkPackageFromBcfTopic(
  input: CreateWorkPackageInput
): Promise<WorkPackage> {
  const wp = await createWorkPackage(input);

  // Vincular en la store local con la metadata del BCF
  const store = readWorkPackages();
  const idx = store.findIndex((s) => s.id === wp.id);
  if (idx >= 0) {
    store[idx] = {
      ...store[idx],
      bcfTopicId: input.bcfTopicId || store[idx].bcfTopicId,
      snapshotUrl: input.snapshotUrl || store[idx].snapshotUrl,
      attachmentUrls: input.attachmentUrls || store[idx].attachmentUrls,
      viewpointInfo: input.viewpointInfo || store[idx].viewpointInfo,
    };
    saveWorkPackages(store);
  }

  return wp;
}

export function getWorkPackages(): WorkPackage[] {
  return readWorkPackages();
}

export async function getWorkPackageById(id: number): Promise<WorkPackage | null> {
  const useMock = process.env.USE_OPENPROJECT_MOCK !== "false";

  if (useMock) {
    const workPackagesStore = readWorkPackages();
    return workPackagesStore.find((wp) => wp.id === id) ?? null;
  }

  try {
    return await openProjectAdapter.getWorkPackageById(id);
  } catch (error) {
    console.error(
      "[work-packages.service] OpenProject get by id failed, using local JSON:",
      error
    );

    const workPackagesStore = readWorkPackages();
    return workPackagesStore.find((wp) => wp.id === id) ?? null;
  }
}