export interface FileAttachment {
	name: string;
	type: string;
	data: string; // base64
}

const _files: File[] = [];

export function clearFiles(): void {
	_files.length = 0;
	render();
}

export function readFilesAsAttachments(): Promise<FileAttachment[]> {
	return Promise.all(
		_files.map(
			(f) =>
				new Promise<FileAttachment>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const base64 = (reader.result as string).split(",")[1] ?? "";
						resolve({ name: f.name, type: f.type, data: base64 });
					};
					reader.onerror = () => reject(new Error(`Failed to read ${f.name}`));
					reader.readAsDataURL(f);
				}),
		),
	);
}

function render(): void {
	const list = document.getElementById("file-list");
	if (!list) return;
	list.innerHTML = "";
	for (const [i, f] of _files.entries()) {
		list.appendChild(makePill(f, i));
	}
}

function makePill(f: File, idx: number): HTMLElement {
	const pill = document.createElement("div");
	pill.className = "file-pill";

	const name = document.createElement("span");
	name.className = "file-pill-name";
	name.textContent = f.name;
	name.title = f.name;

	const rm = document.createElement("button");
	rm.className = "file-pill-remove";
	rm.setAttribute("aria-label", "Remove file");
	rm.innerHTML = "&times;";
	rm.addEventListener("click", () => {
		_files.splice(idx, 1);
		render();
	});

	pill.appendChild(name);
	pill.appendChild(rm);
	return pill;
}

const fileInput = document.getElementById("file-input") as HTMLInputElement;

document
	.getElementById("attach-btn")
	?.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
	if (!fileInput.files) return;
	for (const f of Array.from(fileInput.files)) _files.push(f);
	fileInput.value = "";
	render();
});
