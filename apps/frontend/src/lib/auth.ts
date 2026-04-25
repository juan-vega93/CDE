export const authConfig = {
  keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL || "",
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "",
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || ""
};

export function getKeycloakIssuer() {
  if (!authConfig.keycloakUrl || !authConfig.realm) {
    throw new Error("Falta configuración de Keycloak");
  }

  return `${authConfig.keycloakUrl}/realms/${authConfig.realm}`;
}