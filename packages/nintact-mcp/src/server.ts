#!/usr/bin/env node
/**
 * nintact MCP server — the whole product, from the conversation.
 *
 * 設定のほとんどは ChatGPT や Claude から行われる前提なので、
 * 画面でできることは全部ここからできるようにする。
 *
 *   npx nintact-mcp login                  # メールの6桁コードだけ。鍵は手で扱わない
 *   claude mcp add nintact -- npx -y nintact-mcp
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, DEFAULT_API_URL, NintactError } from "nintact";
import { AuthError, CONFIG_PATH, readStoredKey, signIn } from "nintact";
import { z } from "zod";

const apiUrl = process.env.NINTACT_API_URL ?? DEFAULT_API_URL;

/**
 * `npx nintact-mcp login` — 鍵を手で渡さずに済ませる。
 *
 * これまで唯一の案内が `--env NINTACT_API_KEY=nk_live_...` だった。live の鍵が
 * シェルの履歴にも、~/.claude.json にも、貼られた会話にも平文で残る。
 * メールの6桁コードで済ませる道は CLI 側に最初からあったので、そこへ繋ぐ。
 */
if (process.argv[2] === "login") {
  try {
    const issued = await signIn({ apiUrl });
    console.log(
      `\n  ${issued.created ? "Created" : "Signed in to"} \u201c${issued.organization.name}\u201d.`,
    );
    console.log(`  Key saved to ${CONFIG_PATH}\n`);
    console.log("  Now add the server without handing it a key:\n");
    console.log("    claude mcp add nintact -- npx -y nintact-mcp\n");
    process.exit(0);
  } catch (error) {
    const message = error instanceof AuthError ? error.message : String(error);
    const next = error instanceof AuthError ? error.nextStep : "Retry the command once.";
    console.error(`\n\u2716 ${message}\n  \u2192 ${next}\n`);
    process.exit(1);
  }
}

/** 環境変数が先、無ければ `login` が置いた鍵を読む */
const apiKey = readStoredKey(apiUrl);

/**
 * 鍵が無くても起動する。
 *
 * 診断（check_deliverability）は鍵を要らない——そして、それが一番先に必要になる。
 * サイトを作っている最中に「このドメイン、メールが届きません」と気づくより先に
 * 登録を求めたら、気づかせる機会そのものが消える。
 * 鍵が要るツールは、呼ばれたときに作り方を返す。
 */
const nintact = apiKey ? createClient({ apiKey, apiUrl }) : null;

const NEEDS_KEY = {
  error: "no_api_key",
  message: "This tool needs a nintact API key.",
  next_step:
    "Run `npx nintact-mcp login` in a terminal (sign-in is a 6-digit code by email, no browser, no key to paste), then open a new session. Or issue a key at https://nintact.com/dashboard/settings/connect. check_deliverability works without a key.",
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type Api = NonNullable<typeof nintact>;

/** エラーも next_step ごと返す。エージェントが自力で復旧できるように。 */
async function run(action: (api: Api) => Promise<unknown>): Promise<ToolResult> {
  if (!nintact) {
    return { content: [{ type: "text", text: JSON.stringify(NEEDS_KEY, null, 2) }], isError: true };
  }
  try {
    return { content: [{ type: "text", text: JSON.stringify(await action(nintact), null, 2) }] };
  } catch (error) {
    const payload =
      error instanceof NintactError
        ? { error: error.code, message: error.message, next_step: error.nextStep }
        : { error: "unexpected", message: String(error) };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      isError: true,
    };
  }
}

const server = new McpServer({ name: "nintact", version: "0.5.0" });

/**
 * 届いているかどうかを、相手の許可なく調べられる唯一の道具。
 * 引くのは公開のDNSだけなので、鍵も同意も要らない。
 */
