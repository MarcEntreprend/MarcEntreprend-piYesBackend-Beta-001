// server/test/transactions.test.ts
// Flux critique : transfert P2P + idempotence (ledger).
//   signup 2 users, set PIN, seed solde (User.balance + ledger),
//   transfert, vérification des soldes, replay idempotent.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { supabaseService } from "../src/supabase.js";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4014;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let sender: any;
let receiver: any;
let senderToken: string;
let receiverToken: string;
let keyOk: string;
let keyFail: string;
let keyPin: string;

// Seed le solde d'un user : User.balance + ledger_account_balance (service role)
async function fundUser(userId: string, name: string, cents: number) {
  const { data: ledgerId, error: rpcErr } = await supabaseService.rpc(
    "piyes_ledger_get_or_create_customer_account",
    {
      p_customer_user_id: userId,
      p_name: name,
      p_piyes_account_id: null,
      p_piyes_user_id: userId,
      p_initial_balance_cents: cents,
    },
  );
  if (rpcErr) throw new Error(`ledger RPC failed: ${rpcErr.message}`);

  const { error: balErr } = await supabaseService
    .from("ledger_account_balance")
    .upsert({ ledger_account_id: ledgerId, balance_cents: cents });
  if (balErr) throw new Error(`balance upsert failed: ${balErr.message}`);

  const { error: userErr } = await supabaseService
    .from("User")
    .update({ balance: cents })
    .eq("id", userId);
  if (userErr) throw new Error(`user update failed: ${userErr.message}`);
}

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);

  const s = await signup(client, { email: uniqueEmail("send") });
  sender = s.user;
  senderToken = s.token;

  const r = await signup(client, { email: uniqueEmail("recv") });
  receiver = r.user;
  receiverToken = r.token;

  const pinS = await client.req("POST", "/api/v1/user/pin", {
    token: senderToken,
    body: { pin: "1234" },
  });
  assert.equal(pinS.status, 200);

  const pinR = await client.req("POST", "/api/v1/user/pin", {
    token: receiverToken,
    body: { pin: "5678" },
  });
  assert.equal(pinR.status, 200);

  await fundUser(sender.id, sender.name, 50000); // 500 HTG
  await fundUser(receiver.id, receiver.name, 0);

  // Clés idempotentes uniques par run (évite la collision avec les runs précédents)
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  keyOk = `transfer-ok-${runId}`;
  keyFail = `transfer-fail-${runId}`;
  keyPin = `transfer-pin-${runId}`;
});

after(async () => {
  await srv.stop();
});

test("transfert 100 HTG → 200, soldes mis à jour", async () => {
  const r = await client.req("POST", "/api/v1/transactions/transfer", {
    token: senderToken,
    headers: { "Idempotency-Key": keyOk },
    body: {
      amount: 100,
      contactId: receiver.id,
      pin: "1234",
      description: "Test automatisé",
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.amount, 10000); // centimes
  assert.equal(r.json.senderBalance, 400);
  assert.equal(r.json.receiverBalance, 100);
});

test("rejouer la même requête (même Idempotency-Key) → même transaction, pas de double débit", async () => {
  const r = await client.req("POST", "/api/v1/transactions/transfer", {
    token: senderToken,
    headers: { "Idempotency-Key": keyOk },
    body: {
      amount: 100,
      contactId: receiver.id,
      pin: "1234",
      description: "Test automatisé",
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.amount, 10000);
  assert.equal(r.json.senderBalance, 400);
  assert.equal(r.json.receiverBalance, 100);
});

test("solde insuffisant → 400 INSUFFICIENT_BALANCE", async () => {
  const r = await client.req("POST", "/api/v1/transactions/transfer", {
    token: senderToken,
    headers: { "Idempotency-Key": keyFail },
    body: {
      amount: 99999,
      contactId: receiver.id,
      pin: "1234",
    },
  });
  assert.equal(r.status, 400);
  const msg = (r.json?.error?.message || "").toLowerCase();
  assert.ok(msg.includes("insuffisant") || msg.includes("insufficient"));
});

test("mauvais PIN → 400", async () => {
  const r = await client.req("POST", "/api/v1/transactions/transfer", {
    token: senderToken,
    headers: { "Idempotency-Key": keyPin },
    body: {
      amount: 10,
      contactId: receiver.id,
      pin: "0000",
    },
  });
  assert.equal(r.status, 400);
});

test("historique : 1 transaction de transfert visible", async () => {
  const r = await client.req("GET", "/api/v1/transactions", {
    token: senderToken,
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
});
