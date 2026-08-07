import Keycloak from "next-auth/providers/keycloak";
import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";

type KeycloakAccessTokenPayload = {
  realm_access?: {
    roles?: string[];
  };
};

function parseJwtPayload(token: string): KeycloakAccessTokenPayload | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    return JSON.parse(
      Buffer.from(payload, "base64").toString("utf-8")
    ) as KeycloakAccessTokenPayload;
  } catch {
    return null;
  }
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  const refreshToken =
    typeof token.refreshToken === "string" ? token.refreshToken : "";

  if (!refreshToken) {
    return {
      ...token,
      error: "RefreshAccessTokenError"
    };
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_KEYCLOAK_URL}/realms/${process.env.NEXT_PUBLIC_KEYCLOAK_REALM}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID!,
          client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const refreshed = await response.json();

    if (!response.ok) {
      throw refreshed;
    }

    const accessToken = refreshed.access_token as string;
    const parsed = parseJwtPayload(accessToken);

    return {
      ...token,
      accessToken,
      idToken: refreshed.id_token ?? token.idToken,
      accessTokenExpires: Date.now() + Number(refreshed.expires_in ?? 300) * 1000,
      refreshToken: refreshed.refresh_token ?? refreshToken,
      roles: parsed?.realm_access?.roles ?? token.roles ?? [],
      error: undefined
    };
  } catch (error) {
    console.error("[next-auth] Error refreshing Keycloak access token:", error);

    return {
      ...token,
      error: "RefreshAccessTokenError"
    };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    Keycloak({
      clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
      issuer: `${process.env.NEXT_PUBLIC_KEYCLOAK_URL}/realms/${process.env.NEXT_PUBLIC_KEYCLOAK_REALM}`
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/login"
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
        token.accessTokenExpires =
          typeof account.expires_at === "number"
            ? account.expires_at * 1000
            : Date.now() + Number(account.expires_in ?? 300) * 1000;
      }

      if (account?.id_token) {
        token.idToken = account.id_token;
      }

      if (account?.refresh_token) {
        token.refreshToken = account.refresh_token;
      }

      const accessToken =
        typeof account?.access_token === "string"
          ? account.access_token
          : typeof token.accessToken === "string"
            ? token.accessToken
            : "";

      const accessTokenExpires =
        typeof token.accessTokenExpires === "number"
          ? token.accessTokenExpires
          : 0;

      if (!account && accessTokenExpires && Date.now() > accessTokenExpires - 60_000) {
        return refreshAccessToken(token);
      }

      if (accessToken) {
        const parsed = parseJwtPayload(accessToken);
        const roles = Array.isArray(parsed?.realm_access?.roles)
          ? parsed!.realm_access!.roles!
          : [];

        token.roles = roles;
      }

      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.idToken = token.idToken;
      session.roles = token.roles || [];
      session.error = token.error;

      return session;
    }
  }
};
