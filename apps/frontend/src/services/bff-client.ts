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

const SESSION_TOKEN_RETRY_COUNT = 25;
const SESSION_TOKEN_RETRY_DELAY_MS = 200;

async function waitForSessionAccessToken(): Promise<string | undefined> {
  for (let attempt = 0; attempt < SESSION_TOKEN_RETRY_COUNT; attempt += 1) {
    const session = await getSession();

    if (typeof session?.accessToken === "string" && session.accessToken) {
      cachedAccessToken = {
        value: session.accessToken,
        expiresAt: Date.now() + 10_000
      };
      return session.accessToken;
    }

    if (session?.error === "RefreshAccessTokenError") {
      return undefined;
    }

    await new Promise((resolve) =>
      window.setTimeout(resolve, SESSION_TOKEN_RETRY_DELAY_MS)
    );
  }

  return undefined;
}

async function getSessionAccessToken(): Promise<string | undefined> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.value;
  }

  return waitForSessionAccessToken();
}

type BffFetchOptions = RequestInit & {
  accessToken?: string;
};

export async function bffFetch(
  path: string,
  options: BffFetchOptions = {}
): Promise<Response> {
  const { accessToken: accessTokenOverride, ...fetchOptions } = options;
  let accessToken = accessTokenOverride || (await getSessionAccessToken());

  const buildHeaders = () => {
    const headers = new Headers(fetchOptions.headers);

    if (!(fetchOptions.body instanceof FormData)) {
      headers.set("Content-Type", headers.get("Content-Type") || "application/json");
    }

    if (typeof accessToken === "string" && accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    return headers;
  };

  const startedAt = performance.now();
  let response = await fetch(`${RESOLVED_BFF_URL}${path}`, {
    ...fetchOptions,
    headers: buildHeaders(),
    cache: fetchOptions.cache ?? "no-store"
  });

  if (response.status === 401) {
    cachedAccessToken = null;
    accessToken = await waitForSessionAccessToken();
    response = await fetch(`${RESOLVED_BFF_URL}${path}`, {
      ...fetchOptions,
      headers: buildHeaders(),
      cache: fetchOptions.cache ?? "no-store"
    });
  }

  if (ENABLE_CLIENT_PERF_LOGS) {
    console.info("[BFF_CLIENT_PERF]", {
      method: fetchOptions.method || "GET",
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

    if (url.origin === baseUrl.origin || url.pathname.startsWith("/api/")) {
      // Docker can publish a different BFF origin than the one embedded in URLs.
      return `${url.pathname}${url.search}`;
    }

    return null;
  } catch {
    return null;
  }
}

export async function bffAssetFetch(
  value: string,
  options: BffFetchOptions = {}
): Promise<Response> {
  const bffPath = getBffPathFromUrl(value);

  if (bffPath) {
    return bffFetch(bffPath, options);
  }

  const { accessToken: _accessToken, ...fetchOptions } = options;
  return fetch(value, fetchOptions);
}
