import type { ServerResponse } from 'http';

interface FileAttachment {
  name: string;
  type: string;
  data: string;
}

interface SsePayload {
  delta?: string;
  done?: boolean;
  error?: string;
}

const sse = (payload: SsePayload): string => `data: ${JSON.stringify(payload)}\n\n`;

function startSSE(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });
}

export function hasTestFlag(argv: readonly string[]): boolean {
  return argv.includes('--test');
}

export const TEST_MODE_BIN = '(test mode — canned responses)';
export const TEST_MODE_VERSION = 'test';

export function printTestModeBanner(): void {
  console.log('  Test mode enabled — Claude CLI will not be invoked; responses are canned.');
}

function buildCanned(prompt: string, files: FileAttachment[]): string {
  const echo = prompt.length > 200 ? prompt.slice(0, 200) + '…' : prompt;
  const attached = files.length
    ? `\n\n_Attached: ${files.map(f => f.name).join(', ')}._`
    : '';
  return [
    `**Canned response (test mode).**${attached}`,
    `You sent:\n\n> ${echo.replace(/\n/g, '\n> ')}`,
    `This response streams as several paragraphs so the segmenter, markdown renderer, and inline-comment popover can be exercised without the real CLI.`,
    'Here is a fenced code block:\n\n```ts\nconst answer = 42;\nconsole.log(answer);\n```',
    'And a short list:\n\n- alpha\n- beta\n- gamma',
    'End of canned response.',
  ].join('\n\n');
}

function chunkify(text: string): string[] {
  const out: string[] = [];
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
  let buf = '';
  for (const tok of tokens) {
    buf += tok;
    if (buf.length >= 8) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function streamCanned(prompt: string, files: FileAttachment[], res: ServerResponse, _isolated = false): void {
  startSSE(res);
  const chunks = chunkify(buildCanned(prompt, files));
  let i = 0;
  const tick = (): void => {
    if (res.writableEnded) return;
    if (i >= chunks.length) {
      res.write(sse({ done: true }));
      res.end();
      return;
    }
    res.write(sse({ delta: chunks[i++]! }));
    setTimeout(tick, 25);
  };
  tick();
}
