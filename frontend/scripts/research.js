import { API, nodes, edges, loadData, setAppState } from './api.js';
import { showConfirm } from './ui.js';
import { addHistory } from './history.js';

let _activeItem = null;

// ── Notes panel ───────────────────────────────────────────────────────────────

function _showNotesPanel() {
  document.getElementById('research-notes-panel').classList.add('open');
  document.getElementById('research-notes-overlay').classList.add('open');
  document.getElementById('research-tab-notes').classList.add('active');
  _refreshNotesList();
}

function _hideNotesPanel() {
  document.getElementById('research-notes-panel').classList.remove('open');
  document.getElementById('research-notes-overlay').classList.remove('open');
  document.getElementById('research-tab-notes').classList.remove('active');
}

function _refreshNotesList() {
  const list = document.getElementById('rnp-notes-list');
  const items = [...document.querySelectorAll('.research-question-item')];
  if (!items.length) {
    list.innerHTML = '<li class="rnp-placeholder">No questions yet.</li>';
    return;
  }
  list.innerHTML = items.map(item => {
    const qText = item.querySelector('.research-question-text').textContent;
    const meta  = item.querySelector('.research-question-meta').textContent;
    const note  = item._note?.trim() ?? '';
    const cls   = note ? 'rnp-item has-note' : 'rnp-item';
    const noteHtml = note
      ? `<div class="rnp-note-text">${_esc(note)}</div>`
      : `<div class="rnp-no-note">No notes yet — explore this question first.</div>`;
    return `<li class="${cls}" data-id="${item.dataset.id}">
      <div class="rnp-q-text">${_esc(qText)}</div>
      <div class="rnp-q-meta">${_esc(meta)}</div>
      ${noteHtml}
    </li>`;
  }).join('');

  list.querySelectorAll('.rnp-item').forEach(li => {
    li.addEventListener('click', () => {
      const questionItem = document.querySelector(`.research-question-item[data-id="${li.dataset.id}"]`);
      if (questionItem) _explore(questionItem);
    });
  });
}

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

async function _loadQuestions() {
  const list = document.getElementById('research-questions-list');
  list.innerHTML = '<li class="research-q-placeholder">Loading questions…</li>';

  let questions = [];
  try {
    const res = await fetch(`${API}/questions`);
    questions = await res.json();
  } catch {
    list.innerHTML = '<li class="research-q-placeholder" style="color:#f87171">Failed to load questions.</li>';
    return;
  }

  if (!questions.length) {
    list.innerHTML = '<li class="research-q-placeholder">No questions to explore.</li>';
    return;
  }

  // Pre-populate cache from stored answers
  questions.forEach(q => { if (q.answer) q._cached = { answer: q.answer, citations: q.citations }; });

  list.innerHTML = questions.map(q => `
    <li class="research-question-item" data-id="${q.id}">
      <div class="research-question-header">
        <div class="research-question-left">
          <div class="research-question-text">${q.text}</div>
          <div class="research-question-meta">On: ${_targetTitle(q)}</div>
        </div>
        <span class="research-question-chevron">▾</span>
      </div>
      <div class="research-question-dropdown">
        <div class="rq-actions">
          <button class="rq-action-btn" data-action="edit">Edit Question</button>
          <button class="rq-action-btn rq-action-explore" data-action="explore">${q._cached ? 'Continue Exploring' : 'Explore'}</button>
          <button class="rq-action-btn rq-action-danger" data-action="delete">Delete Question</button>
        </div>
      </div>
    </li>
  `).join('');

  list.querySelectorAll('.research-question-item').forEach(item => {
    const q = questions.find(q => q.id === item.dataset.id);
    if (q?._cached) {
      item._answerCache = q._cached;
    }
    item._note = q?.note ?? '';
    _updateItemTint(item);

    item.querySelector('.research-question-header').addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.research-question-item.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });

    item.querySelectorAll('.rq-action-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'explore') _explore(item);
        if (action === 'edit')    _editQuestion(item);
        if (action === 'delete')  _deleteQuestion(item);
      });
    });
  });

  _syncContinueBtn();
}

