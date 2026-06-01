#!/usr/bin/env node
import { execFile, spawn } from "child_process";
import fs from "fs";
import http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { SecurityLayer } from "./security.js";
import {
	TEST_MODE_BIN,
	TEST_MODE_VERSION,
	hasTestFlag,
	printTestModeBanner,
	streamCanned,
} from "./testMode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const STATIC = path.join(__dirname, "static");

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SsePayload {
	delta?: string;
	done?: boolean;
	error?: string;
}

interface CliEvent {
	type: string;
	subtype?: string;
	session_id?: string;
	event?: {
		type: string;
		delta?: { type: string; text?: string };
	};
	is_error?: boolean;
	result?: string;
}

interface CommentEntry {
	quote?: string;
	conversation?: string;
	completeResponse?: string;
}

interface FileAttachment {
	name: string;
	type: string;
	data: string; // base64
}

// ── Startup: resolve, validate, and test the Claude binary ───────────────────

function parseCliArg(): string | null {
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--claude-path" && args[i + 1]) return args[i + 1]!;
		const m = args[i]?.match(/^--claude-path=(.+)$/);
		if (m) return m[1]!;
	}
	return null;
}

function resolveBin(raw: string): string {
	const bin = path.resolve(raw.replace(/^~/, process.env["HOME"] ?? "~"));
	if (path.basename(bin) !== "claude") {
		console.error(
			`\n  Error: binary must be named "claude" (got "${path.basename(bin)}")\n`,
		);
		process.exit(1);
	}
	try {
		fs.accessSync(bin, fs.constants.X_OK);
	} catch {
		console.error(
			`\n  Error: Claude CLI not found or not executable: ${bin}\n`,
		);
		process.exit(1);
	}
	return bin;
}

function testBin(bin: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("timed out after 5 s")),
			5000,
		);
		execFile(bin, ["--version"], (err, stdout, stderr) => {
			clearTimeout(timer);
			if (err) return reject(err);
			resolve((stdout || stderr).trim().split("\n")[0] ?? "");
		});
	});
}

const TEST_MODE = hasTestFlag(process.argv);

const rawPath = parseCliArg() ?? process.env["CLAUDE_PATH"];
if (!TEST_MODE && !rawPath) {
	console.error("\n  Error: Claude binary path not specified.");
	console.error(
		"  Use --claude-path <path>  or  set the CLAUDE_PATH env var.\n",
	);
	process.exit(1);
}

const CLAUDE_BIN = TEST_MODE ? TEST_MODE_BIN : resolveBin(rawPath as string);
const VERBOSE = process.argv.slice(2).includes("--verbose");
let CLAUDE_VERSION = TEST_MODE ? TEST_MODE_VERSION : "";

const stream = TEST_MODE ? streamCanned : streamCLI;

// ── State ─────────────────────────────────────────────────────────────────────

let cliSessionId: string | null = null;
let streaming = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

const sse = (payload: SsePayload): string =>
	`data: ${JSON.stringify(payload)}\n\n`;

function startSSE(res: ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"X-Accel-Buffering": "no",
		Connection: "keep-alive",
	});
}

function readBody(
	req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
	const MAX = 25 * 1024 * 1024;
	return new Promise((resolve) => {
		let raw = "";
		req.on("data", (c: Buffer) => {
			raw += c;
			if (raw.length > MAX) {
				req.destroy();
				resolve(null);
			}
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(raw) as Record<string, unknown>);
			} catch {
				resolve({});
			}
		});
		req.on("error", () => resolve(null));
	});
}

// ── CLI backend ───────────────────────────────────────────────────────────────

const MAX_LINE_BUF = 10 * 1024 * 1024;

function isPrintable(s: string): boolean {
	let nonPrintable = 0;
	const check = Math.min(s.length, 1000);
	for (let i = 0; i < check; i++) {
		const c = s.charCodeAt(i);
		if (c < 9 || (c > 13 && c < 32) || c === 127) nonPrintable++;
	}
	return nonPrintable / check < 0.05;
}

