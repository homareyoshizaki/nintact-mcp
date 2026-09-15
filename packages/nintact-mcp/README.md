# nintact-mcp

MCP server for [nintact](https://nintact.com) — a contact form you paste in one line, an AI that
sorts what comes in and drafts the reply, and delivery that needs no DNS work.

Build the form, read the inbox, and approve replies without leaving your editor.

## Why this exists

A site built with an AI assistant usually works until the contact form. Then the mail silently
stops: Gmail and Yahoo! reject mail from a domain with no SPF/DKIM, and the person who built the
site finds out weeks later, from the customer who never got an answer.

nintact sends over an already-authenticated domain with `Reply-To` pointing at your own address,
so replies reach you **without you touching DNS, SMTP, or a mail provider**.

## Install

```bash
npx nintact-mcp login                          # 6-digit code by email; the key is stored, not pasted
claude mcp add nintact -- npx -y nintact-mcp
```

`login` writes the key to `~/.nintact/config.json` (0600). Passing it on the command line also
works and is what CI wants:

```bash
claude mcp add nintact --env NINTACT_API_KEY=nk_live_... -- npx -y nintact-mcp
```

Prefer `login` on a person's own machine — a key typed into a command ends up in shell history
and in the client's config file in plaintext.

### No `claude` on PATH?

The desktop app alone does not install the CLI. Add this at the top level of `~/.claude.json`.
A session that is already open will not pick it up; open a new one.

```json
{
  "mcpServers": {
    "nintact": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "nintact-mcp"]
    }
  }
}
```

Any MCP client works — Cursor, Codex CLI, Claude Desktop. ChatGPT itself cannot: its connectors
only accept a server published over HTTPS, not one run locally.

## Works without an account

`check_deliverability` needs no API key. It reads public DNS and tells you whether a domain can
actually get mail delivered — which is usually the question, before anyone has signed up for
anything.

```
check_deliverability("example.com")
→ { spf: "missing", dmarc: "missing", verdict: "will_be_rejected",
    next_step: "..." }
```

## Tools

32 tools covering the same surface as the REST API. No screen-only features.

| Area | Tools |
|---|---|
| Diagnose | `check_deliverability` |
| Forms | `design_form`, `create_form`, `list_forms`, `get_form`, `update_form`, `duplicate_form`, `delete_form` |
| Look | `set_form_logo`, `remove_form_logo` |
| Inbox | `list_messages`, `get_message`, `update_message_status` |
| Replies | `regenerate_draft`, `update_draft`, `approve_draft` |
| Grounding | `list_knowledge`, `add_knowledge`, `update_knowledge`, `delete_knowledge`, `scan_site_for_knowledge` |
| Workspace | `get_organization`, `update_organization`, `transfer_workspace`, `get_usage` |
| Email in | `list_inbound_addresses`, `create_inbound_address`, `delete_inbound_address` |
| Own domain | `get_sending_domain`, `set_sending_domain`, `verify_sending_domain`, `remove_sending_domain` |

Every error carries a `next_step` field describing how to recover, so an agent can fix its own
mistake instead of giving up on the tool.

## Things worth knowing before you point this at someone's account

- **`approve_draft` sends a real email.** Confirm with the person first. nintact never sends
  without an explicit approval, and neither should you.
- **Call `get_organization` (or the API's `GET /me`) first.** It returns the workspace name and
  how many forms already exist. If that count is not zero, reuse a form instead of adding one —
  inquiries split across two forms land in two places, and the owner only watches one.
- **Notifications are held until the address confirms.** Setting `notify_emails` emails a
  confirmation link to each address. Until someone opens it, submissions are stored and visible
  in the dashboard but no notification goes out. Tell the owner to check their mail.
- **AI can be switched off per form.** `update_form` with `mode: "relay"` forwards everything
  untouched — no classification, no draft, nothing sent to a model.

## Verifying an install without creating a real inquiry

```bash
curl -X POST 'https://nintact.com/api/f/YOUR_FORM_ID?dry_run=1' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@example.com","message":"checking the install"}'
```

Everything is checked as in a real submission, then nothing is stored and nobody is notified.
`200` with `{"data":{"ok":true,...}}` means the install is correct. Use this instead of sending a
real submission to someone else's inbox.

## Docs

- `https://nintact.com/llms.txt` — one screen, enough to install
- `https://nintact.com/llms-full.txt` — the full API
- npm: [`nintact`](https://www.npmjs.com/package/nintact) (client + CLI),
  [`nintact-mcp`](https://www.npmjs.com/package/nintact-mcp)

## License

MIT