function _updateItemTint(item) {
  item.classList.remove('explored', 'noted');
  if (item._answerCache) {
    item.classList.add(item._note?.trim() ? 'noted' : 'explored');
  }
}

// ── Answer panel ──────────────────────────────────────────────────────────────

function _esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _exploreBtn(item) {
  return item.querySelector('.rq-action-explore');
}

function _openAnswerPanel(questionText, cached) {
  const panel = document.getElementById('research-answer-panel');
  panel.querySelector('.rap-question-text').textContent = questionText;
  const body = panel.querySelector('.rap-body');
  if (cached) {
    _renderAnswerInPanel(body, cached);
  } else {
    body.innerHTML = '<div class="rap-loading">Exploring…</div>';
  }
  // Load saved note for this question
  document.getElementById('rap-notes-input').value = _activeItem?._note ?? '';
  document.getElementById('rap-notes-save').classList.remove('saved');
  panel.classList.add('open');
  document.getElementById('research-panel-overlay').classList.add('open');
}

function _closeAnswerPanel() {
  document.getElementById('research-answer-panel').classList.remove('open');
  document.getElementById('research-panel-overlay').classList.remove('open');
  // Update the explore button on the item that was open
  if (_activeItem?._answerCache) {
    const btn = _exploreBtn(_activeItem);
    if (btn) btn.textContent = 'Continue Exploring';
  }
}

function _domain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function _renderAnswerInPanel(body, data) {
  const citations = data.citations ?? [];
  const text = data.answer;

  let answerHtml = '';
  if (citations.length) {
    const sorted = [...citations].sort((a, b) => a.start_index - b.start_index);
    let last = 0;
    sorted.forEach((c, i) => {
      if (c.start_index < last) return;
      answerHtml += _esc(text.slice(last, c.start_index));
      answerHtml += `[source: <span class="rap-cite-link" data-idx="${i}">${_esc(_domain(c.url))}</span>]`;
      last = c.end_index;
    });
    answerHtml += _esc(text.slice(last));
  } else {
    answerHtml = _esc(text);
  }

  body.innerHTML = `<div class="rap-answer-text">${answerHtml}</div>`;

  body.querySelectorAll('.rap-cite-link').forEach(el => {
    el.addEventListener('click', () => {
      _showCitationModal(citations[parseInt(el.dataset.idx)]);
    });
  });
}

function _showCitationModal(citation) {
  const modal = document.getElementById('citation-modal');
  const name = citation.title || citation.url;
  document.getElementById('citation-modal-title').textContent = `Open Link To "${name}"?`;
  document.getElementById('citation-modal-url').textContent = citation.url;
  document.getElementById('citation-modal-open').onclick = () => {
    window.open(citation.url, '_blank', 'noopener');
    _closeCitationModal();
  };
  document.getElementById('citation-modal-cancel').onclick = _closeCitationModal;
  modal.style.display = 'flex';
}

function _closeCitationModal() {
  document.getElementById('citation-modal').style.display = 'none';
}

async function _explore(item, force = false) {
  _activeItem = item;
  const questionText = item.querySelector('.research-question-text').textContent;

  // Immediately flip the button text so it's visible through the panel
  const btn = _exploreBtn(item);
  if (btn) btn.textContent = 'Continue Exploring';

  if (!force && item._answerCache) {
    _openAnswerPanel(questionText, item._answerCache);
    return;
  }

  if (!force && item.dataset.exploring === '1') {
    _openAnswerPanel(questionText, null);
    return;
  }

  _openAnswerPanel(questionText, null);
  item.dataset.exploring = '1';

  const panel = document.getElementById('research-answer-panel');
  const body = panel.querySelector('.rap-body');

  try {
    const url = `${API}/questions/${item.dataset.id}/explore${force ? '?force=true' : ''}`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      body.innerHTML = `<div class="rap-error">${err.detail ?? 'Failed to get answer.'}</div>`;
      return;
    }
    const data = await res.json();
    item._answerCache = data;
    _updateItemTint(item);
    _renderAnswerInPanel(body, data);
    addHistory(`Explored: "${questionText}"`, '◎');
  } catch {
    body.innerHTML = '<div class="rap-error">Failed to get answer.</div>';
  } finally {
    delete item.dataset.exploring;
  }
}

