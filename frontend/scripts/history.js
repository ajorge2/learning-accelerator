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

export function toggleHistoryDrawer() {
  const drawer  = document.getElementById('history-drawer');
  const overlay = document.getElementById('history-overlay');
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open', opening);
  overlay.classList.toggle('open', opening);
  if (opening) _render();
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  _render();
}

export function initHistoryDrawer() {
  _render();
}
