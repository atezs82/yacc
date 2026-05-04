import { isLatestResponse } from './chat.js';

export interface Comment {
  quote: string;
  text: string;
  markEl: HTMLElement | null;
  anchorEl: HTMLButtonElement;
}

export const selComments = new Map<string, Comment>();

let _selRange: Range | null = null;
let _viewId: string | null = null;

export function updateSelHint(): void {
  const n = selComments.size;
  document.getElementById('hint-bar')!.classList.toggle('visible', n > 0);
  document.getElementById('hint-text')!.textContent =
    n > 0 ? `${n} comment${n > 1 ? 's' : ''} above will be sent` : '';
}

// ── Popover positioning ───────────────────────────────────────────────────────

function popoverPosition(popEl: HTMLElement, refRect: DOMRect): void {
  const W = 288, GAP = 10, APPROX_H = 180;
  let left = refRect.left + refRect.width / 2 - W / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
  const topAbove = refRect.top - APPROX_H - GAP;
  popEl.style.left = left + 'px';
  popEl.style.top  = (topAbove < 8 ? refRect.bottom + GAP : topAbove) + 'px';
}

// ── New-comment popover ───────────────────────────────────────────────────────

function hideSelPop(): void {
  document.getElementById('sel-popover')!.classList.remove('open');
  _selRange = null;
}

document.addEventListener('mouseup', e => {
  if ((e.target as Element).closest('#sel-popover, #view-popover')) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  const range = sel.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement!;
  if (!(node as Element).closest('.segment:not(.live)')) return;

  _selRange = range.cloneRange();
  const quote = sel.toString().trim();
  document.getElementById('sel-quote')!.textContent =
    '"' + (quote.length > 80 ? quote.slice(0, 80) + '…' : quote) + '"';
  document.getElementById('sel-textarea')!.textContent = '';
  const pop = document.getElementById('sel-popover')!;
  popoverPosition(pop, range.getBoundingClientRect());
  pop.classList.add('open');
  setTimeout(() => (document.getElementById('sel-textarea') as HTMLTextAreaElement).focus(), 40);
});

document.getElementById('sel-cancel')!.addEventListener('click', () => {
  hideSelPop();
  window.getSelection()?.removeAllRanges();
});

function submitSelComment(): void {
  const textarea = document.getElementById('sel-textarea') as HTMLTextAreaElement;
  const commentText = textarea.value.trim();
  if (!commentText || !_selRange) return;

  const id = `sc-${Date.now()}`;
  const quote = _selRange.toString().trim();
  let markEl: HTMLElement | null = null;
  try {
    const frag = _selRange.extractContents();
    markEl = document.createElement('mark');
    markEl.className = 'sel-commented';
    markEl.dataset['id'] = id;
    markEl.appendChild(frag);
    _selRange.insertNode(markEl);
  } catch { markEl = null; }

  const anchor = document.createElement('button');
  anchor.className = 'comment-anchor';
  anchor.dataset['id'] = id;
  anchor.textContent = '💬';
  anchor.title = 'View comment';

  if (markEl) {
    markEl.after(anchor);
  } else {
    const r = _selRange.cloneRange();
    r.collapse(false);
    r.insertNode(anchor);
  }

  selComments.set(id, { quote, text: commentText, markEl, anchorEl: anchor });
  updateSelHint();
  hideSelPop();
  window.getSelection()?.removeAllRanges();
}

document.getElementById('sel-submit')!.addEventListener('click', submitSelComment);
(document.getElementById('sel-textarea') as HTMLTextAreaElement)
  .addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitSelComment();
  });

// ── View / edit / delete popover ──────────────────────────────────────────────

function exitEditMode(): void {
  document.getElementById('view-body')!.style.display = '';
  document.getElementById('view-actions-view')!.style.display = '';
  document.getElementById('view-textarea')!.style.display = 'none';
  document.getElementById('view-actions-edit')!.style.display = 'none';
}

function hideViewPop(): void {
  document.getElementById('view-popover')!.classList.remove('open');
  exitEditMode();
}

document.addEventListener('mousedown', e => {
  const target = e.target as Element;
  if (!target.closest('#sel-popover'))  hideSelPop();
  if (!target.closest('#view-popover') && !target.closest('.comment-anchor')) hideViewPop();
});

document.addEventListener('click', e => {
  const anchor = (e.target as Element).closest<HTMLButtonElement>('.comment-anchor');
  if (!anchor) return;
  e.stopPropagation();

  const id = anchor.dataset['id']!;
  const c  = selComments.get(id);
  if (!c) return;

  _viewId = id;
  exitEditMode();

  const isLatest = isLatestResponse(anchor.closest('.assistant-msg'));
  document.getElementById('view-quote')!.textContent =
    '"' + (c.quote.length > 80 ? c.quote.slice(0, 80) + '…' : c.quote) + '"';
  document.getElementById('view-body')!.textContent = c.text;
  document.getElementById('view-delete')!.style.display = isLatest ? '' : 'none';
  document.getElementById('view-edit')!.style.display   = isLatest ? '' : 'none';

  const pop = document.getElementById('view-popover')!;
  popoverPosition(pop, anchor.getBoundingClientRect());
  pop.classList.add('open');
});

document.getElementById('view-close')!.addEventListener('click', hideViewPop);

document.getElementById('view-delete')!.addEventListener('click', () => {
  const c = selComments.get(_viewId!);
  if (c) {
    if (c.markEl?.isConnected) c.markEl.replaceWith(...c.markEl.childNodes);
    c.anchorEl.remove();
    selComments.delete(_viewId!);
    updateSelHint();
  }
  hideViewPop();
});

document.getElementById('view-edit')!.addEventListener('click', () => {
  const c = selComments.get(_viewId!);
  if (!c) return;
  const ta = document.getElementById('view-textarea') as HTMLTextAreaElement;
  ta.value = c.text;
  ta.rows  = Math.max(3, c.text.split('\n').length);
  document.getElementById('view-body')!.style.display = 'none';
  document.getElementById('view-actions-view')!.style.display = 'none';
  ta.style.display = '';
  document.getElementById('view-actions-edit')!.style.display = '';
  ta.focus();
});

document.getElementById('view-cancel-edit')!.addEventListener('click', exitEditMode);

document.getElementById('view-save')!.addEventListener('click', () => {
  const ta = document.getElementById('view-textarea') as HTMLTextAreaElement;
  const newText = ta.value.trim();
  if (!newText) return;
  const c = selComments.get(_viewId!);
  if (c) {
    c.text = newText;
    document.getElementById('view-body')!.textContent = newText;
  }
  exitEditMode();
});
