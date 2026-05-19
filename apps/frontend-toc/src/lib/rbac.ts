export type PortalRole =
  | "viewer"
  | "doc-controller"
  | "discipline-lead"
  | "bim-coordinator"
  | "bim-manager";

export function hasRole(
  userRoles: string[] | undefined,
  allowedRoles: PortalRole[]
): boolean {
  if (!Array.isArray(userRoles) || userRoles.length === 0) {
    return false;
  }

  return allowedRoles.some((role) => userRoles.includes(role));
}

export function canManageUsers(userRoles: string[] | undefined): boolean {
  return hasRole(userRoles, ["bim-manager"]);
}

export function canUploadDocuments(userRoles: string[] | undefined): boolean {
  return hasRole(userRoles, [
    "doc-controller",
    "discipline-lead",
    "bim-coordinator",
    "bim-manager"
  ]);
}

export function canSendToReview(userRoles: string[] | undefined): boolean {
  return hasRole(userRoles, [
    "doc-controller",
    "discipline-lead",
    "bim-coordinator",
    "bim-manager"
  ]);
}

export function canUseViewers(userRoles: string[] | undefined): boolean {
  return hasRole(userRoles, [
    "viewer",
    "doc-controller",
    "discipline-lead",
    "bim-coordinator",
    "bim-manager"
  ]);
}