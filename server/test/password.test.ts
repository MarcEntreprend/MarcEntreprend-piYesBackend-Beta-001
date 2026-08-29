// server/test/password.test.ts
// Mot de passe oublié / réinitialisation :
//   forgot-password (envoi OTP console), reset-password (nouveau mot de passe),
//   connexion avec le nouveau mot de passe.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4018;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let email: string;
let newPassword = "NewPass456!";

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);
  email = uniqueEmail("reset");
  await signup(client, { email });
});

after(async () => {
  await srv.stop();
});

test("forgot-password : compte inconnu → 200 avec message neutre", async () => {
  const r = await client.req("POST", "/api/v1/auth/forgot-password", {
    body: { identifier: "inconnu.999999@piyes.app" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
});

test("forgot-password : compte existant → OTP envoyé (console)", async () => {
  const r = await client.req("POST", "/api/v1/auth/forgot-password", {
    body: { identifier: email },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.requestId, email);

  // Consomme l'OTP de cette demande pour ne pas polluer les tests suivants
  const code = await srv.waitForOtp(email);
  assert.ok(/^\d{6}$/.test(code));
});

test("reset-password : mauvais code → 400", async () => {
  const r = await client.req("POST", "/api/v1/auth/reset-password", {
    body: { identifier: email, code: "000000", newPassword },
  });
  assert.equal(r.status, 400);
});

test("reset-password : code OTP valide → 200 + nouveau token", async () => {
  // Re-demande un OTP frais (le test précédent n'a pas consommé le bon code)
  await client.req("POST", "/api/v1/auth/forgot-password", {
    body: { identifier: email },
  });
  const code = await srv.waitForOtp(email);

  const r = await client.req("POST", "/api/v1/auth/reset-password", {
    body: { identifier: email, code, newPassword },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(r.json.token);
  assert.equal(r.json.user.email, email);
});

test("login avec le nouveau mot de passe → MFA puis token", async () => {
  const r = await client.req("POST", "/api/v1/auth/login", {
    body: { email, password: newPassword, device: "testsuite" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.mfaRequired, true);

  // Compléter le MFA avec le code OTP envoyé sur l'email
  const code = await srv.waitForOtp(email);
  const v = await client.req("POST", "/api/v1/auth/verify-session-otp", {
    body: { requestId: r.json.requestId, code },
  });
  assert.equal(v.status, 200);
  assert.ok(v.json.token);
});
