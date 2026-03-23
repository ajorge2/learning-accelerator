import { loadData, API, setAppState } from './api.js';
import { addHistory } from './history.js';
import { showTour } from './ui.js';
import { toggleQuestionsDrawer } from './questions.js';

export const FIRST_OUTLINE_TOUR = [
  {
    text: "Take a moment to review every idea and connection on your map. As you click on each, you will have the option to write in any questions you might have — they'll guide what you explore next!",
    pos: { top: '52%', left: '50%', transform: 'translate(-50%, -50%)' },
  },
  {
    text: "As you submit questions, they will populate here in this tab →",
    pos: { top: '52%', right: '80px', transform: 'translateY(-50%)' },
  },
  {
    text: 'Once you feel as if you\'re done with questions, click "Continue" to enter exploration mode!',
    pos: { bottom: '100px', right: '320px' },
    beforeShow: () => {
      const drawer = document.getElementById('questions-drawer');
      if (!drawer.classList.contains('open')) toggleQuestionsDrawer();
    },
  },
];

export function showQuestionnaire(subjectTitle, createFn) {
  const screen = document.getElementById('questionnaire-screen');
  document.getElementById('questionnaire-subject-title').textContent = subjectTitle;
  screen.style.display = 'flex';

  const slider    = document.getElementById('q-importance');
  const sliderVal = document.getElementById('q-importance-value');
  const goalInput = document.getElementById('q-goal');
  const knowInput = document.getElementById('q-knowledge');
  const btn       = document.getElementById('btn-questionnaire-continue');
  const skipBtn   = document.getElementById('btn-questionnaire-skip');
  const pdfBtn    = document.getElementById('btn-upload-pdf');
  const pdfInput  = document.getElementById('q-pdf-input');
  const pdfStatus = document.getElementById('q-pdf-status');

  // reset
  slider.value        = 5;
  sliderVal.textContent = '5';
  goalInput.value     = '';
  knowInput.value     = '';
  pdfStatus.textContent = '';
  btn.disabled        = true;

  const checkEnabled = () => {
    const touched = goalInput.value.trim() || knowInput.value.trim() || slider.value !== '5';
    btn.disabled = !touched;
  };

  slider.oninput    = () => { sliderVal.textContent = slider.value; checkEnabled(); };
  goalInput.oninput = checkEnabled;
  knowInput.oninput = checkEnabled;

  pdfBtn.onclick = () => pdfInput.click();
  pdfInput.onchange = async () => {
    const file = pdfInput.files[0];
    if (!file) return;
    pdfStatus.textContent = 'Reading PDF…';
    pdfBtn.disabled = true;
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('subject', subjectTitle);
      const res = await fetch(`${API}/questionnaire/extract-pdf`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.knowledge) {
        knowInput.value = data.knowledge;
        checkEnabled();
        pdfStatus.textContent = 'Extracted from PDF — feel free to edit.';
      }
    } catch (e) {
      pdfStatus.textContent = 'Failed to read PDF.';
      console.error(e);
    } finally {
      pdfBtn.disabled = false;
      pdfInput.value = '';
    }
  };

  const toast     = document.getElementById('q-toast');
  const allInputs = [goalInput, knowInput, slider];

  const setLoading = (loading, showToast = false) => {
    btn.disabled     = loading;
    skipBtn.disabled = loading;
    allInputs.forEach(el => { el.disabled = loading; });
    toast.textContent = showToast ? 'Generating idea map…' : '';
    toast.classList.toggle('visible', loading && showToast);
  };

  const doSubmit = async (withNotes = false) => {
    const goalVal       = goalInput.value.trim();
    const knowVal       = knowInput.value.trim();
    const importanceVal = parseInt(slider.value, 10);

    setLoading(true, withNotes);
    const err = await createFn();
    if (err) {
      setLoading(false);
      console.error('Subject creation failed:', err);
      return;
    }
    if (withNotes) {
      const res = await fetch(`${API}/graph/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subjectTitle, notes: knowInput.value }),
      });
      const data = await res.json().catch(() => null);
      for (const node of data?.created_nodes ?? []) {
        addHistory(`Added "${node.title}"`, '✦');
      }
    } else {
      await fetch(`${API}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: subjectTitle, node_type: 'Subject' }),
      });
    }
    await fetch(`${API}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'FirstOutline' }),
    });
    setAppState('FirstOutline');
    await loadData();
    _hideQuestionnaire();
    if (withNotes) {
      showTour(FIRST_OUTLINE_TOUR);
    }
    // Fire-and-forget: infer expertise in background (does not block UX)
    fetch(`${API}/expertise/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: subjectTitle,
        goal: goalVal,
        knowledge: knowVal,
        importance: importanceVal,
      }),
    }).catch(() => {});
  };

  btn.onclick     = () => doSubmit(true);
  skipBtn.onclick = () => doSubmit(false);
}

function _hideQuestionnaire() {
  const screen = document.getElementById('questionnaire-screen');
  screen.classList.add('questionnaire-exit');
  setTimeout(() => { screen.style.display = 'none'; screen.classList.remove('questionnaire-exit'); }, 350);
}
