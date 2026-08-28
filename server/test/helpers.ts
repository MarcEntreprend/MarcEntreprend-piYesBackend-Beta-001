// server/test/helpers.ts
//
// Helpers d'intégration pour la suite de tests.
// - Démarre le serveur réel (npx tsx server.ts) en sous-processus sur un port dédié.
// - Capture la sortie console pour extraire les codes OTP (mode dev).
// - Fournit un client HTTP avec cookie jar (refresh token) et helpers dédiés.

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

export interface OtpEntry {
  target: string | null;
  code: string;
}

export interface TestServer {
  proc: ChildProcess;
  port: number;
  baseUrl: string;
  waitForOtp(target?: string, timeoutMs?: number): Promise<string>;
  stop(): Promise<void>;
}

interface StartServerOptions {
  port: number;
  env?: Record<string, string>;
}

export async function startServer(
  opts: StartServerOptions,
): Promise<TestServer> {
  const { port, env } = opts;

  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    ...(env || {}),
  };

  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";

  console.log("[DEBUG] PROJECT_ROOT:", PROJECT_ROOT);
  console.log("[DEBUG] cmd:", cmd);
  console.log("[DEBUG] cwd:", PROJECT_ROOT);

  const proc = spawn(cmd, ["tsx", "server.ts"], {
    cwd: PROJECT_ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
  });

  const otps: OtpEntry[] = [];
  let ready = false;
  let bootError: string | null = null;
  let pendingTarget: string | null = null;

  const state = {
    text: "",
    otps,
    ready: false,
  };

  const handleChunk = (chunk: Buffer) => {
    state.text += chunk.toString();
    const lines = state.text.split("\n");
    state.text = lines.pop() || "";
    for (const line of lines) {
      if (line.includes(">>> [READY] Port")) state.ready = true;
      if (/\[FATAL\]/.test(line)) bootError = line;
      const t = line.match(/TARGET:\s*(\S+)/);
      if (t) pendingTarget = t[1];
      const c = line.match(/CODE:\s*(\d{6})/);
      if (c) state.otps.push({ target: pendingTarget, code: c[1] });
    }
  };

  proc.stdout?.on("data", handleChunk);
  proc.stderr?.on("data", handleChunk);

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for server on port ${port}. Output so far:\n${state.text}`,
        ),
      );
    }, 60_000);

    const poll = setInterval(() => {
      if (state.ready) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      } else if (bootError) {
        clearTimeout(timeout);
        clearInterval(poll);
        reject(new Error(`Server failed to boot: ${bootError}`));
      }
    }, 200);
  });

  proc.on("exit", (code) => {
    state.ready = false;
    void code;
  });

  await readyPromise;

  const waitForOtp = async (
    target?: string,
    timeoutMs = 20_000,
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const idx = state.otps.findIndex(
        (o) => target === undefined || o.target === target,
      );
      if (idx >= 0) {
        const [entry] = state.otps.splice(idx, 1);
        return entry.code;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `No OTP received${target ? ` for target ${target}` : ""} within ${timeoutMs}ms. Logs:\n${state.text}`,
    );
  };

  const stop = async (): Promise<void> => {
    if (proc.killed) return;
    if (process.platform === "win32") {
      const { spawn: sp } = await import("child_process");
      await new Promise<void>((resolve) => {
        const killer = sp("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
          stdio: "ignore",
        });
        killer.on("exit", () => resolve());
      });
    } else {
      try {
        process.kill(-(proc.pid as number), "SIGTERM");
      } catch {
        proc.kill("SIGTERM");
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            process.kill(-(proc.pid as number), "SIGKILL");
          } catch {
            /* already dead */
          }
          resolve();
        }, 4000);
        proc.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };

  return {
    proc,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    waitForOtp,
    stop,
  };
}

export interface ApiClient {
  baseUrl: string;
  getCookie(name: string): string | undefined;
  req(
    method: string,
    p: string,
    opts?: {
      body?: unknown;
      token?: string;
      apiKey?: string;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; json: any; headers: Headers }>;
  reqRaw(
    method: string,
    p: string,
    opts?: {
      body?: unknown;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; json: any; headers: Headers }>;
}

export function makeClient(baseUrl: string): ApiClient {
  const cookies: Record<string, string> = {};

  const parseSetCookies = (headers: Headers) => {
    const setCookies =
      typeof (headers as any).getSetCookie === "function"
        ? ((headers as any).getSetCookie() as string[])
        : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const idx = pair.indexOf("=");
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (v === "" || sc.toLowerCase().includes("expires=thu, 01 jan 1970")) {
          delete cookies[k];
        } else {
          cookies[k] = v;
        }
      }
    }
  };

  const doReq = async (
    method: string,
    p: string,
    opts?: {
      body?: unknown;
      token?: string;
      apiKey?: string;
      headers?: Record<string, string>;
      includeCookies?: boolean;
    },
  ) => {
    const headers: Record<string, string> = { ...(opts?.headers || {}) };
    if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`;
    if (opts?.apiKey) headers["X-API-Key"] = opts.apiKey;
    if (opts?.includeCookies !== false && Object.keys(cookies).length > 0) {
      headers["Cookie"] = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    const res = await fetch(baseUrl + p, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    parseSetCookies(res.headers);
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, headers: res.headers };
  };

  return {
    baseUrl,
    getCookie: (name) => cookies[name],
    req: (method, p, opts) => doReq(method, p, opts),
    reqRaw: (method, p, opts) =>
      doReq(method, p, { ...opts, includeCookies: false }),
  };
}

export function uniqueEmail(prefix = "test"): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1_000_000);
  return `${prefix}.${ts}.${rand}@piyes.app`;
}

export function uniquePhone(): string {
  const ts = Date.now().toString().slice(-8);
  return `+509${ts}`;
}

export async function signup(
  client: ApiClient,
  opts?: { email?: string; phone?: string; name?: string },
) {
  // Génère une chaîne unique basée sur l'email (ou sur un timestamp)
  const uniquePart = opts?.email
    ? opts.email.split("@")[0] // ex: auth.123456.789012
    : uniqueEmail("tst").split("@")[0];

  const body = {
    firstName: "Test",
    lastName: uniquePart, // ex: auth.123456.789012
    name: opts?.name || `Test Suite ${uniquePart}`, // ex: Test Suite auth.123456.789012
    email: opts?.email || uniqueEmail("tst"),
    phone: opts?.phone || uniquePhone(),
    password: "Test1234!",
    device: "testsuite",
  };

  const r = await client.req("POST", "/api/v1/auth/signup", { body });
  if (r.status !== 201) {
    throw new Error(`signup failed (${r.status}): ${JSON.stringify(r.json)}`);
  }
  return r.json as { user: any; token: string };
}
