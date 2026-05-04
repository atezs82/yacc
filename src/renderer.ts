/// <reference path="./globals.d.ts" />

marked.use({
  gfm: true,
  breaks: false,
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
});

export class Segmenter {
  private buf = '';
  private readonly onSegment: (text: string) => void;

  constructor(onSegment: (text: string) => void) {
    this.onSegment = onSegment;
  }

  push(delta: string): string {
    this.buf += delta;
    const fences = (this.buf.match(/```/g) ?? []).length;
    if (fences % 2 !== 0) return this.buf;
    const parts = this.buf.split(/\n{2,}/);
    if (parts.length < 2) return this.buf;
    for (let i = 0; i < parts.length - 1; i++) {
      const t = parts[i]?.trim();
      if (t) this.onSegment(t);
    }
    this.buf = parts[parts.length - 1] ?? '';
    return this.buf;
  }

  flush(): void {
    if (this.buf.trim()) {
      this.onSegment(this.buf.trim());
      this.buf = '';
    }
  }
}

let _segCounter = 0;
export function resetSegCounter(): void { _segCounter = 0; }

export function makeLiveSegment(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'segment live';
  return el;
}

export function makeThinkingEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'segment';
  el.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
  return el;
}

export function finalizeSegment(liveEl: HTMLDivElement, text: string): void {
  liveEl.className = 'segment';
  liveEl.dataset['id'] = `seg-${++_segCounter}`;
  liveEl.innerHTML = DOMPurify.sanitize(marked.parse(text));
  liveEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
}

export function showError(segContainer: HTMLElement, msg: string): void {
  const el = document.createElement('div');
  el.style.cssText = 'color:#f85149;font-size:13px;padding:8px 10px;border:1px solid #4d1919;border-radius:6px;background:#1a0a0a;';
  el.textContent = '⚠ ' + msg;
  segContainer.appendChild(el);
}
