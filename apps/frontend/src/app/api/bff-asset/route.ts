import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth-options";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

function getSafeBffPath(req: NextRequest): string | null {
  const value = req.nextUrl.searchParams.get("path")?.trim();

  if (!value) return null;

  if (value.startsWith("/api/")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const bffBaseUrl = BFF_URL ? new URL(BFF_URL) : null;

    if (bffBaseUrl && parsed.origin === bffBaseUrl.origin) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }

  return null;
}

export async function GET(req: NextRequest) {
  if (!BFF_URL) {
    return new Response("Falta NEXT_PUBLIC_BFF_URL", { status: 500 });
  }

  const path = getSafeBffPath(req);

  if (!path) {
    return new Response("Ruta BFF invalida", { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const accessToken = session?.accessToken;

  if (typeof accessToken !== "string" || !accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(`${BFF_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentLength = upstream.headers.get("content-length");
  const contentDisposition = upstream.headers.get("content-disposition");

  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  if (contentDisposition) {
    headers.set("content-disposition", contentDisposition);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}