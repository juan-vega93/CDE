import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET
  });

  const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin;

  const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;

  const redirectUrl = `${baseUrl}/login`;

  if (!keycloakUrl || !realm || !clientId) {
    return NextResponse.redirect(redirectUrl);
  }

  const logoutUrl = new URL(
    `${keycloakUrl}/realms/${realm}/protocol/openid-connect/logout`
  );

  const idToken = token?.idToken;

  if (typeof idToken === "string" && idToken.length > 0) {
    logoutUrl.searchParams.set("id_token_hint", idToken);
  }

  logoutUrl.searchParams.set("client_id", clientId);
  logoutUrl.searchParams.set("post_logout_redirect_uri", redirectUrl);

  return NextResponse.redirect(logoutUrl.toString());
}