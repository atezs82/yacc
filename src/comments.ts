import { isLatestResponse, parseSse } from "./chat.js";

export type Role = "user" | "assistant";
export interface Turn {
	role: Role;
	text: string;
}

export interface Comment {
	quote: string;
	turns: Turn[];
	markEl: HTMLElement | null;
	anchorEl: HTMLButtonElement;
	sent: boolean;
}

export const selComments = new Map<string, Comment>();

export function pendingComments(): Comment[] {
	return [...selComments.values()].filter((c) => !c.sent);
}

export function updateSelHint(): void {
	const n = pendingComments().length;
	document.getElementById("hint-bar")!.classList.toggle("visible", n > 0);
	document.getElementById("hint-text")!.textContent =
		n > 0 ? `${n} comment${n > 1 ? "s" : ""} above will be sent` : "";
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const QUOTE_MAX = 80;
const ellipsize = (s: string): string =>
	s.length > QUOTE_MAX ? s.slice(0, QUOTE_MAX) + "…" : s;
const quoteDisplay = (s: string): string => '"' + ellipsize(s) + '"';

function $<T extends HTMLElement>(id: string): T {
	return document.getElementById(id) as T;
}

/**
 * Position a popover above or below its reference rect. If the popover is
 * already visible, its measured height is used; otherwise `fallbackHeight`.
 * Returns the chosen side so callers can lock it for subsequent reflows.
 */
function placePopover(
	popEl: HTMLElement,
	refRect: DOMRect,
	opts: { sideHint?: "above" | "below"; fallbackHeight?: number } = {},
): "above" | "below" {
	const GAP = 10;
	const W = popEl.offsetWidth || 288;
	const H = popEl.offsetHeight || opts.fallbackHeight || 180;
	let left = refRect.left + refRect.width / 2 - W / 2;
	left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
	const side: "above" | "below" =
		opts.sideHint ?? (refRect.top - H - GAP < 8 ? "below" : "above");
	const top =
		side === "above"
			? Math.max(8, refRect.top - H - GAP)
			: Math.min(window.innerHeight - H - 8, refRect.bottom + GAP);
	popEl.style.left = left + "px";
	popEl.style.top = top + "px";
	return side;
}

// ── New-comment popover ───────────────────────────────────────────────────────

class SelPopover {
	private readonly root = $<HTMLElement>("sel-popover");
	private readonly quoteEl = $<HTMLElement>("sel-quote");
	private readonly threadEl = $<HTMLElement>("sel-thread");
	private readonly textarea = $<HTMLTextAreaElement>("sel-textarea");
	private readonly submitBtn = $<HTMLButtonElement>("sel-submit");
	private readonly askBtn = $<HTMLButtonElement>("sel-submit-ask");
	private readonly cancelBtn = $<HTMLButtonElement>("sel-cancel");

	private range: Range | null = null;
	private refRect: DOMRect | null = null;
	private side: "above" | "below" = "above";
	private turns: Turn[] = [];
	private streaming = false;
	private abort: AbortController | null = null;

	constructor() {
		this.cancelBtn.addEventListener("click", () => {
			this.close();
			window.getSelection()?.removeAllRanges();
		});
		this.submitBtn.addEventListener("click", () => this.submit());
		this.askBtn.addEventListener("click", () => void this.ask());
		this.textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) this.submit();
		});
	}

	contains(el: Element): boolean {
		return !!el.closest("#sel-popover");
	}

	openForRange(range: Range, quote: string): void {
		this.range = range;
		this.refRect = range.getBoundingClientRect();
		this.quoteEl.textContent = quoteDisplay(quote);
		this.textarea.value = "";
		this.resetThread();
		this.root.classList.add("open");
		this.side = placePopover(this.root, this.refRect);
		setTimeout(() => this.textarea.focus(), 40);
	}

	close(): void {
		if (this.abort) {
			this.abort.abort();
			this.abort = null;
		}
		this.root.classList.remove("open");
		this.range = null;
		this.refRect = null;
		this.resetThread();
		this.setBusy(false);
	}

	private reposition(): void {
		if (this.refRect)
			placePopover(this.root, this.refRect, { sideHint: this.side });
	}

	private setBusy(busy: boolean): void {
		this.streaming = busy;
		this.askBtn.disabled = busy;
		this.submitBtn.disabled = busy;
		this.textarea.disabled = busy;
	}

	private resetThread(): void {
		this.threadEl.innerHTML = "";
		this.threadEl.style.display = "none";
		this.turns = [];
	}

	private appendTurnEl(role: Role, text: string): HTMLElement {
		if (this.threadEl.style.display === "none")
			this.threadEl.style.display = "";
		const el = document.createElement("div");
		el.className = `pop-turn pop-turn-${role}`;
		el.textContent = text;
		this.threadEl.appendChild(el);
		this.threadEl.scrollTop = this.threadEl.scrollHeight;
		return el;
	}

	private submit(): void {
		if (this.streaming || !this.range) return;
		const trailing = this.textarea.value.trim();
		const turns = trailing
			? [...this.turns, { role: "user" as const, text: trailing }]
			: this.turns.slice();
		if (turns.length === 0) return;

		const id = `sc-${Date.now()}`;
		const quote = this.range.toString().trim();
		let markEl: HTMLElement | null = null;
		try {
			const frag = this.range.extractContents();
			markEl = document.createElement("mark");
			markEl.className = "sel-commented";
			markEl.dataset["id"] = id;
			markEl.appendChild(frag);
			this.range.insertNode(markEl);
		} catch {
			markEl = null;
		}

		const anchor = document.createElement("button");
		anchor.className = "comment-anchor";
		anchor.dataset["id"] = id;
		anchor.textContent = "💬";
		anchor.title = "View comment";
		if (markEl) markEl.after(anchor);
		else {
			const r = this.range.cloneRange();
			r.collapse(false);
			r.insertNode(anchor);
		}

		selComments.set(id, {
			quote,
			turns,
			markEl,
			anchorEl: anchor,
			sent: false,
		});
		updateSelHint();
		this.close();
		window.getSelection()?.removeAllRanges();
	}

	private buildConversationPayload(newUserText: string): string {
		const parts = this.turns.map(
			(t) => (t.role === "user" ? "User: " : "Assistant: ") + t.text,
		);
		parts.push("User: " + newUserText);
		return parts.join("\n\n");
	}

	private async ask(): Promise<void> {
		if (this.streaming || !this.range) return;
		const userText = this.textarea.value.trim();
		if (!userText) return;

		this.textarea.value = "";
		this.setBusy(true);
		try {
			await this.runAsk(userText);
		} finally {
			this.setBusy(false);
			this.textarea.focus();
		}
	}

	private async runAsk(userText: string): Promise<void> {
		const lastEl = document.getElementById("chat")?.lastElementChild;
		const lastResponse = lastEl ? (lastEl as HTMLElement).innerText.trim() : "";
		const quote = this.range?.toString().trim() ?? "";

		this.turns.push({ role: "user", text: userText });
		this.appendTurnEl("user", userText);
		this.reposition();

		const assistantEl = this.appendTurnEl("assistant", "");
		assistantEl.classList.add("streaming");
		this.reposition();

		this.abort = new AbortController();
		let acc = "";
		try {
			const res = await fetch("/api/ask-comment", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					conversation: this.buildConversationPayload(userText),
					quote,
					completeResponse: lastResponse,
				}),
				signal: this.abort.signal,
			});
			if (!res.ok || !res.body)
				throw new Error(`Server returned ${res.status}`);

			for await (const data of parseSse(res.body)) {
				if (data.error) throw new Error(data.error);
				if (data.delta) {
					acc += data.delta;
					assistantEl.textContent = acc;
					this.threadEl.scrollTop = this.threadEl.scrollHeight;
					this.reposition();
				}
				if (data.done) break;
			}

			if (!acc.trim()) throw new Error("No response received.");
			this.turns.push({ role: "assistant", text: acc.trim() });
			assistantEl.classList.remove("streaming");
			assistantEl.textContent = acc.trim();
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				assistantEl.remove();
				this.turns.pop();
				return;
			}
			assistantEl.className = "pop-turn pop-turn-error";
			assistantEl.textContent =
				"⚠ " + ((err as Error).message || "Failed to ask.");
			this.turns.pop();
		} finally {
			this.abort = null;
			this.reposition();
			this.threadEl.scrollTop = this.threadEl.scrollHeight;
		}
	}
}

