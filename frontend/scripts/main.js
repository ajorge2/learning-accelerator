import { initAlgolia, API, nodes, loadData, setAppState } from './api.js';
import { initGraph, cheeseMode } from './graph.js';
import { initHistoryDrawer, toggleHistoryDrawer } from './history.js';
import { initLanding } from './landing.js';
import { FIRST_OUTLINE_TOUR } from './questionnaire.js';
import { showInfo, showTour } from './ui.js';
import { initQuestionsDrawer, toggleQuestionsDrawer } from './questions.js';
import { toggleIdeaTableDrawer } from './ideaTable.js';
import { initReflection, devSkipToFinalize } from './reflection.js';
window.devSkipToFinalize = devSkipToFinalize;
import './search.js';

initGraph();
initHistoryDrawer();
initQuestionsDrawer();
initReflection();
document.getElementById('btn-cheese').classList.toggle('active', cheeseMode);
initAlgolia();
initLanding();
window.toggleHistoryDrawer = toggleHistoryDrawer;
window.toggleQuestionsDrawer = toggleQuestionsDrawer;
window.toggleIdeaTableDrawer = toggleIdeaTableDrawer;
window.showInfo = showInfo;
window.showTour = showTour;
window.FIRST_OUTLINE_TOUR = FIRST_OUTLINE_TOUR;
// ---- Dev helpers ----

