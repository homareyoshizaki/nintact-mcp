/**
 * 鍵の置き場と、鍵の作り方。
 *
 * ここを切り出したのは、MCP サーバーにも同じものが要るため。
 * これまで MCP を足す案内は、こう書くしかなかった。
 *
 *   claude mcp add nintact --env NINTACT_API_KEY=nk_live_... -- npx -y nintact-mcp
 *
 * live の鍵が、シェルの履歴にも、設定ファイルにも、貼られた会話にも残る。
 * CLI 側には最初からメールの6桁コードで済ませる道があったのに、
 * MCP だけが鍵を手渡しさせていた。
 */
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { DEFAULT_API_URL } from "./index";

export const CONFIG_PATH = join(homedir(), ".nintact", "config.json");

type Stored = Record<string, { apiKey: string }>;

function readConfig(): Stored {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Stored;
  } catch {
    return {};
  }
}

/** 環境変数が先。CI ではそれしか無いため */
export function readStoredKey(apiUrl: string = DEFAULT_API_URL): string | null {
  if (process.env.NINTACT_API_KEY) return process.env.NINTACT_API_KEY;
  return readConfig()[apiUrl]?.apiKey ?? null;
}

/** 本人だけが読める場所に置く（0700 / 0600） */
export function storeKey(apiUrl: string, apiKey: string): void {
  const config = readConfig();
  config[apiUrl] = { apiKey };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function forgetKey(apiUrl: string = DEFAULT_API_URL): boolean {
  const config = readConfig();
  if (!config[apiUrl]) return false;
  delete config[apiUrl];
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return true;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly nextStep: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function post<T>(apiUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string; next_step?: string } }
    | null;

  if (!response.ok || json?.error) {
    throw new AuthError(
      json?.error?.message ?? `Request failed with status ${response.status}`,
      json?.error?.next_step ?? "Retry the command once.",
    );
  }
  return json?.data as T;
}

export type SignInResult = { apiKey: string; organization: { name: string }; created: boolean };

/**
 * メールに届く6桁コードだけで終える。ブラウザは開かない。
 * 鍵は返すと同時に保存するので、呼び出し側が扱う必要はない。
 */
export async function signIn(options: {
  apiUrl?: string;
  email?: string;
  code?: string;
} = {}): Promise<SignInResult> {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;

  if (!stdin.isTTY && !(options.email && options.code)) {
    throw new AuthError(
      "This shell is not interactive.",
      "Run this in a terminal, or set NINTACT_API_KEY instead.",
    );
  }

  const email = options.email ?? (await ask("Email address: "));
  if (!email) {
    throw new AuthError("An email address is required.", "Run the command again and enter your email.");
  }

  const started = await post<{ device_code: string; email: string }>(apiUrl, "/auth/device", { email });
  if (!options.code) console.log(`\n  A 6-digit code was sent to ${started.email}.`);

  const code = options.code ?? (await ask("  Code: "));
  const issued = await post<{ api_key: string; organization: { name: string }; created: boolean }>(
    apiUrl,
    "/auth/device/token",
    { device_code: started.device_code, user_code: code },
  );

  storeKey(apiUrl, issued.api_key);
  return { apiKey: issued.api_key, organization: issued.organization, created: issued.created };
}
