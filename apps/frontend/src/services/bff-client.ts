"use client";

import { getSession } from "next-auth/react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

const RESOLVED_BFF_URL = BFF_URL;
const ENABLE_CLIENT_PERF_LOGS = process.env.NEXT_PUBLIC_PERF_LOGS === "true";
let cachedAccessToken: {
  value: string;
  expiresAt: number;
} | null = null;

async function getSessionAccessToken(): Promise<unknown> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.value;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await getSession();

    if (typeof session?.accessToken === "string" && session.accessToken) {
      cachedAccessToken = {
        value: session.accessToken,
        expiresAt: Date.now() + 10_000
      };
      return session.accessToken;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }

  return undefined;
}

export async function bffFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getSessionAccessToken();

  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  }

  if (typeof accessToken === "string" && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const startedAt = performance.now();
  const response = await fetch(`${RESOLVED_BFF_URL}${path}`, {
    ...options,
    headers,
    cache: options.cache ?? "no-store"
  });

  if (ENABLE_CLIENT_PERF_LOGS) {
    console.info("[BFF_CLIENT_PERF]", {
      method: options.method || "GET",
      path,
      status: response.status,
      totalMs: Number((performance.now() - startedAt).toFixed(1)),
      bffMs: response.headers.get("x-response-time-ms"),
      serverTiming: response.headers.get("server-timing"),
      requestId: response.headers.get("x-request-id")
    });
  }

  return response;
}

export function getBffUrl(path: string): string {
  return `${RESOLVED_BFF_URL}${path}`;
}

export function getBffPathFromUrl(value: string): string | null {
  if (value.startsWith("/")) {
    return value;
  }

  try {
    const url = new URL(value);
    const baseUrl = new URL(RESOLVED_BFF_URL);

    if (url.origin !== baseUrl.origin) {
      return null;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export async function bffAssetFetch(
  value: string,
  options: RequestInit = {}
): Promise<Response> {
  const bffPath = getBffPathFromUrl(value);

  if (bffPath) {
    return bffFetch(bffPath, options);
  }

  return fetch(value, options);
}
