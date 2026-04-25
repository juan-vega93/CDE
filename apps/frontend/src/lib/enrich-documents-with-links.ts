import type { ExplorerRow, WorkPackageLink } from "@/types/documents";

export function enrichDocumentsWithLinks(
  rows: ExplorerRow[],
  links: WorkPackageLink[]
): ExplorerRow[] {
  return rows.map((row) => {
    if (row.kind !== "document") {
      return row;
    }

    const workPackageLink =
      links.find((link) => link.documentId === row.id) ?? null;

    return {
      ...row,
      workPackageLink
    };
  });
}