// ── View / edit / delete popover ──────────────────────────────────────────────

class ViewPopover {
	private readonly root = $<HTMLElement>("view-popover");
	private readonly quoteEl = $<HTMLElement>("view-quote");
	private readonly bodyEl = $<HTMLElement>("view-body");
	private readonly textarea = $<HTMLTextAreaElement>("view-textarea");
	private readonly viewActions = $<HTMLElement>("view-actions-view");
	private readonly editActions = $<HTMLElement>("view-actions-edit");
	private readonly deleteBtn = $<HTMLButtonElement>("view-delete");
	private readonly editBtn = $<HTMLButtonElement>("view-edit");
	private readonly closeBtn = $<HTMLButtonElement>("view-close");
	private readonly saveBtn = $<HTMLButtonElement>("view-save");
	private readonly cancelEditBtn = $<HTMLButtonElement>("view-cancel-edit");

	private viewId: string | null = null;

	constructor() {
		this.closeBtn.addEventListener("click", () => this.close());
		this.deleteBtn.addEventListener("click", () => this.onDelete());
		this.editBtn.addEventListener("click", () => this.enterEdit());
		this.cancelEditBtn.addEventListener("click", () => this.exitEdit());
		this.saveBtn.addEventListener("click", () => this.onSave());
	}

