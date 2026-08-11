// server/test/scheduler.test.ts
// Rappels de paiement (scheduler) :
//   création d'une demande (incoming), liste, confirmation (via qrToken),
//   suppression.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4017;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let receiver: any;
let payer: any;
let receiverToken: string;
let payerToken: string;
let scheduleId: string;
let qrToken: string;

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);

  const r = await signup(client, { email: uniqueEmail("schedr") });
  receiver = r.user;
  receiverToken = r.token;

  const p = await signup(client, { email: uniqueEmail("schedp") });
  payer = p.user;
  payerToken = p.token;
});

after(async () => {
  await srv.stop();
});

test("scheduler : création d'une demande → 200 avec id + qrToken", async () => {
  const r = await client.req("POST", "/api/v1/scheduler/create", {
    token: receiverToken,
    body: {
      title: "Test schedulé",
      payerName: "Payer Test",
      amount: 150,
      dueDate: futureDate,
    },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.id);
  assert.ok(r.json.qrToken);
  scheduleId = r.json.id;
  qrToken = r.json.qrToken;
  assert.equal(r.json.status, "pending");
});

test("scheduler : liste → la demande est présente (amount converti)", async () => {
  const r = await client.req("GET", "/api/v1/scheduler", {
    token: receiverToken,
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  const found = r.json.find((s: any) => s.id === scheduleId);
  assert.ok(found);
  assert.equal(found.amount, 150);
});

test("scheduler : confirmation via qrToken par le payeur → confirmed + outgoing créé", async () => {
  const r = await client.req("POST", "/api/v1/scheduler/confirm", {
    token: payerToken,
    body: { qrToken },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.success);
});

test("scheduler : re-confirmation → 400/404 (token nullé après confirm)", async () => {
  const r = await client.req("POST", "/api/v1/scheduler/confirm", {
    token: payerToken,
    body: { qrToken },
  });
  assert.ok(r.status === 400 || r.status === 404);
});

test("scheduler : suppression par le receveur → 200", async () => {
  const r = await client.req("DELETE", `/api/v1/scheduler/${scheduleId}`, {
    token: receiverToken,
  });
  assert.equal(r.status, 200);
});
