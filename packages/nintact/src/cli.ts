#!/usr/bin/env node
/**
 * nintact CLI — get from "nothing" to "a working contact form" without opening a browser.
 *
 * The only interactive step is pasting a 6-digit code from email, and it only
 * happens the first time on a machine. After that `init` runs unattended.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import { createClient, DEFAULT_API_URL, NintactError, type Snippet } from "./index";
import { AuthError, CONFIG_PATH, readStoredKey, signIn } from "./credentials";

type Flags = Record<string, string | boolean>;

function parseFlags(argv: string[]): { command: string; flags: Flags } {
  const [command = "help", ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function apiUrlFrom(flags: Flags): string {
  return String(flags["api-url"] ?? process.env.NINTACT_API_URL ?? DEFAULT_API_URL);
}



/** .env.local を壊さずに追記・更新する */
function upsertEnv(file: string, values: Record<string, string>): void {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(file, `${lines.filter((line, i) => line !== "" || i < lines.length - 1).join("\n")}\n`);
}

function detectFramework(): "next" | "react" | "wordpress" | "html" {
  if (existsSync("wp-config.php") || existsSync("wp-content")) return "wordpress";
  if (existsSync("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync("package.json", "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return "next";
      if (deps.react) return "react";
    } catch {
      // package.json が壊れていても致命的ではない
    }
  }
  return "html";
}

const SNIPPET_FOR: Record<string, string> = {
  next: "next-server-action",
  react: "react",
  wordpress: "wordpress",
  html: "html",
};


function die(message: string, nextStep: string): never {
  console.error(`\n✖ ${message}\n  → ${nextStep}\n`);
  process.exit(1);
}


/** 認証は credentials.ts に寄せた。MCP 側と同じ道を通す */
async function authenticate(apiUrl: string, flags: Flags): Promise<string> {
  try {
    const issued = await signIn({
      apiUrl,
      email: flags.email ? String(flags.email) : undefined,
      code: flags.code ? String(flags.code) : undefined,
    });
    console.log(
      `  ${issued.created ? "Created" : "Signed in to"} \u201c${issued.organization.name}\u201d. Key saved to ${CONFIG_PATH}\n`,
    );
    return issued.apiKey;
  } catch (error) {
    if (error instanceof AuthError) die(error.message, error.nextStep);
    throw error;
  }
}

function printSnippet(snippet: Snippet, endpoint: string): void {
  console.log(`\n  Endpoint: ${endpoint}`);
  console.log(`\n  ${snippet.label}:\n`);
  console.log(
    snippet.code
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
  );
  console.log("");
}

async function init(flags: Flags): Promise<void> {
  const apiUrl = apiUrlFrom(flags);
  const asJson = Boolean(flags.json);

  const apiKey = readStoredKey(apiUrl) ?? (await authenticate(apiUrl, flags));
  const client = createClient({ apiKey, apiUrl });

  const name = String(flags.name ?? "Contact form");
  let created: { form: { public_id: string; endpoint: string }; snippets: Snippet[] };
  try {
    created = await client.forms.create({ name });
  } catch (error) {
    if (error instanceof NintactError) die(error.message, error.nextStep ?? "Retry the command once.");
    throw error;
  }

  const framework = detectFramework();
  const snippet =
    created.snippets.find((item) => item.id === SNIPPET_FOR[framework]) ?? created.snippets[0];

  if (existsSync("package.json")) {
    upsertEnv(".env.local", {
      NINTACT_API_KEY: apiKey,
      NEXT_PUBLIC_NINTACT_FORM_ID: created.form.public_id,
    });
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          form_id: created.form.public_id,
          endpoint: created.form.endpoint,
          framework,
          snippets: created.snippets,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`✔ Form created: ${created.form.public_id}`);
  if (existsSync("package.json")) console.log("  Wrote NINTACT_API_KEY and NEXT_PUBLIC_NINTACT_FORM_ID to .env.local");
  printSnippet(snippet, created.form.endpoint);
  console.log("  Submissions are classified and a reply draft is written automatically.");
  console.log("  Read them with: npx nintact messages\n");
}

async function messages(flags: Flags): Promise<void> {
  const apiUrl = apiUrlFrom(flags);
  const apiKey = readStoredKey(apiUrl);
  if (!apiKey) {
    die("No API key found.", "Run `npx nintact init` first, or set NINTACT_API_KEY.");
  }

  const { messages: list } = await createClient({ apiKey, apiUrl }).messages.list({ limit: 20 });

  if (flags.json) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  if (list.length === 0) {
    console.log("\n  No messages yet.\n");
    return;
  }
  console.log("");
  for (const message of list) {
    console.log(
      `  ${(message.category ?? "—").padEnd(17)} ${(message.sender_name ?? "—").padEnd(14)} ${
        message.summary ?? message.subject ?? ""
      }`,
    );
  }
  console.log("");
}

function help(): void {
  console.log(`
  nintact — AI first-responder for your contact form

  Usage
    npx nintact init [--name "Contact form"] [--email you@example.com] [--json]
    npx nintact messages [--json]

  Options
    --api-url   API origin (default ${DEFAULT_API_URL})
    --json      Machine-readable output

  Environment
    NINTACT_API_KEY   Skips the interactive sign-in entirely
`);
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv.slice(2));

  switch (command) {
    case "init":
      return init(flags);
    case "messages":
      return messages(flags);
    default:
      return help();
  }
}

main().catch((error: unknown) => {
  if (error instanceof NintactError) die(error.message, error.nextStep ?? "Retry the command once.");
  console.error(error);
  process.exit(1);
});
