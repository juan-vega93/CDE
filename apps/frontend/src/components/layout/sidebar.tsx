"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { canManageUsers } from "@/lib/rbac";

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectCode = searchParams.get("projectCode") || "";
  const { data: session } = useSession();

  const navigationItems = [
     {
    label: "Proyecto",
    href: "/admin/project-cards"
    },
    {
      label: "Usuarios",
      href: projectCode
        ? `/admin/project-cards?section=users&projectCode=${encodeURIComponent(
            projectCode
          )}`
        : "/admin/project-cards?section=users"
    },
    {
      label: "Documentos",
      href: projectCode
        ? `/documents?projectCode=${encodeURIComponent(projectCode)}`
        : "/documents"
    },
    {
      label: "Workflows",
      href: projectCode
        ? `/workflows?projectCode=${encodeURIComponent(projectCode)}`
        : "/workflows"
    },
    {
      label: "BIM",
      href: projectCode
        ? `/viewer?projectCode=${encodeURIComponent(projectCode)}`
        : "/admin/project-cards"
    }
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
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