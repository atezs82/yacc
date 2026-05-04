import type { IncomingMessage, ServerResponse } from 'http';

const CSP = [
  "default-src 'none'",
  "script-src 'self' cdn.jsdelivr.net cdnjs.cloudflare.com",
  "style-src 'self' cdnjs.cloudflare.com",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "frame-ancestors 'none'",
].join('; ');

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localOnlyPage(remoteAddress: string): string {
  const addr = escHtml(remoteAddress);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local access only — Claude Commenter</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      width: calc(100% - 32px);
      text-align: center;
    }
    .icon { width: 48px; height: 48px; margin: 0 auto 22px; color: #388bfd; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
    p { font-size: 14px; line-height: 1.65; color: #8b949e; }
    .address {
      display: inline-block;
      margin-top: 20px;
      padding: 6px 14px;
      background: #1c2128;
      border: 1px solid #30363d;
      border-radius: 6px;
      font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
      font-size: 12px;
      color: #8b949e;
    }
    .address b { color: #e6edf3; font-weight: 400; }
    footer { margin-top: 32px; font-size: 12px; color: #30363d; letter-spacing: 0.02em; }
  </style>
</head>
<body>
  <div class="card">
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
    <h1>Local access only</h1>
    <p>This application only accepts connections from the machine it is running on.
       Remote access is not permitted.</p>
    <div class="address">Your address:&nbsp; <b>${addr}</b></div>
    <footer>Claude Commenter</footer>
  </div>
</body>
</html>`;
}

export class SecurityLayer {
  private readonly port: number;

  constructor(port: number) {
    this.port = port;
  }

  // Blocks DNS-rebinding: even though the server binds to 127.0.0.1, a browser
  // on the same machine can be tricked into sending requests to localhost via a
  // domain whose DNS has been rotated to 127.0.0.1. The Host header will carry
  // the attacker's domain name rather than "localhost", which we reject here.
  private isLocalHost(req: IncomingMessage): boolean {
    const host = req.headers['host'];
    return host === `localhost:${this.port}` || host === `127.0.0.1:${this.port}`;
  }

  // Blocks cross-origin CSRF on state-mutating methods: browsers always include
  // Origin on cross-origin POST/DELETE, so anything not originating from our own
  // page is rejected.
  private isSameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers['origin'];
    if (!origin) return false;
    return (
      origin === `http://localhost:${this.port}` ||
      origin === `http://127.0.0.1:${this.port}`
    );
  }

  // Sets security headers and enforces same-machine access policy.
  // Returns true if the request was fully handled (rejected); the caller must
  // stop processing immediately when this returns true.
  guard(req: IncomingMessage, res: ServerResponse): boolean {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', CSP);

    if (!this.isLocalHost(req)) {
      const ip = req.socket.remoteAddress ?? 'unknown';
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(localOnlyPage(ip));
      return true;
    }

    if ((req.method === 'POST' || req.method === 'DELETE') && !this.isSameOrigin(req)) {
      res.writeHead(403);
      res.end('Forbidden');
      return true;
    }

    return false;
  }
}
