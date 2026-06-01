import "./settings.js";
import "./comments.js";
import {
	addAssistantContainer,
	addUserMessage,
	resetChat,
	streamInto,
} from "./chat.js";
import {
	type Comment,
	pendingComments,
	selComments,
	updateSelHint,
} from "./comments.js";
import { clearFiles, readFilesAsAttachments } from "./files.js";

let busy = false;

function setBusy(state: boolean): void {
	busy = state;
	(document.getElementById("input") as HTMLTextAreaElement).disabled = state;
	(document.getElementById("send-btn") as HTMLButtonElement).disabled = state;
	(document.getElementById("attach-btn") as HTMLButtonElement).disabled = state;
}

function autoResize(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

function renderCommentBlock(c: Comment): string {
	const body = c.turns
		.map((t) => (t.role === "user" ? "User: " : "Assistant: ") + t.text)
		.join("\n\n");
	return `> ${c.quote}\n\n${body}`;
}

async function sendMessage(): Promise<void> {
	const input = document.getElementById("input") as HTMLTextAreaElement;
	const text = input.value.trim();
	if (!text || busy) return;

	const attachments = await readFilesAsAttachments();
	clearFiles();

	let content = text;
	const pending = pendingComments();
	if (
		pending.length > 0 &&
		(document.getElementById("send-comments-chk") as HTMLInputElement).checked
	) {
		const blocks = pending.map(renderCommentBlock).join("\n\n---\n\n");
		content = blocks + "\n\n" + text;
	}
	if (pending.length > 0) {
		for (const c of pending) c.sent = true;
		updateSelHint();
	}

	input.value = "";
	autoResize(input);
	setBusy(true);

	addUserMessage(
		text,
		attachments.map((a) => a.name),
	);
	try {
		await streamInto(
			"/api/send",
			{ content, files: attachments },
			addAssistantContainer(),
		);
	} finally {
		setBusy(false);
		input.focus();
	}
}

document.getElementById("send-btn")!.addEventListener("click", sendMessage);
(document.getElementById("input") as HTMLTextAreaElement).addEventListener(
	"keydown",
	(e: KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void sendMessage();
		}
	},
);
(document.getElementById("input") as HTMLTextAreaElement).addEventListener(
	"input",
	function () {
		autoResize(this as HTMLTextAreaElement);
	},
);

document.getElementById("reset-btn")!.addEventListener("click", async () => {
	await fetch("/api/conversation", { method: "DELETE" });
	resetChat();
	selComments.clear();
	updateSelHint();
	clearFiles();
});
