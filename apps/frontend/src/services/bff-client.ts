"use client";

import { getSession } from "next-auth/react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

export async function bffFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const session = await getSession();
  const accessToken = session?.accessToken;

  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${BFF_URL}${path}`, {
    ...options,
    headers,
    cache: options.cache ?? "no-store"
  });
}