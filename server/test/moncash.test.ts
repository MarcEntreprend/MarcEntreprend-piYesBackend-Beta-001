// server/test/moncash.test.ts
//
// Tests de l'intégration MonCash :
//   - Le service moncashService.ts est testé contre un mock HTTP local qui
//     reproduit fidèlement les réponses de la doc (api/RestAPI_MonCash.md) :
//     OAuth token, CreatePayment (payment_token), CustomerStatus (wrapper),
//     RetrieveTransactionPayment, RetrieveOrderPayment, Transfert,
//     PrefundedTransactionStatus, PrefundedBalance (objet balance).
//   - Le payout /withdraw vers un compte MonCash est testé de bout en bout via
//     le serveur réel pointé sur le mock.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { supabaseService } from "../src/supabase.js";
import { startServer, makeClient, uniqueEmail, signup } from "./helpers.js";
import type { TestServer } from "./helpers.js";

const PORT = 4023;

// ============================================================
// Mock de l'API REST MonCash (conforme à la doc)
// ============================================================

interface MockState {
  customerStatus: { type: string; status: string[] } | null;
  prefundedBalance: number;
  transferFails: boolean;
  createPaymentToken: string;
  oauthCalls: number;
  lastTransferBody: any;
}

const state: MockState = {
  customerStatus: null,
  prefundedBalance: 50000,
  transferFails: false,
  createPaymentToken: "mock-token-123",
  oauthCalls: 0,
  lastTransferBody: null,
};

let mockServer: http.Server;

function startMockServer(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const send = (status: number, data: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        };

        const url = req.url || "";
        let payload: any = {};
        if (body) {
          try {
            payload = JSON.parse(body);
          } catch {
            payload = { raw: body };
          }
        }

        if (url.endsWith("/oauth/token")) {
          state.oauthCalls++;
          return send(200, {
            access_token: "mock-access-token",
            token_type: "bearer",
            expires_in: 59,
            scope: "read,write",
            jti: "mock-jti",
          });
        }

        if (url.endsWith("/v1/CreatePayment")) {
          return send(202, {
            path: "/v1/CreatePayment",
            payment_token: {
              expired: "2099-01-01 12:00:00:000",
              created: "2099-01-01 11:59:00:000",
              token: state.createPaymentToken,
            },
            timestamp: 1558715815122,
            status: 202,
            mode: "sandbox",
          });
        }

        if (url.endsWith("/v1/RetrieveTransactionPayment")) {
          return send(200, {
            path: "/v1/RetrieveTransactionPayment",
            payment: {
              reference: "1559796839",
              transaction_id: payload.transactionId || "12874820",
              cost: 10,
              message: "successful",
              payer: "50937007294",
            },
            timestamp: 1560029360970,
            status: 200,
          });
        }

        if (url.endsWith("/v1/RetrieveOrderPayment")) {
          return send(200, {
            path: "/v1/RetrieveOrderPayment",
            payment: {
              reference: "1559796839",
              transaction_id: "12874820",
              cost: 10,
              message: "successful",
              payer: "50937007294",
            },
            timestamp: 1560029360970,
            status: 200,
          });
        }

        if (url.endsWith("/v1/CustomerStatus")) {
          if (!state.customerStatus) {
            return send(200, {
              path: "/v1/CustomerStatus",
              customerStatus: {
                type: "fullkyc",
                status: ["registered", "active"],
              },
              timestamp: 1558715815122,
              status: 200,
              mode: "sandbox",
            });
          }
          return send(200, {
            path: "/v1/CustomerStatus",
            customerStatus: state.customerStatus,
            timestamp: 1558715815122,
            status: 200,
            mode: "sandbox",
          });
        }

        if (url.endsWith("/v1/Transfert")) {
          state.lastTransferBody = payload;
          if (state.transferFails) {
            return send(403, {
              path: "/Api/v1/Transfert",
              error: "Forbidden",
              message: "Maximum Account Balance",
              timestamp: 1732154199606,
              status: 403,
            });
          }
          return send(200, {
            path: "/Api/v1/Transfert",
            transfer: {
              transaction_id: "tx-payout-1",
              amount: payload.amount,
              receiver: payload.receiver,
              message: "successful",
              desc: payload.desc,
            },
            timestamp: 1589927614388,
            status: 200,
          });
        }

        if (url.endsWith("/v1/PrefundedTransactionStatus")) {
          return send(200, {
            path: "/Api/v1/PrefundedTransactionStatus",
            transStatus: "successful",
            timestamp: 1732154100298,
            status: 200,
          });
        }

        if (url.endsWith("/v1/PrefundedBalance")) {
          return send(200, {
            path: "/Api/v1/PrefundedBalance",
            balance: {
              balance: state.prefundedBalance,
              message: "successful",
            },
            timestamp: 1732205962423,
            status: 200,
          });
        }

        return send(404, { error: "Not Found" });
      });
    });
    mockServer.listen(0, "127.0.0.1", () => {
      resolve((mockServer.address() as AddressInfo).port);
    });
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => mockServer.close(() => resolve()));
}

