export function getParentPath(path: string): string | null {
  const cleanPath = path.trim();

  if (!cleanPath || cleanPath === "/") {
    return null;
  }

  const segments = cleanPath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  if (segments.length === 1) {
    return "/";
  }

  return `/${segments.slice(0, -1).join("/")}`;
}