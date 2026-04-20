import { API, loadData, setAppState } from './api.js';
import { showConfirm } from './ui.js';
import { showQuestionnaire } from './questionnaire.js';
import { clearHistory } from './history.js';
import { showResearch } from './research.js';

async function _restoreState() {
  const res = await fetch(`${API}/state`).catch(() => null);
  if (!res?.ok) return;
  const { state } = await res.json();
  setAppState(state);
  if (state === 'FirstResearch') showResearch();
}

export async function initLanding() {
  const screen = document.getElementById('landing-screen');

  if (sessionStorage.getItem('sessionStarted')) {
    await loadData();
    screen.classList.add('landing-exit');
    setTimeout(() => { screen.style.display = 'none'; }, 350);
    _restoreState();
    return;
  }

  const res = await fetch(`${API}/nodes`);
  const existing = await res.json();
  const hasData = existing.length > 0;

  document.getElementById('btn-new-subject-toggle').style.display = '';

  if (hasData) {
    const subject = existing.find(n => n.node_type === 'Subject');
    if (subject) document.getElementById('landing-subject-title').textContent = subject.title;
    document.getElementById('landing-continue-section').style.display = '';
    document.getElementById('landing-or').style.display = '';
  }

  document.getElementById('btn-continue').addEventListener('click', async () => {
    sessionStorage.setItem('sessionStarted', '1');
    await loadData();
    _hideLanding();
    _restoreState();
  });

  document.getElementById('btn-new-subject-toggle').addEventListener('click', () => {
    document.getElementById('new-subject-form').classList.add('visible');
    document.getElementById('subject-input').focus();
  });

  const doShowQuestionnaire = () => {
    const title = document.getElementById('subject-input').value.trim();
    const err   = document.getElementById('landing-error');
    if (!title) { err.textContent = 'Please enter a subject name.'; return; }
    err.textContent = '';

    _hideLanding();
    showQuestionnaire(title, async () => {
      clearHistory();
      await fetch(`${API}/graph?full=true`, { method: 'DELETE' });
      sessionStorage.setItem('sessionStarted', '1');
      return null;
    });
  };

  const confirmAndShow = () => {
    if (!document.getElementById('subject-input').value.trim()) { doShowQuestionnaire(); return; }
    if (hasData) {
      showConfirm(
        'Starting a new subject will delete your entire current graph. This cannot be undone.',
        doShowQuestionnaire,
        { okLabel: 'Start New', okClass: 'btn-danger' }
      );
    } else {
      doShowQuestionnaire();
    }
  };

  document.getElementById('btn-create-subject').addEventListener('click', confirmAndShow);
  document.getElementById('subject-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAndShow();
  });
}

function _hideLanding() {
  const screen = document.getElementById('landing-screen');
  screen.classList.add('landing-exit');
  setTimeout(() => { screen.style.display = 'none'; }, 350);
}