// ============================================================
// Import dynamique du service avec env pointé sur le mock
// ============================================================

async function importService(mockPort: number) {
  process.env.MONCASH_CLIENT_ID = "mock-client";
  process.env.MONCASH_CLIENT_SECRET = "mock-secret";
  process.env.MONCASH_API_HOST = `http://127.0.0.1:${mockPort}/Api`;
  process.env.MONCASH_GATEWAY_URL =
    "https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware";
  const mod = await import("../src/services/moncashService.js");
  return mod;
}

let srv: TestServer;
let client: ReturnType<typeof makeClient>;
let mockPort: number;

before(async () => {
  mockPort = await startMockServer();
  srv = await startServer({
    port: PORT,
    env: {
      MONCASH_CLIENT_ID: "mock-client",
      MONCASH_CLIENT_SECRET: "mock-secret",
      MONCASH_API_HOST: `http://127.0.0.1:${mockPort}/Api`,
      MONCASH_GATEWAY_URL:
        "https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware",
    },
  });
  client = makeClient(srv.baseUrl);
});

after(async () => {
  await srv.stop();
  await stopMockServer();
});

// ============================================================
// Tests du service
// ============================================================

test("service: le token OAuth est mis en cache (1 seul /oauth/token)", async () => {
  const { moncashService } = await importService(mockPort);
  state.oauthCalls = 0;
  await moncashService.getCustomerStatus("50937007294");
  await moncashService.getCustomerStatus("50937007294");
  await moncashService.getCustomerStatus("50937007294");
  assert.equal(state.oauthCalls, 1, "token doit être en cache");
});

test("service: createPayment parse payment_token (doc)", async () => {
  const { moncashService } = await importService(mockPort);
  const result = await moncashService.createPayment(25, "order-1");
  assert.equal(result.token, "mock-token-123");
  assert.ok(result.redirectUrl.includes("/Payment/Redirect?token="));
  assert.equal(result.mode, "sandbox");
  assert.ok(result.created);
  assert.ok(result.expired);
});

test("service: getCustomerStatus lit le wrapper customerStatus (doc)", async () => {
  const { moncashService } = await importService(mockPort);
  state.customerStatus = { type: "fullkyc", status: ["registered", "active"] };
  const status = await moncashService.getCustomerStatus("50937007294");
  assert.equal(status.type, "fullkyc");
  assert.deepEqual(status.status, ["registered", "active"]);
});

test("service: getPrefundedBalance lit l'objet balance (doc)", async () => {
  const { moncashService } = await importService(mockPort);
  state.prefundedBalance = 29814021.18;
  const bal = await moncashService.getPrefundedBalance();
  assert.equal(bal.balance, 29814021.18);
  assert.equal(bal.message, "successful");
});

test("service: retrieveTransactionPayment & retrieveOrderPayment", async () => {
  const { moncashService } = await importService(mockPort);
  const byTx = await moncashService.retrieveTransactionPayment("12874820");
  assert.equal(byTx.payment.transaction_id, "12874820");
  assert.equal(byTx.payment.cost, 10);
  assert.equal(byTx.payment.message, "successful");

  const byOrder = await moncashService.retrieveOrderPayment("order-1");
  assert.equal(byOrder.payment.transaction_id, "12874820");
});

test("service: transfer envoie amount/receiver/desc/reference", async () => {
  const { moncashService } = await importService(mockPort);
  state.transferFails = false;
  const transfer = await moncashService.transfer(
    100,
    "50937007294",
    "ref-abc-1",
    "Retrait piYès",
  );
  assert.equal(transfer.transaction_id, "tx-payout-1");
  assert.equal(state.lastTransferBody.amount, 100);
  assert.equal(state.lastTransferBody.receiver, "50937007294");
  assert.equal(state.lastTransferBody.reference, "ref-abc-1");
  assert.equal(state.lastTransferBody.desc, "Retrait piYès");
});

