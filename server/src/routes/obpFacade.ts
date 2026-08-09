// server/src/routes/obpFacade.ts
//
// Phase 4 — API publique / Open Banking (OBP-API v3.1.0)
// ------------------------------------------------------
// Expose des endpoints OBP standardisés pour les tiers, derrière une clé API.
//
// Deux modes :
//   - MODE_PROXY (si OBP_BASE_URL défini) : relaye vers une instance OBP-API
//     réelle (ex: apisandbox.openbankproject.com) avec DirectLogin.
//   - MODE_LOCAL : sert des réponses OBP-compatibles en lecture seule,
//     construites depuis les tables Supabase piYès (Account, Transaction).
//     Jamais source de vérité — le ledger piYès reste la référence.
//
// Sécurité : les endpoints sont protégés par clé API (X-API-Key ou Bearer),
// validée via apiKeyService (table piyes_api_key).
//
// Montage dans server.ts :
//   app.use("/obp/v3.1.0", (await import("./server/src/routes/obpFacade.js")).default);
// Les routes ci-dessous sont donc relatives à /obp/v3.1.0 (pas de préfixe répété).

import express from "express";
import { supabase } from "../supabase.js";
import { apiKeyAuth } from "../services/apiKeyService.js";

const router = express.Router();

const OBP_BASE_URL = process.env.OBP_BASE_URL || "";
const OBP_USERNAME = process.env.OBP_USERNAME || "demo.client1@piyes.app";
const OBP_PASSWORD = process.env.OBP_PASSWORD || "PiyesDemo2026!";
const OBP_CONSUMER_KEY = process.env.OBP_CONSUMER_KEY || "";

let cachedToken: string | null = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 60 * 60 * 1000;

async function getDirectLoginToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedTokenAt < TOKEN_TTL_MS)
    return cachedToken;

  let authHeader = `DirectLogin username="${OBP_USERNAME}",password="${OBP_PASSWORD}"`;
  if (OBP_CONSUMER_KEY) authHeader += `,consumer_key="${OBP_CONSUMER_KEY}"`;

  const res = await fetch(`${OBP_BASE_URL}/my/logins/direct`, {
    method: "POST",
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`DirectLogin failed: ${res.status}`);

  const header = res.headers.get("authorization") || "";
  const token = header.replace(/^DirectLogin token="?/, "").replace(/"?$/, "");
  if (!token) throw new Error("DirectLogin: no token returned");
  cachedToken = token;
  cachedTokenAt = Date.now();
  return token;
}

async function proxy(path: string, init?: RequestInit): Promise<Response> {
  const token = await getDirectLoginToken();
  const url = `${OBP_BASE_URL}/obp/v3.1.0${path}`;
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `DirectLogin token="${token}"`,
    },
  });
}

// GET /obp/v3.1.0/banks
router.get("/banks", apiKeyAuth, async (req, res) => {
  try {
    if (OBP_BASE_URL) {
      const r = await proxy("/banks");
      const body = await r.json();
      return res.status(r.status).json(body);
    }
    const { data } = await supabase
      .from("Account")
      .select("provider, label, logoUrl")
      .eq("status", "active");
    const banks = (data || [])
      .map((a: any) => a.provider)
      .filter((p: string, i: number, arr: string[]) => arr.indexOf(p) === i)
      .map((provider: string) => ({
        id: provider,
        short_name: provider,
        full_name: provider.toUpperCase(),
        logo: "",
        website: "",
      }));
    return res.json({ banks });
  } catch (err: any) {
    return res.status(502).json({ message: err?.message || "OBP proxy error" });
  }
});

// GET /obp/v3.1.0/accounts/public
router.get("/accounts/public", apiKeyAuth, async (req, res) => {
  try {
    if (OBP_BASE_URL) {
      const r = await proxy("/accounts/public");
      const body = await r.json();
      return res.status(r.status).json(body);
    }
    const { data } = await supabase
      .from("Account")
      .select("id, label, provider")
      .eq("status", "active");
    return res.json({
      accounts: (data || []).map((a: any) => ({
        id: a.id,
        label: a.label,
        bank_id: a.provider,
        views_available: [
          { id: "public", short_name: "Public", is_public: true },
        ],
      })),
    });
  } catch (err: any) {
    return res.status(502).json({ message: err?.message || "OBP proxy error" });
  }
});

// GET /obp/v3.1.0/banks/:bankId/accounts/:accountId/:viewId/transactions
router.get(
  "/banks/:bankId/accounts/:accountId/:viewId/transactions",
  apiKeyAuth,
  async (req, res) => {
    try {
      if (OBP_BASE_URL) {
        const r = await proxy(
          `/banks/${req.params.bankId}/accounts/${req.params.accountId}/${req.params.viewId}/transactions`,
        );
        const body = await r.json();
        return res.status(r.status).json(body);
      }

      const { data: account } = await supabase
        .from("Account")
        .select("id, label, provider")
        .eq("id", req.params.accountId)
        .single();
      if (!account)
        return res.status(404).json({ message: "Account not found" });

      const { data: txns } = await supabase
        .from("Transaction")
        .select("*")
        .eq("accountId", req.params.accountId)
        .order("date", { ascending: false })
        .limit(50);

      return res.json({
        transactions: (txns || []).map((t: any) => {
          const isPayer = t.role === "PAYER";
          const signedAmount = isPayer ? -t.amount : t.amount;
          const value = (signedAmount / 100).toFixed(2);
          return {
            id: t.id,
            this_account: {
              id: t.accountId,
              bank_id: account.provider,
              views_available: [{ id: req.params.viewId }],
            },
            other_account: {
              holder: { name: t.counterpartyName || "" },
              number: t.external_id || "",
            },
            details: {
              type: t.type || "SCT",
              description: t.description || "",
              posted: t.date,
              completed: t.date,
              new_balance: ((t.balance_after ?? 0) / 100).toFixed(2),
              value,
            },
            transaction_ids: { transaction_id: t.id },
          };
        }),
      });
    } catch (err: any) {
      return res
        .status(502)
        .json({ message: err?.message || "OBP proxy error" });
    }
  },
);

export default router;
