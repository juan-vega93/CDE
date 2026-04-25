"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { canManageUsers } from "@/lib/rbac";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const navigationItems = [
    { label: "Inicio", href: "/" },
    { label: "Documentos", href: "/documents" },
    ...(canManageUsers(session?.roles) ? [{ label: "Usuarios", href: "/admin/users" }] : []),
    { label: "Workflows", href: "#" },
    { label: "Visor BIM", href: "/viewer" }
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-white">
      <div className="border-b px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Portal CDE BIM
        </p>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">TYPSA CDE</h1>
      </div>

      <nav className="flex-1 px-4 py-4">
        <ul className="space-y-2">
          {navigationItems.map((item) => {
            const active = item.href !== "#" && isActive(item.href);

            return (
              <li key={item.label}>
                {item.href === "#" ? (
                  <div className="rounded-lg px-3 py-2 text-sm text-gray-400">
                    {item.label}
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}