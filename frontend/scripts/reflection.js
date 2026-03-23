import { nodes, edges, API, loadData } from './api.js';
import { showConfirm } from './ui.js';
import { showToast, focusNodeOnly, deselectAll } from './graph.js';

// ---- Connectivity check (undirected BFS from Subject) ----

function _checkConnectivity() {
  const subject = Object.values(nodes).find(n => n.node_type === 'Subject');
  if (!subject) return { unreachable: [] };

  const adj = {};
  Object.values(nodes).forEach(n => { adj[n.id] = []; });
  Object.values(edges).forEach(e => {
    adj[e.node_a_id]?.push(e.node_b_id);
    adj[e.node_b_id]?.push(e.node_a_id);
  });

  const visited = new Set([subject.id]);
  const queue = [subject.id];
  while (queue.length) {
    const curr = queue.shift();
    for (const nb of adj[curr]) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
    }
  }

  return { unreachable: Object.values(nodes).filter(n => !visited.has(n.id)) };
}

// ---- BFS traversal order (undirected, each node once) ----

export function computeReflectionOrder() {
  const subject = Object.values(nodes).find(n => n.node_type === 'Subject');
  if (!subject) return [];

  const adj = {};
  Object.values(nodes).forEach(n => { adj[n.id] = []; });
  Object.values(edges).forEach(e => {
    adj[e.node_a_id]?.push(e.node_b_id);
    adj[e.node_b_id]?.push(e.node_a_id);
  });

  const visited = new Set([subject.id]);
  const order = [subject.id];
  const queue = [subject.id];
  while (queue.length) {
    const curr = queue.shift();
    for (const nb of adj[curr]) {
      if (!visited.has(nb)) { visited.add(nb); order.push(nb); queue.push(nb); }
    }
  }
  return order;
}

// ---- Reflection state ----

let _order     = [];
let _idx       = 0;
let _answers   = JSON.parse(localStorage.getItem('reflection_answers')   || '{}'); // nodeId → string[]
let _questions = JSON.parse(localStorage.getItem('reflection_questions') || '{}'); // nodeId → string[]
let _finalizeMode    = false;
let _storedPatch     = null;
let _storedAddNodes  = null; // filtered add_nodes (duplicates removed)

function _persistAnswers()   { localStorage.setItem('reflection_answers',   JSON.stringify(_answers));   }
function _persistQuestions() { localStorage.setItem('reflection_questions', JSON.stringify(_questions)); }

// ---- Panel content ----

function _immediateNeighbors(nodeId) {
  return Object.values(edges)
    .filter(e => e.node_a_id === nodeId || e.node_b_id === nodeId)
    .map(e => {
      const otherId = e.node_a_id === nodeId ? e.node_b_id : e.node_a_id;
      const dir = e.bidirectional ? '↔' : (e.source_id === nodeId ? '→' : '←');
      return { id: otherId, dir, label: e.body ?? null };
    });
}

