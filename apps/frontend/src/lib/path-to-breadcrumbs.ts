import type { BreadcrumbItem } from "@/components/navigation/breadcrumbs";

export function pathToBreadcrumbs(path: string): BreadcrumbItem[] {
  const baseItems: BreadcrumbItem[] = [
    { label: "Inicio", href: "/" },
    { label: "Documentos", href: "/documents" }
  ];

  const cleanPath = path.trim();

  if (!cleanPath || cleanPath === "/") {
    return baseItems;
  }

  const segments = cleanPath.split("/").filter(Boolean);

  let accumulatedPath = "";

  const pathItems = segments.map((segment) => {
    accumulatedPath += `/${segment}`;

    return {
      label: segment,
      href: `/documents?path=${encodeURIComponent(accumulatedPath)}`
    };
  });

  return [...baseItems, ...pathItems];
}