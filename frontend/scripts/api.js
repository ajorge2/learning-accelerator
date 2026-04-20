import algoliasearch from 'algoliasearch';
import { renderNodes, renderEdges, showConfirm } from './ui.js';
import { renderGraph } from './graph.js';

export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
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

let _algoliaWriteIdx  = null;
let _algoliaSearchIdx = null;

export function initAlgolia() {
  const appId     = import.meta.env.VITE_ALGOLIA_APP_ID;
  const writeKey  = import.meta.env.VITE_ALGOLIA_WRITE_KEY;
  const searchKey = import.meta.env.VITE_ALGOLIA_SEARCH_KEY;
  if (!writeKey || writeKey.startsWith('YOUR_')) return;
  _algoliaWriteIdx  = algoliasearch(appId, writeKey).initIndex(ALGOLIA_INDEX_NAME);
  _algoliaSearchIdx = algoliasearch(appId, searchKey).initIndex(ALGOLIA_INDEX_NAME);
  _algoliaWriteIdx.setSettings({
    searchableAttributes: ['title', 'body', 'nodeATitle', 'nodeBTitle'],
    attributesForFaceting: ['type'],
  }).catch(() => {});
}

export function getAlgoliaSearchIdx() {
  return _algoliaSearchIdx;
}

export async function syncAlgolia() {
  if (!_algoliaWriteIdx) return;
  const records = [
    ...Object.values(nodes).map(n => ({
      objectID:  `node_${n.id}`,
      type:      'node',
      title:     n.title || '',
      body:      n.body  || '',
      nodeId:    n.id,
    })),
    ...Object.values(edges).map(e => ({
      objectID:   `edge_${e.id}`,
      type:       'edge',
      body:       e.body || '',
      nodeATitle: nodes[e.node_a_id]?.title || '',
      nodeBTitle: nodes[e.node_b_id]?.title || '',
      edgeId:     e.id,
      nodeAId:    e.node_a_id,
      nodeBId:    e.node_b_id,
    })),
  ];
  try {
    await _algoliaWriteIdx.replaceAllObjects(records);
  } catch (err) {
    console.error('Algolia sync failed:', err);
  }
}

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
