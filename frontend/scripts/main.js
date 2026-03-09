import { initAlgolia } from './api.js';
import { initGraph, cheeseMode } from './graph.js';
import { initHistoryDrawer, toggleHistoryDrawer } from './history.js';
import { initLanding } from './landing.js';
import './search.js';

initGraph();
initHistoryDrawer();
document.getElementById('btn-cheese').classList.toggle('active', cheeseMode);
initAlgolia();
initLanding();
window.toggleHistoryDrawer = toggleHistoryDrawer;
