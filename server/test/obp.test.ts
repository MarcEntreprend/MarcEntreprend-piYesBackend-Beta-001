// server/test/obp.test.ts
// Phase 4/6 — OBP :
//   création clé API, endpoints publics (/banks, /accounts/public),
//   révocation → 401.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4013;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let token: string;
let apiKey: string;
let keyId: string;

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);
  const res = await signup(client);
  token = res.token;
});

after(async () => {
  await srv.stop();
});

test("OBP keys : sans JWT → 401", async () => {
  const r = await client.req("GET", "/obp/v3.1.0/keys");
  assert.equal(r.status, 401);
});

test("OBP keys : créer une clé → 201 avec apiKey", async () => {
  const r = await client.req("POST", "/obp/v3.1.0/keys", {
    token,
    body: { name: "Test Key" },
  });
  assert.equal(r.status, 201);
  apiKey = r.json.apiKey;
  keyId = r.json.id;
  assert.ok(apiKey);
});

test("OBP keys : lister → contient la clé sans hash", async () => {
  const r = await client.req("GET", "/obp/v3.1.0/keys", { token });
  assert.equal(r.status, 200);
  const found = r.json.keys.find((k: any) => k.id === keyId);
  assert.ok(found);
  assert.equal(found.status, "active");
});

test("OBP /banks : sans clé → 401", async () => {
  const r = await client.req("GET", "/obp/v3.1.0/banks");
  assert.equal(r.status, 401);
});

test("OBP /banks : avec clé → 200", async () => {
  const r = await client.req("GET", "/obp/v3.1.0/banks", { apiKey });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.banks));
});

test("OBP /accounts/public : avec clé → 200", async () => {
  const r = await client.req("GET", "/obp/v3.1.0/accounts/public", { apiKey });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.accounts));
});

test("OBP : révoquer la clé → 200 puis /banks → 401", async () => {
  const del = await client.req("DELETE", `/obp/v3.1.0/keys/${keyId}`, {
    token,
  });
  assert.equal(del.status, 200);

  const r = await client.req("GET", "/obp/v3.1.0/banks", { apiKey });
  assert.equal(r.status, 401);
});
