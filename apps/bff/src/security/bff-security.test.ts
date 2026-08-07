import assert from "node:assert/strict";
import crypto from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { after, before, beforeEach, test } from "node:test";
import { createApp } from "../index";
import { clearJwksCacheForTests } from "./keycloak-jwt";

const issuer = "http://127.0.0.1:18080/realms/cde-test";
const audience = "cde-portal-test";
const allowedOrigin = "http://localhost:3000";
const kid = "test-key-1";

const keyPair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048
});
const otherKeyPair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048
});

const publicJwk = keyPair.publicKey.export({
  format: "jwk"
}) as JsonWebKey;

let jwksServer: http.Server;
let jwksUrl = "";
let appServer: http.Server;
let appUrl = "";

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signToken(
  payloadOverrides: Record<string, unknown> = {},
  options: {
    privateKey?: crypto.KeyObject;
    header?: Record<string, unknown>;
  } = {}
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid,
    ...options.header
  };
  const payload = {
    sub: "user-a",
    iss: issuer,
    aud: audience,
    azp: audience,
    exp: now + 3600,
    nbf: now - 10,
    preferred_username: "user.a",
    email: "user.a@example.com",
    realm_access: {
      roles: ["viewer"]
    },
    groups: ["/PROJA_VIEWER"],
    ...payloadOverrides
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(signingInput), options.privateKey ?? keyPair.privateKey)
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

function adminToken(): string {
  return signToken({
    realm_access: {
      roles: ["bim-manager"]
    },
    groups: []
  });
}

function writerToken(): string {
  return signToken({
    realm_access: {
      roles: ["doc-controller"]
    },
    groups: ["/PROJA_DOC_CONTROLLER"]
  });
}

async function request(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<Response> {
  const headers = new Headers(options.headers);

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${appUrl}${path}`, {
    ...options,
    headers
  });
}

before(async () => {
  process.env.KEYCLOAK_ISSUER = issuer;
  process.env.KEYCLOAK_AUDIENCE = audience;
  process.env.CORS_ALLOWED_ORIGINS = allowedOrigin;
  process.env.USE_NEXTCLOUD_MOCK = "true";
  process.env.USE_OPENPROJECT_MOCK = "true";
  process.env.NEXTCLOUD_BASE_URL = "http://nextcloud.invalid";

  jwksServer = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        keys: [
          {
            ...publicJwk,
            kid,
            alg: "RS256",
            use: "sig"
          }
        ]
      })
    );
  });

  await new Promise<void>((resolve) => {
    jwksServer.listen(0, "127.0.0.1", resolve);
  });

  const jwksAddress = jwksServer.address() as AddressInfo;
  jwksUrl = `http://127.0.0.1:${jwksAddress.port}/certs`;
  process.env.KEYCLOAK_JWKS_URI = jwksUrl;

  appServer = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  const appAddress = appServer.address() as AddressInfo;
  appUrl = `http://127.0.0.1:${appAddress.port}`;
});

beforeEach(() => {
  clearJwksCacheForTests();
});

after(async () => {
  await new Promise<void>((resolve) => appServer.close(() => resolve()));
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
});

test("GET /health funciona sin token", async () => {
  const response = await request("/health");
  assert.equal(response.status, 200);
});

test("ruta protegida responde 401 sin token", async () => {
  const response = await request("/api/documents?path=%2FPROJA");
  assert.equal(response.status, 401);
});

test("encabezado que no usa Bearer responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    headers: {
      Authorization: `Basic ${signToken()}`
    }
  });
  assert.equal(response.status, 401);
});

test("token mal formado responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    headers: {
      Authorization: "Bearer abc.def.ghi"
    }
  });
  assert.equal(response.status, 401);
});

test("token con firma invalida responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({}, { privateKey: otherKeyPair.privateKey })
  });
  assert.equal(response.status, 401);
});

test("token expirado responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({ exp: Math.floor(Date.now() / 1000) - 1 })
  });
  assert.equal(response.status, 401);
});

test("token con issuer incorrecto responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({ iss: "http://issuer.invalid" })
  });
  assert.equal(response.status, 401);
});

test("token con audience incorrecto responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({ aud: "other-client", azp: "other-client" })
  });
  assert.equal(response.status, 401);
});

test("token con algoritmo no permitido responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({}, { header: { alg: "HS256" } })
  });
  assert.equal(response.status, 401);
});

test("token con nbf futuro responde 401", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({ nbf: Math.floor(Date.now() / 1000) + 3600 })
  });
  assert.equal(response.status, 401);
});

test("token valido permite continuar hacia autorizacion", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken()
  });
  assert.equal(response.status, 200);
});