	contains(el: Element): boolean {
		return !!el.closest("#view-popover");
	}

	open(
		anchor: HTMLButtonElement,
		comment: Comment,
		id: string,
		isLatest: boolean,
	): void {
		this.viewId = id;
		this.exitEdit();
		this.quoteEl.textContent = quoteDisplay(comment.quote);
		this.bodyEl.textContent = ViewPopover.renderTurns(comment.turns);
		this.deleteBtn.style.display = isLatest ? "" : "none";
		this.editBtn.style.display = isLatest ? "" : "none";
		this.root.classList.add("open");
		placePopover(this.root, anchor.getBoundingClientRect(), {
			fallbackHeight: 180,
		});
	}

	close(): void {
		this.root.classList.remove("open");
		this.exitEdit();
	}

	private enterEdit(): void {
		const c = this.viewId ? selComments.get(this.viewId) : null;
		if (!c) return;
		const userTurns = c.turns.filter((t) => t.role === "user");
		const editable =
			userTurns.length > 0 ? userTurns[userTurns.length - 1]!.text : "";
		this.textarea.value = editable;
		this.textarea.rows = Math.max(3, editable.split("\n").length);
		this.bodyEl.style.display = "none";
		this.viewActions.style.display = "none";
		this.textarea.style.display = "";
		this.editActions.style.display = "";
		this.textarea.focus();
	}

	private exitEdit(): void {
		this.bodyEl.style.display = "";
		this.viewActions.style.display = "";
		this.textarea.style.display = "none";
		this.editActions.style.display = "none";
	}

	private onSave(): void {
		const newText = this.textarea.value.trim();
		if (!newText || !this.viewId) return;
		const c = selComments.get(this.viewId);
		if (c) {
			for (let i = c.turns.length - 1; i >= 0; i--) {
				if (c.turns[i]!.role === "user") {
					c.turns[i]!.text = newText;
					break;
				}
			}
			this.bodyEl.textContent = ViewPopover.renderTurns(c.turns);
		}
		this.exitEdit();
	}

	private onDelete(): void {
		const c = this.viewId ? selComments.get(this.viewId) : null;
		if (c) {
			if (c.markEl?.isConnected) c.markEl.replaceWith(...c.markEl.childNodes);
			c.anchorEl.remove();
			selComments.delete(this.viewId!);
			updateSelHint();
		}
		this.close();
	}

	private static renderTurns(turns: Turn[]): string {
		return turns
			.map((t) => (t.role === "user" ? "You:\n" : "Claude:\n") + t.text)
			.join("\n\n");
	}
}

// ── Wire-up ───────────────────────────────────────────────────────────────────

const selPop = new SelPopover();
const viewPop = new ViewPopover();

document.addEventListener("mouseup", (e) => {
	const target = e.target as Element;
	if (target.closest("#sel-popover, #view-popover")) return;
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
	const range = sel.getRangeAt(0);
	let node = range.commonAncestorContainer;
	if (node.nodeType === Node.TEXT_NODE) node = (node as Text).parentElement!;
	if (!(node as Element).closest(".segment:not(.live)")) return;
	selPop.openForRange(range.cloneRange(), sel.toString().trim());
});

document.addEventListener("mousedown", (e) => {
	const target = e.target as Element;
	if (!selPop.contains(target)) selPop.close();
	if (!viewPop.contains(target) && !target.closest(".comment-anchor"))
		viewPop.close();
});

document.addEventListener("click", (e) => {
	const anchor = (e.target as Element).closest<HTMLButtonElement>(
		".comment-anchor",
	);
	if (!anchor) return;
	e.stopPropagation();
	const id = anchor.dataset["id"]!;
	const c = selComments.get(id);
	if (!c) return;
	const isLatest = isLatestResponse(anchor.closest(".assistant-msg"));
	viewPop.open(anchor, c, id, isLatest);
});
