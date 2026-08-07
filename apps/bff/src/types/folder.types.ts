export type FolderItem = {
  name: string;
  path: string;
  type: "folder";
};

export type FoldersResponse = {
  path: string;
  items: FolderItem[];
};

export type FolderTreeNode = FolderItem & {
  children: FolderTreeNode[];
};

export type FolderTreeResponse = {
  rootPath: string;
  depth: number;
  tree: FolderTreeNode;
};
