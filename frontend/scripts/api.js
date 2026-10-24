import { renderNodes, renderEdges, showConfirm } from './ui.js';
import { renderGraph } from './graph.js';

export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
// Scope all application requests, including calls in other modules, to this tab.
const SESSION_KEY = 'learning-private-session';
let privateSession = sessionStorage.getItem(SESSION_KEY);
if (!/^[a-f0-9]{64}$/.test(privateSession || '')) {
  privateSession = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(SESSION_KEY, privateSession);
}
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  const base = new URL(API, window.location.href);
  if (url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/'))) {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-Learning-Session', privateSession);
    return nativeFetch(input, {...init, headers});
  }
  return nativeFetch(input, init);
};

export let nodes = {};
export let edges = {};
export let currentState = null;
export const undoStack = [];

export function setAppState(state) {
  if (state !== 'FirstOutline') undoStack.length = 0;
  currentState = state;
  const secondOutline  = state === 'SecondOutline';
  const firstOutline   = state === 'FirstOutline';

  // Questions feature — hidden in SecondOutline
  const questionsTab = document.getElementById('questions-tab');
  const detailQBtn   = document.getElementById('btn-detail-questions');
  const detailQPanel = document.getElementById('detail-questions-panel');
  if (questionsTab) questionsTab.style.display = secondOutline ? 'none' : '';
  if (detailQBtn)   detailQBtn.style.display   = secondOutline ? 'none' : '';
  if (detailQPanel && secondOutline) detailQPanel.style.display = 'none';

  // Reflection tab — only in SecondOutline
  const reflectionTab = document.getElementById('reflection-tab');
  if (reflectionTab) reflectionTab.style.display = secondOutline ? '' : 'none';

  // Add node UI — hidden in FirstOutline; attach stays visible in all states
  const hide = v => v ? 'none' : '';
  document.getElementById('btn-add-idea')?.style.setProperty('display', hide(firstOutline));
  // Regenerate button — only in FirstOutline (disabled state managed by versions.js)
  document.getElementById('btn-regenerate')?.style.setProperty('display', firstOutline ? '' : 'none');
  document.getElementById('canvas-ctx-menu')?.style.setProperty('display', hide(firstOutline));
  const connectBtn = document.querySelector('#connect-pill .btn-connect');
  if (connectBtn) connectBtn.style.display = hide(firstOutline);
  const emptyAddBtn = document.querySelector('#graph-empty button');
  if (emptyAddBtn) emptyAddBtn.style.display = hide(firstOutline);
}

// ---- Algolia ----

const ALGOLIA_INDEX_NAME = 'learning_accelerator';

let _algoliaSearchIdx = null;

export function initAlgolia() { /* Private graphs never enter a shared index. */ }
export function getAlgoliaSearchIdx() { return null; }
export async function syncAlgolia() { /* Intentionally local-only. */ }

// ---- Data ----

export async function loadData() {
  const [nRes, eRes] = await Promise.all([
    fetch(`${API}/nodes`),
    fetch(`${API}/edges`),
  ]);
  nodes = Object.fromEntries((await nRes.json()).map(n => [n.id, n]));
  edges = Object.fromEntries((await eRes.json()).map(e => [e.id, e]));
  renderNodes();
  renderEdges();
  renderGraph();
  syncAlgolia(); // fire-and-forget
}

// ---- Shared API helpers ----

export async function apiRequest(method, url, data, errId = 'modal-error') {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (data !== undefined) opts.body = JSON.stringify(data);
  const res = await fetch(url, opts);
  if (!res.ok) { document.getElementById(errId).textContent = (await res.json()).detail ?? 'Error'; return null; }
  return res.json().catch(() => null);
}

export function confirmDelete(url, msg) {
  showConfirm(msg, async () => { await fetch(url, { method: 'DELETE' }); loadData(); });
}