function streamCLI(
	prompt: string,
	files: FileAttachment[],
	res: ServerResponse,
	isolated = false,
): void {
	if (streaming) {
		startSSE(res);
		res.write(sse({ error: "Another request is already in progress." }));
		res.end();
		return;
	}
	streaming = true;
	startSSE(res);

	const args = [
		"--print",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
	];
	if (!isolated && cliSessionId) args.push("--resume", cliSessionId);

	const textParts: string[] = [];

	for (const f of files) {
		try {
			const text = Buffer.from(f.data, "base64").toString("utf8");
			if (isPrintable(text)) {
				textParts.push(`<file name="${f.name}">\n${text}\n</file>`);
			} else {
				textParts.push(
					`[Attached file: ${f.name} — binary content, not shown]`,
				);
			}
		} catch {
			textParts.push(`[Attached file: ${f.name} — could not be read]`);
		}
	}

	const effectivePrompt =
		textParts.length > 0 ? textParts.join("\n\n") + "\n\n" + prompt : prompt;

	args.push(effectivePrompt);
	if (VERBOSE) {
		console.log(
			"\n[claude args] " + [CLAUDE_BIN, ...args.slice(0, -1)].join(" "),
		);
		console.log("[claude ←]\n" + effectivePrompt + "\n");
	}

	let proc;
	try {
		proc = spawn(CLAUDE_BIN, args);
	} catch {
		streaming = false;
		res.write(sse({ error: `Failed to launch ${CLAUDE_BIN}` }));
		res.end();
		return;
	}

	proc.on("error", () => {
		streaming = false;
		res.write(sse({ error: `Failed to launch ${CLAUDE_BIN}` }));
		res.end();
	});

	proc.stdin.end();

	proc.stderr.resume();

	let buf = "";
	let verboseText = "";
	proc.stdout.on("data", (chunk: Buffer) => {
		buf += chunk.toString("utf8");
		if (buf.length > MAX_LINE_BUF) {
			streaming = false;
			proc.kill("SIGTERM");
			res.write(sse({ error: "Output exceeded size limit." }));
			res.end();
			return;
		}
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let event: CliEvent;
			try {
				event = JSON.parse(trimmed) as CliEvent;
			} catch {
				continue;
			}

			if (event.type === "system" && event.subtype === "init") {
				if (!isolated) cliSessionId = event.session_id ?? null;
			} else if (event.type === "stream_event") {
				const inner = event.event;
				if (
					inner?.type === "content_block_delta" &&
					inner.delta?.type === "text_delta"
				) {
					const text = inner.delta.text ?? "";
					if (text) {
						res.write(sse({ delta: text }));
						if (VERBOSE) verboseText += text;
					}
				}
			} else if (event.type === "result") {
				sentResult = true;
				if (VERBOSE)
					console.log(
						"\n[claude →]\n" + (verboseText || event.result || "") + "\n",
					);
				res.write(
					event.is_error
						? sse({ error: event.result ?? "CLI error" })
						: sse({ done: true }),
				);
			}
		}
	});

	let sentResult = false;
	proc.on("close", (code) => {
		streaming = false;
		if (!sentResult)
			res.write(
				sse({
					error: `Claude exited without a response (code ${code ?? "?"})`,
				}),
			);
		res.end();
	});
}

// ── Router ────────────────────────────────────────────────────────────────────

const security = new SecurityLayer(PORT, VERBOSE);

const server = http.createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		if (security.guard(req, res)) return;

		const url = new URL(req.url ?? "/", "http://localhost");
		const { pathname } = url;
		const method = req.method;

		console.log(`${method} ${pathname}`);

		if (method === "GET") {
			const rel = pathname === "/" ? "/index.html" : pathname;
			const abs = path.resolve(path.join(STATIC, rel));
			if (!abs.startsWith(path.resolve(STATIC))) {
				res.writeHead(403);
				return res.end("Forbidden");
			}
			if (fs.existsSync(abs)) {
				const mime = MIME[path.extname(abs)] ?? "application/octet-stream";
				res.writeHead(200, { "Content-Type": mime });
				return res.end(fs.readFileSync(abs));
			}
		}

		if (method === "POST" && pathname === "/api/send") {
			const body = await readBody(req);
			if (!body) {
				res.writeHead(413);
				return res.end("Request too large");
			}
			const files = Array.isArray(body["files"])
				? (body["files"] as FileAttachment[])
				: [];
			return stream(String(body["content"] ?? ""), files, res);
		}

		if (method === "POST" && pathname === "/api/ask-comment") {
			const payload = await readBody(req);
			if (!payload) {
				res.writeHead(413);
				return res.end("Request too large");
			}
			console.log("Raw comment payload:\n", payload);

			const prompt = `In a previous session you have had the following conversation with the user:    
    '''
    ${payload.completeResponse}
    '''
    Regarding this, the user has selected the following quote from your response and made a comment on it:
    '''
    Quote: ${payload.quote}
    Comment: ${payload.conversation}
    '''
    Please provide a helpful and concise response to the user's comment, taking into account the context 
    of the original conversation. Address any questions or concerns raised in the comment, and provide 
    additional information or clarification as needed. The comment might be critical and might contain
    assistant response fragments, so please be empathetic and constructive in your reply. If the comment 
    is not clear, ask for clarification.
    `;

			console.log("Generated prompt for comment:\n", prompt);

			return stream(prompt, [], res, true);
		}

		if (method === "DELETE" && pathname === "/api/conversation") {
			cliSessionId = null;
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true }));
		}

		if (method === "GET" && pathname === "/api/status") {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({ bin: CLAUDE_BIN, version: CLAUDE_VERSION }),
			);
		}

		res.writeHead(404);
		res.end("Not found");
	},
);

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
	if (TEST_MODE) {
		printTestModeBanner();
	} else {
		process.stdout.write(`  Checking ${CLAUDE_BIN} … `);
		try {
			CLAUDE_VERSION = await testBin(CLAUDE_BIN);
			console.log(`OK  (${CLAUDE_VERSION})`);
		} catch (e) {
			console.error(
				`FAILED\n\n  Error: ${(e as Error).message}\n  Binary: ${CLAUDE_BIN}\n`,
			);
			process.exit(1);
		}
	}

	server.on("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") {
			console.error(
				`\n  Error: port ${PORT} is already in use.\n  Kill the existing process or open http://localhost:${PORT} if it's already running.\n`,
			);
			process.exit(1);
		}
		throw err;
	});

	server.listen(PORT, "127.0.0.1", () => {
		const url = `http://localhost:${PORT}`;
		console.log(`\n  Claude Commenter  →  ${url}\n`);
		const open =
			process.platform === "darwin"
				? "open"
				: process.platform === "win32"
					? "start"
					: "xdg-open";
		execFile(open, [url]);
	});
})();