async function _renderStep(idx) {
  const panel    = document.getElementById('reflection-panel');
  const content  = document.getElementById('reflection-content');
  const progress = document.getElementById('reflection-progress');
  const nextBtn  = document.getElementById('reflection-next');

  const nodeId    = _order[idx];
  const node      = nodes[nodeId];
  const neighbors = _immediateNeighbors(nodeId);
  const total     = _order.length;

  progress.textContent = `${idx + 1} / ${total}`;
  nextBtn.textContent  = idx === total - 1 ? 'Finish ✓' : 'Next →';
  nextBtn.disabled     = true;
  nextBtn.onclick      = null;

  const neighborRows = neighbors.length
    ? neighbors.map(({ id, dir, label }) => {
        const labelSpan = label ? ` <span class="rp-edge-label">${label}</span>` : '';
        return `<div class="rp-neighbor">${dir} ${nodes[id]?.title ?? id}${labelSpan}</div>`;
      }).join('')
    : '<div class="rp-no-neighbors">No connections</div>';

  content.innerHTML = `
    ${node?.node_type === 'Subject' ? '<span class="detail-subject-badge" style="margin-bottom:8px;">Subject</span>' : ''}
    <h3 class="rp-node-title">${node?.title ?? nodeId}</h3>
    <div class="rp-neighbors-section">
      <div class="rp-neighbors-label">Connected to</div>
      <div class="rp-neighbors-list">${neighborRows}</div>
    </div>
    <div class="rp-questions-loading">Generating questions…</div>
  `;

  // Position panel on first show
  if (!panel.dataset.positioned) {
    const container = document.getElementById('graph-container');
    const PW = 600;
    panel.style.left = Math.max(8, Math.round((container.clientWidth - PW) / 2)) + 'px';
    panel.style.top  = '60px';
    panel.dataset.positioned = '1';
  }
  panel.style.display = '';
  focusNodeOnly(nodeId);

  // Use cached questions if available; otherwise fetch and cache
  let questions = _questions[nodeId] ?? [];
  if (!questions.length) {
    try {
      const res = await fetch(`${API}/reflection/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      });
      if (res.ok) questions = (await res.json()).questions ?? [];
    } catch { /* leave questions empty */ }
    _questions[nodeId] = questions;
    _persistQuestions();
  }

  // Restore saved answers if returning to this node
  const saved = _answers[nodeId] ?? [];

  const questionsHTML = questions.length
    ? questions.map((q, i) => `
        <div class="rp-question-block">
          <p class="rp-question-text">${q}</p>
          <textarea class="rp-answer" data-idx="${i}" placeholder="Your thoughts…" spellcheck="true">${saved[i] ?? ''}</textarea>
        </div>`).join('')
    : '<div class="rp-placeholder">No questions generated.</div>';

  // Replace loading indicator
  content.querySelector('.rp-questions-loading')?.remove();
  const qSection = document.createElement('div');
  qSection.className = 'rp-questions-section';
  qSection.innerHTML = questionsHTML;
  content.appendChild(qSection);

  nextBtn.disabled = false;
}

function _saveCurrentAnswers() {
  const nodeId = _order[_idx];
  if (!nodeId) return;
  const answers = [...document.querySelectorAll('#reflection-content .rp-answer')]
    .map(ta => ta.value);
  if (answers.length) { _answers[nodeId] = answers; _persistAnswers(); }
}

function _doAdvance() {
  if (_idx >= _order.length - 1) {
    _startFinalize();
    return;
  }
  _idx++;
  _renderStep(_idx);
}

function _advance() {
  if (_finalizeMode) {
    _applyChecked();
    return;
  }
  _saveCurrentAnswers();
  _doAdvance();
}

// ---- Finalize: generate patch for the whole graph ----

async function _startFinalize() {
  const content  = document.getElementById('reflection-content');
  const progress = document.getElementById('reflection-progress');
  const nextBtn  = document.getElementById('reflection-next');

  progress.textContent = 'Generating changes…';
  nextBtn.disabled     = true;
  nextBtn.textContent  = 'Analyzing…';
  nextBtn.onclick      = null;

  content.innerHTML = '<div class="rp-questions-loading">Analyzing your answers…</div>';

  // Build qa_by_node from all saved answers+questions
  const qaByNode = _order
    .map(nodeId => ({
      node_id:  nodeId,
      qa_pairs: (_questions[nodeId] ?? [])
        .map((q, i) => ({ question: q, answer: _answers[nodeId]?.[i] ?? '' }))
        .filter(p => p.answer.trim()),
    }))
    .filter(entry => entry.qa_pairs.length > 0);

  let patch = {};
  try {
    const res = await fetch(`${API}/reflection/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qa_by_node: qaByNode }),
    });
    if (res.ok) patch = (await res.json()).patch ?? {};
  } catch { /* leave empty */ }

  _storedPatch  = patch;
  _finalizeMode = true;
  _renderChecklist(patch);
}

// Resolve a value that may be a node ID or a node title to a display title
function _resolveNodeLabel(titleOrId) {
  if (nodes[titleOrId]) return nodes[titleOrId].title;
  const match = Object.values(nodes).find(n => n.title.toLowerCase() === (titleOrId ?? '').toLowerCase());
  return match ? match.title : titleOrId;
}