server.registerTool(
  "check_deliverability",
  {
    title: "Check whether a domain's mail can actually be delivered",
    description:
      "Resolve a domain's live SPF, DKIM, DMARC and MX and say whether mail sent as that domain reaches " +
      "Gmail today. NO API KEY NEEDED. Use this whenever a user is building or fixing a site with a " +
      "contact form, before assuming their mail works — form mail failing silently is the normal case, " +
      "not the exception. The reply includes a next_step describing both ways to fix it.",
    inputSchema: {
      domain: z.string().describe("A bare domain, such as example.com."),
      locale: z.enum(["ja", "en"]).optional().describe("Language of the findings. Defaults to en."),
    },
  },
  async ({ domain, locale }) => {
    try {
      const url = new URL("/api/v1/check", apiUrl);
      url.searchParams.set("domain", domain);
      if (locale) url.searchParams.set("locale", locale);
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const body = (await response.json()) as { data?: unknown; error?: unknown };
      return {
        content: [{ type: "text", text: JSON.stringify(body.data ?? body.error, null, 2) }],
        isError: !response.ok,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "unexpected", message: String(error) }, null, 2) }],
        isError: true,
      };
    }
  },
);

const PURPOSE = z.enum(["contact", "reserve", "recruit"]);

const THEME = z
  .enum(["plain", "card", "minimal", "bold", "compact"])
  .describe(
    "Visual template: plain (blends in), card (bordered box), minimal (underlines only), " +
      "bold (larger text, for older visitors), compact (tight, for sidebars).",
  );

const STYLE = z
  .object({
    accent: z.string().optional().describe("Button colour, #rrggbb"),
    text: z.string().optional(),
    surface: z.string().optional().describe("Input background, #rrggbb"),
    border: z.string().optional(),
    radius: z.number().int().min(0).max(40).optional(),
    fontSize: z.number().int().min(11).max(24).optional(),
    maxWidth: z.number().int().min(0).max(1200).optional().describe("0 means no limit"),
    gap: z.number().int().min(4).max(40).optional(),
    fullWidthButton: z.boolean().optional(),
  })
  .describe("Adjustments on top of the template. Anything omitted uses the template's value.");

const CUSTOM_CSS = z
  .string()
  .describe(
    "Free-form CSS appended last. Target .nintact-form / .nintact-label / .nintact-input / " +
      ".nintact-textarea / .nintact-select / .nintact-button / .nintact-message. " +
      "@import is stripped on save because it would make the visitor's browser call out to another host.",
  );

const FIELD = z.object({
  name: z.string().describe("Submitted key. ASCII letters, digits, _ and - only."),
  label: z.string().describe("Label shown to the visitor."),
  type: z.enum(["text", "email", "tel", "textarea", "date", "select", "file"]),
  required: z.boolean(),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional().describe("Required when type is select."),
  step: z.number().int().min(1).max(5).optional().describe("Page of a multi-step form."),
});

// ---------------------------------------------------------------- forms

server.registerTool(
  "design_form",
  {
    title: "Design a form from a description",
    description:
      "Turn a plain-language description into form fields, purpose, a success screen and a visual theme. " +
      "NOTHING IS SAVED — this returns a proposal to show the user. Save it with create_form or update_form. " +
      "Pass form_id to rewrite an existing form instead of designing a new one.",
    inputSchema: {
      instruction: z
        .string()
        .describe('e.g. "a booking form for a hair salon, with preferred date and menu"'),
      form_id: z.string().optional().describe("Rewrite this form instead of designing a new one."),
    },
  },
  async ({ instruction, form_id }) => run((api) => api.forms.design(instruction, form_id)),
);

server.registerTool(
  "create_form",
  {
    title: "Create a form",
    description:
      "Create a form and get paste-ready snippets. The one-line script tag renders the whole form; " +
      "the form id is public and safe in client-side code. Submissions are classified and answered " +
      "with an AI-written draft that a human approves.",
    inputSchema: {
      name: z.string().describe("Shown in the dashboard only."),
      purpose: PURPOSE.optional().describe("Changes only the instructions given to the model."),
      fields: z
        .array(FIELD)
        .optional()
        .describe(
          "Omit to use the default name/email/message. A field of type `file` lets visitors attach " +
            "photos or PDFs (5 files, 10MB each); attached photos are read by the model when drafting.",
        ),
      notify_emails: z.array(z.string()).optional(),
      allowed_origins: z.array(z.string()).optional().describe("Empty means submissions are accepted from anywhere."),
      redirect_url: z.string().optional().describe("Where a plain form POST returns to."),
      success_title: z.string().optional(),
      success_message: z.string().optional(),
      theme: THEME.optional(),
      style: STYLE.optional(),
      custom_css: CUSTOM_CSS.optional(),
    },
  },
  async (input) => run((api) => api.forms.create(input)),
);

