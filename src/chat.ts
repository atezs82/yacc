import { apiFetch } from './settings.js';
import {
  Segmenter, resetSegCounter,
  makeLiveSegment, makeThinkingEl, finalizeSegment, showError,
} from './renderer.js';

export interface SseData {
  delta?: string;
  done?: boolean;
  error?: string;
}

let _lastAssistantMsg: HTMLElement | null = null;

export function isLatestResponse(msgEl: Element | null): boolean {
  return msgEl !== null && msgEl === _lastAssistantMsg;
}

export function scrollChat(): void {
  const chat = document.getElementById('chat')!;
  chat.scrollTop = chat.scrollHeight;
}

function appendToChat(el: HTMLElement): void {
  const chat = document.getElementById('chat')!;
  document.getElementById('empty-state')?.remove();
  chat.appendChild(el);
  scrollChat();
}

export function addUserMessage(text: string, fileNames: string[] = []): void {
  const el = document.createElement('div');
  el.className = 'user-msg';
  const textNode = document.createElement('div');
  textNode.textContent = text;
  el.appendChild(textNode);
  if (fileNames.length > 0) {
    const row = document.createElement('div');
    row.className = 'user-msg-files';
    for (const name of fileNames) {
      const chip = document.createElement('span');
      chip.className = 'user-msg-file-chip';
      chip.textContent = '📎 ' + name;
      row.appendChild(chip);
    }
    el.appendChild(row);
  }
  appendToChat(el);
}

export function addAssistantContainer(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-msg';
  const segs = document.createElement('div');
  segs.className = 'segments';
  wrapper.appendChild(segs);
  appendToChat(wrapper);
  _lastAssistantMsg = wrapper;
  return segs;
}

export function resetChat(): void {
  _lastAssistantMsg = null;
  resetSegCounter();
  document.getElementById('chat')!.innerHTML =
    '<div id="empty-state">Send a message to start.</div>';
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseData> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { yield JSON.parse(line.slice(6)) as SseData; } catch { /* skip malformed */ }
    }
  }
}

export async function streamInto(
  endpoint: string,
  body: Record<string, unknown>,
  segContainer: HTMLElement,
): Promise<void> {
  const thinkEl = makeThinkingEl();
  segContainer.appendChild(thinkEl);
  scrollChat();

  let liveEl = makeLiveSegment();
  const seg = new Segmenter(text => {
    finalizeSegment(liveEl, text);
    liveEl = makeLiveSegment();
    segContainer.appendChild(liveEl);
    scrollChat();
  });

  let gotDone = false;
  try {
    let res: Response;
    try {
      res = await apiFetch(endpoint, body);
    } catch {
      throw new Error('Cannot reach server — is it running?');
    }
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    for await (const data of parseSse(res.body!)) {
      if (data.error) {
        thinkEl.remove();
        if (liveEl.isConnected) liveEl.remove();
        showError(segContainer, data.error);
        scrollChat();
        gotDone = true;
        break;
      }
      if (data.done) {
        if (thinkEl.isConnected) thinkEl.remove();
        seg.flush();
        if (liveEl.isConnected) {
          if (liveEl.textContent?.trim()) finalizeSegment(liveEl, liveEl.textContent.trim());
          else liveEl.remove();
        }
        const wrapper = segContainer.parentElement;
        const chat = document.getElementById('chat');
        if (wrapper && chat) {
          const wrapperTop = wrapper.getBoundingClientRect().top;
          const chatTop = chat.getBoundingClientRect().top;
          if (wrapperTop < chatTop) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        gotDone = true;
        break;
      }
      if (data.delta) {
        if (thinkEl.isConnected) thinkEl.replaceWith(liveEl);
        const remaining = seg.push(data.delta);
        liveEl.textContent = remaining;
        scrollChat();
      }
    }
  } catch (e) {
    thinkEl.remove();
    if (liveEl.isConnected) liveEl.remove();
    showError(segContainer, e instanceof Error ? e.message : String(e));
    scrollChat();
    gotDone = true;
  } finally {
    if (!gotDone) {
      thinkEl.remove();
      if (liveEl.isConnected) liveEl.remove();
      showError(segContainer, 'No response received from server.');
      scrollChat();
    }
  }
}
