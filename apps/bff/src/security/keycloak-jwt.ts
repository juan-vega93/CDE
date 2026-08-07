import crypto from "crypto";
import { loadBffEnv } from "../config/env";

export type AuthenticatedUser = {
  subject: string;
  username?: string;
  email?: string;
  realmRoles: string[];
  clientRoles: string[];
  groups: string[];
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  nbf?: number;
  preferred_username?: string;
  email?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
  groups?: string[];
};

type Jwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

type JwksResponse = {
  keys?: Jwk[];
};

type JwksCache = {
  expiresAt: number;
  keysByKid: Map<string, Jwk>;
};

const ALLOWED_ALGORITHMS = new Set(["RS256"]);
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
let jwksCache: JwksCache | null = null;

export class AuthenticationError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthenticationError";
  }
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function parseJsonPart<T>(value: string): T {
  try {
    return JSON.parse(base64UrlDecode(value).toString("utf8")) as T;
  } catch {
    throw new AuthenticationError("Token mal formado");
  }
}

async function fetchJwks(): Promise<JwksCache> {
  const { keycloakJwksUri } = loadBffEnv();
  const response = await fetch(keycloakJwksUri, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new AuthenticationError("JWKS no disponible");
  }

  const json = (await response.json()) as JwksResponse;
  const keysByKid = new Map<string, Jwk>();

  for (const key of json.keys ?? []) {
    if (key.kid && key.kty === "RSA") {
      keysByKid.set(key.kid, key);
    }
  }

  if (!keysByKid.size) {
    throw new AuthenticationError("JWKS sin claves RSA validas");
  }

  return {
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
    keysByKid
  };
}

async function getJwkByKid(kid: string): Promise<Jwk> {
  if (!jwksCache || jwksCache.expiresAt <= Date.now()) {
    jwksCache = await fetchJwks();
  }

  let jwk = jwksCache.keysByKid.get(kid);

  if (!jwk) {
    jwksCache = await fetchJwks();
    jwk = jwksCache.keysByKid.get(kid);
  }

  if (!jwk) {
    throw new AuthenticationError("Clave JWT no reconocida");
  }

  return jwk;
}

function assertAudience(payload: JwtPayload, expectedAudience: string) {
  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud
      ? [payload.aud]
      : [];

  if (!audiences.includes(expectedAudience) && payload.azp !== expectedAudience) {
    throw new AuthenticationError("Audience invalido");
  }
}

function assertTimeClaims(payload: JwtPayload) {
  const now = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp <= now) {
    throw new AuthenticationError("Token expirado");
  }

  if (payload.nbf && payload.nbf > now) {
    throw new AuthenticationError("Token aun no valido");
  }
}

function extractClientRoles(payload: JwtPayload, clientId: string): string[] {
  const roles = payload.resource_access?.[clientId]?.roles;
  return Array.isArray(roles) ? roles : [];
}

function verifySignature(
  signingInput: string,
  signature: string,
  keyObject: crypto.KeyObject
) {
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();

  const ok = verifier.verify(keyObject, base64UrlDecode(signature));

  if (!ok) {
    throw new AuthenticationError("Firma JWT invalida");
  }
}

export async function verifyKeycloakJwt(token: string): Promise<AuthenticatedUser> {
  const parts = token.split(".");

  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new AuthenticationError("Token mal formado");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonPart<JwtHeader>(encodedHeader);

  if (!header.alg || !ALLOWED_ALGORITHMS.has(header.alg)) {
    throw new AuthenticationError("Algoritmo JWT no permitido");
  }

  if (!header.kid) {
    throw new AuthenticationError("JWT sin kid");
  }

  const jwk = await getJwkByKid(header.kid);

  if (jwk.alg && jwk.alg !== "RS256") {
    throw new AuthenticationError("Algoritmo JWKS no permitido");
  }

  const keyObject = crypto.createPublicKey({
    key: jwk as crypto.JsonWebKey,
    format: "jwk"
  });

  verifySignature(`${encodedHeader}.${encodedPayload}`, encodedSignature, keyObject);

  const payload = parseJsonPart<JwtPayload>(encodedPayload);
  const { keycloakIssuer, keycloakAudience } = loadBffEnv();

  if (!payload.sub) {
    throw new AuthenticationError("Token sin subject");
  }

  if (payload.iss !== keycloakIssuer) {
    throw new AuthenticationError("Issuer invalido");
  }

  assertAudience(payload, keycloakAudience);
  assertTimeClaims(payload);

  const realmRoles = Array.isArray(payload.realm_access?.roles)
    ? payload.realm_access!.roles!
    : [];

  return {
    subject: payload.sub,
    username: payload.preferred_username,
    email: payload.email,
    realmRoles,
    clientRoles: extractClientRoles(payload, keycloakAudience),
    groups: Array.isArray(payload.groups) ? payload.groups : []
  };
}

export function clearJwksCacheForTests() {
  jwksCache = null;
}
