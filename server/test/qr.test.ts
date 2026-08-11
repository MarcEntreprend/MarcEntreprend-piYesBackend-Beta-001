// server/test/qr.test.ts
// Paiement par QR Code :
//   generate-qr (montant pré-rempli), scan-qr → transfert ledger P2P,
//   vérification des soldes du payeur.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { supabaseService } from "../src/supabase.js";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4019;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let sender: any;
let receiver: any;
let senderToken: string;
let receiverToken: string;
let qrData: string;

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

  const s = await signup(client, { email: uniqueEmail("qrs") });
  sender = s.user;
  senderToken = s.token;

  const r = await signup(client, { email: uniqueEmail("qrr") });
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

  await fundUser(sender.id, sender.name, 30000); // 300 HTG
});

after(async () => {
  await srv.stop();
});

test("generate-qr : QR identité sans montant → qrData JSON", async () => {
  const r = await client.req("POST", "/api/v1/transactions/generate-qr", {
    token: receiverToken,
    body: {},
  });
  assert.equal(r.status, 200);
  const parsed = JSON.parse(r.json.qrData);
  assert.equal(parsed.id, receiver.id);
  assert.ok(!("amount" in parsed));
});

test("generate-qr : QR de paiement avec montant → amount en HTG", async () => {
  const r = await client.req("POST", "/api/v1/transactions/generate-qr", {
    token: receiverToken,
    body: { amount: 80, description: "Lunch", expiresInMinutes: 5 },
  });
  assert.equal(r.status, 200);
  qrData = r.json.qrData;
  const parsed = JSON.parse(qrData);
  assert.equal(parsed.amount, 80); // HTG (le scanner convertit en centimes)
  assert.equal(parsed.description, "Lunch");
});

test("scan-qr : paiement 80 HTG → 200, solde payeur mis à jour", async () => {
  const r = await client.req("POST", "/api/v1/transactions/scan-qr", {
    token: senderToken,
    headers: {
      "Idempotency-Key": `qr-ok-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    },
    body: { qrData, pin: "1234" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, "TRANSFER");
  assert.equal(r.json.role, "PAYER");
  assert.equal(r.json.amount, 8000);
});

test("scan-qr : rejeu (même Idempotency-Key) → pas de double débit", async () => {
  const key = `qr-replay-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const body = { qrData, pin: "1234" };

  const r1 = await client.req("POST", "/api/v1/transactions/scan-qr", {
    token: senderToken,
    headers: { "Idempotency-Key": key },
    body,
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.amount, 8000);

  // Récupérer le solde du payeur après le premier paiement
  const sync1 = await client.req("GET", "/api/v1/user/sync", {
    token: senderToken,
  });
  assert.equal(sync1.status, 200);
  const balanceAfterFirst = sync1.json.balance; // en HTG

  // Second appel avec la même clé
  const r2 = await client.req("POST", "/api/v1/transactions/scan-qr", {
    token: senderToken,
    headers: { "Idempotency-Key": key },
    body,
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.amount, 8000);

  // Vérifier que le solde n'a pas changé
  const sync2 = await client.req("GET", "/api/v1/user/sync", {
    token: senderToken,
  });
  assert.equal(sync2.status, 200);
  const balanceAfterSecond = sync2.json.balance;

  assert.equal(
    balanceAfterFirst,
    balanceAfterSecond,
    "Le solde n'a pas dû changer après le replay",
  );
});

test("scan-qr : solde insuffisant → 400", async () => {
  const r = await client.req("POST", "/api/v1/transactions/scan-qr", {
    token: senderToken,
    headers: {
      "Idempotency-Key": `qr-fail-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    },
    body: { qrData, pin: "1234", amount: 999999 },
  });
  assert.equal(r.status, 400);
});
