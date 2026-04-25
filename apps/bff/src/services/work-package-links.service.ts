import type {
  WorkPackageLink,
  CreateWorkPackageLinkInput
} from "../types/work-package-link.types";
import { readJsonFile, writeJsonFile } from "../utils/json-store";
import { getWorkPackageById } from "./work-packages.service";

const WORK_PACKAGE_LINKS_FILE = "data/work-package-links.json";

function readWorkPackageLinks(): WorkPackageLink[] {
  return readJsonFile<WorkPackageLink[]>(WORK_PACKAGE_LINKS_FILE, []);
}

function saveWorkPackageLinks(links: WorkPackageLink[]): void {
  writeJsonFile(WORK_PACKAGE_LINKS_FILE, links);
}

export function createWorkPackageLink(
  input: CreateWorkPackageLinkInput
): WorkPackageLink {
  const workPackageLinksStore = readWorkPackageLinks();
  const now = new Date().toISOString();

  const newLink: WorkPackageLink = {
    id: `wpl-${Date.now()}`,
    documentId: input.documentId,
    documentPath: input.documentPath,
    documentName: input.documentName,
    workPackageId: input.workPackageId,
    projectId: input.projectId,
    typeId: input.typeId,
    linkType: input.linkType,
    status: "active",
    createdAt: now,
    updatedAt: now
  };

  workPackageLinksStore.push(newLink);
  saveWorkPackageLinks(workPackageLinksStore);

  return newLink;
}

export function getWorkPackageLinks(): WorkPackageLink[] {
  return readWorkPackageLinks();
}

export function getWorkPackageLinkByDocumentId(
  documentId: string
): WorkPackageLink | null {
  const workPackageLinksStore = readWorkPackageLinks();

  return (
    workPackageLinksStore.find((link) => link.documentId === documentId) ?? null
  );
}


export async function syncWorkPackageStatusByDocumentId(
  documentId: string
): Promise<WorkPackageLink | null> {
  const links = readWorkPackageLinks();

  const link = links.find((l) => l.documentId === documentId);
  if (!link) return null;

  try {
    const wp = await getWorkPackageById(link.workPackageId);
    if (!wp) {
        link.lastSyncedAt = new Date().toISOString();
          link.updatedAt = new Date().toISOString();
            saveWorkPackageLinks(links);
       return link;
    }
    link.workPackageStatusName = wp.status;
    link.lastSyncedAt = new Date().toISOString();
    link.updatedAt = new Date().toISOString(); 
    saveWorkPackageLinks(links);
    return link;
  }catch (error) {
    console.error("[syncWorkPackageStatusByDocumentId] error:", error);
    return link; 
  }
}