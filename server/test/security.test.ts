// server/test/security.test.ts
// Sécurité (Phase 6) :
//   headers helmet, route de debug supprimée, rate limiting (429),
//   OTP mono-usage (code consommé après vérification).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4012;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;

before(async () => {
  srv = await startServer({
    port: PORT,
    env: { TRUST_PROXY: "1" },
  });
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

test("PIN : premier set sans ancien PIN → 200, changement sans ancien PIN → 400", async () => {
  const s = await signup(client, { email: uniqueEmail("pin") });
  const first = await client.req("POST", "/api/v1/user/pin", {
    token: s.token,
    body: { pin: "1234" },
  });
  assert.equal(first.status, 200);

  const missing = await client.req("POST", "/api/v1/user/pin", {
    token: s.token,
    body: { pin: "5678" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error.code, "CURRENT_PIN_REQUIRED");
});

test("PIN : changement avec mauvais ancien PIN → 400 INVALID_PIN, bon → 200", async () => {
  const s = await signup(client, { email: uniqueEmail("pin2") });
  await client.req("POST", "/api/v1/user/pin", {
    token: s.token,
    body: { pin: "1234" },
  });

  const wrong = await client.req("POST", "/api/v1/user/pin", {
    token: s.token,
    body: { pin: "5678", currentPin: "9999" },
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error.code, "INVALID_PIN");

  const ok = await client.req("POST", "/api/v1/user/pin", {
    token: s.token,
    body: { pin: "5678", currentPin: "1234" },
  });
  assert.equal(ok.status, 200);

  const verify = await client.req("POST", "/api/v1/user/pin/verify", {
    token: s.token,
    body: { pin: "5678" },
  });
  assert.equal(verify.status, 200);
});

test("lockout : 5 echecs login sur un meme compte → 429 ACCOUNT_LOCKED", async () => {
  const email = uniqueEmail("lk");
  await signup(client, { email });

  let last = 0;
  for (let i = 0; i < 6; i++) {
    const r = await client.req("POST", "/api/v1/auth/login", {
      body: { email, password: "WrongPass1", device: "locktest" },
      headers: { "X-Forwarded-For": `203.0.113.${i + 1}` },
    });
    last = r.status;
  }
  assert.equal(last, 429);
});

test("lockout PIN : 5 mauvais PIN → 429 PIN_LOCKED", async () => {
  const s = await signup(client, { email: uniqueEmail("pinlk") });
  await client.req("POST", "/api/v1/user/pin", {
    token: s.token,
    body: { pin: "1234" },
  });

  let last = 0;
  for (let i = 0; i < 6; i++) {
    const r = await client.req("POST", "/api/v1/user/pin/verify", {
      token: s.token,
      body: { pin: "9999" },
      headers: { "X-Forwarded-For": `198.51.100.${i + 1}` },
    });
    last = r.status;
  }
  assert.equal(last, 429);
});

test("resolve/:key : PII masquée (pas d'email/phone complets)", async () => {
  const s = await signup(client, { email: uniqueEmail("resv") });
  const target = await signup(client, { email: uniqueEmail("rest") });

  const r = await client.req(
    "GET",
    `/api/v1/transactions/resolve/${target.user.tag}`,
    {
      token: s.token,
    },
  );
  assert.equal(r.status, 200);
  assert.notEqual(r.json.email, target.user.email);
  assert.ok((r.json.email || "").includes("•"));
  assert.ok(r.json.phone === null || (r.json.phone || "").includes("•"));
});
