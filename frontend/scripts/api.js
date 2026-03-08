import algoliasearch from 'algoliasearch';
import { renderNodes, renderEdges, showConfirm } from './ui.js';
import { renderGraph } from './graph.js';

export const API = 'http://localhost:8000';
export let nodes = {};
export let edges = {};

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
    await _algoliaWriteIdx.replaceAllObjects(records, { safe: true });
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
