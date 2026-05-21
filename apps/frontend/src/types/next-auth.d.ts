import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: unknown;
    idToken?: unknown;
    roles?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: unknown;
    idToken?: unknown;
    roles?: string[];
  }
}