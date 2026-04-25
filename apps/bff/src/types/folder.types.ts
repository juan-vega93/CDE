export type FolderItem = {
  name: string;
  path: string;
  type: "folder";
};

export type FoldersResponse = {
  path: string;
  items: FolderItem[];
};