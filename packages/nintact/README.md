# nintact

**AI first-responder for your contact form.** Point a form at one URL and you get: delivery that
actually lands in the inbox, automatic classification of what came in, and a reply draft written
for you. A human approves before anything is sent.

**No SMTP credentials. No SPF/DKIM/DMARC records. No domain verification.** Mail goes out over
nintact's already-authenticated sending domain, with `Reply-To` pointing at your own address —
so replies reach you without you ever touching DNS.

```tsx
import { NintactForm } from "nintact/react";

export default function Contact() {
  return <NintactForm formId="YOUR_FORM_ID" />;
}
```

That's the whole integration. `formId` is public by design — it is safe in client code.

## Get a form id

```bash
npx nintact init
```

Asks for your email, sends a 6-digit code, and creates the form. No browser, one prompt.
It writes `NINTACT_API_KEY` and `NEXT_PUBLIC_NINTACT_FORM_ID` to `.env.local`, then prints a
snippet for the framework it detected.

Already have a key? Set `NINTACT_API_KEY` and `init` runs unattended.

## Without React

```ts
import { submit } from "nintact";

await submit("YOUR_FORM_ID", {
  name: "Jane Doe",
  email: "jane@example.com",
  message: "I'd like a quote.",
});
```

Or skip the package entirely. One tag renders the whole form:

```html
<script src="https://nintact.com/embed.js" data-nintact="YOUR_FORM_ID" async></script>
```

Already have a form? Point it at nintact and keep your own markup:

```html
<form action="https://nintact.com/api/f/YOUR_FORM_ID" method="POST">
  <input name="name"><input name="email"><textarea name="message"></textarea>
  <button>Send</button>
</form>
```

## Reading what came in

The management API needs an API key, so call it **from your server only**.

```ts
import { createClient } from "nintact";

const nintact = createClient({ apiKey: process.env.NINTACT_API_KEY! });

const { messages } = await nintact.messages.list({ status: "needs_review" });
const { draft } = await nintact.messages.get(messages[0].id);

// The AI wrote a draft. A human decides.
await nintact.drafts.approve(draft.id);
```

Every message is classified as `estimate_request`, `question`, `sales`, `spam`, or `other`.
Spam gets no draft and no notification.

## CLI

```bash
npx nintact init [--name "Contact form"] [--email you@example.com] [--json]
npx nintact messages [--json]
```

`--json` prints machine-readable output, for use from scripts and coding agents.

## Errors

Every error carries a `nextStep` telling you how to recover.

```ts
try {
  await nintact.forms.create({ name: "Contact form" });
} catch (error) {
  if (error instanceof NintactError) {
    console.error(error.code, error.message, error.nextStep);
  }
}
```

## License

MIT