test("service: transfer 403 → MonCashError status 403", async () => {
  const { moncashService, MonCashError } = await importService(mockPort);
  state.transferFails = true;
  await assert.rejects(
    moncashService.transfer(500, "50937007294", "ref-fail-1"),
    (err: any) =>
      err instanceof MonCashError &&
      err.status === 403 &&
      err.message.includes("Maximum Account Balance"),
  );
  state.transferFails = false;
});

test("service: prefundedTransactionStatus", async () => {
  const { moncashService } = await importService(mockPort);
  const status = await moncashService.prefundedTransactionStatus("ref-abc-1");
  assert.equal(status.transStatus, "successful");
});

test("service: sans client_id/secret → MonCashError config", async () => {
  const mod = await import("../src/services/moncashService.js");
  const savedId = process.env.MONCASH_CLIENT_ID;
  const savedSecret = process.env.MONCASH_CLIENT_SECRET;
  process.env.MONCASH_CLIENT_ID = "";
  process.env.MONCASH_CLIENT_SECRET = "";
  await assert.rejects(
    mod.moncashService.createPayment(10, "order-x"),
    (err: any) =>
      err instanceof mod.MonCashError &&
      err.message.includes("MONCASH_CLIENT_ID"),
  );
  process.env.MONCASH_CLIENT_ID = savedId;
  process.env.MONCASH_CLIENT_SECRET = savedSecret;
});

// ============================================================
// Tests de bout en bout : payout MonCash via /withdraw
// ============================================================

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