const _devPost = (path, body) => fetch(`${API}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => r.json());

const _devSeedGraph = async (subject) => {
  await fetch(`${API}/graph?full=true`, { method: 'DELETE' });
  const subj = await _devPost('/nodes', { title: subject, node_type: 'Subject' });
  const n1   = await _devPost('/nodes', { title: 'Supervised Learning',  body: 'Training a model on labeled data to predict outputs.' });
  const n2   = await _devPost('/nodes', { title: 'Neural Networks',      body: 'Layered computational graphs loosely inspired by the brain.' });
  const n3   = await _devPost('/nodes', { title: 'Gradient Descent',     body: 'Optimization algorithm that minimizes loss by following the gradient.' });
  const n4   = await _devPost('/nodes', { title: 'Overfitting',          body: 'When a model learns training data too well and fails to generalize.' });
  await _devPost('/edges', { node_a_id: subj.id, node_b_id: n1.id });
  await _devPost('/edges', { node_a_id: subj.id, node_b_id: n2.id });
  await _devPost('/edges', { node_a_id: n1.id,   node_b_id: n3.id, body: 'trained via' });
  await _devPost('/edges', { node_a_id: n2.id,   node_b_id: n3.id, body: 'optimized with' });
  await _devPost('/edges', { node_a_id: n1.id,   node_b_id: n4.id });
  return { n1, n2, n3, n4 };
};

// Set state only — uses whatever graph/questions are already in the DB
window.devLoadFirstOutline = async () => {
  await _devPost('/state', { state: 'FirstOutline' });
  setAppState('FirstOutline');
  await loadData();
  console.log('[dev] State → FirstOutline');
};

window.devLoadFirstResearch = async () => {
  await _devPost('/state', { state: 'FirstResearch' });
  setAppState('FirstResearch');
  await loadData();
  const { showResearch } = await import('./research.js');
  showResearch();
  console.log('[dev] State → FirstResearch');
};

window.devLoadSecondOutline = async () => {
  await _devPost('/state', { state: 'SecondOutline' });
  setAppState('SecondOutline');
  await loadData();
  console.log('[dev] State → SecondOutline');
};

// Export current graph + questions to console (copy and save before seeding)
window.devExport = async () => {
  const [nodes, edges, questions, stateRes] = await Promise.all([
    fetch(`${API}/nodes`).then(r => r.json()),
    fetch(`${API}/edges`).then(r => r.json()),
    fetch(`${API}/questions`).then(r => r.json()),
    fetch(`${API}/state`).then(r => r.json()).catch(() => ({})),
  ]);
  const data = { nodes, edges, questions, state: stateRes.state ?? null };
  console.log('[dev] Export (copy this):', JSON.stringify(data));
  return data;
};

// Save current DB state to localStorage under a named snapshot
window.devSaveSnapshot = async (name = 'default') => {
  const data = await window.devExport();
  localStorage.setItem(`devSnapshot_${name}`, JSON.stringify(data));
  console.log(`[dev] Snapshot saved: "${name}" (state: ${data.state})`);
};

// Restore a named snapshot: clears graph, re-creates nodes/edges/questions, sets state
window.devLoadSnapshot = async (name = 'default') => {
  const raw = localStorage.getItem(`devSnapshot_${name}`);
  if (!raw) { console.error(`[dev] No snapshot named "${name}"`); return; }
  const data = JSON.parse(raw);

  await fetch(`${API}/graph?full=true`, { method: 'DELETE' });

  const idMap = {};

  // Re-create nodes (export uses {id, ...})
  for (const n of data.nodes) {
    const res = await _devPost('/nodes', { title: n.title, node_type: n.node_type, body: n.body ?? null });
    idMap[n.id] = res.id;
  }

  // Re-create edges (export uses {id, source_id, ...})
  for (const e of data.edges) {
    const res = await _devPost('/edges', {
      node_a_id:     idMap[e.node_a_id],
      node_b_id:     idMap[e.node_b_id],
      body:          e.body ?? null,
      bidirectional: e.bidirectional ?? true,
      source_id:     e.source_id ? (idMap[e.source_id] ?? null) : null,
    });
    idMap[e.id] = res.id;
  }

  // Re-create questions (text, answer, citations, note)
  for (const q of data.questions) {
    const mappedTarget = idMap[q.target_id] ?? q.target_id;
    const res = await _devPost('/questions', { target_id: mappedTarget, target_type: q.target_type, text: q.text });
    if (q.answer) {
      await fetch(`${API}/questions/${res.id}/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: q.answer, citations: q.citations ?? [] }),
      });
    }
    if (q.note) {
      await fetch(`${API}/questions/${res.id}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: q.note }),
      });
    }
  }

  if (data.state) { await _devPost('/state', { state: data.state }); setAppState(data.state); }
  await loadData();
  if (data.state === 'FirstResearch') {
    const { showResearch } = await import('./research.js');
    showResearch();
  }
  console.log(`[dev] Snapshot restored: "${name}" (state: ${data.state})`);
};

// Seed a blank graph with ML placeholder data, then set state
window.devSeedFirstOutline = async (subject = 'Machine Learning') => {
  await _devSeedGraph(subject);
  await _devPost('/state', { state: 'FirstOutline' });
  await loadData();
  console.log('[dev] Seeded + FirstOutline — subject:', subject);
};

window.devSeedFirstResearch = async (subject = 'Machine Learning') => {
  const { n1, n2, n3 } = await _devSeedGraph(subject);
  await _devPost('/questions', { target_id: n1.id, target_type: 'node', text: 'How does supervised learning differ from reinforcement learning?' });
  await _devPost('/questions', { target_id: n2.id, target_type: 'node', text: 'What makes deep neural networks different from shallow ones?' });
  await _devPost('/questions', { target_id: n3.id, target_type: 'node', text: 'Why does gradient descent sometimes get stuck in local minima?' });
  await _devPost('/state', { state: 'FirstResearch' });
  await loadData();
  const { showResearch } = await import('./research.js');
  showResearch();
  console.log('[dev] Seeded + FirstResearch — subject:', subject);
};

window.inferExpertise = async (opts = {}) => {
  const subject = opts.subject ?? Object.values(nodes).find(n => n.node_type === 'Subject')?.title ?? 'Unknown';
  const saved = await fetch(`${API}/settings`).then(r => r.json()).catch(() => ({}));
  const res = await fetch(`${API}/expertise/infer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject,
      goal:       opts.goal       ?? saved.user_goal       ?? '',
      knowledge:  opts.knowledge  ?? saved.user_knowledge  ?? '',
      importance: opts.importance ?? parseInt(saved.user_importance ?? '5', 10),
    }),
  });
  const result = await res.json();
  console.log('[inferExpertise]', result);
  return result;
};
