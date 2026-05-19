import Link from "next/link";
import type { FolderItem } from "@/types/documents";

type FoldersListProps = {
  folders: FolderItem[];
};

export function FoldersList({ folders }: FoldersListProps) {
  return (
    <div className="mt-6 rounded-xl border bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Carpetas</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {folders.map((folder) => (
          <Link
            key={folder.path}
            href={`/documents?path=${encodeURIComponent(folder.path)}`}
            className="rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900"
          >
            {folder.name}
          </Link>
        ))}
      </div>
    </div>
  );
}