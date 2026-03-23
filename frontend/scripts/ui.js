import { nodes, edges, loadData, apiRequest, confirmDelete, API, currentState, undoStack } from './api.js';
import { attachMode, toggleAttachMode } from './graph.js';
import { addHistory } from './history.js';

// ---- Tour callout ----

export function showTour(steps) {
  const callout = document.getElementById('tour-callout');
  const textEl  = document.getElementById('tour-callout-text');
  const btn     = document.getElementById('tour-callout-btn');
  let idx = 0;

  function show() {
    if (idx >= steps.length) {
      callout.style.display = 'none';
      return;
    }
    const step = steps[idx];
    if (step.beforeShow) step.beforeShow();

    textEl.textContent = step.text;
    btn.textContent    = idx < steps.length - 1 ? 'Next →' : 'Got it!';

    // Reset all position props then apply step's
    Object.assign(callout.style, { top: '', left: '', right: '', bottom: '', transform: '', display: 'block' });
    Object.assign(callout.style, step.pos);
  }

  btn.onclick = () => { idx++; show(); };
  show();
}

// ---- Info dialog ----

export function showInfo(message) {
  document.getElementById('info-message').textContent = message;
  const okBtn = document.getElementById('info-ok');
  okBtn.onclick = () => document.getElementById('info-overlay').classList.remove('open');
  document.getElementById('info-overlay').classList.add('open');
}

// ---- Confirm dialog ----

export function showConfirm(message, onConfirm, { okLabel = 'Delete', okClass = 'btn-danger', onCancel = null, altLabel = null, altClass = 'btn-secondary', onAlt = null } = {}) {
  document.getElementById('confirm-message').textContent = message;
  const okBtn     = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  const altBtn    = document.getElementById('confirm-alt');
  okBtn.textContent = okLabel;
  okBtn.className   = okClass;
  okBtn.onclick     = () => { closeConfirm(); onConfirm(); };
  cancelBtn.onclick = () => { closeConfirm(); onCancel?.(); };
  if (altLabel && onAlt) {
    altBtn.textContent = altLabel;
    altBtn.className   = altClass;
    altBtn.onclick     = () => { closeConfirm(); onAlt(); };
    altBtn.style.display = '';
  } else {
    altBtn.style.display = 'none';
  }
  document.getElementById('confirm-overlay').classList.add('open');
}

export function closeConfirm() {
  document.getElementById('confirm-overlay').classList.remove('open');
}

document.getElementById('confirm-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('confirm-overlay')) closeConfirm();
});

// ---- Modal ----

export function openModal(title, bodyHTML, onSubmit) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-submit').onclick = onSubmit;
  document.getElementById('modal-overlay').classList.add('open');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