function _editQuestion(item) {
  const textEl = item.querySelector('.research-question-text');
  const current = textEl.textContent;

  // Insert ✓ confirm button into the header row (replaces chevron visually)
  const header = item.querySelector('.research-question-header');
  const chevron = item.querySelector('.research-question-chevron');
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'rq-edit-confirm';
  confirmBtn.textContent = '✓';
  chevron.style.display = 'none';
  header.appendChild(confirmBtn);

  textEl.contentEditable = 'true';
  textEl.spellcheck = false;
  const stopClick = e => e.stopPropagation();
  textEl.addEventListener('click', stopClick);
  textEl.focus();
  // Place cursor at end without selecting
  const range = document.createRange();
  range.selectNodeContents(textEl);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const hasChanges = () => textEl.textContent.trim() !== current;

  const updateConfirmStyle = () => confirmBtn.classList.toggle('has-changes', hasChanges());
  textEl.addEventListener('input', updateConfirmStyle);

  const finish = async (accept) => {
    textEl.removeEventListener('input', updateConfirmStyle);
    if (confirmBtn.parentNode) confirmBtn.remove();
    chevron.style.display = '';
    textEl.contentEditable = 'false';
    textEl.removeEventListener('click', stopClick);
    const newText = textEl.textContent.trim();
    if (!accept || !newText || newText === current) { textEl.textContent = current; return; }
    const res = await fetch(`${API}/questions/${item.dataset.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    }).catch(() => null);
    if (res?.ok) {
      textEl.textContent = newText;
      if (item._answerCache) {
        const revertEdit = async () => {
          await fetch(`${API}/questions/${item.dataset.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: current }),
          }).catch(() => null);
          textEl.textContent = current;
        };
        const hasNotes = item._note?.trim();
        const regenMsg = hasNotes
          ? 'Rename this question? Your saved notes will be kept.'
          : 'Rename this question?';
        showConfirm(regenMsg, () => _explore(item, true), {
          okLabel: 'Rename & Regenerate', okClass: 'btn-danger',
          altLabel: 'Rename Only', altClass: 'btn-secondary', onAlt: () => {},
          onCancel: revertEdit,
        });
      }
    } else {
      textEl.textContent = current;
    }
  };

  // mousedown prevents blur so check button click can handle saving directly
  confirmBtn.addEventListener('mousedown', e => e.preventDefault());
  confirmBtn.addEventListener('click', () => finish(hasChanges()));

  textEl.addEventListener('blur', () => {
    if (!hasChanges()) { finish(false); return; }
    showConfirm('Save changes to this question?', () => finish(true), {
      okLabel: 'Save', okClass: 'btn-primary', onCancel: () => finish(false),
    });
  }, { once: true });

  textEl.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); textEl.blur(); }
    if (e.key === 'Escape') { textEl.textContent = current; textEl.blur(); }
  });
}

function _syncContinueBtn() {
  const items = [...document.querySelectorAll('.research-question-item')];
  const allNoted = items.length > 0 && items.every(item => item._note?.trim());
  const wrap = document.getElementById('research-continue-wrap');
  if (allNoted) {
    wrap.removeAttribute('data-blocked');
    wrap.removeAttribute('data-tip');
  } else {
    const remaining = items.filter(item => !item._note?.trim()).length;
    wrap.dataset.blocked = '';
    wrap.dataset.tip = `Take notes on ${remaining} remaining question${remaining === 1 ? '' : 's'} first`;
  }
}

