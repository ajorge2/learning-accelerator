import { nodes, edges, loadData, API } from './api.js';

const VERSIONS_KEY   = 'graphVersions';
const GEN_PARAMS_KEY = 'graphGenParams';
export const MAX_VERSIONS = 3;

export function getVersions() {
  try { return JSON.parse(localStorage.getItem(VERSIONS_KEY)) || []; }
  catch { return []; }
}

export function getCurrentIdx() {
  return parseInt(localStorage.getItem('graphVersionIdx') ?? '0', 10);
}

export function setCurrentIdx(idx) {
  localStorage.setItem('graphVersionIdx', String(idx));
}

export function saveGenParams(subject, notes, goal = '', importance = 5) {
  localStorage.setItem(GEN_PARAMS_KEY, JSON.stringify({ subject, notes, goal, importance }));
}

export function getGenParams() {
  try { return JSON.parse(localStorage.getItem(GEN_PARAMS_KEY)) || {}; }
  catch { return {}; }
}

export function clearVersions() {
  localStorage.removeItem(VERSIONS_KEY);
  localStorage.removeItem('graphVersionIdx');
}

/** Snapshot the current graph state and push it as the newest version. */
export function pushSnapshot() {
  const versions = getVersions();
  const snap = {
    nodes: Object.values(nodes).filter(n => n.node_type !== 'Subject'),
    edges: Object.values(edges),
    ts: Date.now(),
  };
  versions.unshift(snap);
  if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
  localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  setCurrentIdx(0);
}

/** Returns true if the user can still regenerate (on latest, under limit). */
export function canRegenerate() {
  const versions = getVersions();
  return versions.length > 0 && versions.length < MAX_VERSIONS && getCurrentIdx() === 0;
}

/** Regenerates the graph via LLM, pushes a new snapshot. */
export async function regenerate() {
  const { subject, notes, goal, importance } = getGenParams();
  if (!subject) return false;
  const res = await fetch(`${API}/graph/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, notes: notes || '', goal: goal || '', importance: importance ?? 5 }),
  });
  if (!res.ok) return false;
  await loadData();
  pushSnapshot();
  return true;
}

/** Restores a previously saved version by index (0 = newest). */
export async function restoreVersion(idx) {
  const versions = getVersions();
  const snap = versions[idx];
  if (!snap) return false;
  const res = await fetch(`${API}/graph/restore-version`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: snap.nodes, edges: snap.edges }),
  });
  if (!res.ok) return false;
  await loadData();
  setCurrentIdx(idx);
  return true;
}

/** Updates the regenerate toolbar button state. */
export function updateRegenerateBtn() {
  const btn = document.getElementById('btn-regenerate');
  if (!btn) return;
  const versions = getVersions();
  if (versions.length === 0) {
    btn.style.display = 'none';
    return;
  }
  // visibility controlled by setAppState; just manage disabled + label here
  const can = canRegenerate();
  btn.disabled = !can;
  const remaining = MAX_VERSIONS - versions.length;
  btn.title = can
    ? `Generate a new version (${remaining} attempt${remaining !== 1 ? 's' : ''} left)`
    : (getCurrentIdx() > 0 ? 'Navigate to latest version to regenerate' : 'No regenerations remaining');
}
