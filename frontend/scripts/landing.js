import { API, loadData } from './api.js';
import { showConfirm } from './ui.js';
import { showQuestionnaire } from './questionnaire.js';
import { clearHistory } from './history.js';

export async function initLanding() {
  const screen = document.getElementById('landing-screen');

  if (sessionStorage.getItem('sessionStarted')) {
    loadData();
    setTimeout(() => {
      screen.classList.add('landing-exit');
      setTimeout(() => { screen.style.display = 'none'; }, 350);
    }, 1000);
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

  document.getElementById('btn-continue').addEventListener('click', () => {
    sessionStorage.setItem('sessionStarted', '1');
    loadData();
    _hideLanding();
  });

  document.getElementById('btn-new-subject-toggle').addEventListener('click', () => {
    document.getElementById('new-subject-form').style.display = '';
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
      const nodeRes = await fetch(`${API}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, node_type: 'Subject' }),
      });
      if (!nodeRes.ok) {
        return (await nodeRes.json()).detail ?? 'Something went wrong.';
      }
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
