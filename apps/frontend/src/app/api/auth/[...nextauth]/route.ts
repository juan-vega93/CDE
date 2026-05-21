import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";

type KeycloakAccessTokenPayload = {
  realm_access?: {
    roles?: string[];
  };
};

function parseJwtPayload(token: string): KeycloakAccessTokenPayload | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const decoded = JSON.parse(
      Buffer.from(payload, "base64").toString("utf-8")
    ) as KeycloakAccessTokenPayload;

    return decoded;
  } catch {
    return null;
  }
}

const handler = NextAuth({
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
      }

      if (account?.id_token) {
        token.idToken = account.id_token;
      }

      const accessToken =
        typeof account?.access_token === "string"
          ? account.access_token
          : typeof token.accessToken === "string"
            ? token.accessToken
            : "";

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

      return session;
    }
  }
});

export { handler as GET, handler as POST };