import type { AuthenticatedUser } from "../security/keycloak-jwt";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
      authorizedProjectCode?: string;
    }
  }
}

export {};