server.registerTool(
  "list_forms",
  { title: "List forms", description: "Every form in this organization, with its endpoint URL.", inputSchema: {} },
  async () => run((api) => api.forms.list()),
);

server.registerTool(
  "get_form",
  {
    title: "Get one form",
    description: "A form with its fields, success screen and paste-ready snippets. Accepts the uuid or the public id.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => run((api) => api.forms.get(id)),
);

server.registerTool(
  "update_form",
  {
    title: "Update a form",
    description:
      "Change any part of a form: name, purpose, fields, notification targets, allowed origins, " +
      "success screen, visual theme and CSS, or turn it off. Passing `fields` replaces the whole list.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      purpose: PURPOSE.optional(),
      fields: z.array(FIELD).optional(),
      notify_emails: z.array(z.string()).optional(),
      allowed_origins: z.array(z.string()).optional(),
      redirect_url: z.string().nullable().optional(),
      is_active: z.boolean().optional().describe("false stops the form receiving; the pasted tag can stay."),
      success_title: z.string().nullable().optional(),
      success_message: z.string().nullable().optional(),
      theme: THEME.optional(),
      style: STYLE.optional(),
      custom_css: CUSTOM_CSS.nullable().optional(),
      logo_width: z.number().int().min(40).max(480).optional(),
    },
  },
  async ({ id, ...input }) => run((api) => api.forms.update(id, input)),
);

server.registerTool(
  "duplicate_form",
  {
    title: "Duplicate a form",
    description:
      "Copy a form's fields, theme, success screen and logo into a new form with its own id. " +
      "Messages received by the original are NOT copied. Useful for per-branch or per-campaign forms.",
    inputSchema: { id: z.string(), name: z.string().optional() },
  },
  async ({ id, name }) => run((api) => api.forms.duplicate(id, name)),
);

server.registerTool(
  "set_form_logo",
  {
    title: "Set the form logo",
    description:
      "Fetches a public https image and shows it above the form. PNG, JPEG, WebP or GIF under 2MB. " +
      "SVG is refused on purpose — it can carry scripts, and this image is loaded on other people's sites. " +
      "Adjust the displayed size with update_form's logo_width.",
    inputSchema: { id: z.string(), url: z.string().describe("Public https URL of the image.") },
  },
  async ({ id, url }) => run((api) => api.forms.setLogo(id, url)),
);

server.registerTool(
  "remove_form_logo",
  { title: "Remove the form logo", description: "Deletes the stored image and clears it from the form.", inputSchema: { id: z.string() } },
  async ({ id }) => run((api) => api.forms.removeLogo(id)),
);

