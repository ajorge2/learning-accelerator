import { loadData } from './api.js';

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

  // reset
  slider.value        = 5;
  sliderVal.textContent = '5';
  goalInput.value     = '';
  knowInput.value     = '';
  btn.disabled        = true;

  const checkEnabled = () => {
    const touched = goalInput.value.trim() || knowInput.value.trim() || slider.value !== '5';
    btn.disabled = !touched;
  };

  slider.oninput    = () => { sliderVal.textContent = slider.value; checkEnabled(); };
  goalInput.oninput = checkEnabled;
  knowInput.oninput = checkEnabled;

  const doSubmit = async () => {
    btn.disabled = true;
    skipBtn.disabled = true;
    const err = await createFn();
    if (err) {
      btn.disabled = false;
      skipBtn.disabled = false;
      console.error('Subject creation failed:', err);
      return;
    }
    loadData();
    _hideQuestionnaire();
  };

  btn.onclick     = doSubmit;
  skipBtn.onclick = doSubmit;
}

function _hideQuestionnaire() {
  const screen = document.getElementById('questionnaire-screen');
  screen.classList.add('questionnaire-exit');
  setTimeout(() => { screen.style.display = 'none'; screen.classList.remove('questionnaire-exit'); }, 350);
}
