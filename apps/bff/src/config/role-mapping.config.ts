export type PortalRoleKey =
  | "bim-manager"
  | "bim-coordinator"
  | "discipline-lead"
  | "doc-controller"
  | "viewer";

export type PortalRoleMapping = {
  keycloakRealmRole: PortalRoleKey;
  nextcloudGroupSuffix: string;
  openProjectRoleKey: PortalRoleKey;
  label: string;
};

export const PORTAL_ROLE_MAPPING: Record<PortalRoleKey, PortalRoleMapping> = {
  "bim-manager": {
    keycloakRealmRole: "bim-manager",
    nextcloudGroupSuffix: "BIM_MANAGER",
    openProjectRoleKey: "bim-manager",
    label: "BIM Manager"
  },
  "bim-coordinator": {
    keycloakRealmRole: "bim-coordinator",
    nextcloudGroupSuffix: "BIM_COORDINATOR",
    openProjectRoleKey: "bim-coordinator",
    label: "BIM Coordinator"
  },
  "discipline-lead": {
    keycloakRealmRole: "discipline-lead",
    nextcloudGroupSuffix: "DISCIPLINE_LEAD",
    openProjectRoleKey: "discipline-lead",
    label: "Líder de Disciplina"
  },
  "doc-controller": {
    keycloakRealmRole: "doc-controller",
    nextcloudGroupSuffix: "DOC_CONTROLLER",
    openProjectRoleKey: "doc-controller",
    label: "Document Controller"
  },
  viewer: {
    keycloakRealmRole: "viewer",
    nextcloudGroupSuffix: "VIEWER",
    openProjectRoleKey: "viewer",
    label: "Viewer"
  }
};

const ROLE_ALIASES: Record<string, PortalRoleKey> = {
  "bim-manager": "bim-manager",
  "bim manager": "bim-manager",
  "BIM Manager": "bim-manager",

  "bim-coordinator": "bim-coordinator",
  "bim coordinator": "bim-coordinator",
  "BIM Coordinator": "bim-coordinator",

  "discipline-lead": "discipline-lead",
  "discipline lead": "discipline-lead",
  "Líder de Disciplina": "discipline-lead",
  "Lider de Disciplina": "discipline-lead",

  "doc-controller": "doc-controller",
  "doc controller": "doc-controller",
  "Document Controller": "doc-controller",

  viewer: "viewer",
  Viewer: "viewer"
};

export function normalizePortalRoleKey(value: string): PortalRoleKey {
  const trimmedValue = value.trim();

  const directMatch = ROLE_ALIASES[trimmedValue];

  if (directMatch) {
    return directMatch;
  }

  const lowerMatch = ROLE_ALIASES[trimmedValue.toLowerCase()];

  if (lowerMatch) {
    return lowerMatch;
  }

  throw new Error(
    `Rol no soportado: '${value}'. Roles válidos: ${Object.keys(PORTAL_ROLE_MAPPING).join(", ")}`
  );
}

export function buildProjectRoleGroupName(projectCode: string, roleKey: PortalRoleKey): string {
  return `${projectCode}_${PORTAL_ROLE_MAPPING[roleKey].nextcloudGroupSuffix}`;
}

export function buildProjectDisciplineGroupName(
  projectCode: string,
  disciplineKey?: string
): string | null {
  if (!disciplineKey?.trim()) {
    return null;
  }

  return `${projectCode}_${disciplineKey.trim().toUpperCase()}`;
}