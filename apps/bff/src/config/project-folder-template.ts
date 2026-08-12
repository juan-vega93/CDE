import fs from "node:fs";

export type ProjectFolderTemplateNode = {
  name: string;
  children?: ProjectFolderTemplateNode[];
};

function folder(name: string, children?: ProjectFolderTemplateNode[]): ProjectFolderTemplateNode {
  return children?.length ? { name, children } : { name };
}

function disciplineFolders() {
  return ["3-2-1-BE", "3-2-2-SE", "3-2-3-GE", "3-2-4-LE", "3-2-5-IE", "3-2-6-BM"].map(
    (name) => folder(name, [folder("EXPORT"), folder("INPUT"), folder("WORK")])
  );
}

export const DEFAULT_PROJECT_FOLDER_TEMPLATE: ProjectFolderTemplateNode[] = [
  folder("1-DATA", [folder("1-1-CONT"), folder("1-2-COMM"), folder("1-3-EXTD")]),
  folder("2-PLAN", [folder("2-1-QPLA"), folder("2-2-PROG"), folder("2-3-DLIST")]),
  folder("3-WIPR", [folder("3-1-NOGR"), folder("3-2-GRPH", disciplineFolders())]),
  folder("4-SHRD", [folder("4-1-INFO"), folder("4-2-COOR")]),
  folder("5-PUBL", [folder("5-1-DEL-1")]),
  folder("6-JPRO", [folder("6-1-ARCH")])
];

function isTemplateNode(value: unknown): value is ProjectFolderTemplateNode {
  if (!value || typeof value !== "object") return false;

  const node = value as ProjectFolderTemplateNode;
  if (typeof node.name !== "string" || node.name.trim().length === 0) return false;
  if (node.name.includes("/") || node.name.includes("\\")) return false;
  if (node.children === undefined) return true;

  return Array.isArray(node.children) && node.children.every(isTemplateNode);
}

function normalizeTemplate(nodes: ProjectFolderTemplateNode[]): ProjectFolderTemplateNode[] {
  return nodes.map((node) => {
    const normalized: ProjectFolderTemplateNode = { name: node.name.trim() };
    if (node.children?.length) normalized.children = normalizeTemplate(node.children);
    return normalized;
  });
}

function parseTemplate(raw: string, sourceLabel: string) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isTemplateNode)) {
      throw new Error("Template must be an array of folder nodes with name and optional children.");
    }
    return normalizeTemplate(parsed);
  } catch (error) {
    console.warn(`[project-folder-template] Ignoring ${sourceLabel}:`, error);
    return null;
  }
}

function parseTemplateFromFile() {
  const filePath = process.env.PROJECT_FOLDER_TEMPLATE_FILE?.trim();
  if (!filePath) return null;

  try {
    return parseTemplate(fs.readFileSync(filePath, "utf8"), `PROJECT_FOLDER_TEMPLATE_FILE ${filePath}`);
  } catch (error) {
    console.warn(`[project-folder-template] Cannot read PROJECT_FOLDER_TEMPLATE_FILE ${filePath}:`, error);
    return null;
  }
}

function parseTemplateFromEnv() {
  const raw = process.env.PROJECT_FOLDER_TEMPLATE_JSON?.trim();
  return raw ? parseTemplate(raw, "PROJECT_FOLDER_TEMPLATE_JSON") : null;
}

export function getProjectFolderTemplate(): ProjectFolderTemplateNode[] {
  return parseTemplateFromFile() ?? parseTemplateFromEnv() ?? DEFAULT_PROJECT_FOLDER_TEMPLATE;
}

function flattenTemplate(nodes: ProjectFolderTemplateNode[], parentPath = ""): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    paths.push(currentPath);
    if (node.children?.length) paths.push(...flattenTemplate(node.children, currentPath));
  }

  return paths;
}

export function getProjectFolderTemplatePaths() {
  return flattenTemplate(getProjectFolderTemplate());
}