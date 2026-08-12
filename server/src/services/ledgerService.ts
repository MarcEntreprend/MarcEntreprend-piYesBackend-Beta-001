// server/src/services/ledgerService.ts

import crypto from "crypto";
import { supabase } from "../supabase.js";

const SYSTEM_CASH_CODE = "1001";

export function getIdempotencyKey(req: {
  headers: Record<string, unknown>;
}): string {
  const header = req.headers["idempotency-key"];
  if (header && String(header).trim() !== "") return String(header).trim();
  return crypto.randomUUID();
}

export function isInsufficientFundsError(err: any): boolean {
  return (
    typeof err?.message === "string" &&
    err.message.includes("FONDS_INSUFFISANTS")
  );
}

export function isLedgerNotInitialized(err: any): boolean {
  return (
    typeof err?.message === "string" &&
    /piyes_ledger_post|piyes_ledger_get_or_create_customer_account|ledger_account|Could not find the function/i.test(
      err.message,
    )
  );
}

let systemCashPromise: Promise<string> | null = null;

export async function getSystemCashAccountId(): Promise<string> {
  if (systemCashPromise) return systemCashPromise;
  systemCashPromise = (async () => {
    const { data } = await supabase
      .from("ledger_account")
      .select("id")
      .eq("code", SYSTEM_CASH_CODE)
      .maybeSingle();
    if (data) return data.id as string;

    const { data: inserted, error } = await supabase
      .from("ledger_account")
      .insert({
        code: SYSTEM_CASH_CODE,
        name: "Caisse piYès HTG",
        type: "ASSET",
        is_system: true,
        allow_overdraft: true,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!inserted) throw new Error("Ledger non initialisé");
    return inserted.id as string;
  })();
  return systemCashPromise;
}

export interface CustomerLedgerOptions {
  name?: string;
  piyesAccountId?: string;
  piyesUserId?: string;
  initialBalanceCents?: number;
}

export async function getOrCreateCustomerLedgerAccount(
  customerUserId: string,
  opts: CustomerLedgerOptions = {},
): Promise<string> {
  console.log(
    "[LEDGER] Calling piyes_ledger_get_or_create_customer_account with:",
    {
      p_customer_user_id: customerUserId,
      p_name: opts.name || "Compte client",
      p_piyes_account_id: opts.piyesAccountId ?? null,
      p_piyes_user_id: opts.piyesUserId ?? null,
      p_initial_balance_cents: opts.initialBalanceCents ?? 0,
    },
  );

  // ✅ SUPPRIMER { schema: 'public' } – le client Supabase utilise public par défaut
  const { data, error } = await supabase.rpc(
    "piyes_ledger_get_or_create_customer_account",
    {
      p_customer_user_id: customerUserId,
      p_name: opts.name || "Compte client",
      p_piyes_account_id: opts.piyesAccountId ?? null,
      p_piyes_user_id: opts.piyesUserId ?? null,
      p_initial_balance_cents: opts.initialBalanceCents ?? 0,
    },
  );

  if (error) {
    console.error(
      "[LEDGER] getOrCreateCustomerLedgerAccount RPC error:",
      error,
    );
    throw error;
  }
  return data as string;
}

export interface PostOrderInput {
  idempotencyKey: string;
  type: string;
  customerUserId: string;
  amountCents: number;
  debitAccountId: string;
  creditAccountId: string;
  description: string;
  externalRef: string;
}

export interface PostOrderResult {
  paymentOrderId: string;
  journalEntryId: string | null;
  status: string;
  replay: boolean;
  debitBalance?: number;
  creditBalance?: number;
}

export async function postOrder(
  input: PostOrderInput,
): Promise<PostOrderResult> {
  console.log("[LEDGER] postOrder called with:", {
    idempotencyKey: input.idempotencyKey,
    type: input.type,
    customerUserId: input.customerUserId,
    amountCents: input.amountCents,
    debitAccountId: input.debitAccountId,
    creditAccountId: input.creditAccountId,
    description: input.description,
    externalRef: input.externalRef,
  });

  // Test de connexion RPC
  console.log("[LEDGER] Testing RPC connection...");
  const { data: testData, error: testError } = await supabase.rpc(
    "piyes_ledger_get_or_create_customer_account",
    {
      p_customer_user_id: "test",
      p_name: "test",
      p_piyes_account_id: null,
      p_piyes_user_id: null,
      p_initial_balance_cents: 0,
    },
  );
  console.log("[LEDGER] RPC test result:", testData, testError);
  if (testError) {
    console.error("[LEDGER] RPC test FAILED:", testError);
    throw new Error(`RPC not accessible: ${testError.message}`);
  }

  const { data, error } = await supabase.rpc("piyes_ledger_post", {
    p_idempotency_key: input.idempotencyKey,
    p_type: input.type,
    p_customer_user_id: input.customerUserId,
    p_amount_cents: input.amountCents,
    p_debit_account_id: input.debitAccountId,
    p_credit_account_id: input.creditAccountId,
    p_description: input.description,
    p_external_ref: input.externalRef,
  });

  if (error) {
    console.error("[LEDGER] postOrder RPC error:", error);
    throw error;
  }
  console.log("[LEDGER] postOrder result:", data);
  // Normalise les clés snake_case renvoyées par la RPC (payment_order_id,
  // debit_balance, credit_balance, journal_entry_id) vers le camelCase.
  const raw: any = data ?? {};
  return {
    paymentOrderId: raw.payment_order_id ?? raw.paymentOrderId,
    journalEntryId: raw.journal_entry_id ?? raw.journalEntryId,
    status: raw.status,
    replay: raw.replay,
    debitBalance: raw.debit_balance ?? raw.debitBalance,
    creditBalance: raw.credit_balance ?? raw.creditBalance,
  } as PostOrderResult;
}

export function ledgerErrorResponse(err: any): {
  status: number;
  body: { error: { message: string; code?: string } };
} {
  console.error("[LEDGER] ledgerErrorResponse:", err);

  if (isInsufficientFundsError(err)) {
    return {
      status: 400,
      body: {
        error: {
          message: "Transaction refusée : solde insuffisant",
          code: "INSUFFICIENT_BALANCE",
        },
      },
    };
  }

  if (isLedgerNotInitialized(err)) {
    return {
      status: 500,
      body: {
        error: {
          message:
            "Ledger non initialisé : exécutez ledger.sql dans Supabase avant de continuer.",
          code: "LEDGER_NOT_INITIALIZED",
        },
      },
    };
  }

  return {
    status: 400,
    body: { error: { message: err?.message || "Transaction failed" } },
  };
}
