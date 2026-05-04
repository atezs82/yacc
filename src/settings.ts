export function apiFetch(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

document.getElementById('settings-btn')!.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('settings-panel')!.classList.toggle('open');
});

document.addEventListener('click', e => {
  const target = e.target as Element;
  if (!target.closest('#settings-panel') && !target.closest('#settings-btn'))
    document.getElementById('settings-panel')!.classList.remove('open');
});

fetch('/api/status')
  .then(r => r.json() as Promise<{ bin: string }>)
  .then(({ bin }) => { document.getElementById('bin-path')!.textContent = bin; })
  .catch(() => { document.getElementById('bin-path')!.textContent = 'unknown'; });
