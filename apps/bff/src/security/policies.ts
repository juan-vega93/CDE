import type { PortalRoleKey } from "../config/role-mapping.config";

export type Permission =
  | "project:read"
  | "project:write"
  | "document:read"
  | "document:write"
  | "bcf:read"
  | "bcf:write"
  | "project:admin"
  | "system:admin"
  | "document:hard-delete";

export type RouteClassification =
  | "PUBLIC"
  | "AUTHENTICATED"
  | "PROJECT_AUTHORIZED"
  | "SYSTEM_ADMIN";

const PROJECT_ROLE_PERMISSIONS: Record<PortalRoleKey, Permission[]> = {
  viewer: ["project:read", "document:read", "bcf:read"],
  "discipline-lead": [
    "project:read",
    "document:read",
    "document:write",
    "bcf:read",
    "bcf:write"
  ],
  "doc-controller": [
    "project:read",
    "document:read",
    "document:write",
    "bcf:read",
    "bcf:write",
    "project:write"
  ],
  "bim-coordinator": [
    "project:read",
    "project:write",
    "document:read",
    "document:write",
    "bcf:read",
    "bcf:write"
  ],
  "bim-manager": [
    "project:read",
    "project:write",
    "document:read",
    "document:write",
    "bcf:read",
    "bcf:write",
    "project:admin",
    "document:hard-delete"
  ]
};

const SYSTEM_ADMIN_REALM_ROLES = new Set([
  "system-admin",
  "cde-admin",
  "admin"
]);

export function hasSystemAdminRole(realmRoles: string[]): boolean {
  return realmRoles.some((role) => {
    const normalizedRole = role.trim().toLowerCase();

    if (SYSTEM_ADMIN_REALM_ROLES.has(normalizedRole)) {
      return true;
    }

    return (
      normalizedRole === "bim-manager" &&
      process.env.BFF_LEGACY_BIM_MANAGER_SYSTEM_ADMIN === "true"
    );
  });
}

export function roleHasPermission(
  roleKey: PortalRoleKey,
  permission: Permission
): boolean {
  return PROJECT_ROLE_PERMISSIONS[roleKey]?.includes(permission) ?? false;
}

export function isKnownPermission(permission: string): permission is Permission {
  return [
    "project:read",
    "project:write",
    "document:read",
    "document:write",
    "bcf:read",
    "bcf:write",
    "project:admin",
    "system:admin",
    "document:hard-delete"
  ].includes(permission);
}
