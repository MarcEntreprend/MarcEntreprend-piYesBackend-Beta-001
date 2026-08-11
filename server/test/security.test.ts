// server/test/security.test.ts
// Sécurité (Phase 6) :
//   headers helmet, route de debug supprimée, rate limiting (429),
//   OTP mono-usage (code consommé après vérification).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, uniqueEmail } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4012;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);
});

after(async () => {
  await srv.stop();
});

test("helmet : headers de sécurité présents", async () => {
  const r = await client.req("GET", "/healthz");
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("strict-transport-security"));
  assert.ok(r.headers.get("x-content-type-options"));
  assert.ok(r.headers.get("x-dns-prefetch-control"));
});

test("route de debug /auth/test supprimée → 404", async () => {
  const r = await client.req("GET", "/api/v1/auth/test");
  assert.equal(r.status, 404);
});

test("rate limit : 11 echecs login → 429", async () => {
  let lastStatus = 0;
  for (let i = 0; i < 11; i++) {
    const r = await client.req("POST", "/api/v1/auth/login", {
      body: {
        email: uniqueEmail("rl"),
        password: "WrongPass1",
        device: "ratelimit",
      },
    });
    lastStatus = r.status;
  }
  assert.equal(lastStatus, 429);
});

test("OTP : verify success puis rejeu du même code → 400", async () => {
  const email = uniqueEmail("otp");
  const req = await client.req("POST", "/api/v1/auth/otp/request", {
    body: { email },
  });
  assert.equal(req.status, 200);

  const code = await srv.waitForOtp(email);
  const ok = await client.req("POST", "/api/v1/auth/otp/verify", {
    body: { email, code },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.success, true);

  const replay = await client.req("POST", "/api/v1/auth/otp/verify", {
    body: { email, code },
  });
  assert.equal(replay.status, 400);
});

test("OTP : mauvais code → 400", async () => {
  const email = uniqueEmail("otp2");
  await client.req("POST", "/api/v1/auth/otp/request", { body: { email } });
  const code = await srv.waitForOtp(email);
  const wrong = (parseInt(code, 10) + 1) % 1000000;
  const r = await client.req("POST", "/api/v1/auth/otp/verify", {
    body: { email, code: String(wrong).padStart(6, "0") },
  });
  assert.equal(r.status, 400);
});