export function setModalError(msg) {
  document.getElementById('modal-error').textContent = msg;
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ---- Table renders ----

export function renderNodes() {
  const tbody = document.getElementById('nodes-body');
  const list = Object.values(nodes);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty">No ideas yet!</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(n => {
    return `<tr>
      <td>${n.title}</td>
      <td class="cell-actions">
        <button class="btn-edit" onclick="selectNodeById('${n.id}')">View</button>
        <button class="btn-delete" onclick="deleteNode('${n.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

export function renderEdges() {
  const tbody = document.getElementById('edges-body');
  const list = Object.values(edges);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No connections yet!</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(e => {
    const aTitle = nodes[e.node_a_id]?.title ?? e.node_a_id;
    const bTitle = nodes[e.node_b_id]?.title ?? e.node_b_id;
    const typeBadge = e.bidirectional
      ? '<span class="badge badge-bidir">Bidirectional</span>'
      : '<span class="badge badge-dir">Directed</span>';
    const source = e.source_id ? (nodes[e.source_id]?.title ?? e.source_id) : '—';
    return `<tr>
      <td>${aTitle} — ${bTitle}</td>
      <td>${typeBadge}</td>
      <td>${source}</td>
      <td class="cell-actions">
        <button class="btn-edit" onclick="selectEdgeById('${e.id}')">View</button>
        <button class="btn-delete" onclick="deleteEdge('${e.id}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

// ---- Node forms ----

export function nodeFormHTML(node = null) {
  return `
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="f-node-title" value="${node?.title ?? ''}" placeholder="e.g. Calculus" />
    </div>
    <div class="form-group">
      <label>Description <span style="color:#aaa; font-weight:400">(optional)</span></label>
      <textarea id="f-node-body" rows="3" placeholder="Additional notes or description...">${node?.body ?? ''}</textarea>
    </div>
  `;
}

export function connectSectionHTML(prefix, selfOption, nodeList) {
  return `
    <hr class="section-divider">
    <div class="form-group">
      <label>Add connection <span style="color:#aaa; font-weight:400">(optional)</span></label>
      <select id="${prefix}-connect-to">
        <option value="">— None —</option>
        ${nodeList.map(n => `<option value="${n.id}">${n.title}</option>`).join('')}
      </select>
    </div>
    <div id="${prefix}-connect-fields" style="display:none">
      <div class="form-group">
        <label>Relationship <span style="color:#aaa; font-weight:400">(optional)</span></label>
        <input type="text" id="${prefix}-edge-body" placeholder="e.g. prerequisite of" />
      </div>
      <div class="form-group">
        <div class="form-check">
          <input type="checkbox" id="${prefix}-bidirectional" checked />
          <label for="${prefix}-bidirectional">Bidirectional</label>
        </div>
      </div>
      <div class="form-group" id="${prefix}-source-group" style="display:none">
        <label>Source Idea</label>
        <select id="${prefix}-source">
          ${selfOption}
        </select>
      </div>
    </div>
  `;
}

export function wireConnectListeners(prefix, getNodeBTitle) {
  document.getElementById(`${prefix}-connect-to`).addEventListener('change', function () {
    document.getElementById(`${prefix}-connect-fields`).style.display = this.value ? 'block' : 'none';
    if (this.value) updateConnectSourceOpts(prefix, this.value, getNodeBTitle);
  });
  document.getElementById(`${prefix}-bidirectional`).addEventListener('change', function () {
    document.getElementById(`${prefix}-source-group`).style.display = this.checked ? 'none' : 'block';
    if (!this.checked) updateConnectSourceOpts(prefix, document.getElementById(`${prefix}-connect-to`).value, getNodeBTitle);
  });
}

export function updateConnectSourceOpts(prefix, nodeBId, getNodeBTitle) {
  const sourceEl = document.getElementById(`${prefix}-source`);
  const bTitle = getNodeBTitle(nodeBId);
  const bOpt = nodeBId && bTitle ? `<option value="${nodeBId}">${bTitle}</option>` : '';
  sourceEl.innerHTML = sourceEl.querySelector('option[data-self]')?.outerHTML + bOpt;
}

// ---- Node CRUD ----

export function openEditNode(id) {
  const node = nodes[id];
  const otherNodes = Object.values(nodes).filter(n => n.id !== id);
  const hasOthers = otherNodes.length > 0;
  const connectSection = hasOthers
    ? connectSectionHTML('en', `<option value="${id}" data-self>${node.title}</option>`, otherNodes)
    : '';

  openModal('Edit Idea', nodeFormHTML(node) + connectSection, async () => {
    const title = document.getElementById('f-node-title').value.trim();
    const body  = document.getElementById('f-node-body').value.trim() || null;
    if (!title) return setModalError('Title is required.');

    const connectTo = document.getElementById('en-connect-to')?.value || '';
    const edgeBody  = document.getElementById('en-edge-body')?.value.trim() || '';

    if (!await apiRequest('PATCH', `${API}/nodes/${id}`, { title, body })) return;

    if (connectTo) {
      const bidirectional = document.getElementById('en-bidirectional').checked;
      const source_id = bidirectional ? null : document.getElementById('en-source').value;
      if (!await apiRequest('POST', `${API}/edges`, { body: edgeBody, node_a_id: id, node_b_id: connectTo, bidirectional, source_id })) return;
    }

    closeModal();
    loadData();
  });

  if (hasOthers) {
    wireConnectListeners('en', nodeBId => nodes[nodeBId]?.title);
  }
}

export function deleteNode(id) {
  const title = nodes[id]?.title ?? id;
  showConfirm(`Delete "${title}"? Its connections will also be deleted.`, async () => {
    if (currentState === 'FirstOutline') {
      const nodeEdges = Object.values(edges).filter(e => e.node_a_id === id || e.node_b_id === id);
      undoStack.push({ type: 'delete-node', node: { ...nodes[id] }, edges: nodeEdges.map(e => ({ ...e })) });
    }
    await fetch(`${API}/nodes/${id}`, { method: 'DELETE' });
    addHistory(`Deleted "${title}"`, '✕');
    loadData();
  });
}

// ---- Edge forms ----

export function nodeOptions(selectedId = null) {
  return Object.values(nodes)
    .map(n => `<option value="${n.id}" ${n.id === selectedId ? 'selected' : ''}>${n.title}</option>`)
    .join('');
}

export function edgeFormHTML(edge = null) {
  const directed = edge ? !edge.bidirectional : false;
  return `
    <div class="form-group">
      <label>Description <span style="color:#aaa; font-weight:400">(optional)</span></label>
      <input type="text" id="f-edge-body" value="${edge?.body ?? ''}" placeholder="e.g. prerequisite of" />
    </div>
    <div class="form-group">
      <label>Idea A</label>
      <select id="f-node-a" onchange="handleNodeSelect(this)" data-prev="${edge?.node_a_id ?? ''}">
        <option value="" disabled ${edge ? '' : 'selected'}>Select an idea...</option>
        ${nodeOptions(edge?.node_a_id)}
        <option value="__new__">+ Create new idea</option>
      </select>
    </div>
    <div class="form-group">
      <label>Idea B</label>
      <select id="f-node-b" onchange="handleNodeSelect(this)" data-prev="${edge?.node_b_id ?? ''}">
        <option value="" disabled ${edge ? '' : 'selected'}>Select an idea...</option>
        ${nodeOptions(edge?.node_b_id)}
        <option value="__new__">+ Create new idea</option>
      </select>
    </div>
    <div class="form-group">
      <div class="form-check">
        <input type="checkbox" id="f-bidirectional" ${directed ? '' : 'checked'} onchange="toggleSourceField()" />
        <label for="f-bidirectional">Bidirectional</label>
      </div>
    </div>
    <div class="form-group" id="source-group" style="display:${directed ? 'block' : 'none'}">
      <label>Source Idea</label>
      <select id="f-source">${pairOptions(edge?.node_a_id, edge?.node_b_id, edge?.source_id)}</select>
    </div>
  `;
}

export function pairOptions(node_a_id, node_b_id, selectedId = null) {
  return [node_a_id, node_b_id]
    .filter(id => id && nodes[id])
    .map(id => `<option value="${id}" ${id === selectedId ? 'selected' : ''}>${nodes[id].title}</option>`)
    .join('');
}

export function updateSourceOptions() {
  const node_a_id = document.getElementById('f-node-a').value;
  const node_b_id = document.getElementById('f-node-b').value;
  const current = document.getElementById('f-source')?.value;
  document.getElementById('f-source').innerHTML = pairOptions(node_a_id, node_b_id, current);
}

export function toggleSourceField() {
  const bidir = document.getElementById('f-bidirectional').checked;
  document.getElementById('source-group').style.display = bidir ? 'none' : 'block';
}

export function handleNodeSelect(select) {
  if (select.value === '__new__') {
    _subModalTarget = select.id;
    _subModalPrevValue = select.dataset.prev ?? '';
    openSubModal();
  } else {
    select.dataset.prev = select.value;
    updateSourceOptions();
  }
}

let _subModalTarget = null;
let _subModalPrevValue = null;

function openSubModal() {
  document.getElementById('sub-modal-body').innerHTML = nodeFormHTML();
  document.getElementById('sub-modal-error').textContent = '';
  document.getElementById('sub-modal-overlay').classList.add('open');
}

export function closeSubModal() {
  if (_subModalTarget) {
    const sel = document.getElementById(_subModalTarget);
    if (sel) {
      const fallback = [...sel.options].find(o => o.value !== '__new__')?.value ?? '';
      sel.value = _subModalPrevValue || fallback;
      updateSourceOptions();
    }
  }
  _subModalTarget = null;
  _subModalPrevValue = null;
  document.getElementById('sub-modal-overlay').classList.remove('open');
}

export async function submitSubModalNode() {
  const title = document.getElementById('f-node-title').value.trim();
  const body  = document.getElementById('f-node-body').value.trim() || null;
  if (!title) {
    document.getElementById('sub-modal-error').textContent = 'Title is required.';
    return;
  }
  const newNode = await apiRequest('POST', `${API}/nodes`, { title, body }, 'sub-modal-error');
  if (!newNode) return;
  nodes[newNode.id] = newNode;

  const insertNewOpt = (sel) => {
    const o = document.createElement('option');
    o.value = newNode.id;
    o.textContent = newNode.title;
    sel.insertBefore(o, sel.querySelector('option[value="__new__"]'));
  };
  insertNewOpt(document.getElementById('f-node-a'));
  insertNewOpt(document.getElementById('f-node-b'));

  const targetSel = document.getElementById(_subModalTarget);
  targetSel.value = newNode.id;
  targetSel.dataset.prev = newNode.id;

  updateSourceOptions();
  _subModalTarget = null;
  _subModalPrevValue = null;
  document.getElementById('sub-modal-overlay').classList.remove('open');
}

// ---- Edge CRUD ----

export function openEdgeModal(id = null) {
  const edge = id ? edges[id] : null;
  openModal(id ? 'Edit Connection' : 'Add Connection', edgeFormHTML(edge), async () => {
    const body          = document.getElementById('f-edge-body').value.trim() || '';
    const node_a_id     = document.getElementById('f-node-a').value;
    const node_b_id     = document.getElementById('f-node-b').value;
    const bidirectional = document.getElementById('f-bidirectional').checked;
    const source_id     = bidirectional ? null : document.getElementById('f-source').value;

    if (!node_a_id || node_a_id === '__new__') return setModalError('Please select or create Idea A.');
    if (!node_b_id || node_b_id === '__new__') return setModalError('Please select or create Idea B.');
    if (node_a_id === node_b_id) return setModalError('Idea A and Idea B must be different.');

    const payload = id
      ? { body, node_a_id: node_a_id !== edge.node_a_id ? node_a_id : null, node_b_id: node_b_id !== edge.node_b_id ? node_b_id : null, bidirectional, source_id }
      : { body, node_a_id, node_b_id, bidirectional, source_id };
    if (!await apiRequest(id ? 'PATCH' : 'POST', id ? `${API}/edges/${id}` : `${API}/edges`, payload)) return;
    closeModal(); loadData();
  });
}

export function deleteEdge(id) {
  const e = edges[id];
  const label = e ? `"${nodes[e.node_a_id]?.title}"–"${nodes[e.node_b_id]?.title}"` : 'connection';
  showConfirm(`Delete connection?`, async () => {
    if (currentState === 'FirstOutline' && e) {
      undoStack.push({ type: 'delete-edge', edge: { ...e } });
    }
    await fetch(`${API}/edges/${id}`, { method: 'DELETE' });
    addHistory(`Deleted connection ${label}`, '✕');
    loadData();
  });
}

export function clearGraph() {
  showConfirm('Clear the entire graph? This will delete all ideas and connections and cannot be undone.', async () => {
    await fetch(`${API}/graph`, { method: 'DELETE' });
    if (attachMode) toggleAttachMode();
    loadData();
  });
}

// ---- View Toggle ----

export function switchView(view) {
  document.getElementById('graph-section').style.display  = view === 'graph' ? '' : 'none';
  document.getElementById('table-scroll-wrap').style.display = view === 'table' ? '' : 'none';
  document.getElementById('toggle-graph').classList.toggle('active', view === 'graph');
  document.getElementById('toggle-table').classList.toggle('active', view === 'table');
  if (view === 'table') _initScrollFade();
}

function _initScrollFade() {
  const wrap = document.getElementById('table-scroll-wrap');
  const scroller = document.getElementById('table-sections');
  const update = () => {
    const atStart = scroller.scrollLeft <= 4;
    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
    wrap.style.setProperty('--fade-l', atStart ? '0' : '1');
    wrap.style.setProperty('--fade-r', atEnd ? '0' : '1');
  };
  scroller.addEventListener('scroll', update, { passive: true });
  update();
}

// ---- Window exports (for inline HTML handlers) ----

Object.assign(window, {
  switchView, clearGraph,
  closeModal, closeConfirm, closeSubModal, submitSubModalNode,
  openEditNode, deleteNode, openEdgeModal, deleteEdge,
  handleNodeSelect, toggleSourceField,
});