// Check if a node title already exists in the current graph
function _nodeExists(title) {
  return Object.values(nodes).some(n => n.title.toLowerCase() === (title ?? '').toLowerCase());
}

function _renderChecklist(patch) {
  const content  = document.getElementById('reflection-content');
  const progress = document.getElementById('reflection-progress');
  const nextBtn  = document.getElementById('reflection-next');

  // Separate add_nodes into true adds vs duplicates (already exist → skip)
  const trueAddNodes = (patch.add_nodes ?? []).filter(n => !_nodeExists(n.title));
  _storedAddNodes = trueAddNodes;

  // Build flat item list with stable keys per array index
  const groups = [
    { key: 'add_node',    arr: trueAddNodes,              label: n  => `Add: <strong>${n.title}</strong>${n.body ? ` — <em>${_trunc(n.body)}</em>` : ''}`,              dot: 'add'    },
    { key: 'upd_node',    arr: patch.update_nodes       ?? [], label: n  => `Update: <strong>${nodes[n.id]?.title ?? n.id}</strong>${n.title ? ` → rename to "${n.title}"` : ''}${n.body !== undefined ? ` (update description)` : ''}`, dot: 'update' },
    { key: 'del_node',    arr: patch.delete_nodes       ?? [], label: id => `Remove node: <strong>${nodes[id]?.title ?? id}</strong>`,                                         dot: 'delete' },
    { key: 'add_conn',    arr: patch.add_connections    ?? [], label: c  => `Connect: <strong>${_resolveNodeLabel(c.from)}</strong> ↔ <strong>${_resolveNodeLabel(c.to)}</strong>${c.label ? ` <em>${c.label}</em>` : ''}`, dot: 'add' },
    { key: 'upd_conn',    arr: patch.update_connections ?? [], label: c  => { const e = edges[c.id]; return `Update connection: <strong>${nodes[e?.node_a_id]?.title ?? '?'}</strong> ↔ <strong>${nodes[e?.node_b_id]?.title ?? '?'}</strong>`; }, dot: 'update' },
    { key: 'del_conn',    arr: patch.delete_connections ?? [], label: id => { const e = edges[id]; return `Remove connection: <strong>${nodes[e?.node_a_id]?.title ?? '?'}</strong> ↔ <strong>${nodes[e?.node_b_id]?.title ?? '?'}</strong>`; }, dot: 'delete' },
  ];

  const items = [];
  for (const g of groups) {
    g.arr.forEach((entry, i) => {
      items.push({ key: `${g.key}_${i}`, dot: g.dot, html: g.label(entry) });
    });
  }

  progress.textContent = 'Review changes';

  if (items.length === 0) {
    content.innerHTML = '<div class="rp-placeholder" style="margin-top:12px;">No changes suggested.</div>';
    nextBtn.textContent = 'Done';
    nextBtn.disabled    = false;
    nextBtn.onclick     = () => { _closePanel(); showToast('Reflection complete!'); };
    return;
  }

  const checklistHTML = items.map(item => `
    <label class="rp-review-item">
      <input type="checkbox" class="rp-review-check" data-key="${item.key}" checked>
      <span class="rp-review-dot rp-review-dot--${item.dot}"></span>
      <span class="rp-review-label">${item.html}</span>
    </label>
  `).join('');

  content.innerHTML = `
    <div class="rp-review-section">
      <div class="rp-review-header">
        <span class="rp-suggestions-label">Suggested changes</span>
        <label class="rp-review-toggle-all"><input type="checkbox" id="rp-check-all" checked> Select all</label>
      </div>
      ${checklistHTML}
    </div>
  `;

  document.getElementById('rp-check-all').addEventListener('change', e => {
    document.querySelectorAll('.rp-review-check').forEach(cb => cb.checked = e.target.checked);
    _updateApplyBtn(items.length);
  });
  document.querySelectorAll('.rp-review-check').forEach(cb => {
    cb.addEventListener('change', () => _updateApplyBtn(items.length));
  });

  nextBtn.disabled    = false;
  _updateApplyBtn(items.length);
}

