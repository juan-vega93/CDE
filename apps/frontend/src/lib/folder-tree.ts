import type { ExplorerRow, FolderTreeNode } from "@/types/documents";

export function normalizeTreePath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function getTreeParentPath(path: string) {
  const parts = normalizeTreePath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function getTreeAncestors(path: string) {
  const parts = normalizeTreePath(path).split("/").filter(Boolean);
  const ancestors = new Set<string>(["/"]);
  for (let index = 1; index <= parts.length; index += 1) {
    ancestors.add(`/${parts.slice(0, index).join("/")}`);
  }
  return Array.from(ancestors);
}

function getNodeName(path: string) {
  const parts = normalizeTreePath(path).split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "/";
}

function isSameOrDescendant(path: string, parentPath: string) {
  const normalizedPath = normalizeTreePath(path);
  const normalizedParent = normalizeTreePath(parentPath);
  return (
    normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent === "/" ? "" : normalizedParent}/`)
  );
}

function sortChildren(children: FolderTreeNode[]) {
  return [...children].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

export function normalizeFolderTreeNode(node: FolderTreeNode): FolderTreeNode {
  const normalizedPath = normalizeTreePath(node.path);
  return {
    ...node,
    path: normalizedPath,
    name: node.name || getNodeName(normalizedPath),
    children: sortChildren((node.children ?? []).map(normalizeFolderTreeNode))
  };
}

function makeNode(path: string): FolderTreeNode {
  const normalizedPath = normalizeTreePath(path);
  return {
    name: getNodeName(normalizedPath),
    path: normalizedPath,
    type: "folder",
    children: []
  };
}

function insertPath(root: FolderTreeNode, path: string): FolderTreeNode {
  const normalizedRoot = normalizeFolderTreeNode(root);
  const normalizedPath = normalizeTreePath(path);

  if (!isSameOrDescendant(normalizedPath, normalizedRoot.path)) {
    return normalizedRoot;
  }

  if (normalizedPath === normalizedRoot.path) {
    return normalizedRoot;
  }

  const rootParts = normalizedRoot.path.split("/").filter(Boolean);
  const pathParts = normalizedPath.split("/").filter(Boolean);
  const nextPart = pathParts[rootParts.length];
  const childPath = normalizeTreePath(`/${pathParts.slice(0, rootParts.length + 1).join("/")}`);
  const existingChild = normalizedRoot.children.find((child) => normalizeTreePath(child.path) === childPath);
  const child = existingChild ?? makeNode(childPath);
  const nextChild = insertPath(child, normalizedPath);
  const children = normalizedRoot.children
    .filter((current) => normalizeTreePath(current.path) !== childPath)
    .concat({ ...nextChild, name: nextChild.name || nextPart });

  return {
    ...normalizedRoot,
    children: sortChildren(children)
  };
}

export function insertFolderSubtree(root: FolderTreeNode, subtree: FolderTreeNode): FolderTreeNode {
  const normalizedSubtree = normalizeFolderTreeNode(subtree);
  let nextRoot = insertPath(root, normalizedSubtree.path);
  for (const child of normalizedSubtree.children) {
    nextRoot = insertFolderSubtree(nextRoot, child);
  }
  return nextRoot;
}

export function mergeFolderTrees(current: FolderTreeNode | null, incoming: FolderTreeNode | null) {
  if (!incoming) return current;
  if (!current) return normalizeFolderTreeNode(incoming);

  const normalizedCurrent = normalizeFolderTreeNode(current);
  const normalizedIncoming = normalizeFolderTreeNode(incoming);

  if (normalizedCurrent.path === normalizedIncoming.path) {
    let merged = normalizedCurrent;
    for (const child of normalizedIncoming.children) {
      merged = insertFolderSubtree(merged, child);
    }
    return merged;
  }

  if (isSameOrDescendant(normalizedIncoming.path, normalizedCurrent.path)) {
    return insertFolderSubtree(normalizedCurrent, normalizedIncoming);
  }

  if (isSameOrDescendant(normalizedCurrent.path, normalizedIncoming.path)) {
    return insertFolderSubtree(normalizedIncoming, normalizedCurrent);
  }

  const currentProject = normalizedCurrent.path.split("/").filter(Boolean)[0];
  const incomingProject = normalizedIncoming.path.split("/").filter(Boolean)[0];
  if (currentProject && currentProject === incomingProject) {
    let projectRoot = makeNode(`/${currentProject}`);
    projectRoot = insertFolderSubtree(projectRoot, normalizedCurrent);
    projectRoot = insertFolderSubtree(projectRoot, normalizedIncoming);
    return projectRoot;
  }

  return normalizedIncoming;
}

export function buildFolderTreePatch(rootPath: string, focusPath: string, rows: ExplorerRow[]) {
  let root = makeNode(rootPath);
  root = insertPath(root, focusPath);

  for (const row of rows) {
    if (row.kind === "folder") {
      root = insertPath(root, row.path);
    }
  }

  return root;
}

