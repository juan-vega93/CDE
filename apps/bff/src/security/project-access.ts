import fs from "fs/promises";
import path from "path";
import {
  buildProjectRoleGroupName,
  normalizePortalRoleKey,
  PORTAL_ROLE_MAPPING,
  type PortalRoleKey
} from "../config/role-mapping.config";
import type { ProjectMember } from "../types/project-member.types";
import type { AuthenticatedUser } from "./keycloak-jwt";
import {
  hasSystemAdminRole,
  roleHasPermission,
  type Permission
} from "./policies";
import { getBffDataPath } from "../utils/data-dir";

const PROJECT_MEMBERS_FILE = getBffDataPath("project-members.json");

export class AuthorizationError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function normalizeProjectCode(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(normalized)) {
    throw new AuthorizationError("Proyecto invalido");
  }

  return normalized;
}

function normalizeGroupName(value: string): string {
  return value.replace(/^\/+/, "").trim().toUpperCase();
}

function getRoleFromProjectGroups(
  user: AuthenticatedUser,
  projectCode: string
): PortalRoleKey | null {
  const normalizedGroups = new Set(user.groups.map(normalizeGroupName));

  for (const roleKey of Object.keys(PORTAL_ROLE_MAPPING) as PortalRoleKey[]) {
    const expectedGroup = buildProjectRoleGroupName(projectCode, roleKey);
    if (normalizedGroups.has(expectedGroup.toUpperCase())) {
      return roleKey;
    }
  }

  return null;
}

async function readProjectMembers(): Promise<ProjectMember[]> {
  try {
    const raw = await fs.readFile(PROJECT_MEMBERS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as ProjectMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getRoleFromActiveProjectMember(
  user: AuthenticatedUser,
  projectCode: string
): Promise<PortalRoleKey | null> {
  const members = await readProjectMembers();
  const username = user.username?.trim().toLowerCase();
  const email = user.email?.trim().toLowerCase();

  const member = members.find((candidate) => {
    if (candidate.status !== "active") return false;
    if (candidate.projectCode.trim().toUpperCase() !== projectCode) return false;

    return (
      (username && candidate.username.trim().toLowerCase() === username) ||
      (email && candidate.email.trim().toLowerCase() === email)
    );
  });

  if (!member) {
    return null;
  }

  return normalizePortalRoleKey(member.roleKey);
}

export async function authorizeProjectAccess(
  user: AuthenticatedUser,
  projectCodeInput: string,
  permission: Permission
): Promise<void> {
  const projectCode = normalizeProjectCode(projectCodeInput);

  if (hasSystemAdminRole(user.realmRoles)) {
    return;
  }

  const keycloakGroupRole = getRoleFromProjectGroups(user, projectCode);
  if (keycloakGroupRole && roleHasPermission(keycloakGroupRole, permission)) {
    return;
  }

  const memberRole = await getRoleFromActiveProjectMember(user, projectCode);
  if (memberRole && roleHasPermission(memberRole, permission)) {
    return;
  }

  throw new AuthorizationError("Permisos insuficientes");
}

export function authorizeSystemAdmin(user: AuthenticatedUser): void {
  if (!hasSystemAdminRole(user.realmRoles)) {
    throw new AuthorizationError("Permisos insuficientes");
  }
}
