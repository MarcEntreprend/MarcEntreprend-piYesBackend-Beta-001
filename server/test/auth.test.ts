// server/test/auth.test.ts
// Flux critiques d'authentification (Phase 6) :
//   signup, login même device, MFA sur 2e device, verify-session-otp,
//   refresh rotation + replay (purge), logout-all (révocation immédiate).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4011;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let user: any;
let token: string;

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);
  const res = await signup(client, { email: uniqueEmail("auth") });
  user = res.user;
  token = res.token;
});

after(async () => {
  await srv.stop();
});

test("signup renvoie un token et un cookie refreshToken", () => {
  assert.ok(user.id);
  assert.ok(token);
  assert.ok(client.getCookie("refreshToken"));
});

test("login même device → 200", async () => {
  const r = await client.req("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: "Test1234!", device: "testsuite" },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.token);
});

test("login mauvais mot de passe → 401", async () => {
  const r = await client.req("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: "WrongPass1", device: "testsuite" },
  });
  assert.equal(r.status, 401);
});

test("login 2e device → mfaRequired + verify-session-otp → 200", async () => {
  const login = await client.req("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: "Test1234!", device: "deviceB" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.mfaRequired, true);
  assert.ok(login.json.requestId);

  const code = await srv.waitForOtp(user.email);
  const verify = await client.req("POST", "/api/v1/auth/verify-session-otp", {
    body: { requestId: login.json.requestId, code },
  });
  assert.equal(verify.status, 200);
  assert.ok(verify.json.token);
  assert.ok(client.getCookie("refreshToken"));
});

test("refresh rotation : nouveau token + ancien refresh rejeté (replay purge)", async () => {
  const oldRefresh = client.getCookie("refreshToken");
  assert.ok(oldRefresh);

  const r1 = await client.req("POST", "/api/v1/auth/refresh");
  assert.equal(r1.status, 200);
  assert.ok(r1.json.token);
  const newRefresh = client.getCookie("refreshToken");
  assert.notEqual(newRefresh, oldRefresh);

  // Rejeu de l'ANCIEN refresh token → 401 et purge des sessions
  const replay = await client.reqRaw("POST", "/api/v1/auth/refresh", {
    headers: { Cookie: `refreshToken=${oldRefresh}` },
  });
  assert.equal(replay.status, 401);
});

test("refresh sans cookie → 401", async () => {
  const r = await client.reqRaw("POST", "/api/v1/auth/refresh");
  assert.equal(r.status, 401);
});

test("logout-all puis /user/sync → 401 (révocation immédiate)", async () => {
  // Login frais (le replay du test précédent a purgé les sessions)
  const login = await client.req("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: "Test1234!", device: "logouttest" },
  });
  assert.equal(login.status, 200);

  const lo = await client.req("POST", "/api/v1/auth/logout-all", {
    token: login.json.token,
  });
  assert.equal(lo.status, 200);

  const sync = await client.req("GET", "/api/v1/user/sync", {
    token: login.json.token,
  });
  assert.equal(sync.status, 401);
});
