// server/src/services/moncashService.ts
//
// Client REST MonCash – conforme à la documentation officielle
// (api/RestAPI_MonCash.md) :
//   POST /oauth/token                       (client_credentials)
//   POST /v1/CreatePayment                  → payment_token.token
//   POST /v1/RetrieveTransactionPayment     → payment.transaction_id
//   POST /v1/RetrieveOrderPayment           → payment.transaction_id
//   POST /v1/CustomerStatus                 → customerStatus {type, status}
//   POST /v1/Transfert                      → transfer.transaction_id
//   POST /v1/PrefundedTransactionStatus     → transStatus
//   GET  /v1/PrefundedBalance               → balance {balance, message}

import dotenv from "dotenv";
dotenv.config();

const REQUEST_TIMEOUT_MS = 15_000;

function envConfig() {
  const clientId = process.env.MONCASH_CLIENT_ID || "";
  const clientSecret = process.env.MONCASH_CLIENT_SECRET || "";
  const rawApiHost =
    process.env.MONCASH_API_HOST ||
    "sandbox.moncashbutton.digicelgroup.com/Api";
  // Accepte "sandbox.moncashbutton.digicelgroup.com/Api" (doc) ou une base complète
  // (ex: "http://127.0.0.1:4001/Api" pour les tests contre un mock local).
  const apiBase = /^https?:\/\//.test(rawApiHost)
    ? rawApiHost.replace(/\/+$/, "")
    : `https://${rawApiHost}`;
  const gatewayUrl =
    process.env.MONCASH_GATEWAY_URL ||
    "https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware";
  return { clientId, clientSecret, apiBase, gatewayUrl };
}

function assertConfigured(cfg: ReturnType<typeof envConfig>): void {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new MonCashError(
      "MonCash non configuré : renseignez MONCASH_CLIENT_ID et MONCASH_CLIENT_SECRET",
      500,
    );
  }
}

// --- Types conformes à la doc -------------------------------------------------

export interface PaymentToken {
  expired: string;
  created: string;
  token: string;
}

export interface CreatePaymentResult {
  token: string;
  expired: string;
  created: string;
  mode: string;
  redirectUrl: string;
}

export interface MonCashPayment {
  reference: string;
  transaction_id: string;
  cost: number;
  message: string;
  payer: string;
}

export interface RetrievePaymentResult {
  payment: MonCashPayment;
}

export interface CustomerStatusResult {
  type: string;
  status: string[];
}

export interface TransferResult {
  transaction_id: string;
  amount: number;
  receiver: string;
  message: string;
  desc: string;
}

export interface TransferStatusResult {
  transStatus: string;
}

export interface PrefundedBalanceResult {
  balance: number;
  message: string;
}

// --- Interfaces de réponse brute (ce que renvoie réellement MonCash) ----------

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  jti?: string;
}

interface CreatePaymentResponse {
  path?: string;
  payment_token?: PaymentToken;
  timestamp?: number;
  status?: number;
  mode?: string;
}

interface CustomerStatusResponse {
  path?: string;
  customerStatus?: CustomerStatusResult;
  timestamp?: number;
  status?: number;
  mode?: string;
}

interface RetrieveTransactionResponse {
  path?: string;
  payment?: MonCashPayment;
  timestamp?: number;
  status?: number;
}

interface TransferResponse {
  path?: string;
  transfer?: TransferResult;
  timestamp?: number;
  status?: number;
}

interface TransferStatusResponse {
  path?: string;
  transStatus?: string;
  timestamp?: number;
  status?: number;
  error?: string;
  message?: string;
}

interface PrefundedBalanceResponse {
  path?: string;
  balance?: PrefundedBalanceResult;
  timestamp?: number;
  status?: number;
}

export class MonCashError extends Error {
  status: number;
  moncashMessage?: string;

  constructor(message: string, status = 500, moncashMessage?: string) {
    super(message);
    this.name = "MonCashError";
    this.status = status;
    this.moncashMessage = moncashMessage;
  }
}

// --- Client -------------------------------------------------------------------