test("usuario autenticado sin pertenencia al proyecto no puede acceder", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken({ groups: [] })
  });
  assert.equal(response.status, 403);
});

test("usuario de Proyecto A no puede leer Proyecto B", async () => {
  const response = await request("/api/documents?path=%2FPROJB", {
    token: signToken()
  });
  assert.equal(response.status, 403);
});

test("manipulacion de projectCode por query no permite acceso cruzado", async () => {
  const response = await request("/api/documents?path=%2FPROJB&projectCode=PROJA", {
    token: signToken()
  });
  assert.equal(response.status, 403);
});

test("manipulacion de projectCode por body no permite acceso cruzado", async () => {
  const response = await request("/api/documents/rename", {
    method: "PUT",
    token: signToken(),
    body: JSON.stringify({
      projectCode: "PROJA",
      documentPath: "/PROJB/model.ifc",
      newName: "renamed.ifc"
    })
  });
  assert.equal(response.status, 403);
});

test("manipulacion de projectCode por path no permite acceso cruzado", async () => {
  const response = await request("/api/project-cards/PROJB", {
    token: signToken()
  });
  assert.equal(response.status, 403);
});

test("usuario con permiso de lectura puede consultar documentos", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    token: signToken()
  });
  assert.equal(response.status, 200);
});

test("usuario con permiso de lectura no puede escribir", async () => {
  const response = await request("/api/bcf/topics?projectCode=PROJA", {
    method: "PUT",
    token: signToken(),
    body: JSON.stringify([])
  });
  assert.equal(response.status, 403);
});

test("usuario con permiso de escritura puede ejecutar operaciones permitidas", async () => {
  const response = await request("/api/bcf/topics?projectCode=PROJA", {
    method: "PUT",
    token: writerToken(),
    body: JSON.stringify([])
  });
  assert.equal(response.status, 200);
});

test("usuario no administrador no puede acceder a rutas administrativas", async () => {
  const response = await request("/api/project-cards", {
    token: signToken()
  });
  assert.equal(response.status, 403);
});

test("administrador autorizado puede acceder a rutas administrativas", async () => {
  const response = await request("/api/project-cards", {
    token: adminToken()
  });
  assert.equal(response.status, 200);
});

test("hard delete requiere permiso especifico", async () => {
  const response = await request("/api/documents", {
    method: "DELETE",
    token: signToken(),
    body: JSON.stringify({
      documentPath: "/PROJA/model.ifc"
    })
  });
  assert.equal(response.status, 403);
});

test("administrador puede ejecutar hard delete autorizado", async () => {
  const response = await request("/api/documents", {
    method: "DELETE",
    token: adminToken(),
    body: JSON.stringify({
      documentPath: "/PROJA/model.ifc"
    })
  });
  assert.equal(response.status, 200);
});

test("origen CORS no autorizado es rechazado", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    headers: {
      Origin: "http://evil.local"
    }
  });
  assert.equal(response.status, 403);
});

test("origen CORS autorizado continua funcionando", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    headers: {
      Origin: allowedOrigin
    }
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
});

test("preflight CORS autorizado responde 204", async () => {
  const response = await request("/api/documents?path=%2FPROJA", {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "GET"
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
});

test("errores no contienen tokens ni stack traces", async () => {
  const token = "not-a-valid-token";
  const response = await request("/api/documents?path=%2FPROJA", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const body = await response.text();
  assert.equal(response.status, 401);
  assert.equal(body.includes(token), false);
  assert.equal(body.includes("Error:"), false);
});

test("autorizacion ocurre antes de ejecutar adaptador externo", async () => {
  const originalFetch = globalThis.fetch;
  let nextcloudCalls = 0;

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("nextcloud.invalid")) {
      nextcloudCalls += 1;
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const response = await request("/api/documents?path=%2FPROJB", {
      token: signToken()
    });
    assert.equal(response.status, 403);
    assert.equal(nextcloudCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ruta funcional sin politica explicita queda denegada", async () => {
  const response = await request("/api/no-policy", {
    token: adminToken()
  });
  assert.equal(response.status, 403);
});

test("aislamiento explicito: Usuario A solo opera Proyecto A", async () => {
  const token = signToken();

  const readA = await request("/api/documents?path=%2FPROJA", { token });
  const readB = await request("/api/documents?path=%2FPROJB", { token });
  const writeB = await request("/api/bcf/topics?projectCode=PROJB", {
    method: "PUT",
    token,
    body: JSON.stringify([])
  });
  const pathB = await request("/api/project-cards/PROJB", { token });

  assert.equal(readA.status, 200);
  assert.equal(readB.status, 403);
  assert.equal(writeB.status, 403);
  assert.equal(pathB.status, 403);
});
