// server/test/funds.test.ts
// Flux fonds : recharge (ledger), dépôt, retrait.
//   signup, PIN, seed solde (User.balance + ledger + Account.balance),
//   recharge opérateur, dépôt sur compte, retrait.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { supabaseService } from "../src/supabase.js";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4015;
let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let user: any;
let token: string;
let piyesAccountId: string;

// Seed le solde complet d'un user :
//   User.balance + ledger_account_balance + Account.balance (compte piyes)
async function seedBalance(userId: string, name: string, cents: number) {
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

  const { data: account } = await supabaseService
    .from("Account")
    .select("id")
    .eq("userId", userId)
    .eq("provider", "piyes")
    .single();
  if (account) {
    const { error: accErr } = await supabaseService
      .from("Account")
      .update({ balance: cents })
      .eq("id", account.id);
    if (accErr) throw new Error(`account update failed: ${accErr.message}`);
  }
}

before(async () => {
  srv = await startServer({ port: PORT });
  client = makeClient(srv.baseUrl);

  const s = await signup(client, { email: uniqueEmail("fund") });
  user = s.user;
  token = s.token;

  const pinRes = await client.req("POST", "/api/v1/user/pin", {
    token,
    body: { pin: "1234" },
  });
  assert.equal(pinRes.status, 200);

  await seedBalance(user.id, user.name, 50000); // 500 HTG

  const { data: account } = await supabaseService
    .from("Account")
    .select("id")
    .eq("userId", user.id)
    .eq("provider", "piyes")
    .single();
  piyesAccountId = account!.id;
});

after(async () => {
  await srv.stop();
});

test("recharge opérateur 50 HTG → 200 (type RECHARGE)", async () => {
  const r = await client.req("POST", "/api/v1/transactions/recharge", {
    token,
    body: {
      phoneNumber: "50900001111",
      amount: 50,
      operatorId: "digicel",
      accountId: piyesAccountId,
      pin: "1234",
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, "RECHARGE");
  assert.equal(r.json.amount, 5000); // centimes
  assert.equal(r.json.role, "PAYER");
});

test("recharge solde insuffisant → 400 INSUFFICIENT_BALANCE", async () => {
  const r = await client.req("POST", "/api/v1/transactions/recharge", {
    token,
    body: {
      phoneNumber: "50900001111",
      amount: 999999,
      operatorId: "natcom",
      accountId: piyesAccountId,
      pin: "1234",
    },
  });
  assert.equal(r.status, 400);
  const msg = (r.json?.error?.message || "").toLowerCase();
  assert.ok(msg.includes("insuffisant") || msg.includes("insufficient"));
});

test("dépôt 25 HTG → 200 (type DEPOSIT, crédit ledger)", async () => {
  const r = await client.req("POST", "/api/v1/transactions/deposit", {
    token,
    body: { amount: 25, accountId: piyesAccountId, pin: "1234" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, "DEPOSIT");
  assert.equal(r.json.role, "RECEIVER");
  assert.equal(r.json.amount, 2500);
});

test("retrait 10 HTG → 200 (type WITHDRAW, débit ledger)", async () => {
  const r = await client.req("POST", "/api/v1/transactions/withdraw", {
    token,
    body: { amount: 10, accountId: piyesAccountId, pin: "1234" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, "WITHDRAW");
  assert.equal(r.json.role, "PAYER");
  assert.equal(r.json.amount, 1000);
});
