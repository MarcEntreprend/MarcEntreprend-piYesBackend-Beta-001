// server/test/contacts.test.ts
// Contacts + amitiés :
//   sync de contact (résolution par tag/phone → user lié), liste,
//   demande d'ami, acceptation, statut, annulation.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4016;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let alice: any;
let bob: any;
let aliceToken: string;
let bobToken: string;

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);

  const a = await signup(client, { email: uniqueEmail("alice") });
  alice = a.user;
  aliceToken = a.token;

  const b = await signup(client, { email: uniqueEmail("bob") });
  bob = b.user;
  bobToken = b.token;
});

after(async () => {
  await srv.stop();
});

test("sync contacts : contact résolu par tag → lié au user (isVerified)", async () => {
  const r = await client.req("POST", "/api/v1/contacts/sync", {
    token: aliceToken,
    body: {
      contacts: [{ name: "Bob", tag: bob.tag }],
    },
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  const c = r.json[0];
  assert.ok(c);
  assert.equal(c.contactUserId, bob.id);
  assert.equal(c.isVerified, true);
});

test("liste des contacts : Bob présent", async () => {
  const r = await client.req("GET", "/api/v1/contacts", {
    token: aliceToken,
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  const found = r.json.find((c: any) => c.contactUserId === bob.id);
  assert.ok(found);
});

test("friendship : demande d'ami → pending", async () => {
  const r = await client.req("POST", "/api/v1/friendship/request", {
    token: aliceToken,
    body: { contactUserId: bob.id },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.status, "sent");
});

test("friendship : statut avant acceptation → pending", async () => {
  const r2 = await fetch(
    `${srv.baseUrl}/api/v1/friendship/status?with=${bob.id}`,
    {
      headers: { Authorization: `Bearer ${aliceToken}` },
    },
  );
  const body = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(body.status, "pending");
});

test("friendship : acceptation par Bob → friends", async () => {
  const r = await client.req("POST", "/api/v1/friendship/accept", {
    token: bobToken,
    body: { requesterId: alice.id },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "friends");
});

test("friendship : statut après acceptation → friends", async () => {
  const r2 = await fetch(
    `${srv.baseUrl}/api/v1/friendship/status?with=${bob.id}`,
    { headers: { Authorization: `Bearer ${aliceToken}` } },
  );
  const body = await r2.json();
  assert.equal(r2.status, 200);
  assert.equal(body.status, "friends");
});

test("friendship : annulation → success", async () => {
  const r = await client.req(
    "DELETE",
    `/api/v1/friendship/cancel?contactUserId=${bob.id}`,
    { token: aliceToken },
  );
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
});