function _updateApplyBtn(total) {
  const nextBtn = document.getElementById('reflection-next');
  const n = document.querySelectorAll('.rp-review-check:checked').length;
  nextBtn.textContent = n === 0 ? 'Skip' : `Apply ${n} change${n !== 1 ? 's' : ''}`;
  nextBtn.disabled = false;
  // sync "select all" checkbox
  const allBox = document.getElementById('rp-check-all');
  if (allBox) allBox.checked = n === total;
}

async function _applyChecked() {
  const nextBtn = document.getElementById('reflection-next');
  const patch   = _storedPatch ?? {};

  const checked = new Set(
    [...document.querySelectorAll('.rp-review-check:checked')].map(cb => cb.dataset.key)
  );

  if (checked.size === 0) {
    _closePanel();
    showToast('Reflection complete!');
    return;
  }

  nextBtn.disabled    = true;
  nextBtn.textContent = 'Applying…';

  const filtered = {};
  const keep = (arr, prefix) => arr?.filter((_, i) => checked.has(`${prefix}_${i}`));

  const addNodes = keep(_storedAddNodes ?? [],     'add_node');    if (addNodes?.length)    filtered.add_nodes          = addNodes;
  const updNodes = keep(patch.update_nodes,       'upd_node');    if (updNodes?.length)    filtered.update_nodes       = updNodes;
  const delNodes = keep(patch.delete_nodes,       'del_node');    if (delNodes?.length)    filtered.delete_nodes       = delNodes;
  const addConns = keep(patch.add_connections,    'add_conn');    if (addConns?.length)    filtered.add_connections    = addConns;
  const updConns = keep(patch.update_connections, 'upd_conn');    if (updConns?.length)    filtered.update_connections = updConns;
  const delConns = keep(patch.delete_connections, 'del_conn');    if (delConns?.length)    filtered.delete_connections = delConns;

  try {
    const res = await fetch(`${API}/graph/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered),
    });
    if (!res.ok) throw new Error(await res.text());
    await loadData();
    _closePanel();
    showToast('Reflection complete!');
  } catch {
    nextBtn.disabled    = false;
    nextBtn.textContent = 'Apply failed — retry';
  }
}

function _trunc(str, max = 60) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function _closePanel() {
  const panel = document.getElementById('reflection-panel');
  panel.style.display = 'none';
  delete panel.dataset.positioned;
  _finalizeMode   = false;
  _storedPatch    = null;
  _storedAddNodes = null;
  deselectAll();
}

// ---- Entry point ----

function _onBeginReflection() {
  const { unreachable } = _checkConnectivity();

  if (unreachable.length > 0) {
    const names = unreachable.map(n => `"${n.title}"`).join(', ');
    const verb  = unreachable.length === 1 ? 'idea is' : 'ideas are';
    showConfirm(
      `${unreachable.length} ${verb} not reachable from your subject: ${names}. Please connect them before beginning reflection.`,
      () => {},
      { okLabel: 'Got it', okClass: 'btn-primary' }
    );
    return;
  }

  // Invalidate cached answers/questions for node IDs that no longer exist
  const validIds = new Set(Object.keys(nodes));
  let dirty = false;
  for (const id of Object.keys(_answers))   { if (!validIds.has(id)) { delete _answers[id];   dirty = true; } }
  for (const id of Object.keys(_questions)) { if (!validIds.has(id)) { delete _questions[id]; dirty = true; } }
  if (dirty) { _persistAnswers(); _persistQuestions(); }

  _finalizeMode = false;
  _storedPatch  = null;
  _order = computeReflectionOrder();
  _idx   = 0;
  _renderStep(0);
}

// ---- Drag ----

function _initDrag(panel) {
  const header = panel.querySelector('.reflection-header');
  let _dragging = false, _ox = 0, _oy = 0;
  header.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _dragging = true;
    _ox = e.clientX - panel.getBoundingClientRect().left;
    _oy = e.clientY - panel.getBoundingClientRect().top;
    header.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!_dragging) return;
    const container = document.getElementById('graph-container');
    const cr = container.getBoundingClientRect();
    const left = Math.max(0, Math.min(e.clientX - cr.left - _ox, container.clientWidth  - panel.offsetWidth));
    const top  = Math.max(0, Math.min(e.clientY - cr.top  - _oy, container.clientHeight - panel.offsetHeight));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  });
  document.addEventListener('mouseup', () => { _dragging = false; header.classList.remove('dragging'); });
}

// ---- Resize ----

function _initResize(panel) {
  const MIN_W = 380, MIN_H = 460;
  let _dir = null, _sx, _sy, _sw, _sh, _pl, _pt;

  panel.querySelectorAll('[class^="detail-resize-"]').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _dir = handle.dataset.dir;
      const r  = panel.getBoundingClientRect();
      const cr = document.getElementById('graph-container').getBoundingClientRect();
      if (!panel.style.height) panel.style.height = r.height + 'px';
      _sx = e.clientX; _sy = e.clientY;
      _sw = r.width;   _sh = r.height;
      _pl = r.left - cr.left;
      _pt = r.top  - cr.top;
      e.preventDefault(); e.stopPropagation();
    });
  });

  document.addEventListener('mousemove', e => {
    if (!_dir) return;
    const container = document.getElementById('graph-container');
    const cw = container.clientWidth, ch = container.clientHeight;
    const dx = e.clientX - _sx, dy = e.clientY - _sy;
    if (_dir === 'r'  || _dir === 'br' || _dir === 'tr') panel.style.width  = Math.max(MIN_W, Math.min(_sw + dx, cw - _pl)) + 'px';
    if (_dir === 'b'  || _dir === 'br' || _dir === 'bl') panel.style.height = Math.max(MIN_H, Math.min(_sh + dy, ch - _pt)) + 'px';
    if (_dir === 'l'  || _dir === 'tl' || _dir === 'bl') {
      const nw = Math.max(MIN_W, Math.min(_sw - dx, _pl + _sw));
      panel.style.width = nw + 'px';
      panel.style.left  = (_pl + _sw - nw) + 'px';
    }
    if (_dir === 't'  || _dir === 'tl' || _dir === 'tr') {
      const nh = Math.max(MIN_H, Math.min(_sh - dy, _pt + _sh));
      panel.style.height = nh + 'px';
      panel.style.top    = (_pt + _sh - nh) + 'px';
    }
  });

  document.addEventListener('mouseup', () => { _dir = null; });
}

// ---- Init ----

// ---- Dev helpers ----

export function devSkipToFinalize() {
  const { unreachable } = _checkConnectivity();
  if (unreachable.length > 0) { console.warn('[reflection] Graph has unreachable nodes'); return; }

  const validIds = new Set(Object.keys(nodes));
  for (const id of Object.keys(_answers))   { if (!validIds.has(id)) delete _answers[id]; }
  for (const id of Object.keys(_questions)) { if (!validIds.has(id)) delete _questions[id]; }

  _finalizeMode = false;
  _storedPatch  = null;
  _order = computeReflectionOrder();
  _idx   = _order.length - 1;

  const panel = document.getElementById('reflection-panel');
  if (!panel.dataset.positioned) {
    const container = document.getElementById('graph-container');
    panel.style.left = Math.max(8, Math.round((container.clientWidth - 600) / 2)) + 'px';
    panel.style.top  = '60px';
    panel.dataset.positioned = '1';
  }
  panel.style.display = '';

  console.log('[reflection] Skipping to finalize with', Object.keys(_answers).length, 'nodes answered');
  _startFinalize();
}

export function initReflection() {
  const panel = document.getElementById('reflection-panel');
  _initDrag(panel);
  _initResize(panel);

  document.getElementById('reflection-tab').addEventListener('click', _onBeginReflection);
  document.getElementById('reflection-close').addEventListener('click', _closePanel);
  document.getElementById('reflection-next').addEventListener('click', _advance);
}
