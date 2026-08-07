type BffEnv = {
  keycloakIssuer: string;
  keycloakJwksUri: string;
  keycloakAudience: string;
  corsAllowedOrigins: string[];
};

function requireUrl(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Falta variable obligatoria ${name}`);
  }

  try {
    new URL(value);
  } catch {
    throw new Error(`Variable ${name} debe ser una URL valida`);
  }

  return value.replace(/\/$/, "");
}

function requireText(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Falta variable obligatoria ${name}`);
  }

  return value;
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();

  if (!raw) {
    throw new Error("Falta variable obligatoria CORS_ALLOWED_ORIGINS");
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  if (!origins.length || origins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS debe contener origenes explicitos");
  }

  for (const origin of origins) {
    try {
      new URL(origin);
    } catch {
      throw new Error(`Origen CORS invalido: ${origin}`);
    }
  }

  return origins;
}

export function loadBffEnv(): BffEnv {
  return {
    keycloakIssuer: requireUrl("KEYCLOAK_ISSUER"),
    keycloakJwksUri: requireUrl("KEYCLOAK_JWKS_URI"),
    keycloakAudience: requireText("KEYCLOAK_AUDIENCE"),
    corsAllowedOrigins: parseCorsOrigins()
  };
}
