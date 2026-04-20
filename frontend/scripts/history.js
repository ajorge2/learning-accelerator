import { getVersions, getCurrentIdx, restoreVersion, canRegenerate, MAX_VERSIONS } from './versions.js';

const HISTORY_KEY = 'editHistory';
const MAX = 30;

export function addHistory(label, icon = '•') {
  const list = getHistory();
  list.unshift({ ts: Date.now(), label, icon });
  if (list.length > MAX) list.length = MAX;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  _render();
}

export function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function _age(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

function _render() {
  const el = document.getElementById('history-list');
  if (!el) return;
  const list = getHistory();
  if (!list.length) {
    el.innerHTML = '<li class="history-empty">No edits yet</li>';
    return;
  }
  el.innerHTML = list.map(e => `
    <li class="history-item">
      <span class="history-icon">${e.icon}</span>
      <span class="history-label">${e.label}</span>
      <span class="history-time">${_age(e.ts)}</span>
    </li>
  `).join('');
}

export function renderVersionHistory() {
  const section = document.getElementById('graph-versions-section');
  if (!section) return;
  const versions = getVersions();
  if (!versions.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const currentIdx = getCurrentIdx();
  const can = canRegenerate();

  section.querySelector('.graph-versions-header').textContent =
    `Graph Versions (${versions.length}/${MAX_VERSIONS})`;

  const list = section.querySelector('.graph-versions-list');
  list.innerHTML = versions.map((v, i) => {
    const isActive  = i === currentIdx;
    const label     = i === 0 ? 'latest' : (i === versions.length - 1 ? 'original' : `v${versions.length - i}`);
    const date      = new Date(v.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<button class="version-pill${isActive ? ' active' : ''}" data-idx="${i}">
      <span class="version-pill-label">Version ${versions.length - i} <span class="version-pill-tag">${label}</span></span>
      <span class="version-pill-time">${date}</span>
    </button>`;
  }).join('');

  list.querySelectorAll('.version-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (idx === currentIdx) return;
      btn.disabled = true;
      await restoreVersion(idx);
      renderVersionHistory();
      // update regenerate button if visible
      const { updateRegenerateBtn } = await import('./versions.js');
      updateRegenerateBtn();
    });
  });

  // remaining-attempts hint
  let hint = section.querySelector('.versions-hint');
  if (!hint) { hint = document.createElement('p'); hint.className = 'versions-hint'; section.appendChild(hint); }
  const remaining = MAX_VERSIONS - versions.length;
  hint.textContent = can
    ? `${remaining} regeneration${remaining !== 1 ? 's' : ''} remaining`
    : (versions.length >= MAX_VERSIONS ? 'No regenerations remaining' : 'Navigate to latest to regenerate');
}

export function toggleHistoryDrawer() {
  const drawer  = document.getElementById('history-drawer');
  const overlay = document.getElementById('history-overlay');
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open', opening);
  overlay.classList.toggle('open', opening);
  if (opening) { _render(); renderVersionHistory(); }
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  _render();
}

export function initHistoryDrawer() {
  _render();
}