class MonCashService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private async request(
    method: "GET" | "POST",
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<any> {
    const cfg = envConfig();
    assertConfigured(cfg);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    try {
      const response = await fetch(`${cfg.apiBase}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      let data: any = null;
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const moncashMessage = data?.message || data?.error || text;
        if (response.status === 403 && path === "/v1/Transfert") {
          throw new MonCashError(
            "Maximum Account Balance",
            403,
            moncashMessage,
          );
        }
        throw new MonCashError(
          `MonCash ${path} Error: ${moncashMessage}`,
          response.status,
          moncashMessage,
        );
      }

      return data;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new MonCashError(
          `MonCash ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`,
          504,
        );
      }
      if (err instanceof MonCashError) throw err;
      throw new MonCashError(`MonCash ${path} request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async getAccessToken(): Promise<string> {
    const cfg = envConfig();
    assertConfigured(cfg);

    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiry) {
      return this.accessToken;
    }

    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
      "base64",
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${cfg.apiBase}/oauth/token`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "scope=read,write&grant_type=client_credentials",
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new MonCashError("MonCash token request timed out", 504);
      }
      throw new MonCashError(`MonCash token request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data: OAuthTokenResponse | null = null;
    try {
      data = JSON.parse(text) as OAuthTokenResponse;
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new MonCashError(
        `MonCash Auth Error: ${data?.access_token || text}`,
        response.status,
      );
    }

    this.accessToken = data!.access_token;
    // Expire un peu avant le TTL réel (59s → 50s) pour éviter les fenêtres 401.
    this.tokenExpiry = now + (data!.expires_in - 9) * 1000;
    return this.accessToken!;
  }

  // CREATE PAYMENT — POST /v1/CreatePayment
  async createPayment(
    amount: number,
    orderId: string,
  ): Promise<CreatePaymentResult> {
    const token = await this.getAccessToken();
    const data = (await this.request("POST", "/v1/CreatePayment", {
      token,
      body: { amount, orderId },
    })) as CreatePaymentResponse;

    if (!data?.payment_token?.token) {
      throw new MonCashError(
        "MonCash CreatePayment : réponse sans payment_token",
        502,
      );
    }

    return {
      token: data.payment_token.token,
      expired: data.payment_token.expired,
      created: data.payment_token.created,
      mode: data.mode || "",
      redirectUrl: `${envConfig().gatewayUrl}/Payment/Redirect?token=${data.payment_token.token}`,
    };
  }

  // CAPTURE BY TRANSACTION ID — POST /v1/RetrieveTransactionPayment
  async retrieveTransactionPayment(
    transactionId: string,
  ): Promise<RetrievePaymentResult> {
    const token = await this.getAccessToken();
    const data = (await this.request("POST", "/v1/RetrieveTransactionPayment", {
      token,
      body: { transactionId },
    })) as RetrieveTransactionResponse;

    if (!data?.payment) {
      throw new MonCashError(
        "MonCash RetrieveTransactionPayment : réponse sans payment",
        502,
      );
    }
    return { payment: data.payment };
  }

  // CAPTURE BY ORDER ID — POST /v1/RetrieveOrderPayment
  async retrieveOrderPayment(orderId: string): Promise<RetrievePaymentResult> {
    const token = await this.getAccessToken();
    const data = (await this.request("POST", "/v1/RetrieveOrderPayment", {
      token,
      body: { orderId },
    })) as RetrieveTransactionResponse;

    if (!data?.payment) {
      throw new MonCashError(
        "MonCash RetrieveOrderPayment : réponse sans payment",
        502,
      );
    }
    return { payment: data.payment };
  }

  // CHECK CUSTOMER STATUS — POST /v1/CustomerStatus
  async getCustomerStatus(
    phoneNumber: string,
    pin?: string,
  ): Promise<CustomerStatusResult> {
    const token = await this.getAccessToken();
    const body: Record<string, string> = { account: phoneNumber };
    if (pin) body.pin = pin;

    const data = (await this.request("POST", "/v1/CustomerStatus", {
      token,
      body,
    })) as CustomerStatusResponse;

    if (!data?.customerStatus) {
      throw new MonCashError(
        "MonCash CustomerStatus : réponse sans customerStatus",
        502,
      );
    }
    return data.customerStatus;
  }

  // PAYOUT — POST /v1/Transfert
  async transfer(
    amount: number,
    receiver: string,
    reference: string,
    desc = "Retrait piYès",
  ): Promise<TransferResult> {
    const token = await this.getAccessToken();
    const data = (await this.request("POST", "/v1/Transfert", {
      token,
      body: { amount, receiver, desc, reference },
    })) as TransferResponse;

    if (!data?.transfer) {
      throw new MonCashError("MonCash Transfert : réponse sans transfer", 502);
    }
    return data.transfer;
  }

  // CHECK PREFUNDED TRANSACTION STATUS — POST /v1/PrefundedTransactionStatus
  async prefundedTransactionStatus(
    reference: string,
  ): Promise<TransferStatusResult> {
    const token = await this.getAccessToken();
    const data = (await this.request("POST", "/v1/PrefundedTransactionStatus", {
      token,
      body: { reference },
    })) as TransferStatusResponse;

    if (!data?.transStatus) {
      throw new MonCashError(
        "MonCash PrefundedTransactionStatus : réponse sans transStatus",
        502,
      );
    }
    return { transStatus: data.transStatus };
  }

  // BALANCE PREFUNDED — GET /v1/PrefundedBalance
  async getPrefundedBalance(): Promise<PrefundedBalanceResult> {
    const token = await this.getAccessToken();
    const data = (await this.request("GET", "/v1/PrefundedBalance", {
      token,
    })) as PrefundedBalanceResponse;

    if (typeof data?.balance?.balance !== "number") {
      throw new MonCashError(
        "MonCash PrefundedBalance : réponse sans balance",
        502,
      );
    }
    return { balance: data.balance.balance, message: data.balance.message };
  }
}

export const moncashService = new MonCashService();
