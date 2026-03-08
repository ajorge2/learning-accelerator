import { initAlgolia, loadData } from './api.js';
import { initGraph, cheeseMode } from './graph.js';
import './search.js';

initGraph();
document.getElementById('btn-cheese').classList.toggle('active', cheeseMode);
initAlgolia();
loadData();
