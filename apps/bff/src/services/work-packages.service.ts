import type {
  WorkPackage,
  WorkPackageStatus,
  CreateWorkPackageInput
} from "../types/work-package.types";
import { readJsonFile, writeJsonFile } from "../utils/json-store";
import { OpenProjectAdapter } from "../adapters/openproject.adapter";
import { syncWorkPackageStatusForLinks } from "./work-package-links.service";

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
    projectCode: input.projectCode,
    openProjectProjectId: input.openProjectProjectId,
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
        projectCode: input.projectCode,
        openProjectProjectId: input.openProjectProjectId,
        snapshotUrl: input.snapshotUrl,
        attachmentUrls: input.attachmentUrls,
        viewpointInfo: input.viewpointInfo
      };
      workPackagesStore.push(enriched);
      saveWorkPackages(workPackagesStore);
      return enriched;
    }

    return realWorkPackage;
    } catch (error) {
    console.error(
      "[work-packages.service] OpenProject real failed:",
      error
    );

    throw error;
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
    projectCode: input.projectCode || store[idx].projectCode,
    openProjectProjectId:
      input.openProjectProjectId || store[idx].openProjectProjectId,
    snapshotUrl: input.snapshotUrl || store[idx].snapshotUrl,
    attachmentUrls: input.attachmentUrls || store[idx].attachmentUrls,
    viewpointInfo: input.viewpointInfo || store[idx].viewpointInfo
  };
    saveWorkPackages(store);
  }

  return wp;
}

export function getWorkPackages(): WorkPackage[] {
  return readWorkPackages();
}

export async function updateWorkPackageStatus(
  id: number,
  newStatus: WorkPackageStatus
): Promise<WorkPackage | null> {
  const useMock = process.env.USE_OPENPROJECT_MOCK !== "false";

  if (useMock) {
    const workPackagesStore = readWorkPackages();
    const index = workPackagesStore.findIndex((wp) => wp.id === id);

    if (index === -1) return null;

    workPackagesStore[index] = {
      ...workPackagesStore[index],
      status: newStatus
    };
    saveWorkPackages(workPackagesStore);

    // Sync status into work-package-links store
    syncWorkPackageStatusForLinks(id, newStatus);

    return workPackagesStore[index];
  }

  const workPackagesStore = readWorkPackages();
  const localWp = workPackagesStore.find((wp) => wp.id === id);
  const openProjectId = localWp?.openProjectId ?? id;

  try {
    const updated = await openProjectAdapter.updateWorkPackageStatus(openProjectId, newStatus);

    const index = workPackagesStore.findIndex((wp) => wp.id === id);

    if (index >= 0) {
      workPackagesStore[index] = {
        ...workPackagesStore[index],
        status: updated.status
      };
      saveWorkPackages(workPackagesStore);
    }

    // Sync status into work-package-links store (use both portal ID and openProjectId)
    syncWorkPackageStatusForLinks(openProjectId, newStatus);
    syncWorkPackageStatusForLinks(id, newStatus);

    return updated;
  } catch (error) {
    console.error(
      "[work-packages.service] OpenProject update status failed, using local JSON:",
      error
    );

    const catchIndex = workPackagesStore.findIndex((wp) => wp.id === id);

    if (catchIndex === -1) return null;

    workPackagesStore[catchIndex] = {
      ...workPackagesStore[catchIndex],
      status: newStatus
    };
    saveWorkPackages(workPackagesStore);

    // Sync status into work-package-links store (use both portal ID and openProjectId)
    syncWorkPackageStatusForLinks(openProjectId, newStatus);
    syncWorkPackageStatusForLinks(id, newStatus);

    return workPackagesStore[catchIndex];
  }
}

export async function getWorkPackageById(id: number): Promise<WorkPackage | null> {
  const useMock = process.env.USE_OPENPROJECT_MOCK !== "false";
  const workPackagesStore = readWorkPackages();
  const localWp = workPackagesStore.find((wp) => wp.id === id);

  if (useMock) {
    return localWp ?? null;
  }

  // Determine the real OpenProject ID to query
  // Some WPs were created in mock mode with fake openProjectId values.
  // The local store has the canonical mapping.
  const openProjectId = localWp?.openProjectId ?? id;

  try {
    const opWp = await openProjectAdapter.getWorkPackageById(openProjectId);

    // Update local store with latest data from OpenProject
    if (localWp) {
      const index = workPackagesStore.findIndex((wp) => wp.id === id);
      if (index >= 0) {
        workPackagesStore[index] = {
          ...workPackagesStore[index],
          status: opWp.status,
          subject: opWp.subject,
          description: opWp.description
        };
        saveWorkPackages(workPackagesStore);

        // Also sync to work-package-links
        syncWorkPackageStatusForLinks(openProjectId, opWp.status);
      }
      return workPackagesStore[index];
    }

    return opWp;
  } catch (error) {
    console.error(
      "[work-packages.service] OpenProject get by id failed, using local JSON:",
      error
    );

    return localWp ?? null;
  }
}