function _deleteQuestion(item) {
  const hasData = item._answerCache || item._note?.trim();
  const msg = hasData
    ? 'Delete this question? Its explored answer and any notes you saved will also be removed.'
    : 'Delete this question?';
  showConfirm(msg, async () => {
    const res = await fetch(`${API}/questions/${item.dataset.id}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok || res?.status === 204) item.remove();
  });
}

async function _doFinishResearch() {
  const btn = document.getElementById('btn-research-continue');
  btn.textContent = 'Updating map…';
  btn.disabled = true;

  const items = [...document.querySelectorAll('.research-question-item')];
  const research_notes = items
    .filter(item => item._note?.trim())
    .map(item => ({
      question:     item.querySelector('.research-question-text').textContent,
      note:         item._note.trim(),
      target_title: item.querySelector('.research-question-meta').textContent.replace(/^On:\s*/, ''),
    }));

  await fetch(`${API}/graph/update-from-research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ research_notes }),
  }).catch(() => {});

  await fetch(`${API}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'SecondOutline' }),
  }).catch(() => {});

  setAppState('SecondOutline');
  await loadData();
  _hideResearch();
}

export function showResearch() {
  const subject = Object.values(nodes).find(n => n.node_type === 'Subject')?.title ?? '';
  const screen = document.getElementById('research-screen');
  document.getElementById('research-subject-title').textContent = subject;
  screen.style.display = 'flex';
  _loadQuestions();
  fetch(`${API}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'FirstResearch' }),
  }).catch(() => {});

  document.getElementById('research-tab-notes').onclick = () => {
    const panel = document.getElementById('research-notes-panel');
    if (panel.classList.contains('open')) _hideNotesPanel();
    else _showNotesPanel();
  };
  document.getElementById('rnp-close-btn').onclick = _hideNotesPanel;
  document.getElementById('research-notes-overlay').onclick = _hideNotesPanel;

  document.getElementById('rap-close-btn').onclick = _closeAnswerPanel;
  document.getElementById('research-panel-overlay').onclick = _closeAnswerPanel;

  document.getElementById('rap-regenerate-btn').onclick = () => {
    if (!_activeItem) return;
    const hasNotes = _activeItem._note?.trim();
    const msg = hasNotes
      ? 'Regenerate the explored answer for this question? Your saved notes will be kept.'
      : 'Regenerate the explored answer for this question?';
    showConfirm(msg, () => _explore(_activeItem, true), { okLabel: 'Regenerate', okClass: 'btn-danger' });
  };

  document.getElementById('rap-notes-save').onclick = async () => {
    if (!_activeItem) return;
    const note = document.getElementById('rap-notes-input').value;
    const res = await fetch(`${API}/questions/${_activeItem.dataset.id}/note`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).catch(() => null);
    if (res?.ok) {
      _activeItem._note = note;
      _updateItemTint(_activeItem);
      _syncContinueBtn();
      if (document.getElementById('research-notes-panel').classList.contains('open')) _refreshNotesList();
      const qText = _activeItem.querySelector('.research-question-text').textContent;
      addHistory(`Noted: "${qText}"`, '✎');
      const saveBtn = document.getElementById('rap-notes-save');
      saveBtn.textContent = 'Saved';
      saveBtn.classList.add('saved');
      setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.classList.remove('saved'); }, 2000);
    }
  };

  document.getElementById('rap-notes-clear').onclick = () => {
    if (!_activeItem || !_activeItem._note?.trim()) return;
    showConfirm('Clear your saved notes for this question?', async () => {
      const res = await fetch(`${API}/questions/${_activeItem.dataset.id}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: '' }),
      }).catch(() => null);
      if (res?.ok) {
        _activeItem._note = '';
        document.getElementById('rap-notes-input').value = '';
        _updateItemTint(_activeItem);
        _syncContinueBtn();
        if (document.getElementById('research-notes-panel').classList.contains('open')) _refreshNotesList();
      }
    }, { okLabel: 'Clear', okClass: 'btn-danger' });
  };

  document.getElementById('btn-research-continue').onclick = () => {
    showConfirm(
      "Your notes will be used to update your idea map. You won't be able to return to this research phase.",
      _doFinishResearch,
      { okLabel: 'Continue', okClass: 'btn-primary' }
    );
  };

  document.getElementById('btn-research-back').onclick = async () => {
    await fetch(`${API}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'FirstOutline' }),
    }).catch(() => {});
    _hideResearch();
  };
}

function _hideResearch() {
  document.getElementById('research-answer-panel').classList.remove('open');
  _hideNotesPanel();
  const screen = document.getElementById('research-screen');
  screen.classList.add('research-exit');
  setTimeout(() => { screen.style.display = 'none'; screen.classList.remove('research-exit'); }, 350);
}