test("withdraw vers compte MonCash → payout réel + ledger (débit client / crédit préfondé)", async () => {
  const s = await signup(client, { email: uniqueEmail("mcw") });
  const user = s.user;
  const token = s.token;

  const pinRes = await client.req("POST", "/api/v1/user/pin", {
    token,
    body: { pin: "1234" },
  });
  assert.equal(pinRes.status, 200);

  await fundUser(user.id, user.name, 10000); // 100 HTG

  // Lier un compte MonCash
  const link = await client.req("POST", "/api/v1/banks/link", {
    token,
    body: { bankId: "b2", username: "50937007294" },
  });
  assert.equal(link.status, 200);
  const moncashAccountId = link.json.id;
  assert.equal(link.json.provider, "moncash");

  state.customerStatus = { type: "fullkyc", status: ["registered", "active"] };
  state.prefundedBalance = 50000; // 500 HTG préfondés
  state.transferFails = false;

  const r = await client.req("POST", "/api/v1/transactions/withdraw", {
    token,
    body: { amount: 10, accountId: moncashAccountId, pin: "1234" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.type, "WITHDRAW");
  assert.equal(r.json.role, "PAYER");
  assert.equal(r.json.amount, 1000);
  assert.equal(r.json.moncashTransactionId, "tx-payout-1");
  assert.ok(r.json.moncashReference);
  assert.equal(state.lastTransferBody.receiver, "50937007294");
});

test("withdraw MonCash: KYC inéligible → 400 MONCASH_CUSTOMER_INELIGIBLE", async () => {
  const s = await signup(client, { email: uniqueEmail("mckyc") });
  const token = s.token;
  const pinRes = await client.req("POST", "/api/v1/user/pin", {
    token,
    body: { pin: "1234" },
  });
  assert.equal(pinRes.status, 200);
  await fundUser(s.user.id, s.user.name, 10000);

  const link = await client.req("POST", "/api/v1/banks/link", {
    token,
    body: { bankId: "b2", username: "50937007294" },
  });
  const moncashAccountId = link.json.id;

  state.customerStatus = { type: "none", status: ["not_found"] };
  const r = await client.req("POST", "/api/v1/transactions/withdraw", {
    token,
    body: { amount: 10, accountId: moncashAccountId, pin: "1234" },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "MONCASH_CUSTOMER_INELIGIBLE");
});

test("withdraw MonCash: sans PIN → 400", async () => {
  const s = await signup(client, { email: uniqueEmail("mcpin") });
  const token = s.token;
  await fundUser(s.user.id, s.user.name, 10000);
  const link = await client.req("POST", "/api/v1/banks/link", {
    token,
    body: { bankId: "b2", username: "50937007294" },
  });
  const moncashAccountId = link.json.id;

  state.customerStatus = { type: "fullkyc", status: ["registered", "active"] };
  const r = await client.req("POST", "/api/v1/transactions/withdraw", {
    token,
    body: { amount: 10, accountId: moncashAccountId },
  });
  assert.equal(r.status, 400);
  assert.ok((r.json.error.message || "").includes("PIN"));
});

test("withdraw MonCash: compte préfondé insuffisant → 400 MONCASH_PREFUNDED_INSUFFICIENT", async () => {
  const s = await signup(client, { email: uniqueEmail("mcbala") });
  const token = s.token;
  const pinRes = await client.req("POST", "/api/v1/user/pin", {
    token,
    body: { pin: "1234" },
  });
  assert.equal(pinRes.status, 200);
  await fundUser(s.user.id, s.user.name, 10000);

  const link = await client.req("POST", "/api/v1/banks/link", {
    token,
    body: { bankId: "b2", username: "50937007294" },
  });
  const moncashAccountId = link.json.id;

  state.customerStatus = { type: "fullkyc", status: ["registered", "active"] };
  state.prefundedBalance = 5; // 0.05 HTG
  const r = await client.req("POST", "/api/v1/transactions/withdraw", {
    token,
    body: { amount: 10, accountId: moncashAccountId, pin: "1234" },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "MONCASH_PREFUNDED_INSUFFICIENT");
});

test("endpoints moncash: order-payment, transfer-status, prefunded-balance", async () => {
  const s = await signup(client, { email: uniqueEmail("mceps") });
  const token = s.token;

  const op = await client.req(
    "POST",
    "/api/v1/transactions/moncash/order-payment",
    {
      token,
      body: { orderId: "order-1" },
    },
  );
  assert.equal(op.status, 200);
  assert.equal(op.json.payment.transaction_id, "12874820");

  const ts = await client.req(
    "POST",
    "/api/v1/transactions/moncash/transfer-status",
    {
      token,
      body: { reference: "ref-abc-1" },
    },
  );
  assert.equal(ts.status, 200);
  assert.equal(ts.json.transStatus, "successful");

  const bal = await client.req(
    "GET",
    "/api/v1/transactions/moncash/prefunded-balance",
    {
      token,
      headers: { "x-admin-secret": "not-configured" },
    },
  );
  assert.equal(bal.status, 403);
});

test("deposit MonCash puis confirm par orderId → ledger crédité", async () => {
  const s = await signup(client, { email: uniqueEmail("mcdep") });
  const user = s.user;
  const token = s.token;
  const pinRes = await client.req("POST", "/api/v1/user/pin", {
    token,
    body: { pin: "1234" },
  });
  assert.equal(pinRes.status, 200);
  await fundUser(user.id, user.name, 5000);

  const link = await client.req("POST", "/api/v1/banks/link", {
    token,
    body: { bankId: "b2", username: "50937007294" },
  });
  const moncashAccountId = link.json.id;

  // Deposit via compte MonCash → crée une PENDING + retourne redirectUrl
  const dep = await client.req("POST", "/api/v1/transactions/deposit", {
    token,
    body: { amount: 10, accountId: moncashAccountId, pin: "1234" },
  });
  assert.equal(dep.status, 200);
  assert.ok(dep.json.redirectUrl);
  assert.equal(dep.json.mode, "sandbox");
  const orderId = dep.json.orderId;

  // Confirmation par orderId → RetrieveOrderPayment (mock cost=10)
  const conf = await client.req(
    "POST",
    "/api/v1/transactions/moncash/confirm",
    {
      token,
      body: { orderId },
    },
  );
  assert.equal(conf.status, 200, JSON.stringify(conf.json));
  assert.equal(conf.json.type, "DEPOSIT");
  assert.equal(conf.json.status, "COMPLETED");
  assert.equal(conf.json.amount, 1000);
  assert.equal(conf.json.moncashReference, "1559796839");
});

test("moncash/confirm : l'orderId d'un autre user → 403 ORDER_NOT_OWNED", async () => {
  const a = await signup(client, { email: uniqueEmail("mcowna") });
  await client.req("POST", "/api/v1/user/pin", {
    token: a.token,
    body: { pin: "1234" },
  });
  const linkA = await client.req("POST", "/api/v1/banks/link", {
    token: a.token,
    body: { bankId: "b2", username: "50937007294" },
  });
  const moncashAccountIdA = linkA.json.id;

  const dep = await client.req("POST", "/api/v1/transactions/deposit", {
    token: a.token,
    body: { amount: 10, accountId: moncashAccountIdA, pin: "1234" },
  });
  assert.equal(dep.status, 200);
  const orderId = dep.json.orderId;

  // Le user B tente de confirmer l'ordre de A
  const b = await signup(client, { email: uniqueEmail("mcownb") });
  const conf = await client.req(
    "POST",
    "/api/v1/transactions/moncash/confirm",
    {
      token: b.token,
      body: { orderId },
    },
  );
  assert.equal(conf.status, 403);
  assert.equal(conf.json.error.code, "ORDER_NOT_OWNED");
});
