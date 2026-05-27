# yet-another-claude-commenter

A local web UI for chatting with Claude that adds Google Docs-style inline commenting to responses.

Select any text in a Claude response, leave a comment on it, and send those comments back as context for the next turn.

## Disclaimer

The code currently is in a proof-of-concept state. Minimal security hardening and usability fixes were done but use it at your own risk.

## Requirements

- Node.js ≥ 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Usage

```bash
npx @atezs82/yet-another-claude-commenter --claude-path /path/to/claude
```

Or set the `CLAUDE_PATH` environment variable instead:

```bash
CLAUDE_PATH=/path/to/claude npx @atezs82/yet-another-claude-commenter
```

The server starts on `http://localhost:8765` and opens your browser automatically.

## Features

- **Inline comments** — select text in any response, write a note, and it gets highlighted with a 💬 anchor
- **Comment context** — queued comments are sent along with your next message so Claude can address them directly
- **File attachments** — attach text files to any message (binary files are noted but not inlined)
- **Session continuity** — conversation history is maintained via the Claude CLI `--resume` flag
- **Security** — localhost-only binding, DNS-rebinding protection via `Host` header validation, same-origin checks on state-changing requests (POST/DELETE), and a CSP that disallows remote scripts and inline JS (inline styles are permitted)

## Development

```bash
npm install
npm run build   # compiles TypeScript for both server and client
npm start       # requires CLAUDE_PATH or --claude-path
```
