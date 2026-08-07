"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { canManageUsers } from "@/lib/rbac";

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectCode = searchParams.get("projectCode")?.trim().toUpperCase() || "";
  const { data: session } = useSession();
  const userRoles = session?.roles ?? [];
  const isProjectContext = Boolean(projectCode);

  const navigationItems = [
    {
      label: "Proyecto",
      href: "/admin/project-cards"
    },
    ...(isProjectContext && canManageUsers(userRoles)
      ? [
          {
            label: "Usuarios",
            href: `/admin/project-cards?section=users&projectCode=${encodeURIComponent(
              projectCode
            )}`
          }
        ]
      : []),
    ...(isProjectContext
      ? [
          {
            label: "Documentos",
            href: `/documents?projectCode=${encodeURIComponent(projectCode)}`
          },
          {
            label: "Workflows",
            href: `/workflows?projectCode=${encodeURIComponent(projectCode)}`
          },
          {
            label: "BIM",
            href: `/viewer?projectCode=${encodeURIComponent(projectCode)}`
          }
        ]
      : [])
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    const hrefPath = href.split("?")[0] || href;
    return pathname.startsWith(hrefPath);
  }

  return (
  <aside className="w-60 shrink-0 border-r border-red-900 bg-red-800 text-white">
    <nav className="flex flex-col gap-1 p-3 text-sm">
      {navigationItems.map((item) => {
        const active = item.href !== "#" && isActive(item.href);

        if (item.href === "#") {
          return (
            <div
              key={item.label}
              className="rounded px-3 py-2 text-left font-medium opacity-70"
            >
              {item.label}
            </div>
          );
        }

        return (
          <Link
            key={item.label}
            href={item.href}
            className={`rounded px-3 py-2 text-left font-medium transition ${
              active
                ? "bg-white text-red-800"
                : "text-white hover:bg-red-700"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  </aside>
);
}
