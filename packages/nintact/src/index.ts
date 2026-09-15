/**
 * nintact — AI first-responder for your contact form.
 *
 * Submitting a form needs no API key: the form endpoint is public by design,
 * so it can be called straight from the browser.
 */

export const DEFAULT_API_URL = "https://nintact.com";

export type SubmitOptions = {
  /** Override the API origin (self-hosted or local development). */
  apiUrl?: string;
  signal?: AbortSignal;
};

export type SubmitResult = { id: string | null };

export class NintactError extends Error {
  readonly code: string;
  readonly status: number;
  /** What to do about it. Present on every error the API returns. */
  readonly nextStep?: string;

  constructor(params: { code: string; message: string; status: number; nextStep?: string }) {
    super(params.message);
    this.name = "NintactError";
    this.code = params.code;
    this.status = params.status;
    this.nextStep = params.nextStep;
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string; next_step?: string } }
    | null;

  if (!response.ok || json?.error) {
    throw new NintactError({
      code: json?.error?.code ?? "http_error",
      message: json?.error?.message ?? `Request failed with status ${response.status}`,
      status: response.status,
      nextStep: json?.error?.next_step,
    });
  }
  return json?.data as T;
}

/** Send one submission to a form. No API key required. */
export async function submit(
  formId: string,
  fields: Record<string, unknown>,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
  const response = await fetch(`${apiUrl}/api/f/${encodeURIComponent(formId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(fields),
    signal: options.signal,
  });
  return unwrap<SubmitResult>(response);
}

export type ClientOptions = { apiKey: string; apiUrl?: string };

export type Form = {
  id: string;
  public_id: string;
  name: string;
  purpose: "contact" | "reserve" | "recruit";
  endpoint: string;
  is_active: boolean;
  created_at: string;
};

export type Snippet = { id: string; label: string; language: string; code: string };

export type FormField = {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "date" | "select" | "file";
  required: boolean;
  placeholder?: string;
  options?: string[];
  /** Which page of a multi-step form this field belongs to (1-based). */
  step?: number;
};

export type FormStyle = {
  accent?: string;
  text?: string;
  surface?: string;
  border?: string;
  radius?: number;
  fontSize?: number;
  maxWidth?: number;
  gap?: number;
  fullWidthButton?: boolean;
};

export type FormDesign = {
  name: string;
  purpose: Form["purpose"];
  fields: FormField[];
  successTitle: string;
  successMessage: string;
  theme: "plain" | "card" | "minimal" | "bold" | "compact";
  style: FormStyle;
  /** Why the AI chose these fields, in plain language. */
  notes: string;
};

export type KnowledgeItem = {
  id: string;
  kind: "faq" | "policy" | "sample_reply";
  title: string | null;
  content: string;
  is_active: boolean;
  created_at: string;
};

export type Organization = {
  id: string;
  name: string;
  industry: string | null;
  ai_instructions: string | null;
  signature: string | null;
  reply_to_email: string | null;
  auto_send_enabled: boolean;
};

export type InboundAddress = {
  id: string;
  address: string;
  purpose: Form["purpose"];
  is_active: boolean;
  created_at: string;
};

export type SendingDomainRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
};

export type SendingDomain = {
  id: string;
  domain: string;
  from_local: string;
  status: "pending" | "verified" | "failed";
  records: SendingDomainRecord[];
  verified_at: string | null;
  last_checked_at: string | null;
};

export type Usage = {
  period: string;
  plan: { id: string; name: string; status: string };
  drafts: { used: number; limit: number; remaining: number };
  messages_received: number;
  replies_sent: number;
  current_period_end: string | null;
};

export type Message = {
  id: string;
  source: "form" | "email";
  subject: string | null;
  body: string | null;
  sender_name: string | null;
  sender_email: string | null;
  category: "estimate_request" | "question" | "complaint" | "sales" | "spam" | "other" | null;
  summary: string | null;
  status: string;
  created_at: string;
};

export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  /** Short-lived signed URL. Expires in url_expires_in seconds. */
  url: string | null;
  url_expires_in: number;
};

export type Draft = {
  id: string;
  version: number;
  subject: string | null;
  body: string;
  subject_edited: string | null;
  body_edited: string | null;
  status: "draft" | "approved" | "discarded";
};

/** Authenticated client for the management API. Server-side only — never ship the key to a browser. */
export function createClient(options: ClientOptions) {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiUrl}/api/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    return unwrap<T>(response);
  }

  return {
    me: () => request<{ organization: { id: string; name: string }; form_count: number }>("/me"),

    forms: {
      list: () => request<{ forms: Form[] }>("/forms"),
      get: (id: string) => request<{ form: Form; snippets: Snippet[] }>(`/forms/${id}`),
      create: (input: {
        name: string;
        purpose?: Form["purpose"];
        notify_emails?: string[];
        allowed_origins?: string[];
        redirect_url?: string;
        fields?: FormField[];
        success_title?: string;
        success_message?: string;
        theme?: "plain" | "card" | "minimal" | "bold" | "compact";
        style?: FormStyle;
        custom_css?: string;
      }) =>
        request<{ form: Form; snippets: Snippet[] }>("/forms", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      update: (
        id: string,
        input: Partial<{
          name: string;
          purpose: Form["purpose"];
          notify_emails: string[];
          allowed_origins: string[];
          redirect_url: string | null;
          is_active: boolean;
          fields: FormField[];
          success_title: string | null;
          success_message: string | null;
          theme: "plain" | "card" | "minimal" | "bold" | "compact";
          style: FormStyle;
          custom_css: string | null;
          logo_width: number;
        }>,
      ) =>
        request<{ form: Form; snippets: Snippet[] }>(`/forms/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      delete: (id: string) => request<{ deleted: true }>(`/forms/${id}`, { method: "DELETE" }),
      /** Copy a form's settings into a new one. Messages are not copied. */
      duplicate: (id: string, name?: string) =>
        request<{ form: Form; snippets: Snippet[]; note: string }>(`/forms/${id}/duplicate`, {
          method: "POST",
          body: JSON.stringify(name ? { name } : {}),
        }),
      /** Set the logo from a public https URL. PNG/JPEG/WebP/GIF, under 2MB. */
      setLogo: (id: string, url: string) =>
        request<{ logo_url: string }>(`/forms/${id}/logo`, {
          method: "POST",
          body: JSON.stringify({ url }),
        }),
      removeLogo: (id: string) =>
        request<{ deleted: true }>(`/forms/${id}/logo`, { method: "DELETE" }),
      /** Describe the form in plain language. Returns a proposal — nothing is saved. */
      design: (instruction: string, formId?: string) =>
        request<{ design: FormDesign; saved: false; next_step: string }>("/forms/design", {
          method: "POST",
          body: JSON.stringify({ instruction, form_id: formId }),
        }),
    },

    messages: {
      list: (query: { status?: string; category?: string; limit?: number; cursor?: string } = {}) => {
        const params = new URLSearchParams(
          Object.entries(query)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        );
        const suffix = params.toString() ? `?${params}` : "";
        return request<{ messages: Message[]; next_cursor: string | null }>(`/messages${suffix}`);
      },
      get: (id: string) =>
        request<{
          message: Message;
          draft: Draft | null;
          drafts: Draft[];
          attachments: Attachment[];
        }>(`/messages/${id}`),
      updateStatus: (id: string, status: "needs_review" | "archived" | "spam") =>
        request<{ message: { id: string; status: string } }>(`/messages/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      /** Write a new draft. Earlier drafts are kept as previous versions. */
      regenerate: (id: string, instruction?: string) =>
        request<{ draft: { id: string; version: number } | null; category: string }>(
          `/messages/${id}/drafts`,
          { method: "POST", body: JSON.stringify(instruction ? { instruction } : {}) },
        ),
    },

    drafts: {
      update: (id: string, input: { subject?: string; body?: string }) =>
        request<{ draft: Draft }>(`/drafts/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      /** Sends a real email to the person who wrote in. */
      approve: (id: string, input: { subject?: string; body?: string; to?: string } = {}) =>
        request<{ reply: { id: string; to: string; subject: string; status: string } }>(
          `/drafts/${id}/approve`,
          { method: "POST", body: JSON.stringify(input) },
        ),
    },

    knowledge: {
      list: () => request<{ knowledge_items: KnowledgeItem[] }>("/knowledge"),
      create: (input: { content: string; kind?: KnowledgeItem["kind"]; title?: string }) =>
        request<{ knowledge_item: KnowledgeItem }>("/knowledge", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      update: (
        id: string,
        input: Partial<{ kind: KnowledgeItem["kind"]; title: string | null; content: string; is_active: boolean }>,
      ) =>
        request<{ knowledge_item: KnowledgeItem }>(`/knowledge/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      delete: (id: string) => request<{ deleted: true }>(`/knowledge/${id}`, { method: "DELETE" }),
    },

    organization: {
      get: () => request<{ organization: Organization }>("/organization"),
      update: (
        input: Partial<{
          name: string;
          industry: string | null;
          ai_instructions: string | null;
          signature: string | null;
          reply_to_email: string | null;
        }>,
      ) =>
        request<{ organization: Organization }>("/organization", {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      /**
       * ワークスペースをまるごと相手に渡す。
       * 代わりに作った受信箱を、依頼主のアカウントへ移すときに使う。
       * 受け取った人がオーナーになり、請求先もその人に切り替わる。
       */
      transfer: (email: string) =>
        request<{ transfer: { email: string; status: "sent" } }>("/organization/transfer", {
          method: "POST",
          body: JSON.stringify({ email }),
        }),
    },

    inboundAddresses: {
      list: () => request<{ inbound_addresses: InboundAddress[] }>("/inbound-addresses"),
      create: (input: { address?: string; purpose?: Form["purpose"] } = {}) =>
        request<{ inbound_address: InboundAddress }>("/inbound-addresses", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      delete: (id: string) =>
        request<{ deleted: true }>(`/inbound-addresses/${id}`, { method: "DELETE" }),
    },

    /** サイトを読んでFAQの下地を作る。返るのは案で、保存は knowledge.create で行う */
    site: {
      scan: (url: string) =>
        request<{
          saved: false;
          industry: string | null;
          items: { kind: KnowledgeItem["kind"]; title: string; content: string; source: string }[];
          pages: { url: string; title: string }[];
          notes: string;
        }>("/knowledge/from-site", { method: "POST", body: JSON.stringify({ url }) }),
    },

    /**
     * 独自の送信ドメイン（ビジネス以上）。
     * 既定は nintact の共有ドメインからの送信で、顧客側の DNS 作業は要らない。
     * ここは「自社のドメインで送りたい」場合の設定。
     */
    sendingDomain: {
      get: () => request<{ sending_domain: SendingDomain | null }>("/sending-domain"),
      set: (input: { domain: string; from_local?: string }) =>
        request<{ sending_domain: SendingDomain }>("/sending-domain", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      verify: () =>
        request<{ sending_domain: SendingDomain }>("/sending-domain/verify", { method: "POST" }),
      remove: () => request<{ deleted: true }>("/sending-domain", { method: "DELETE" }),
    },

    usage: {
      get: () => request<Usage>("/usage"),
    },
  };
}

export type NintactClient = ReturnType<typeof createClient>;

export {
  AuthError,
  CONFIG_PATH,
  forgetKey,
  readStoredKey,
  signIn,
  storeKey,
  type SignInResult,
} from "./credentials";
