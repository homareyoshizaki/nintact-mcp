# nintact — MCP server and JavaScript client

A contact form you paste in one line. An AI that sorts what comes in and drafts the reply.
Delivery that needs no DNS work.

This repository holds the two published packages. The hosted service lives at
[nintact.com](https://nintact.com).

| Package | What it is |
|---|---|
| [`nintact-mcp`](packages/nintact-mcp) | MCP server — 32 tools. Build forms, read the inbox, approve replies from your editor. |
| [`nintact`](packages/nintact) | JavaScript client, React component, and CLI. |

## The problem this exists for

A site built with an AI assistant usually works until the contact form. Then the mail silently
stops. Gmail and Yahoo! reject mail from a domain with no SPF/DKIM, and whoever built the site
finds out weeks later — from the customer who never got an answer.

The usual fixes all end at the same wall: an SMTP plugin still needs a domain you have
authenticated, and authenticating a domain means DNS records the person often cannot edit.

nintact sends over an already-authenticated domain, with `Reply-To` pointing at your own address.
Replies reach you without touching DNS, SMTP, or a mail provider.

## Quick start

```bash
npx nintact-mcp login                          # 6-digit code by email; the key is stored, not pasted
claude mcp add nintact -- npx -y nintact-mcp
```

Then ask your assistant to build the form.

No account yet? `check_deliverability` works without a key — it reads public DNS and tells you
whether a domain can actually get mail delivered.

```bash
curl https://nintact.com/api/v1/check?domain=example.com
```

## Docs

- [`https://nintact.com/llms.txt`](https://nintact.com/llms.txt) — one screen, enough to install
- [`https://nintact.com/llms-full.txt`](https://nintact.com/llms-full.txt) — the full API
- [MCP server details](packages/nintact-mcp/README.md)
- [Client and CLI](packages/nintact/README.md)

## Development

```bash
npm install
npm run build
```

## License

MIT
