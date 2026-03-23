import { API, nodes, edges } from './api.js';
import { setReturnToQuestions } from './graph.js';
import { showResearch } from './research.js';

function _targetTitle(q) {
  if (q.target_type === 'node') {
    const n = nodes[q.target_id];
    return n ? n.title : q.target_id;
  }
  if (q.target_type === 'edge') {
    const e = edges[q.target_id];
    if (e) {
      const a = nodes[e.node_a_id]?.title ?? '?';
      const b = nodes[e.node_b_id]?.title ?? '?';
      return e.bidirectional ? `${a} ↔ ${b}` : `${a} → ${b}`;
    }
    return q.target_id;
  }
  return q.target_id;
}

async function _render() {
  const list = document.getElementById('questions-list');
  if (!list) return;

  list.innerHTML = '<li class="questions-loading">Loading…</li>';

  let questions = [];
  try {
    const res = await fetch(`${API}/questions`);
    questions = await res.json();
  } catch {
    list.innerHTML = '<li class="questions-empty">Failed to load.</li>';
    return;
  }

  if (!questions.length) {
    list.innerHTML = '<li class="questions-empty">No questions yet</li>';
    return;
  }

  list.innerHTML = questions.map(q => `
    <li class="questions-item" data-id="${q.id}" data-target-id="${q.target_id}" data-target-type="${q.target_type}" style="cursor:pointer;">
      <span class="questions-text">${q.text}</span>
      <span class="questions-target">On: ${_targetTitle(q)}</span>
    </li>
  `).join('');

  list.querySelectorAll('.questions-item').forEach(item => {
    item.addEventListener('click', () => {
      const targetId   = item.dataset.targetId;
      const targetType = item.dataset.targetType;
      toggleQuestionsDrawer();
      setReturnToQuestions();
      // wait for drawer close animation before selecting
      setTimeout(() => {
        if (targetType === 'node') window.selectNodeById?.(targetId);
        else                       window.selectEdgeById?.(targetId);
      }, 280);
    });
  });
}

export function toggleQuestionsDrawer() {
  const drawer  = document.getElementById('questions-drawer');
  const overlay = document.getElementById('questions-overlay');
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open', opening);
  overlay.classList.toggle('open', opening);
  if (opening) _render();
}

export function initQuestionsDrawer() {
  document.getElementById('btn-questions-continue').addEventListener('click', () => {
    toggleQuestionsDrawer();
    showResearch();
  });
}