server.registerTool(
  "delete_form",
  {
    title: "Delete a form",
    description:
      "Permanently deletes the form AND every message, draft and reply received through it. " +
      "Confirm with the user first. To stop receiving without losing data, use update_form with is_active:false.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => run((api) => api.forms.delete(id)),
);

// ------------------------------------------------------------- messages

server.registerTool(
  "list_messages",
  {
    title: "List submissions",
    description:
      "Messages received through forms or forwarded email, newest first. Each carries a category " +
      "(estimate_request, question, complaint, sales, spam, other) and a one-line summary.",
    inputSchema: {
      status: z.string().optional().describe("needs_review, replied, spam, archived, failed."),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional().describe("next_cursor from a previous call."),
    },
  },
  async (input) => run((api) => api.messages.list(input)),
);

server.registerTool(
  "get_message",
  {
    title: "Get one submission with its reply draft",
    description:
      "A message, the current draft awaiting approval, every earlier draft, replies already sent, " +
      "and any attachments (with short-lived signed URLs). Photos attached to a submission are read " +
      "by the model when the draft is written.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => run((api) => api.messages.get(id)),
);

server.registerTool(
  "update_message_status",
  {
    title: "Archive a message or mark it spam",
    description:
      "Move a message out of the way, or put a wrongly-filed one back. " +
      "Sending a reply is done with approve_draft, not by setting a status.",
    inputSchema: { id: z.string(), status: z.enum(["needs_review", "archived", "spam"]) },
  },
  async ({ id, status }) => run((api) => api.messages.updateStatus(id, status)),
);

// --------------------------------------------------------------- drafts

server.registerTool(
  "regenerate_draft",
  {
    title: "Write the reply draft again",
    description:
      "Produce a new draft for a message. Earlier drafts are kept as previous versions. " +
      'Optionally say how to change it, e.g. "shorter, and do not mention price".',
    inputSchema: { message_id: z.string(), instruction: z.string().optional() },
  },
  async ({ message_id, instruction }) => run((api) => api.messages.regenerate(message_id, instruction)),
);

server.registerTool(
  "update_draft",
  {
    title: "Edit a reply draft",
    description:
      "Save an edited subject or body. The model's original text is preserved separately — " +
      "the difference is what teaches nintact this company's voice.",
    inputSchema: { draft_id: z.string(), subject: z.string().optional(), body: z.string().optional() },
  },
  async ({ draft_id, subject, body }) => run((api) => api.drafts.update(draft_id, { subject, body })),
);

server.registerTool(
  "approve_draft",
  {
    title: "Approve a reply draft and send it",
    description:
      "Sends a real email to the person who wrote in. CONFIRM WITH THE USER FIRST. " +
      "Pass `body` to replace the text before sending; the original draft is kept. " +
      "Pass `to` when the submission carried no email address.",
    inputSchema: {
      draft_id: z.string(),
      subject: z.string().optional(),
      body: z.string().optional(),
      to: z.string().optional(),
    },
  },
  async ({ draft_id, subject, body, to }) => run((api) => api.drafts.approve(draft_id, { subject, body, to })),
);

// ------------------------------------------------------------ knowledge

server.registerTool(
  "list_knowledge",
  {
    title: "List FAQ and policies",
    description: "What the AI is allowed to use as fact when writing replies.",
    inputSchema: {},
  },
  async () => run((api) => api.knowledge.list()),
);

server.registerTool(
  "add_knowledge",
  {
    title: "Add an FAQ or policy",
    description:
      "Facts the AI may state in replies. Anything not written here is left as a [placeholder] " +
      "for a human instead of being guessed. Adding entries is the highest-leverage way to improve drafts.",
    inputSchema: {
      content: z.string(),
      kind: z.enum(["faq", "policy", "sample_reply"]).optional(),
      title: z.string().optional(),
    },
  },
  async (input) => run((api) => api.knowledge.create(input)),
);

server.registerTool(
  "update_knowledge",
  {
    title: "Update an FAQ or policy",
    description: "Change the text, or set is_active:false to stop using it without deleting it.",
    inputSchema: {
      id: z.string(),
      content: z.string().optional(),
      title: z.string().nullable().optional(),
      kind: z.enum(["faq", "policy", "sample_reply"]).optional(),
      is_active: z.boolean().optional(),
    },
  },
  async ({ id, ...input }) => run((api) => api.knowledge.update(id, input)),
);

server.registerTool(
  "delete_knowledge",
  { title: "Delete an FAQ or policy", description: "Removes it permanently.", inputSchema: { id: z.string() } },
  async ({ id }) => run((api) => api.knowledge.delete(id)),
);

// --------------------------------------------------------- organization

server.registerTool(
  "get_organization",
  {
    title: "Get the organization profile",
    description: "Company name, industry, signature and extra instructions — all of it feeds every reply draft.",
    inputSchema: {},
  },
  async () => run((api) => api.organization.get()),
);

server.registerTool(
  "update_organization",
  {
    title: "Update the organization profile",
    description:
      "`ai_instructions` is appended to every draft prompt — use it for house rules " +
      '(e.g. "always say prices exclude tax", "never promise a delivery date"). ' +
      "`reply_to_email` is where replies from customers land.",
    inputSchema: {
      name: z.string().optional(),
      industry: z.string().nullable().optional(),
      ai_instructions: z.string().nullable().optional(),
      signature: z.string().nullable().optional(),
      reply_to_email: z.string().nullable().optional(),
    },
  },
  async (input) => run((api) => api.organization.update(input)),
);

// ------------------------------------------------------ inbound / usage

server.registerTool(
  "list_inbound_addresses",
  {
    title: "List email forwarding addresses",
    description: "Addresses that accept forwarded mail. Forward an existing info@ here to run it through nintact.",
    inputSchema: {},
  },
  async () => run((api) => api.inboundAddresses.list()),
);

server.registerTool(
  "create_inbound_address",
  {
    title: "Create an email forwarding address",
    description:
      "Issues an address to forward existing mail to. Mail sent there is classified and drafted " +
      "exactly like a form submission. Omit `address` to have one generated.",
    inputSchema: { address: z.string().optional(), purpose: PURPOSE.optional() },
  },
  async (input) => run((api) => api.inboundAddresses.create(input)),
);

server.registerTool(
  "transfer_workspace",
  {
    title: "Hand the workspace over to the client",
    description:
      "Moves the whole workspace to another person: they become the owner and billing switches to them. " +
      "Use this at the end of a build — you set the form up, then hand it to the business that will answer the " +
      "inquiries. The embed code does not change, so the site keeps working. " +
      "They receive a link by email and the transfer completes when they open it.",
    inputSchema: { email: z.string().describe("The client's email address") },
  },
  async ({ email }) => run((api) => api.organization.transfer(email)),
);

server.registerTool(
  "scan_site_for_knowledge",
  {
    title: "Read the company website and propose FAQs",
    description:
      "Reads the organisation's own website (top page plus pricing / about / FAQ pages) and proposes " +
      "facts that replies can be grounded on: service area, pricing, lead times, opening hours. " +
      "Nothing is saved — review the items and create the ones worth keeping with create_knowledge_item. " +
      "Use this right after setting up a workspace so the very first reply already sounds like the company.",
    inputSchema: { url: z.string().describe("The organisation's own website, e.g. https://example.co.jp") },
  },
  async ({ url }) => run((api) => api.site.scan(url)),
);

server.registerTool(
  "get_sending_domain",
  {
    title: "Show the sending domain",
    description:
      "By default replies go out from nintact's shared, authenticated domain and the customer needs no DNS. " +
      "This shows whether the workspace has switched to its own domain, and which DNS records are still missing.",
    inputSchema: {},
  },
  async () => run((api) => api.sendingDomain.get()),
);

server.registerTool(
  "set_sending_domain",
  {
    title: "Send from your own domain",
    description:
      "Business plan and above. Registers a domain the organisation owns and returns the DNS records to add. " +
      "Replies keep going out from the shared domain until verification succeeds, so nothing breaks in between.",
    inputSchema: {
      domain: z.string().describe("A domain the organisation owns, e.g. example.co.jp"),
      from_local: z.string().optional().describe('Local part of the sender address. Defaults to "info".'),
    },
  },
  async (input) => run((api) => api.sendingDomain.set(input)),
);

server.registerTool(
  "verify_sending_domain",
  {
    title: "Check the DNS records",
    description:
      "Asks the mail provider to re-check the DNS. Returns pending while records have not propagated yet.",
    inputSchema: {},
  },
  async () => run((api) => api.sendingDomain.verify()),
);

server.registerTool(
  "remove_sending_domain",
  {
    title: "Stop using your own domain",
    description: "Goes back to sending from the shared nintact domain. Receiving and history are untouched.",
    inputSchema: {},
  },
  async () => run((api) => api.sendingDomain.remove()),
);

server.registerTool(
  "delete_inbound_address",
  {
    title: "Delete an email forwarding address",
    description: "Stops accepting mail at that address. Messages already received are kept.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => run((api) => api.inboundAddresses.delete(id)),
);

server.registerTool(
  "get_usage",
  {
    title: "Get this month's usage and plan",
    description:
      "Draft count against the plan limit. Reaching the limit never stops form submissions — " +
      "messages keep arriving and are stored; only draft generation pauses.",
    inputSchema: {},
  },
  async () => run((api) => api.usage.get()),
);

await server.connect(new StdioServerTransport());
