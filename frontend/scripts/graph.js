import * as d3 from 'd3';
import { nodes, edges, loadData, apiRequest, API, currentState, undoStack } from './api.js';
import { showConfirm, openEditNode, deleteNode, openEdgeModal, deleteEdge } from './ui.js';
import { addHistory } from './history.js';

const NODE_R         = 14;  // base SVG radius of every node circle
const HOVER_VISUAL_R = 17;  // screen-pixel radius a hovered node grows to

// Node palette (HSL): fill/hover/selected/stroke derived automatically per hue.
const NODE_PALETTE = [
  // Default
  { name: 'Pearl',       h: 40,  s: 18,  l: 90 },  // index 0 — default for new nodes
  // Blues & teals
  { name: 'Blue',        h: 215, s: 48,  l: 40 },
  { name: 'Sky',         h: 198, s: 52,  l: 40 },
  { name: 'Electric',    h: 220, s: 100, l: 52 },
  { name: 'Neon Cyan',   h: 188, s: 100, l: 46 },
  { name: 'Ice',         h: 196, s: 72,  l: 72 },
  { name: 'Glacier',     h: 200, s: 60,  l: 58 },
  { name: 'Seafoam',     h: 172, s: 36,  l: 38 },
  { name: 'Teal',        h: 184, s: 42,  l: 28 },
  { name: 'Pulsar',      h: 185, s: 65,  l: 36 },
  { name: 'Abyss',       h: 220, s: 45,  l: 18 },
  // Greens
  { name: 'Sage',        h: 145, s: 32,  l: 38 },
  { name: 'Forest',      h: 145, s: 38,  l: 22 },
  { name: 'Neon Green',  h: 140, s: 100, l: 42 },
  { name: 'Acid',        h: 80,  s: 100, l: 42 },
  { name: 'Biolum',      h: 165, s: 80,  l: 38 },
  { name: 'Aurora',      h: 160, s: 65,  l: 40 },
  { name: 'Moss',        h: 120, s: 28,  l: 30 },
  // Purples & pinks
  { name: 'Lavender',    h: 262, s: 30,  l: 48 },
  { name: 'Vaporwave',   h: 280, s: 50,  l: 58 },
  { name: 'Plum',        h: 292, s: 24,  l: 40 },
  { name: 'Violet',      h: 270, s: 40,  l: 28 },
  { name: 'Synthwave',   h: 285, s: 65,  l: 42 },
  { name: 'Nebula',      h: 248, s: 48,  l: 36 },
  { name: 'Cosmos',      h: 230, s: 35,  l: 20 },
  { name: 'Magenta',     h: 300, s: 70,  l: 46 },
  { name: 'Neon Pink',   h: 320, s: 100, l: 52 },
  { name: 'Hot Pink',    h: 340, s: 80,  l: 52 },
  { name: 'Rose',        h: 338, s: 36,  l: 46 },
  { name: 'Crimson',     h: 350, s: 45,  l: 28 },
  { name: 'Infrared',    h: 4,   s: 72,  l: 38 },
  // Warm tones
  { name: 'Terra',       h: 14,  s: 40,  l: 40 },
  { name: 'Rust',        h: 14,  s: 50,  l: 26 },
  { name: 'Ember',       h: 8,   s: 65,  l: 36 },
  { name: 'Molten',      h: 12,  s: 80,  l: 42 },
  { name: 'Copper',      h: 20,  s: 55,  l: 44 },
  { name: 'Nova',        h: 25,  s: 75,  l: 45 },
  { name: 'Sand',        h: 34,  s: 42,  l: 42 },
  { name: 'Umber',       h: 28,  s: 32,  l: 24 },
  { name: 'Amber',       h: 38,  s: 90,  l: 48 },
  { name: 'Gold',        h: 46,  s: 48,  l: 42 },
  { name: 'Solar',       h: 45,  s: 85,  l: 52 },
  // Neutrals
  { name: 'Chrome',      h: 205, s: 15,  l: 52 },
  { name: 'Mist',        h: 210, s: 20,  l: 65 },
  { name: 'Slate',       h: 215, s: 16,  l: 36 },
  { name: 'Steel',       h: 215, s: 10,  l: 28 },
  { name: 'Graphite',    h: 220, s: 6,   l: 30 },
  { name: 'Charcoal',    h: 220, s: 8,   l: 20 },
  { name: 'Stone',       h: 30,  s: 8,   l: 32 },
  { name: 'Ash',         h: 30,  s: 4,   l: 24 },
];

// Edge palette: derived from NODE_PALETTE, brightened for visibility as thin lines.
const EDGE_PALETTE = NODE_PALETTE.map(({ name, h, s, l }) => ({
  name,
  color: `hsla(${h},${Math.min(100, s + 15)}%,${Math.min(95, l + 22)}%,0.9)`,
}));

function nodeColorVars(colorIdx) {
  const { h, s, l } = NODE_PALETTE[colorIdx ?? 0];
  const light = l >= 70;
  const sd = light ? -1 : 1;
  return {
    '--node-fill':       `hsla(${h},${s}%,${l}%,0.9)`,
    '--node-hover':      `hsla(${h},${s + 6}%,${Math.min(97, l + 8 * sd)}%,0.95)`,
    '--node-sel':        `hsla(${h},${s + 10}%,${Math.min(97, l + 6 * sd)}%,0.97)`,
    '--node-stroke':     `hsla(${h},${s + 8}%,${l - 20 * sd}%,1)`,
    '--node-sel-stroke': `hsla(${h},${s + 12}%,${l - 30 * sd}%,1)`,
  };
}

function hoveredNodeR() {
  const raw = Math.max(baseNodeR(hoveredNodeId), HOVER_VISUAL_R / currentK);
  const inFocusOther = focusDistances && hoveredNodeId !== selectedId;
  return inFocusOther ? Math.min(raw, Math.round(NODE_R * 0.65)) : Math.max(raw, NODE_R);
}

let simulation    = null;
let svgRoot       = null;
let gZoom         = null;
let zoomBehavior  = null;
let graphW = 800, graphH = 600;
let selectedId    = null;
let _selectedBranchKey = null;
const _branchColors = new Map(); // branchKey → colorIdx (independent of individual edge colors)
let _yEdgeIndex  = new Map(); // edgeId → branchKey — updated each tick, read by edge hover handlers
let _yBranchLabel = new Map(); // branchKey → isFirst edgeId (the one whose label sits on the stem)
let _orbDataCache = []; // last computed orb data — reused when simulation is settled
let selectedType  = null;  // 'node' | 'edge'
let hoveredNodeId = null;
let focusDistances = null;
let savedZoom = null;
let isolatedNodes = null;
let _deepFocusActive = false;
let _returnToQuestionsDrawer = false;
let savedZoomIsolation = null;
let _pendingNodePos = null;
let multiSelected = new Set();
let selectionListOrder = [];
export let lassoMode = 'rect';
export let floatMode = true;
const _edgeBends = new Map(); // edge_id -> { offset, vel }  — only for parallel pairs
let _bendSettled = true;
let _bendAnimId  = null;
let _palettePointerdown = null;
const SIM_STORAGE_KEY = 'nodeSimData';
let nodeSimData = (() => {
  try { return JSON.parse(localStorage.getItem(SIM_STORAGE_KEY)) || {}; } catch { return {}; }
})();
export let cheeseMode = localStorage.getItem('cheeseMode') === '1';
let _edgePanelOpen = false;
let _saveSimTimer = null;
function saveSimData() {
  clearTimeout(_saveSimTimer);
  _saveSimTimer = setTimeout(() => {
    try { localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(nodeSimData)); } catch {}
  }, 500);
}
let currentK = 1;

function makeBoundaryForce() {
  const ml = -NODE_R * 4, mr = -NODE_R * 4;
  const mt = -NODE_R * 2, mb = -NODE_R * 5;
  return function(alpha) {
    for (const n of simulation.nodes()) {
      if (n.x < ml)              n.vx += (ml - n.x)              * alpha * 0.1;
      if (n.x > graphW - mr)     n.vx -= (n.x - (graphW - mr))   * alpha * 0.1;
      if (n.y < mt)              n.vy += (mt - n.y)              * alpha * 0.1;
      if (n.y > graphH - mb)     n.vy -= (n.y - (graphH - mb))   * alpha * 0.1;
    }
  };
}

function computeDistances(fromId) {
  const links = simulation.force('link').links();
  const dist = { [fromId]: 0 };
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of links) {
      const nb = e.source.id === cur ? e.target.id : (e.target.id === cur ? e.source.id : null);
      if (nb != null && dist[nb] === undefined) {
        dist[nb] = dist[cur] + 1;
        queue.push(nb);
      }
    }
  }
  return dist;
}

function baseNodeR(id) {
  if (!focusDistances) return NODE_R;
  const dist = focusDistances[id];
  if (dist === undefined || dist === 0) return NODE_R;
  return Math.max(5, Math.round(NODE_R * Math.pow(0.45, dist)));
}

function applyFocusView() {
  if (!gZoom) return;
  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 800;
  const H = 600;
  const inFocus = focusDistances !== null;

  const distOpacity = dist => inFocus ? (dist === undefined ? 0 : Math.max(0.12, 1 - dist * 0.25)) : 1;
  gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
    const dist = focusDistances ? focusDistances[d.id] : 0;
    const hidden = inFocus && dist === undefined;
    d3.select(this).transition().duration(480)
      .style('opacity', distOpacity(dist))
      .style('pointer-events', hidden ? 'none' : null);
    if (!hidden && d.id !== hoveredNodeId) {
      const r = baseNodeR(d.id);
      d3.select(this).select('path').transition().duration(300).attr('transform', r === NODE_R ? null : `scale(${r / NODE_R})`);
    }
  });

  gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
    const srcDist = focusDistances ? focusDistances[d.source.id] : 0;
    const tgtDist = focusDistances ? focusDistances[d.target.id] : 0;
    const hidden = inFocus && (srcDist === undefined || tgtDist === undefined);
    const opacity = hidden ? 0 : distOpacity(Math.max(srcDist ?? 0, tgtDist ?? 0));
    d3.select(this).transition().duration(480)
      .style('opacity', inFocus ? opacity : null)
      .style('pointer-events', hidden ? 'none' : null);
  });

  if (inFocus && selectedId) {
    const selNode = simulation.nodes().find(n => n.id === selectedId);
    if (selNode) {
      selNode.fx = selNode.x;
      selNode.fy = selNode.y;
      const sx = selNode.x, sy = selNode.y;
      simulation.force('x', d3.forceX(d => (focusDistances[d.id] > 0) ? sx : W / 2)
        .strength(d => (focusDistances[d.id] > 0) ? 0.12 : 0.03));
      simulation.force('y', d3.forceY(d => (focusDistances[d.id] > 0) ? sy : H / 2)
        .strength(d => (focusDistances[d.id] > 0) ? 0.12 : 0.03));
      simulation.force('link').distance(() => 80);
    }
    simulation.velocityDecay(0.78);
  } else {
    if (!floatMode) simulation.nodes().forEach(n => { n.fx = n.x; n.fy = n.y; });
    else { simulation.nodes().forEach(n => { n.fx = null; n.fy = null; }); _pinSubjectTop(); }
    simulation.force('x', null).force('y', null);
    simulation.force('boundary', makeBoundaryForce());
    simulation.force('link').distance(d => {
      const h = String(d.id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
      return 180 + Math.abs(h % 200);
    });
    simulation.velocityDecay(0.4);
  }
  if (floatMode) {
    simulation.alpha(0.5).alphaDecay(0.007).restart();
  } else {
    simulation.stop();
    ticked();
  }
  updateVisualScales();
  _syncGraphOptionsBtn();
  if (isolatedNodes !== null) applyIsolationView();
}

let _vsRafId = null;
function _scheduleVisualScales() {
  if (_vsRafId !== null) return; // already queued for next frame
  _vsRafId = requestAnimationFrame(() => { _vsRafId = null; updateVisualScales(); });
}

function updateVisualScales() {
  if (!gZoom) return;

  gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
    if (d.id === hoveredNodeId) {
      const r = hoveredNodeR();
      d3.select(this).select('path').attr('transform', `scale(${r / NODE_R})`);
    }
  });

  const labelFontPx = Math.max(9, 10 / currentK);
  const labelY = -(NODE_R + 5 / currentK);
  gZoom.select('.nodes-layer').selectAll('.g-node text')
    .style('font-size', labelFontPx + 'px')
    .attr('y', labelY);

  gZoom.select('.labels-layer').selectAll('.edge-label')
    .style('font-size', (10 / currentK) + 'px');

  svgRoot.select('#arrow')
    .attr('markerWidth', 12 / currentK)
    .attr('markerHeight', 8.5 / currentK);

  gZoom.select('.branch-orbs-layer').selectAll('.branch-orb-circle')
    .attr('r', 3.5 / currentK);
}

export function zoomIn()  { svgRoot.transition().duration(420).call(zoomBehavior.scaleBy, 1.5); }
export function zoomOut() { svgRoot.transition().duration(420).call(zoomBehavior.scaleBy, 1 / 1.5); }

export function zoomToNode(id) {
  const pos = nodeSimData[id];
  if (!pos || !zoomBehavior) return;
  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 800;
  const H = 600;
  const targetK = Math.max(currentK, 4);
  svgRoot.transition().duration(1400).ease(d3.easeQuadInOut).call(
    zoomBehavior.transform,
    d3.zoomIdentity
      .translate(W / 2, H / 2)
      .scale(targetK)
      .translate(-pos.x, -pos.y)
  );
}

function zoomToEdge(id) {
  if (!zoomBehavior) return;
  const link = simulation.force('link').links().find(e => e.id === id);
  if (!link) return;
  const sx = link.source.x ?? 0, sy = link.source.y ?? 0;
  const tx = link.target.x ?? 0, ty = link.target.y ?? 0;
  const mx = (sx + tx) / 2, my = (sy + ty) / 2;
  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 800;
  const H = 600;
  const pad = 140;
  const fitK = Math.min(W / (Math.abs(tx - sx) + pad), H / (Math.abs(ty - sy) + pad));
  const targetK = Math.max(currentK, Math.min(fitK, 4));
  svgRoot.transition().duration(1400).ease(d3.easeQuadInOut).call(
    zoomBehavior.transform,
    d3.zoomIdentity
      .translate(W / 2, H / 2)
      .scale(targetK)
      .translate(-mx, -my)
  );
}

function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function setLassoMode(mode) {
  lassoMode = mode;
  document.querySelectorAll('#lasso-filter .lasso-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

export function openLassoFilter() {
  document.getElementById('btn-lasso-type').classList.add('lasso-hidden');
  const filter = document.getElementById('lasso-filter');
  filter.classList.add('open');
  filter.querySelectorAll('.lasso-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === lassoMode);
  });
}

export function closeLassoFilter() {
  document.getElementById('lasso-filter').classList.remove('open');
  document.getElementById('btn-lasso-type').classList.remove('lasso-hidden');
}

export function openGraphOptions() {
  document.getElementById('btn-graph-options').classList.add('lasso-hidden');
  document.getElementById('graph-options-menu').classList.add('open');
}

export function closeGraphOptions() {
  document.getElementById('graph-options-menu').classList.remove('open');
  if (!attachMode && !isolatedNodes && focusDistances === null && !_deepFocusActive)
    document.getElementById('btn-graph-options').classList.remove('lasso-hidden');
}

function _syncGraphOptionsBtn() {
  const inNormalView = !attachMode && !isolatedNodes && focusDistances === null && !_deepFocusActive;
  // Add Idea visible in normal, attach, and isolation; hidden in focus/deep focus/edge panel
  const showToolbar  = focusDistances === null && !_deepFocusActive && !_edgePanelOpen;
  // Attach + lasso hidden in focus mode or when edge panel is open
  const hideFocusCtrl = focusDistances !== null || _deepFocusActive || _edgePanelOpen;

  const graphOptBtn = document.getElementById('btn-graph-options');
  if (graphOptBtn) {
    if (inNormalView && !_edgePanelOpen) {
      graphOptBtn.classList.remove('lasso-hidden');
    } else {
      graphOptBtn.classList.add('lasso-hidden');
      document.getElementById('graph-options-menu').classList.remove('open');
    }
  }
  document.getElementById('btn-add-idea')?.classList.toggle('lasso-hidden', !showToolbar || _edgePanelOpen);
  document.getElementById('btn-attach')?.classList.toggle('lasso-hidden', hideFocusCtrl);
  document.getElementById('btn-lasso-type')?.classList.toggle('lasso-hidden', hideFocusCtrl);
}

function _pinSubjectTop() {
  // Pin the subject's y near the very top of the allowed space (boundary mt = -NODE_R*2 ≈ -28).
  // fx stays null so it can drift horizontally.
  const subjectNode = simulation.nodes().find(n => n.node_type === 'Subject');
  if (subjectNode) subjectNode.fy = -10;
}

export function toggleFloatMode() {
  floatMode = !floatMode;
  const btn = document.getElementById('btn-float-toggle');
  if (btn) { btn.textContent = floatMode ? '⟡ Float: On' : '⟡ Float: Off'; btn.classList.toggle('float-off', !floatMode); }
  if (floatMode) {
    if (_bendAnimId !== null) { cancelAnimationFrame(_bendAnimId); _bendAnimId = null; }
    simulation.nodes().forEach(n => { n.fx = null; n.fy = null; });
    _pinSubjectTop();
    simulation.alpha(0.3).restart(); // simulation drives ticked()
  } else {
    simulation.nodes().forEach(n => { n.fx = n.x; n.fy = n.y; n.vx = 0; n.vy = 0; });
    simulation.stop();
    _startBendAnim();
  }
}

export function initGraph() {
  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 800;
  const H = 600;

  svgRoot = d3.select('#graph-svg');

  const defs = svgRoot.append('defs');
  defs.append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -3.5 10 7')
    .attr('refX', 0)
    .attr('refY', 0)
    .attr('markerUnits', 'userSpaceOnUse')
    .attr('markerWidth', 12)
    .attr('markerHeight', 8.5)
    .attr('orient', 'auto')
    .append('path')
      .attr('d', 'M0,-3.5L10,0L0,3.5')
      .attr('fill', 'context-stroke');

  const gridPat = defs.append('pattern')
    .attr('id', 'grid-pattern')
    .attr('width', 40).attr('height', 40)
    .attr('patternUnits', 'userSpaceOnUse');
  gridPat.append('path')
    .attr('d', 'M 40 0 L 0 0 0 40')
    .attr('fill', 'none')
    .attr('stroke', '#2a2a2e')
    .attr('stroke-width', 1);

  const halo = defs.append('filter')
    .attr('id', 'wc-halo')
    .attr('x', '-40%').attr('y', '-40%')
    .attr('width', '180%').attr('height', '180%');
  halo.append('feTurbulence')
    .attr('type', 'fractalNoise').attr('baseFrequency', '0.042').attr('numOctaves', 2)
    .attr('seed', 7).attr('result', 'cheese-noise');
  halo.append('feColorMatrix')
    .attr('in', 'cheese-noise').attr('type', 'matrix')
    .attr('values', '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .35 .3 .2 .3 -.45')
    .attr('result', 'cheese-color');
  halo.append('feComposite')
    .attr('in', 'cheese-color').attr('in2', 'SourceGraphic')
    .attr('operator', 'in').attr('result', 'cheese-masked');
  halo.append('feBlend')
    .attr('in', 'SourceGraphic').attr('in2', 'cheese-masked')
    .attr('mode', 'screen').attr('result', 'textured');
  halo.append('feGaussianBlur').attr('in', 'textured').attr('stdDeviation', 1.5).attr('result', 'blur');
  halo.append('feComponentTransfer').attr('in', 'blur').attr('result', 'halo-fade')
    .append('feFuncA').attr('type', 'linear').attr('slope', '0.28');
  const hm = halo.append('feMerge');
  hm.append('feMergeNode').attr('in', 'halo-fade');
  hm.append('feMergeNode').attr('in', 'textured');

  // Lantern glow filter for selected edges — bright core + layered bloom
  const edgeGlow = defs.append('filter')
    .attr('id', 'edge-glow')
    .attr('x', '-300%').attr('y', '-300%')
    .attr('width', '700%').attr('height', '700%');
  edgeGlow.append('feGaussianBlur')
    .attr('in', 'SourceGraphic').attr('stdDeviation', '2.5').attr('result', 'blur-inner');
  edgeGlow.append('feGaussianBlur')
    .attr('in', 'SourceGraphic').attr('stdDeviation', '7').attr('result', 'blur-mid');
  edgeGlow.append('feGaussianBlur')
    .attr('in', 'SourceGraphic').attr('stdDeviation', '18').attr('result', 'blur-outer');
  edgeGlow.append('feComponentTransfer').attr('in', 'blur-outer').attr('result', 'bloom')
    .append('feFuncA').attr('type', 'linear').attr('slope', '0.35');
  edgeGlow.append('feComponentTransfer').attr('in', 'blur-mid').attr('result', 'mid-glow')
    .append('feFuncA').attr('type', 'linear').attr('slope', '0.65');
  const egm = edgeGlow.append('feMerge');
  egm.append('feMergeNode').attr('in', 'bloom');
  egm.append('feMergeNode').attr('in', 'mid-glow');
  egm.append('feMergeNode').attr('in', 'blur-inner');
  egm.append('feMergeNode').attr('in', 'SourceGraphic');

  const grain = defs.append('filter')
    .attr('id', 'paper-grain')
    .attr('x', '0%').attr('y', '0%')
    .attr('width', '100%').attr('height', '100%')
    .attr('color-interpolation-filters', 'sRGB');
  grain.append('feTurbulence')
    .attr('type', 'fractalNoise')
    .attr('baseFrequency', '0.45')
    .attr('numOctaves', '10')
    .attr('stitchTiles', 'stitch')
    .attr('result', 'noise');
  grain.append('feColorMatrix')
    .attr('type', 'saturate').attr('values', '0').attr('in', 'noise');

  svgRoot.append('rect')
    .attr('id', 'grid-bg')
    .attr('width', '100%').attr('height', '100%')
    .attr('fill', 'url(#grid-pattern)');

  svgRoot.append('rect')
    .attr('id', 'paper-texture')
    .attr('width', '100%').attr('height', '100%')
    .attr('filter', 'url(#paper-grain)')
    .style('opacity', '0.1')
    .style('mix-blend-mode', 'screen')
    .style('pointer-events', 'none');

  gZoom = svgRoot.append('g').attr('class', 'zoom-layer');
  gZoom.append('g').attr('class', 'edges-layer');
  gZoom.append('g').attr('class', 'branch-orbs-layer');
  gZoom.append('g').attr('class', 'nodes-layer');
  gZoom.append('g').attr('class', 'labels-layer');

  const PAD = 600;
  zoomBehavior = d3.zoom()
    .filter(e => (e.type === 'wheel') || (!e.shiftKey && !e.button && !e.ctrlKey))
    .scaleExtent([0.4, 4])
    .translateExtent([[-PAD, -PAD], [W + PAD, H + PAD]])
    .on('zoom', e => {
      gZoom.attr('transform', e.transform);
      svgRoot.select('#grid-pattern').attr('patternTransform', e.transform);
      currentK = e.transform.k;
      _scheduleVisualScales();
      const slider = document.getElementById('zoom-slider');
      if (slider && document.activeElement !== slider) slider.value = e.transform.k;
      _cullNodeLabels();
    });
  svgRoot.call(zoomBehavior);

  document.getElementById('zoom-slider')?.addEventListener('input', function() {
    svgRoot.transition().duration(0).call(zoomBehavior.scaleTo, +this.value);
  });

  let _panVx = 0, _panVy = 0, _panPrevX = 0, _panPrevY = 0;
  let _inertiaRaf = null, _isPanning = false, _inertiaActive = false;
  zoomBehavior
    .on('start.inertia', e => {
      if (e.sourceEvent?.type !== 'mousedown') return;
      if (_inertiaRaf) { cancelAnimationFrame(_inertiaRaf); _inertiaActive = false; }
      _isPanning = true;
      _panVx = 0; _panVy = 0;
      _panPrevX = e.transform.x; _panPrevY = e.transform.y;
    })
    .on('zoom.inertia', e => {
      if (!_isPanning) return;
      _panVx = e.transform.x - _panPrevX;
      _panVy = e.transform.y - _panPrevY;
      _panPrevX = e.transform.x; _panPrevY = e.transform.y;
    })
    .on('end.inertia', e => {
      if (!_isPanning) return;
      _isPanning = false;
      const speed = Math.sqrt(_panVx * _panVx + _panVy * _panVy);
      if (speed < 0.5) return;
      _inertiaActive = true;
      let vx = _panVx, vy = _panVy;
      const decay = 0.95;
      (function frame() {
        if (!_inertiaActive) return;
        vx *= decay; vy *= decay;
        if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) { _inertiaActive = false; return; }
        svgRoot.call(zoomBehavior.translateBy, vx, vy);
        _inertiaRaf = requestAnimationFrame(frame);
      })();
    });

  let _wheelPrevK = 1, _wheelKv = 1;
  let _wheelInertiaRaf = null, _wheelStopTimer = null;
  zoomBehavior.on('zoom.wheelinertia', e => {
    if (e.sourceEvent?.type !== 'wheel') return;
    if (_wheelInertiaRaf) { cancelAnimationFrame(_wheelInertiaRaf); _wheelInertiaRaf = null; }
    _wheelKv = currentK / _wheelPrevK;
    _wheelPrevK = currentK;
    clearTimeout(_wheelStopTimer);
    _wheelStopTimer = setTimeout(() => {
      let kv = _wheelKv;
      const decay = 0.78;
      (function frame() {
        kv = 1 + (kv - 1) * decay;
        if (Math.abs(kv - 1) < 0.0003) return;
        svgRoot.call(zoomBehavior.scaleBy, kv);
        _wheelInertiaRaf = requestAnimationFrame(frame);
      })();
    }, 50);
  });

  svgRoot.on('dblclick.zoom', null);

  let _suppressClick = false;
  const ctxMenu = document.getElementById('canvas-ctx-menu');
  svgRoot.on('click', e => {
    if (_suppressClick) { _suppressClick = false; return; }
    ctxMenu.style.display = 'none';
    if (document.getElementById('attach-result').classList.contains('visible')) {
      showPillError('attach-result-error', 'attach-desc-input'); return;
    }
    if (document.getElementById('node-result').classList.contains('visible')) {
      showPillError('node-result-error', 'node-title-input'); return;
    }
    if (attachMode && _attachSource) {
      clearTimeout(_clearSourceTimer);
      _clearSourceTimer = setTimeout(clearAttachSource, 280);
      return;
    }
    if (e.target === svgRoot.node() || e.target.id === 'grid-bg') {
      if (isolatedNodes !== null) return;
      deselectAll();
    }
  });

  svgRoot.on('mousemove.attach', e => {
    if (!attachMode || !_attachSource) return;
    const [mx, my] = d3.pointer(e, gZoom.node());
    let ghost = gZoom.select('.attach-ghost');
    if (ghost.empty() && !_ghostHidden) {
      ghost = gZoom.append('line')
        .attr('class', 'attach-ghost')
        .attr('marker-end', 'url(#arrow)')
        .attr('stroke-width', 2 / currentK)
        .attr('stroke-dasharray', `${8 / currentK} ${4 / currentK}`);
    }
    if (!ghost.empty()) {
      const tip = _ghostTipPos() ?? { x: mx, y: my };
      ghost.attr('x1', _attachSource.x ?? 0).attr('y1', _attachSource.y ?? 0)
           .attr('x2', tip.x).attr('y2', tip.y);
    }
    const hit = findNodeAt(mx, my, _attachSource.id);
    gZoom.select('.nodes-layer').selectAll('.g-node').classed('attach-highlight', n => n === hit);
    _updateAutoPan(e.clientX, e.clientY);
  });

  svgRoot.on('mouseleave.attach', () => { _stopAutoPan(); });

  svgRoot.on('dblclick', e => {
    if (e.target !== svgRoot.node() && e.target.id !== 'grid-bg') return;
    if (currentState === 'FirstOutline') return;
    clearTimeout(_clearSourceTimer);
    const tr = d3.zoomTransform(svgRoot.node());
    const rect = svgRoot.node().getBoundingClientRect();
    const simX = (e.clientX - rect.left - tr.x) / tr.k;
    const simY = (e.clientY - rect.top  - tr.y) / tr.k;
    ctxMenu.dataset.simX = simX;
    ctxMenu.dataset.simY = simY;
    const containerRect = document.getElementById('graph-container').getBoundingClientRect();
    ctxMenu.style.left = (e.clientX - containerRect.left) + 'px';
    ctxMenu.style.top  = (e.clientY - containerRect.top)  + 'px';
    ctxMenu.style.display = 'block';
  });

  document.getElementById('canvas-ctx-add').onclick = async () => {
    ctxMenu.style.display = 'none';
    if (_nodeResultStack.length >= 10) return;
    const simX = parseFloat(ctxMenu.dataset.simX);
    const simY = parseFloat(ctxMenu.dataset.simY);
    const res = await fetch(`${API}/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Idea', body: null }),
    });
    if (!res.ok) return;
    const newNode = await res.json();
    _pendingNodePos = { id: newNode.id, x: simX, y: simY };
    if (attachMode && _attachSource) {
      const sourceId = _attachSource.id;
      _pendingTargetNodeId = newNode.id;
      _nodeResultOnEnter = async (newNodeId) => {
        await createEdgeDirect(sourceId, newNodeId, false);
      };
    } else if (attachMode) {
      _nodeResultOnEnter = async (newNodeId) => {
        enterAttachFrom(newNodeId);
      };
    }
    await loadData();
    if (isolatedNodes !== null) {
      isolatedNodes.add(newNode.id);
      applyIsolationView();
    }
    showNodeResult(newNode.id);
  };

  svgRoot.on('mousedown.lasso', e => {
    if (attachMode) return;
    if (!e.shiftKey) return;
    if (e.target !== svgRoot.node() && e.target.id !== 'grid-bg') return;
    e.preventDefault();

    const x0 = e.clientX, y0 = e.clientY;
    const containerEl = document.getElementById('graph-container');
    const containerRect = containerEl.getBoundingClientRect();

    const finishSelection = (testFn) => {
      _suppressClick = true;
      gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
        const hidden = focusDistances && focusDistances[d.id] === undefined;
        if (hidden) return;
        const nb = this.getBoundingClientRect();
        const cx = nb.left + nb.width / 2, cy = nb.top + nb.height / 2;
        if (testFn(cx, cy)) {
          multiSelected.add(d.id);
          if (!selectionListOrder.includes(d.id)) selectionListOrder.push(d.id);
        }
      });
      if (multiSelected.size > 0 && selectedId) {
        selectedId = null; selectedType = null; focusDistances = null;
        document.getElementById('graph-detail-panel').style.display = 'none';
        applyFocusView();
      }
      refreshSelectionClasses();
    };

    if (lassoMode === 'rect') {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'absolute', border: '1.5px dashed #fbbf24',
        background: 'rgba(251,191,36,0.08)', pointerEvents: 'none', zIndex: '99',
      });
      containerEl.appendChild(overlay);
      const onMove = (mv) => {
        overlay.style.left   = Math.min(x0, mv.clientX) - containerRect.left + 'px';
        overlay.style.top    = Math.min(y0, mv.clientY) - containerRect.top  + 'px';
        overlay.style.width  = Math.abs(mv.clientX - x0) + 'px';
        overlay.style.height = Math.abs(mv.clientY - y0) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const lassoBox = overlay.getBoundingClientRect();
        overlay.remove();
        if (lassoBox.width > 4 || lassoBox.height > 4) {
          finishSelection((cx, cy) =>
            cx >= lassoBox.left && cx <= lassoBox.right &&
            cy >= lassoBox.top  && cy <= lassoBox.bottom);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

    } else {
      // Freeform lasso — fill appears only when mouse returns near start
      const CLOSE_R = 22;
      const points = [[x0, y0]];
      let curX = x0, curY = y0;

      const lassoSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.assign(lassoSvg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '99' });

      const fillPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      fillPoly.setAttribute('fill', 'rgba(251,191,36,0.10)');
      fillPoly.setAttribute('stroke', 'none');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#fbbf24');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '5,3');
      line.setAttribute('stroke-linecap', 'round');
      const closeSeg = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      closeSeg.setAttribute('stroke', 'rgba(251,191,36,0.3)');
      closeSeg.setAttribute('stroke-width', '1');
      closeSeg.setAttribute('stroke-dasharray', '3,4');

      lassoSvg.appendChild(fillPoly);
      lassoSvg.appendChild(closeSeg);
      lassoSvg.appendChild(line);
      containerEl.appendChild(lassoSvg);

      const toLocal = ([cx, cy]) => `${cx - containerRect.left},${cy - containerRect.top}`;
      const ptStr = () => points.map(toLocal).join(' ');

      const redraw = () => {
        const dx = curX - x0, dy = curY - y0;
        const nearStart = points.length > 4 && dx * dx + dy * dy < CLOSE_R * CLOSE_R;
        line.setAttribute('points', nearStart ? ptStr() : ptStr() + ' ' + toLocal([curX, curY]));
        if (nearStart) {
          fillPoly.setAttribute('points', ptStr());
          fillPoly.style.display = '';
          closeSeg.style.display = 'none';
        } else {
          fillPoly.style.display = 'none';
          closeSeg.setAttribute('x1', curX - containerRect.left);
          closeSeg.setAttribute('y1', curY - containerRect.top);
          closeSeg.setAttribute('x2', x0 - containerRect.left);
          closeSeg.setAttribute('y2', y0 - containerRect.top);
          closeSeg.style.display = '';
        }
      };

      const onMove = (mv) => {
        curX = mv.clientX; curY = mv.clientY;
        const last = points[points.length - 1];
        const dx = curX - last[0], dy = curY - last[1];
        if (dx * dx + dy * dy >= 25) points.push([curX, curY]);
        redraw();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        lassoSvg.remove();
        if (points.length > 3) finishSelection((cx, cy) => pointInPolygon(cx, cy, points));
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  });

  simulation = d3.forceSimulation()
    .force('link',    d3.forceLink().id(d => d.id).distance(d => {
      const h = String(d.id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
      return 180 + Math.abs(h % 200);
    }))
    .force('charge',   d3.forceManyBody().strength(-650).distanceMin(NODE_R))
    .force('collide',  d3.forceCollide(NODE_R * 2.2).strength(0.25))
    .force('boundary', makeBoundaryForce())
    .force('subjectY', d3.forceY(d => d.node_type === 'Subject' ? -10 : graphH * 0.72)
      .strength(d => d.node_type === 'Subject' ? 0.25 : 0.06))
    .force('subjectX', d3.forceX(graphW * 0.5)
      .strength(d => d.node_type === 'Subject' ? 0.18 : 0))
    .on('tick', ticked);
}

const JITTER_V = 3;

function makeJitter() {
  return Array.from({ length: 10 }, () => ({
    da: (Math.random() - 0.5) * 0.28,
    dr: (Math.random() - 0.5) * 6,
  }));
}

function buildWcPath(jitter) {
  const N = jitter.length;
  const pts = jitter.map(({ da, dr }, i) => {
    const angle = (2 * Math.PI * i / N) + da;
    const r = NODE_R + dr;
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });
  return d3.line().x(d => d[0]).y(d => d[1]).curve(d3.curveCatmullRomClosed.alpha(0.5))(pts);
}

function buildCirclePath(r) {
  return `M ${r},0 A ${r},${r} 0 1,0 ${-r},0 A ${r},${r} 0 1,0 ${r},0 Z`;
}

function currentNodePath() {
  return buildCirclePath(NODE_R);
}

export function toggleCheeseMode() {
  cheeseMode = !cheeseMode;
  localStorage.setItem('cheeseMode', cheeseMode ? '1' : '0');
  document.getElementById('btn-cheese').classList.toggle('active', cheeseMode);
  gZoom.select('.nodes-layer').selectAll('.g-node path').each(function(d) {
    this.setAttribute('d', currentNodePath(d.id));
    d3.select(this).attr('filter', cheeseMode ? 'url(#wc-halo)' : null);
  });
}

export function renderGraph() {
  if (!svgRoot) return;

  const nodeList = Object.values(nodes);
  const edgeList = Object.values(edges);

  document.getElementById('graph-empty').classList.toggle('visible', nodeList.length === 0);

  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 800;
  const H = 600;
  graphW = W; graphH = H;
  const t = svgRoot ? d3.zoomTransform(svgRoot.node()) : d3.zoomIdentity;
  const viewCx = (W / 2 - t.x) / t.k;
  const viewCy = (H / 2 - t.y) / t.k;

  const simNodes = nodeList.map(n => {
    const pending = (_pendingNodePos?.id === n.id) ? _pendingNodePos : null;
    if (pending) _pendingNodePos = null;
    return {
      ...n,
      x: pending?.x ?? nodeSimData[n.id]?.x ?? viewCx,
      y: pending?.y ?? nodeSimData[n.id]?.y ?? viewCy,
      vx: 0, vy: 0,
    };
  });

  const simEdges = edgeList.map(e => ({
    ...e,
    source: e.node_a_id,
    target: e.node_b_id,
  }));

  const edgeGs = gZoom.select('.edges-layer')
    .selectAll('.g-edge')
    .data(simEdges, d => d.id)
    .join(
      enter => {
        const g = enter.append('g').attr('class', 'g-edge');
        g.append('path').attr('class', 'edge-hit');
        g.append('path').attr('class', 'edge-line');
        return g;
      },
      update => update,
      exit => exit.remove()
    );

  edgeGs
    .classed('selected', d => d.id === selectedId && selectedType === 'edge')
    .on('click', (e, d) => { e.stopPropagation(); selectEdge(d.id, e); })
    .on('mouseenter', (e, d) => {
      const bKey = _yEdgeIndex.get(d.id);
      const labelId = bKey ? (_yBranchLabel.get(bKey) ?? d.id) : d.id;
      gZoom.select('.labels-layer').selectAll('.edge-label')
        .filter(l => l.id === labelId).style('opacity', 1);
      if (bKey) {
        gZoom.select('.branch-orbs-layer').selectAll('.g-branch-orb')
          .filter(v => v.key === bKey).classed('spoke-hovered', true);
      }
    })
    .on('mouseleave', (e, d) => {
      const bKey = _yEdgeIndex.get(d.id);
      const labelId = bKey ? (_yBranchLabel.get(bKey) ?? d.id) : d.id;
      const labelIsSelected = labelId === selectedId && selectedType === 'edge';
      if (!labelIsSelected) {
        gZoom.select('.labels-layer').selectAll('.edge-label')
          .filter(l => l.id === labelId).style('opacity', 0);
      }
      if (bKey) {
        gZoom.select('.branch-orbs-layer').selectAll('.g-branch-orb')
          .filter(v => v.key === bKey).classed('spoke-hovered', false);
      }
    });

  gZoom.select('.labels-layer')
    .selectAll('.edge-label')
    .data(simEdges, d => d.id)
    .join(
      enter => enter.append('text').attr('class', 'edge-label'),
      update => update,
      exit => exit.remove()
    )
    .classed('selected', d => d.id === selectedId && selectedType === 'edge')
    .text(d => d.body);

  const nodeGs = gZoom.select('.nodes-layer')
    .selectAll('.g-node')
    .data(simNodes, d => d.id)
    .join(
      enter => {
        const g = enter.append('g').attr('class', 'g-node');
        g.append('path')
          .attr('filter', cheeseMode ? 'url(#wc-halo)' : null)
          .each(function(d) { this.setAttribute('d', currentNodePath(d.id)); });
        g.append('text').attr('y', -(NODE_R + 5));
        return g;
      },
      update => update,
      exit => exit.remove()
    );

  nodeGs
    .classed('selected', d => d.id === selectedId && selectedType === 'node')
    .on('click', (e, d) => {
      e.stopPropagation();
      if (attachMode) {
        if (document.getElementById('attach-result').classList.contains('visible')) {
          showPillError('attach-result-error', 'attach-desc-input'); return;
        }
        if (document.getElementById('node-result').classList.contains('visible')) {
          showPillError('node-result-error', 'node-title-input'); return;
        }
        if (_attachSource === null) {
          _attachSource = d;
          gZoom.select('.nodes-layer').selectAll('.g-node').classed('attach-source', n => n.id === d.id);
          const [mx, my] = d3.pointer(e, gZoom.node());
          gZoom.append('line')
            .attr('class', 'attach-ghost')
            .attr('marker-end', e.shiftKey ? null : 'url(#arrow)')
            .attr('stroke-width', 2 / currentK)
            .attr('stroke-dasharray', `${8 / currentK} ${4 / currentK}`)
            .attr('x1', d.x).attr('y1', d.y).attr('x2', mx).attr('y2', my);
          _attachShiftDown = ev => { if (ev.key === 'Shift') gZoom.select('.attach-ghost').attr('marker-end', null); };
          _attachShiftUp   = ev => { if (ev.key === 'Shift') gZoom.select('.attach-ghost').attr('marker-end', 'url(#arrow)'); };
          document.addEventListener('keydown', _attachShiftDown);
          document.addEventListener('keyup',   _attachShiftUp);
          document.getElementById('attach-go-back').classList.add('visible');
        } else if (d.id !== _attachSource.id) {
          createEdgeDirect(_attachSource.id, d.id, e.shiftKey);
        } else {
          if (!_rewireState) clearAttachSource();
        }
        return;
      }
      if (e.shiftKey) {
        toggleMultiSelect(d.id);
      } else {
        multiSelected.clear();
        selectNode(d.id, e);
      }
    })
    .on('mouseenter', function(e, d) {
      hoveredNodeId = d.id;
      const r = hoveredNodeR();
      d3.select(this).select('path').transition().duration(220).attr('transform', `scale(${r / NODE_R})`);
      d3.select(this).classed('hovered', true);
      if (!document.getElementById('attach-result').classList.contains('visible') &&
          !document.getElementById('node-result').classList.contains('visible')) {
        const lbl = document.getElementById('node-hover-label');
        lbl.textContent = d.title;
        lbl.classList.add('visible');
      }
    })
    .on('mouseleave', function(e, d) {
      hoveredNodeId = null;
      const r = baseNodeR(d.id);
      d3.select(this).select('path').transition().duration(220).attr('transform', r === NODE_R ? null : `scale(${r / NODE_R})`);
      d3.select(this).classed('hovered', false);
      document.getElementById('node-hover-label').classList.remove('visible');
    })
    .call(dragBehavior());

  nodeGs.select('path').each(function(d) {
    this.setAttribute('d', currentNodePath(d.id));
    d3.select(this).attr('filter', cheeseMode ? 'url(#wc-halo)' : null);
  });

  nodeGs.each(function(d) {
    const colorIdx = nodeSimData[d.id]?.colorIdx ?? 0;
    const vars = nodeColorVars(colorIdx);
    const el = d3.select(this);
    Object.entries(vars).forEach(([k, v]) => el.style(k, v));
  });

  nodeGs.classed('subject-node', d => nodes[d.id]?.node_type === 'Subject');
  nodeGs.select('text').text(d => d.title);

  simulation.nodes(simNodes);
  simulation.force('link').links(simEdges);
  _initEdgeBends(simEdges);
  if (floatMode) {
    _pinSubjectTop();
    simulation.alpha(0.3).restart(); // simulation drives ticked(), which steps bends
    ticked(); // immediately apply updated bend state (don't wait for first sim tick)
  } else {
    simulation.nodes().forEach(n => { n.fx = n.x; n.fy = n.y; n.vx = 0; n.vy = 0; });
    simulation.stop();
    _startBendAnim(); // no simulation — drive ticked() via rAF until bends settle
  }
  updateVisualScales();

  if (_attachSource) {
    const fresh = simulation.nodes().find(n => n.id === _attachSource.id);
    if (fresh) _attachSource = fresh;
  }
  if (isolatedNodes !== null) applyIsolationView();
}

// ---- Parallel-edge bend physics ----

function _initEdgeBends(edgeData) {
  // Remove stale entries
  const edgeIds = new Set(edgeData.map(e => e.id));
  for (const k of _edgeBends.keys()) { if (!edgeIds.has(k)) _edgeBends.delete(k); }

  // Build pair groups
  const pairGroups = new Map();
  for (const e of edgeData) {
    const key = e.node_a_id < e.node_b_id ? `${e.node_a_id}|${e.node_b_id}` : `${e.node_b_id}|${e.node_a_id}`;
    if (!pairGroups.has(key)) pairGroups.set(key, []);
    pairGroups.get(key).push(e);
  }

  // Track which edges are actually in parallel pairs
  const paired = new Set();
  pairGroups.forEach(group => {
    if (group.length < 2) return;
    group.sort((a, b) => a.id < b.id ? -1 : 1);
    group.forEach((e, idx) => {
      paired.add(e.id);
      if (!_edgeBends.has(e.id)) {
        const initOffset = (idx - (group.length - 1) / 2) * 55;
        _edgeBends.set(e.id, { offset: initOffset, vel: 0 });
      }
    });
  });

  // Remove bends for edges no longer in a parallel pair
  for (const k of _edgeBends.keys()) { if (!paired.has(k)) _edgeBends.delete(k); }
  _bendSettled = false;
}

function _stepEdgeBends() {
  if (_edgeBends.size === 0) { _bendSettled = true; return; }

  const pairGroups = new Map();
  if (gZoom) {
    gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
      if (!_edgeBends.has(d.id)) return;
      const key = d.node_a_id < d.node_b_id ? `${d.node_a_id}|${d.node_b_id}` : `${d.node_b_id}|${d.node_a_id}`;
      if (!pairGroups.has(key)) pairGroups.set(key, []);
      pairGroups.get(key).push(d.id);
    });
  }

  const REPEL_MIN = 52;
  const DAMPING   = 0.82;

  pairGroups.forEach(ids => {
    // Repulsion only — no spring toward center (spring fights separation)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const bi = _edgeBends.get(ids[i]);
        const bj = _edgeBends.get(ids[j]);
        if (!bi || !bj) continue;
        const diff = bi.offset - bj.offset;
        const dist = Math.abs(diff) || 0.01;
        if (dist < REPEL_MIN) {
          const force = (REPEL_MIN - dist) * 0.6;
          const sign  = diff >= 0 ? 1 : -1;
          bi.vel += sign * force;
          bj.vel -= sign * force;
        }
      }
    }
    // Integrate
    ids.forEach(id => {
      const b = _edgeBends.get(id);
      if (!b) return;
      b.offset += b.vel;
      b.vel    *= DAMPING;
    });
  });

  let moving = false;
  _edgeBends.forEach(b => { if (Math.abs(b.vel) > 0.05) moving = true; });
  _bendSettled = !moving;
}

// Only used when float mode is off (simulation stopped — drives ticked() via rAF).
// When float mode is on the simulation's own tick calls ticked(), which steps bends inline.
function _startBendAnim() {
  if (_bendAnimId !== null) cancelAnimationFrame(_bendAnimId);
  _bendAnimId = null;
  if (_edgeBends.size === 0) { ticked(); return; }
  function step() {
    ticked(); // ticked() calls _stepEdgeBends() internally
    _bendAnimId = _bendSettled ? null : requestAnimationFrame(step);
  }
  _bendAnimId = requestAnimationFrame(step);
}


let _cullLastRun = 0;
function _cullNodeLabels() {
  const now = performance.now();
  if (now - _cullLastRun < 80) return; // throttle to ~12fps — labels don't need 60fps updates
  _cullLastRun = now;
  if (!gZoom || !svgRoot) return;
  const allGs = gZoom.select('.nodes-layer').selectAll('.g-node');
  if (allGs.empty()) return;

  const t = d3.zoomTransform(svgRoot.node()); // current pan/zoom
  const svgEl = svgRoot.node();
  const svgW  = svgEl?.clientWidth  || graphW;
  const svgH  = svgEl?.clientHeight || graphH;
  const subjectId  = Object.values(nodes).find(n => n.node_type === 'Subject')?.id;
  const subjectSim = simulation.nodes().find(n => n.id === subjectId);

  // Convert graph coords → screen coords
  const toScreen = (gx, gy) => ({ sx: gx * t.k + t.x, sy: gy * t.k + t.y });

  // Is a node's centre visible in the SVG viewport?
  const onScreen = (gx, gy) => {
    const { sx, sy } = toScreen(gx, gy);
    return sx >= -NODE_R * t.k && sx <= svgW + NODE_R * t.k &&
           sy >= -NODE_R * t.k && sy <= svgH + NODE_R * t.k;
  };

  // Screen-space label dimensions (constant regardless of zoom — labels are CSS-scaled)
  const CHAR_W_SCR = 6.2;
  const LABEL_H_SCR = 13;
  const PAD_SCR = 4;
  const LABEL_Y_OFF = 18; // px above node centre in screen space

  const labelBox = (gx, gy, title, distFactor = 1) => {
    const { sx, sy } = toScreen(gx, gy);
    // Shrink the collision box for closer nodes (distFactor 0→1 = closest→furthest)
    const shrink = 0.55 + 0.45 * distFactor; // 0.55 at dist=0, 1.0 at dist=max
    const hw = ((title.length * CHAR_W_SCR) / 2 + PAD_SCR) * shrink;
    const hh = (LABEL_H_SCR / 2 + PAD_SCR) * shrink;
    return { cx: sx, cy: sy - LABEL_Y_OFF * t.k, hw, hh };
  };

  const overlaps = (a, b) =>
    Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;

  const MAX_SHOWN = 5;
  const shown = [];
  const visibleIds = new Set();

  // Subject: always shown if on screen
  if (subjectId && subjectSim && onScreen(subjectSim.x ?? 0, subjectSim.y ?? 0)) {
    visibleIds.add(subjectId);
    shown.push(labelBox(subjectSim.x ?? 0, subjectSim.y ?? 0, nodes[subjectId]?.title ?? ''));
  }

  // Others: on-screen nodes sorted by distance to subject, greedy non-overlap pick
  const sx0 = subjectSim?.x ?? 0, sy0 = subjectSim?.y ?? 0;
  const candidates = simulation.nodes()
    .filter(n => n.id !== subjectId && onScreen(n.x ?? 0, n.y ?? 0))
    .map(n => {
      const dx = (n.x ?? 0) - sx0, dy = (n.y ?? 0) - sy0;
      return { id: n.id, dist: Math.sqrt(dx * dx + dy * dy), gx: n.x ?? 0, gy: n.y ?? 0 };
    })
    .sort((a, b) => a.dist - b.dist);

  const maxDist = candidates.length ? candidates[candidates.length - 1].dist || 1 : 1;
  for (const c of candidates) {
    if (visibleIds.size >= MAX_SHOWN + 1) break;
    const box = labelBox(c.gx, c.gy, nodes[c.id]?.title ?? '', c.dist / maxDist);
    if (!shown.some(b => overlaps(box, b))) {
      visibleIds.add(c.id);
      shown.push(box);
    }
  }

  allGs.select('text').style('opacity', d => visibleIds.has(d.id) ? 1 : 0);
}

function ticked() {
  gZoom.select('.nodes-layer').selectAll('.g-node')
    .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

  _cullNodeLabels();

  if (_attachSource && !_ghostHidden) {
    const ghost = gZoom.select('.attach-ghost');
    if (!ghost.empty()) {
      const tip = _ghostTipPos();
      if (tip) ghost.attr('x1', _attachSource.x ?? 0).attr('y1', _attachSource.y ?? 0)
                    .attr('x2', tip.x).attr('y2', tip.y);
    }
  }

  // Build parallel-edge groups inline every tick — no external state dependency
  const _pairGroups = new Map();
  if (focusDistances === null) {
    gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
      const aId = (typeof d.source === 'object' ? d.source.id : null) ?? d.node_a_id ?? '';
      const bId = (typeof d.target === 'object' ? d.target.id : null) ?? d.node_b_id ?? '';
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (!_pairGroups.has(key)) _pairGroups.set(key, []);
      _pairGroups.get(key).push(d.id);
    });
    _pairGroups.forEach(ids => ids.sort());
  }

  // Build Y-groups: edges with identical label that share one endpoint.
  // _orbDataCache stores group structure (IDs only, no live node refs).
  // stemX/stemY are recomputed every tick from current sim positions — never stale.
  const _simAlpha = simulation.alpha();
  const _simNodeMap = new Map(simulation.nodes().map(n => [n.id, n]));

  if (focusDistances === null && _simAlpha >= 0.008) {
    // Rebuild group structure when sim is actively moving
    const _eList = [];
    gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
      const sObj = typeof d.source === 'object' ? d.source : null;
      const tObj = typeof d.target === 'object' ? d.target : null;
      if (sObj && tObj && d.body?.trim()) {
        _eList.push({ id: d.id, body: d.body.trim(), sObjId: sObj.id, tObjId: tObj.id, bidir: d.bidirectional, src_id: d.source_id });
      }
    });
    const _byHubBody = new Map();
    for (const e of _eList) {
      const pairs = e.bidir
        ? [[e.sObjId, e.tObjId], [e.tObjId, e.sObjId]]
        : [[e.src_id === e.sObjId ? e.sObjId : e.tObjId, e.src_id === e.sObjId ? e.tObjId : e.sObjId]];
      for (const [hubId, spokeId] of pairs) {
        const k = `${hubId}||${e.body}`;
        if (!_byHubBody.has(k)) _byHubBody.set(k, { hubId, members: [], body: e.body });
        _byHubBody.get(k).members.push({ id: e.id, spokeId });
      }
    }
    const _claimed = new Set();
    _orbDataCache = [];
    [..._byHubBody.values()]
      .filter(g => g.members.length >= 2)
      .sort((a, b) => b.members.length - a.members.length)
      .forEach(({ hubId, members, body: groupBody }) => {
        const free = members.filter(m => !_claimed.has(m.id));
        if (free.length < 2) return;
        const groupKey = `${hubId}||${groupBody}`;
        const edgeIds  = free.map(m => m.id);
        free.forEach(m => _claimed.add(m.id));
        // Store IDs only — positions resolved each tick from _simNodeMap
        _orbDataCache.push({ hubId, spokeIds: free.map(m => m.spokeId), key: groupKey, edgeIds, body: groupBody });
      });

    _yEdgeIndex.clear();
    _yBranchLabel.clear();
    _orbDataCache.forEach(orb => {
      orb.edgeIds.forEach((eid, i) => {
        _yEdgeIndex.set(eid, orb.key);
        if (i === 0) _yBranchLabel.set(orb.key, eid);
      });
    });
  }

  // Compute stemX/stemY from live positions every tick (cheap — just arithmetic)
  const _orbDataArr = _orbDataCache.map(orb => {
    const hubNode = _simNodeMap.get(orb.hubId);
    const hx = hubNode?.x ?? 0, hy = hubNode?.y ?? 0;
    const spokeNodes = orb.spokeIds.map(id => _simNodeMap.get(id)).filter(Boolean);
    const cx = spokeNodes.reduce((s, n) => s + (n.x ?? 0), 0) / (spokeNodes.length || 1);
    const cy = spokeNodes.reduce((s, n) => s + (n.y ?? 0), 0) / (spokeNodes.length || 1);
    return { ...orb, hubNode, spokeNodes, stemX: hx + (cx - hx) * 0.5, stemY: hy + (cy - hy) * 0.5 };
  });

  // Per-edge lookup for edge rendering (replaces old _yEdge Map)
  const _yEdge = new Map();
  _orbDataArr.forEach(orb => {
    orb.edgeIds.forEach((eid, i) => {
      const spokeNode = _simNodeMap.get(orb.spokeIds[i]);
      if (spokeNode) _yEdge.set(eid, { hubNode: orb.hubNode, spokeNode, stemX: orb.stemX, stemY: orb.stemY, isFirst: i === 0 });
    });
  });
  gZoom.select('.branch-orbs-layer')
    .selectAll('.g-branch-orb')
    .data(_orbDataArr, v => v.key)
    .join(
      enter => {
        const g = enter.append('g').attr('class', 'g-branch-orb');
        g.append('line').attr('class', 'branch-stem-vis').attr('x2', 0).attr('y2', 0);
        g.append('line').attr('class', 'branch-stem-hit').attr('x2', 0).attr('y2', 0);
        g.append('circle').attr('r', 3.5).attr('class', 'branch-orb-circle');
        // Bind handlers once on enter — read fresh datum via d3.select(this).datum() at event time
        g.on('click', function(ev) {
          const v = d3.select(this).datum();
          ev.stopPropagation();
          _selectedBranchKey = v.key;
          selectedId   = null;
          selectedType = null;
          gZoom.select('.branch-orbs-layer').selectAll('.g-branch-orb')
            .classed('branch-selected', d => d.key === v.key);
          refreshSelectionClasses();
          showBranchPanel(v, ev);
        });
        g.on('mouseenter', function() {
          const v = d3.select(this).datum();
          d3.select(this).classed('hovered', true);
          gZoom.select('.edges-layer').selectAll('.g-edge')
            .filter(d => v.edgeIds.includes(d.id)).classed('branch-hovered', true);
          const labelId = _yBranchLabel.get(v.key);
          if (labelId) gZoom.select('.labels-layer').selectAll('.edge-label')
            .filter(l => l.id === labelId).style('opacity', 1);
        });
        g.on('mouseleave', function() {
          const v = d3.select(this).datum();
          d3.select(this).classed('hovered', false);
          gZoom.select('.edges-layer').selectAll('.g-edge').classed('branch-hovered', false);
          const labelId = _yBranchLabel.get(v.key);
          if (labelId && !(labelId === selectedId && selectedType === 'edge'))
            gZoom.select('.labels-layer').selectAll('.edge-label')
              .filter(l => l.id === labelId).style('opacity', 0);
        });
        return g;
      },
      update => update,
      exit => exit.remove()
    )
    .classed('branch-selected', v => v.key === _selectedBranchKey)
    .attr('transform', v => `translate(${v.stemX},${v.stemY})`);

  // Update stem endpoints + branch color each tick
  gZoom.select('.branch-orbs-layer').selectAll('.g-branch-orb').each(function(d) {
    // Initialize branch color on first render from edge; never re-read individual edge after that
    if (!_branchColors.has(d.key)) {
      _branchColors.set(d.key, nodeSimData[d.edgeIds[0]]?.colorIdx ?? 0);
    }
    const branchColorIdx = _branchColors.get(d.key);
    const branchColor    = EDGE_PALETTE[branchColorIdx]?.color ?? EDGE_PALETTE[0].color;
    // Hub-offset point (start of visible stem, avoids overdrawing the node shape)
    const hx = d.hubNode.x ?? 0, hy = d.hubNode.y ?? 0;
    const sDx = d.stemX - hx, sDy = d.stemY - hy, sDist = Math.sqrt(sDx*sDx + sDy*sDy) || 1;
    const hx1 = hx + (sDx / sDist) * baseNodeR(d.hubNode.id) - d.stemX;
    const hy1 = hy + (sDy / sDist) * baseNodeR(d.hubNode.id) - d.stemY;
    const g = d3.select(this);
    g.style('--branch-color', branchColor);
    g.classed('has-selected-edge', selectedType === 'edge' && d.edgeIds.includes(selectedId));
    g.select('.branch-stem-vis').attr('x1', hx1).attr('y1', hy1);
    g.select('.branch-stem-hit').attr('x1', hx - d.stemX).attr('y1', hy - d.stemY);
  });

  gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
    const isReversed = !d.bidirectional && d.source_id && d.source_id === d.node_b_id;
    const sNode = isReversed ? d.target : d.source;
    const tNode = isReversed ? d.source : d.target;
    const sx = sNode.x ?? 0, sy = sNode.y ?? 0;
    const tx = tNode.x ?? 0, ty = tNode.y ?? 0;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist, uy = dy / dist;

    const x1 = sx + ux * baseNodeR(sNode.id), y1 = sy + uy * baseNodeR(sNode.id);
    const x2 = tx - ux * baseNodeR(tNode.id), y2 = ty - uy * baseNodeR(tNode.id);

    const arrow = d.bidirectional ? null : 'url(#arrow)';
    // refX=0 means the arrow BASE sits at the path endpoint; tip extends forward 12 user-units.
    // Pull edge-line back 6 units so its stroke endpoint sits at the arrow base (full ~8.5px
    // wide there), which completely covers the 3px stroke — no blunt tip, no gap.
    // The tip lands exactly at x2 (node boundary) at every zoom level.
    const pb = d.bidirectional ? 0 : 12;
    let pathD, lineD, labelX, labelY;

    if (focusDistances !== null) {
      pathD  = `M${x1},${y1} L${x2},${y2}`;
      lineD  = `M${x1},${y1} L${x2 - ux*pb},${y2 - uy*pb}`;
      labelX = (x1 + x2) / 2;
      labelY = (y1 + y2) / 2 - 9;
    } else if (_yEdge.has(d.id)) {
      const { hubNode, spokeNode, stemX, stemY, isFirst } = _yEdge.get(d.id);
      const hx = hubNode.x ?? 0, hy = hubNode.y ?? 0;
      const spx = spokeNode.x ?? 0, spy = spokeNode.y ?? 0;
      // Hub → stem (for label position reference only — stem is drawn by branch-stem-vis)
      const sDx = stemX - hx, sDy = stemY - hy, sDist = Math.sqrt(sDx*sDx + sDy*sDy) || 1;
      const hx1 = hx + (sDx / sDist) * baseNodeR(hubNode.id);
      const hy1 = hy + (sDy / sDist) * baseNodeR(hubNode.id);
      // Spoke only: orb → spoke node (individual edge color applies only here)
      const bDx = spx - stemX, bDy = spy - stemY, bDist = Math.sqrt(bDx*bDx + bDy*bDy) || 1;
      const bUx = bDx / bDist, bUy = bDy / bDist;
      const spx2 = spx - bUx * baseNodeR(spokeNode.id);
      const spy2 = spy - bUy * baseNodeR(spokeNode.id);
      pathD  = `M${stemX},${stemY} L${spx2},${spy2}`;
      lineD  = `M${stemX},${stemY} L${spx2 - bUx*pb},${spy2 - bUy*pb}`;
      // Label sits on the shared stem, shown only for the first member of the group
      labelX = isFirst ? (hx1 + stemX) / 2 : -9999;
      labelY = isFirst ? (hy1 + stemY) / 2 - 9 : -9999;
    } else {
      const aId2    = (typeof d.source === 'object' ? d.source.id : null) ?? d.node_a_id ?? '';
      const bId2    = (typeof d.target === 'object' ? d.target.id : null) ?? d.node_b_id ?? '';
      const pairKey = aId2 < bId2 ? `${aId2}|${bId2}` : `${bId2}|${aId2}`;
      const group = _pairGroups.get(pairKey) ?? [d.id];
      const count = group.length;
      const idx   = group.indexOf(d.id);
      // Scale by zoom so separation stays ~30 screen-pixels regardless of zoom level
      const SPACING    = 30 / currentK;
      const baseOffset = (idx - (count - 1) / 2) * SPACING;
      // Physics layer adds a small dynamic adjustment on top
      const physOffset = _edgeBends.get(d.id)?.offset ?? 0;
      const offset     = baseOffset + physOffset;
      // Debug — remove once working
      if (Math.abs(offset) < 0.5) {
        pathD  = `M${x1},${y1} L${x2},${y2}`;
        lineD  = `M${x1},${y1} L${x2 - ux*pb},${y2 - uy*pb}`;
        labelX = (x1 + x2) / 2;
        labelY = (y1 + y2) / 2 - 9;
      } else {
        // Canonical perpendicular: always from smaller-ID node → larger-ID node
        // so both parallel edges use the same direction regardless of source/target order
        const [canonA, canonB] = (d.source?.id ?? '') < (d.target?.id ?? '')
          ? [d.source, d.target] : [d.target, d.source];
        const caDx = (canonB?.x ?? 0) - (canonA?.x ?? 0);
        const caDy = (canonB?.y ?? 0) - (canonA?.y ?? 0);
        const caL  = Math.sqrt(caDx * caDx + caDy * caDy) || 1;
        const px   = -caDy / caL;
        const py   =  caDx / caL;
        const cpX  = (x1 + x2) / 2 + px * offset;
        const cpY  = (y1 + y2) / 2 + py * offset;
        const tdx = x2 - cpX, tdy = y2 - cpY, tl = Math.sqrt(tdx*tdx + tdy*tdy) || 1;
        const tux = tdx / tl, tuy = tdy / tl;
        pathD  = `M${x1},${y1} Q${cpX},${cpY} ${x2},${y2}`;
        lineD  = `M${x1},${y1} Q${cpX},${cpY} ${x2 - tux*pb},${y2 - tuy*pb}`;
        labelX = 0.25 * x1 + 0.5 * cpX + 0.25 * x2;
        labelY = 0.25 * y1 + 0.5 * cpY + 0.25 * y2 - 9;
      }
    }

    // Apply per-edge color via CSS custom property
    const colorIdx = nodeSimData[d.id]?.colorIdx ?? 0;
    const edgeColor = EDGE_PALETTE[colorIdx]?.color ?? EDGE_PALETTE[0].color;
    d3.select(this).style('--edge-color', edgeColor);

    d3.select(this).select('.edge-hit').attr('d', pathD);
    d3.select(this).select('.edge-line').attr('d', lineD).attr('marker-end', arrow);
    gZoom.select('.labels-layer').selectAll('.edge-label')
      .filter(l => l.id === d.id)
      .attr('x', labelX).attr('y', labelY);
  });

  if (_attachSource) {
    gZoom.select('.attach-ghost')
      .attr('x1', _attachSource.x ?? 0).attr('y1', _attachSource.y ?? 0);
  }

  gZoom.select('.nodes-layer').selectAll('.g-node').each(d => {
    if (d.x != null) {
      if (!nodeSimData[d.id]) nodeSimData[d.id] = {};
      nodeSimData[d.id].x = d.x;
      nodeSimData[d.id].y = d.y;
    }
  });
  saveSimData();
  _stepEdgeBends(); // advance bend physics each render frame
}

// ---- Attach mode state ----

let _attachHintTimer = null;
let _attachResultTimer = null;
let _attachEnterUnlock = null;
let _attachShiftListener = null;
let _panelStateBeforeAttach = null;

let _attachShiftDown = null, _attachShiftUp = null;
let _rewireState = null;
let _returnToNodeId = null;
let _ghostHidden = false;
let _pendingTargetNodeId = null;
let _clearSourceTimer = null;

let _enterKeyDown = false;
document.addEventListener('keydown', (e) => { if (e.key === 'Enter') _enterKeyDown = true;  }, true);
document.addEventListener('keyup',   (e) => { if (e.key === 'Enter') _enterKeyDown = false; }, true);

let _mouseClientX = 0, _mouseClientY = 0;
document.addEventListener('mousemove', e => { _mouseClientX = e.clientX; _mouseClientY = e.clientY; });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'a') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (document.getElementById('history-drawer')?.classList.contains('open')) return;
  if (document.getElementById('questions-drawer')?.classList.contains('open')) return;
  e.preventDefault();
  toggleAttachMode();
});

document.addEventListener('keydown', async (e) => {
  if (e.key !== 'n') return;
  if (currentState === 'FirstOutline') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (document.getElementById('graph-detail-panel')?.style.display !== 'none') return;
  if (document.getElementById('history-drawer')?.classList.contains('open')) return;
  if (document.getElementById('questions-drawer')?.classList.contains('open')) return;
  e.preventDefault();
  if (_nodeResultStack.length >= 10) return;
  const svgEl = svgRoot.node();
  const rect = svgEl.getBoundingClientRect();
  if (_mouseClientX < rect.left || _mouseClientX > rect.right || _mouseClientY < rect.top || _mouseClientY > rect.bottom) return;
  const tr = d3.zoomTransform(svgEl);
  const simX = (_mouseClientX - rect.left - tr.x) / tr.k;
  const simY = (_mouseClientY - rect.top  - tr.y) / tr.k;
  const res = await fetch(`${API}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New Idea', body: null }),
  });
  if (!res.ok) return;
  const newNode = await res.json();
  _pendingNodePos = { id: newNode.id, x: simX, y: simY };
  if (attachMode && _attachSource) {
    const sourceId = _attachSource.id;
    _pendingTargetNodeId = newNode.id;
    _nodeResultOnEnter = async (newNodeId) => { await createEdgeDirect(sourceId, newNodeId, false); };
  } else if (attachMode) {
    _nodeResultOnEnter = async (newNodeId) => { enterAttachFrom(newNodeId); };
  }
  await loadData();
  if (isolatedNodes !== null) {
    isolatedNodes.add(newNode.id);
    applyIsolationView();
  }
  showNodeResult(newNode.id);
});

let _autoPanRaf = null;
let _autoPanVx = 0, _autoPanVy = 0;
let _lastMouseClient = null;
const AUTO_PAN_ZONE = 80;
const AUTO_PAN_MAX  = 8;

function _ghostTipPos() {
  if (_pendingTargetNodeId) {
    const tn = simulation.nodes().find(n => n.id === _pendingTargetNodeId);
    if (tn) return { x: tn.x ?? 0, y: tn.y ?? 0 };
  }
  if (!_lastMouseClient || !svgRoot) return null;
  const tr = d3.zoomTransform(svgRoot.node());
  const rect = svgRoot.node().getBoundingClientRect();
  return { x: (_lastMouseClient.x - rect.left - tr.x) / tr.k,
           y: (_lastMouseClient.y - rect.top  - tr.y) / tr.k };
}

function _syncGhostTip() {
  if (!_attachSource) return;
  const tip = _ghostTipPos();
  if (!tip) return;
  gZoom.select('.attach-ghost')
    .attr('x1', _attachSource.x ?? 0).attr('y1', _attachSource.y ?? 0)
    .attr('x2', tip.x).attr('y2', tip.y);
}

function _stopAutoPan() {
  if (_autoPanRaf) { cancelAnimationFrame(_autoPanRaf); _autoPanRaf = null; }
  _autoPanVx = 0; _autoPanVy = 0;
}

function _startAutoPan() {
  if (_autoPanRaf) return;
  function loop() {
    if (!_autoPanVx && !_autoPanVy) { _autoPanRaf = null; return; }
    zoomBehavior.translateBy(svgRoot, -_autoPanVx, -_autoPanVy);
    _syncGhostTip();
    _autoPanRaf = requestAnimationFrame(loop);
  }
  _autoPanRaf = requestAnimationFrame(loop);
}

function _updateAutoPan(clientX, clientY) {
  _lastMouseClient = { x: clientX, y: clientY };
  const rect = svgRoot.node().getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const W = rect.width, H = rect.height;
  function edgeVel(pos, size) {
    if (pos < AUTO_PAN_ZONE)        return -AUTO_PAN_MAX * (1 - pos / AUTO_PAN_ZONE);
    if (pos > size - AUTO_PAN_ZONE) return  AUTO_PAN_MAX * (1 - (size - pos) / AUTO_PAN_ZONE);
    return 0;
  }
  _autoPanVx = edgeVel(x, W);
  _autoPanVy = edgeVel(y, H);
  if (_autoPanVx || _autoPanVy) _startAutoPan();
  else _stopAutoPan();
}

document.getElementById('attach-go-back').addEventListener('click', () => {
  if (!_attachSource) return;
  const tr = d3.zoomTransform(svgRoot.node());
  const rect = svgRoot.node().getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  const tx = cx - tr.k * _attachSource.x;
  const ty = cy - tr.k * _attachSource.y;
  svgRoot.transition().duration(400).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(tx, ty).scale(tr.k)
  );
});

function clearAttachSource() {
  clearTimeout(_clearSourceTimer);
  _attachSource = null;
  _lastMouseClient = null;
  _ghostHidden = false;
  _pendingTargetNodeId = null;
  _stopAutoPan();
  document.getElementById('attach-go-back').classList.remove('visible');
  gZoom.select('.attach-ghost').remove();
  gZoom.select('.nodes-layer').selectAll('.g-node')
    .classed('attach-source', false)
    .classed('attach-highlight', false);
  if (_attachShiftDown) { document.removeEventListener('keydown', _attachShiftDown); _attachShiftDown = null; }
  if (_attachShiftUp)   { document.removeEventListener('keyup',   _attachShiftUp);   _attachShiftUp   = null; }
}

function clearRewireState() {
  if (!_rewireState) return;
  gZoom.select('.edges-layer').selectAll('.g-edge')
    .filter(d => d.id === _rewireState.edgeId)
    .style('opacity', null).style('pointer-events', null);
  _rewireState = null;
}

function enterRewireMode(edgeId, field, stayingNodeId, returnNodeId = null) {
  _rewireState = { edgeId, field, returnNodeId };
  gZoom.select('.edges-layer').selectAll('.g-edge')
    .filter(d => d.id === edgeId)
    .style('opacity', '0.15').style('pointer-events', 'none');
  enterAttachFrom(stayingNodeId);
}

export let attachMode = false;
let _attachSource = null;

export function enterAttachFrom(nodeId) {
  const d = simulation.nodes().find(n => n.id === nodeId);
  if (!d) return;
  if (!attachMode) {
    const activeTabBtn = document.querySelector('#detail-content .detail-tab-btn.active');
    _panelStateBeforeAttach = (selectedId && selectedType)
      ? { type: selectedType, id: selectedId, activeTab: activeTabBtn?.dataset.tab ?? null }
      : null;
    toggleAttachMode();
  }
  document.getElementById('graph-detail-panel').style.display = 'none';
  _attachSource = d;
  gZoom.select('.nodes-layer').selectAll('.g-node').classed('attach-source', n => n.id === d.id);
  gZoom.append('line')
    .attr('class', 'attach-ghost')
    .attr('marker-end', 'url(#arrow)')
    .attr('stroke-width', 2 / currentK)
    .attr('stroke-dasharray', `${8 / currentK} ${4 / currentK}`)
    .attr('x1', d.x).attr('y1', d.y).attr('x2', d.x).attr('y2', d.y);
  _attachShiftDown = ev => { if (ev.key === 'Shift') gZoom.select('.attach-ghost').attr('marker-end', null); };
  _attachShiftUp   = ev => { if (ev.key === 'Shift') gZoom.select('.attach-ghost').attr('marker-end', 'url(#arrow)'); };
  document.addEventListener('keydown', _attachShiftDown);
  document.addEventListener('keyup',   _attachShiftUp);
  document.getElementById('attach-go-back').classList.add('visible');
}

export function toggleAttachMode(hideEscHint = false) {
  attachMode = !attachMode;
  document.getElementById('btn-attach').classList.toggle('active', attachMode);
  document.getElementById('graph-container').classList.toggle('attach-mode', attachMode);
  document.getElementById('graph-vignette').classList.toggle('attach-mode', attachMode);
  const hint = document.getElementById('attach-hint');
  const escHint = document.getElementById('attach-escape-hint');
  clearTimeout(_attachHintTimer);
  if (attachMode) {
    if (focusDistances !== null) deselectAll();
    multiSelected.clear();
    selectionListOrder = [];
    refreshSelectionClasses();
    hint.classList.add('visible');
    if (!hideEscHint) escHint.classList.add('visible');
    _attachHintTimer = setTimeout(() => { hint.classList.remove('visible'); escHint.classList.remove('visible'); }, 5000);
    _attachShiftListener = (ev) => {
      if (ev.key === 'Shift') {
        clearTimeout(_attachHintTimer);
        hint.classList.remove('visible');
        escHint.classList.remove('visible');
      }
      if (ev.key === 'Escape') {
        if (document.getElementById('attach-result').classList.contains('visible')) return;
        if (document.getElementById('node-result').classList.contains('visible')) return;
        toggleAttachMode();
      }
    };
    document.addEventListener('keydown', _attachShiftListener);
  } else {
    hint.classList.remove('visible');
    escHint.classList.remove('visible');
    hideAttachResult();
    clearAttachSource();
    clearRewireState();
    _returnToNodeId = null;
    if (_panelStateBeforeAttach) {
      const saved = _panelStateBeforeAttach;
      _panelStateBeforeAttach = null;
      if (saved.type === 'node') {
        selectedId   = saved.id;
        selectedType = 'node';
        savedZoom    = d3.zoomTransform(svgRoot.node());
        focusDistances = computeDistances(saved.id);
        refreshSelectionClasses();
        applyFocusView();
        zoomToNode(saved.id);
      }
      showDetailPanel(saved.type, saved.id, null);
      if (saved.activeTab) {
        const btn = document.querySelector(`#detail-content .detail-tab-btn[data-tab="${saved.activeTab}"]`);
        if (btn) btn.click();
      }
    }
    if (_attachShiftListener) {
      document.removeEventListener('keydown', _attachShiftListener);
      _attachShiftListener = null;
    }
  }
  _syncGraphOptionsBtn();
}

function showAttachResult(edgeId, onComplete) {
  clearTimeout(_attachResultTimer);
  if (_attachHeld) { _attachHeld = false; if (attachMode) toggleAttachMode(); }
  document.getElementById('attach-hint').classList.remove('visible');
  document.getElementById('node-hover-label').classList.remove('visible');
  _ghostHidden = true;
  _pendingTargetNodeId = null;
  gZoom.select('.attach-ghost').remove();
  _stopAutoPan();

  const input = document.getElementById('attach-desc-input');
  input.value = '';

  const saveDesc = async () => {
    const body = input.value.trim() || null;
    if (body) {
      await apiRequest('PATCH', `${API}/edges/${edgeId}`, { body });
      loadData();
    }
  };

  let _attachUndone = false;
  let _enterReady = !_enterKeyDown;
  if (!_enterReady) {
    if (_attachEnterUnlock) document.removeEventListener('keyup', _attachEnterUnlock);
    _attachEnterUnlock = (e) => { if (e.key === 'Enter') { _enterReady = true; _attachEnterUnlock = null; } };
    document.addEventListener('keyup', _attachEnterUnlock, { once: true });
  }
  input.onkeydown = async (e) => {
    if (e.key === 'Enter' && _enterReady) {
      await saveDesc();
      showToast('Connection created!');
      const _e = edges[edgeId]; if (_e) { const _sym = _e.bidirectional ? '↔' : '→'; addHistory(`Connected "${nodes[_e.node_a_id]?.title}" ${_sym} "${nodes[_e.node_b_id]?.title}"`, '⊕'); }
      hideAttachResult();
      _ghostHidden = false;
      if (onComplete) await onComplete();
    }
  };
  input.oninput = () => document.getElementById('attach-result-error').classList.remove('visible');
  input.onfocus = () => clearTimeout(_attachResultTimer);
  input.onblur = async () => {
    if (_attachUndone) return;
    await saveDesc();
    _attachResultTimer = setTimeout(() => { hideAttachResult(); clearAttachSource(); }, 4000);
  };

  document.getElementById('attach-undo-btn').onmousedown = () => { _attachUndone = true; };
  document.getElementById('attach-undo-btn').onclick = async () => {
    hideAttachResult();
    clearAttachSource();
    await fetch(`${API}/edges/${edgeId}`, { method: 'DELETE' });
    loadData();
  };

  document.getElementById('attach-edit-btn').onclick = async () => {
    await saveDesc();
    hideAttachResult();
    clearAttachSource();
    openEdgeModal(edgeId);
  };

  document.getElementById('attach-result').classList.add('visible');
  setTimeout(() => input.focus(), 50);
  _attachResultTimer = setTimeout(hideAttachResult, 8000);
}

function hideAttachResult() {
  clearTimeout(_attachResultTimer);
  document.getElementById('attach-result').classList.remove('visible');
  if (_attachEnterUnlock) { document.removeEventListener('keyup', _attachEnterUnlock); _attachEnterUnlock = null; }
}

let _nodeResultTimer = null;
let _nodeResultStack = [];
let _nodeResultOnEnter = null;
let _pillErrorTimer  = null;

let _toastTimer = null;
export function showToast(msg) {
  clearTimeout(_toastTimer);
  const el = document.getElementById('graph-toast');
  el.textContent = msg;
  el.classList.add('visible');
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
}

export function showPillError(errorId, inputId) {
  clearTimeout(_pillErrorTimer);
  const el = document.getElementById(errorId);
  el.innerHTML = 'Press <u>Enter</u> to continue working';
  el.classList.add('visible');
  document.getElementById(inputId)?.focus();
  _pillErrorTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

export function showNodeResult(nodeId) {
  if (nodeId !== undefined) _nodeResultStack.push(nodeId);
  clearTimeout(_nodeResultTimer);
  hideAttachResult();
  document.getElementById('node-hover-label').classList.remove('visible');

  const input = document.getElementById('node-title-input');
  const count = _nodeResultStack.length;
  input.value = '';
  input.classList.remove('input-error');
  input.placeholder = count > 1 ? `Name this idea… (×${count})` : 'Name this idea…';

  const saveTitle = async () => {
    const title = input.value.trim();
    const id = _nodeResultStack[_nodeResultStack.length - 1];
    if (title && id) {
      await apiRequest('PATCH', `${API}/nodes/${id}`, { title });
      loadData();
    }
  };

  let _nodeUndone = false;
  input.onkeydown = async (e) => {
    if (e.key === 'Enter') {
      const id = _nodeResultStack[_nodeResultStack.length - 1];
      const onEnter = _nodeResultOnEnter;
      await saveTitle();
      showToast('Idea created!');
      addHistory(`Added "${input.value.trim() || 'New Idea'}"`, '✦');
      hideNodeResult();
      if (onEnter && id) await onEnter(id);
    }
  };
  input.oninput = () => document.getElementById('node-result-error').classList.remove('visible');
  input.onfocus = () => clearTimeout(_nodeResultTimer);
  input.onblur = async () => {
    await saveTitle();
    _nodeResultTimer = setTimeout(hideNodeResult, 4000);
  };

  document.getElementById('node-undo-btn').onmousedown = () => { _nodeUndone = true; };
  document.getElementById('node-undo-btn').onclick = async () => {
    const id = _nodeResultStack.pop();
    if (!id) return;
    isolatedNodes?.delete(id);
    await fetch(`${API}/nodes/${id}`, { method: 'DELETE' });
    loadData();
    if (_nodeResultStack.length > 0) { showNodeResult(); } else { hideNodeResult(); }
  };
  document.getElementById('node-edit-btn').onclick = async () => {
    await saveTitle();
    const id = _nodeResultStack[_nodeResultStack.length - 1];
    hideNodeResult(); openEditNode(id);
  };

  document.getElementById('node-result').classList.add('visible');
  setTimeout(() => input.focus(), 50);
  _nodeResultTimer = setTimeout(hideNodeResult, 8000);
}

export function hideNodeResult() {
  clearTimeout(_nodeResultTimer);
  _nodeResultStack = [];
  _nodeResultOnEnter = null;
  _pendingTargetNodeId = null;
  document.getElementById('node-result').classList.remove('visible');
}

function findNodeAt(x, y, excludeId) {
  return simulation.nodes().find(n => {
    if (n.id === excludeId) return false;
    if (focusDistances && focusDistances[n.id] === undefined) return false;
    const dx = (n.x ?? 0) - x, dy = (n.y ?? 0) - y;
    return Math.sqrt(dx * dx + dy * dy) < NODE_R * 2;
  });
}

export async function createEdgeDirect(fromId, toId, bidirectional) {
  if (document.getElementById('attach-result').classList.contains('visible')) {
    showPillError('attach-result-error', 'attach-desc-input'); return;
  }
  if (_rewireState) {
    const { edgeId, field, returnNodeId } = _rewireState;
    const e = edges[edgeId];
    const patch = { [field]: toId };
    const replacedId = field === 'node_a_id' ? e.node_a_id : e.node_b_id;
    if (!e.bidirectional && e.source_id === replacedId) patch.source_id = fromId;
    const ok = await apiRequest('PATCH', `${API}/edges/${edgeId}`, patch);
    if (!ok) { clearRewireState(); return; }
    const savedTab = _panelStateBeforeAttach?.activeTab ?? null;
    clearRewireState();
    showToast('Connection moved!');
    addHistory(`Reconnected "${nodes[toId]?.title}"`, '⇌');
    _panelStateBeforeAttach = null;
    toggleAttachMode();
    await loadData();
    if (returnNodeId) showDetailPanel('node', returnNodeId, null);
    else              showDetailPanel('edge', edgeId, null);
    if (savedTab) document.querySelector(`#detail-content .detail-tab-btn[data-tab="${savedTab}"]`)?.click();
    return;
  }
  if (_returnToNodeId) {
    const nodeId = _returnToNodeId;
    const savedTab = _panelStateBeforeAttach?.activeTab ?? null;
    _returnToNodeId = null;
    const edge = await apiRequest('POST', `${API}/edges`, { body: '', node_a_id: fromId, node_b_id: toId, bidirectional, source_id: bidirectional ? null : fromId });
    if (!edge) return;
    loadData();
    showAttachResult(edge.id, async () => {
      _panelStateBeforeAttach = null;
      await loadData();
      showDetailPanel('node', nodeId, null);
      if (savedTab) document.querySelector(`#detail-content .detail-tab-btn[data-tab="${savedTab}"]`)?.click();
    });
    return;
  }
  const edge = await apiRequest('POST', `${API}/edges`, { body: '', node_a_id: fromId, node_b_id: toId, bidirectional, source_id: bidirectional ? null : fromId });
  if (!edge) return;
  loadData(); showAttachResult(edge.id);
}

function isOverTrash(ev) {
  const r = document.getElementById('graph-trash').getBoundingClientRect();
  return ev.clientX >= r.left && ev.clientX <= r.right &&
         ev.clientY >= r.top  && ev.clientY <= r.bottom;
}

function dragBehavior() {
  const trash = () => document.getElementById('graph-trash');
  let _dragAttachNode = null, _dragAttachLive = false, _dragAttachX0, _dragAttachY0;
  return d3.drag()
    .on('start', (e, d) => {
      if (attachMode) {
        _dragAttachNode = d; _dragAttachLive = false;
        _dragAttachX0 = e.x; _dragAttachY0 = e.y;
        return;
      }
      if (floatMode && !e.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
      trash().classList.add('visible');
    })
    .on('drag', (e, d) => {
      if (attachMode) {
        if (!_dragAttachLive) {
          if (Math.hypot(e.x - _dragAttachX0, e.y - _dragAttachY0) < 6) return;
          _dragAttachLive = true;
          clearAttachSource();
          _attachSource = _dragAttachNode;
          gZoom.select('.nodes-layer').selectAll('.g-node').classed('attach-source', n => n.id === _dragAttachNode.id);
          gZoom.append('line')
            .attr('class', 'attach-ghost')
            .attr('marker-end', e.sourceEvent?.shiftKey ? null : 'url(#arrow)')
            .attr('stroke-width', 2 / currentK)
            .attr('stroke-dasharray', `${8 / currentK} ${4 / currentK}`)
            .attr('x1', _dragAttachNode.x).attr('y1', _dragAttachNode.y)
            .attr('x2', e.x).attr('y2', e.y);
          _attachShiftDown = ev => { if (ev.key === 'Shift') gZoom.select('.attach-ghost').attr('marker-end', null); };
          _attachShiftUp   = ev => { if (ev.key === 'Shift') gZoom.select('.attach-ghost').attr('marker-end', 'url(#arrow)'); };
          document.addEventListener('keydown', _attachShiftDown);
          document.addEventListener('keyup',   _attachShiftUp);
          document.getElementById('attach-go-back').classList.add('visible');
        }
        gZoom.select('.attach-ghost')
          .attr('x1', _attachSource.x ?? 0).attr('y1', _attachSource.y ?? 0)
          .attr('x2', e.x).attr('y2', e.y);
        const hit = findNodeAt(e.x, e.y, _attachSource.id);
        gZoom.select('.nodes-layer').selectAll('.g-node').classed('attach-highlight', n => n === hit);
        if (e.sourceEvent) _updateAutoPan(e.sourceEvent.clientX, e.sourceEvent.clientY);
        return;
      }
      if (floatMode) {
        d.fx = e.x; d.fy = e.y;
      } else {
        const t = d3.zoomTransform(svgRoot.node());
        const px = 10 / t.k;
        d.fx = Math.max(t.invertX(0) + px, Math.min(t.invertX(graphW) - px, e.x));
        d.fy = Math.max(t.invertY(0) + px, Math.min(t.invertY(graphH) - px, e.y));
        d.x = d.fx; d.y = d.fy;
        ticked();
      }
      trash().classList.toggle('danger', isOverTrash(e.sourceEvent));
    })
    .on('end', async (e, d) => {
      if (attachMode) {
        _stopAutoPan();
        if (_dragAttachLive && _attachSource) {
          const hit = findNodeAt(e.x, e.y, _attachSource.id);
          if (hit) createEdgeDirect(_attachSource.id, hit.id, e.sourceEvent?.shiftKey ?? false);
          else clearAttachSource();
        }
        _dragAttachNode = null; _dragAttachLive = false;
        return;
      }
      if (!e.active) {
        if (floatMode) {
          simulation.alphaTarget(0);
        } else {
          simulation.nodes().forEach(n => { n.vx = 0; n.vy = 0; });
          simulation.stop();
        }
      }
      hoveredNodeId = null;
      document.getElementById('node-hover-label').classList.remove('visible');
      trash().classList.remove('visible', 'danger');
      if (isOverTrash(e.sourceEvent)) {
        d.fx = null; d.fy = null;
        if (multiSelected.size > 0 && multiSelected.has(d.id)) {
          const ids = [...multiSelected];
          const label = ids.length === 1 ? '1 idea' : `${ids.length} ideas`;
          showConfirm(`Delete ${label}? This cannot be undone.`, async () => {
            multiSelected.clear();
            refreshSelectionClasses();
            for (const id of ids) await fetch(`${API}/nodes/${id}`, { method: 'DELETE' });
            loadData();
          });
        } else {
          deleteNode(d.id);
        }
      } else {
        if (floatMode) {
          d.fx = null; d.fy = null;
          if (d.node_type === 'Subject') simulation.alpha(0.4).restart();
        }
      }
    });
}

// ---- Selection ----

function toggleMultiSelect(id) {
  if (multiSelected.size === 0 && selectedId) {
    selectedId = null;
    selectedType = null;
    focusDistances = null;
    document.getElementById('graph-detail-panel').style.display = 'none';
    applyFocusView();
  }
  if (multiSelected.has(id)) {
    multiSelected.delete(id);
  } else {
    multiSelected.add(id);
    if (!selectionListOrder.includes(id)) selectionListOrder.push(id);
  }
  refreshSelectionClasses();
}

function selectNode(id, event) {
  selectedId     = id;
  selectedType   = 'node';
  if (!focusDistances) savedZoom = d3.zoomTransform(svgRoot.node());
  focusDistances = computeDistances(id);
  refreshSelectionClasses();
  applyFocusView();
  showDetailPanel('node', id, event);
  zoomToNode(id);
}

// Focus a node (highlight + zoom) without opening the detail panel — used by reflection
export function focusNodeOnly(id) {
  if (!focusDistances) savedZoom = d3.zoomTransform(svgRoot.node());
  selectedId     = id;
  selectedType   = 'node';
  focusDistances = computeDistances(id);
  document.getElementById('graph-detail-panel').style.display = 'none';
  refreshSelectionClasses();
  applyFocusView();
  zoomToNode(id);
}

function selectEdge(id, event) {
  selectedId   = id;
  selectedType = 'edge';
  refreshSelectionClasses();
  showDetailPanel('edge', id, event);
  zoomToEdge(id);
}

export function selectNodeById(id) {
  if (window.switchView) window.switchView('graph');
  selectNode(id, null);
}

export function selectEdgeById(id) {
  if (window.switchView) window.switchView('graph');
  selectEdge(id, null);
}

function _setupPaletteDismiss(detailsEl) {
  const panel = document.getElementById('graph-detail-panel');
  if (_palettePointerdown) panel.removeEventListener('pointerdown', _palettePointerdown);
  _palettePointerdown = (ev) => {
    if (!detailsEl.open) return;
    if (!detailsEl.contains(ev.target)) {
      detailsEl.removeAttribute('open');
      document.getElementById('graph-container').classList.remove('color-picking');
    }
  };
  panel.addEventListener('pointerdown', _palettePointerdown);
}

export function deselectAll() {
  if (_deepFocusActive) {
    _deepFocusActive = false;
    document.getElementById('deep-focus-exit').style.display = 'none';
    const PAD = 600;
    zoomBehavior.translateExtent([[-PAD, -PAD], [graphW + PAD, graphH + PAD]]);
    svgRoot.call(zoomBehavior.transform, d3.zoomTransform(svgRoot.node()));
  }
  const wasFocused = focusDistances !== null;
  selectedId     = null;
  selectedType   = null;
  focusDistances = null;
  _edgePanelOpen = false;
  multiSelected.clear();
  selectionListOrder = [];
  refreshSelectionClasses();
  applyFocusView();
  if (wasFocused && savedZoom) {
    svgRoot.transition().duration(1000).ease(d3.easeQuadInOut).call(zoomBehavior.transform, savedZoom);
    savedZoom = null;
  }
  _selectedBranchKey = null;
  gZoom?.select('.edges-layer')?.selectAll('.g-edge')?.classed('branch-active', false);
  document.getElementById('graph-detail-panel').style.display = 'none';
  if (_returnToQuestionsDrawer) {
    _returnToQuestionsDrawer = false;
    setTimeout(() => window.toggleQuestionsDrawer?.(), 300);
  }
}

export function setReturnToQuestions() {
  _returnToQuestionsDrawer = true;
}

function refreshSelectionClasses() {
  gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
    const isSelected = d.id === selectedId && selectedType === 'node';
    d3.select(this)
      .classed('selected', isSelected)
      .classed('multi-selected', multiSelected.has(d.id));
  });
  gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
    const isSelected = d.id === selectedId && selectedType === 'edge';
    d3.select(this).classed('selected', isSelected);
    const arrow = d.bidirectional ? null : 'url(#arrow)';
    d3.select(this).select('.edge-line').attr('marker-end', arrow);
  });
  gZoom.select('.labels-layer').selectAll('.edge-label').each(function(d) {
    const isSelected = d.id === selectedId && selectedType === 'edge';
    d3.select(this).classed('selected', isSelected).style('opacity', isSelected ? 1 : null);
  });
  document.getElementById('connect-pill').classList.toggle('visible',
    !isolatedNodes && selectionListOrder.length < 3 && multiSelected.size === 2);

  const listEl = document.getElementById('selection-list');
  if (!isolatedNodes && selectionListOrder.length >= 3) {
    const activeCount = multiSelected.size;
    const headerEl = document.getElementById('selection-list-header');
    headerEl.innerHTML = `<span>${activeCount} of ${selectionListOrder.length} selected</span>`
      + (activeCount >= 2 ? `<button class="btn-isolate-list" onclick="isolateSelected()">⊠ Isolate</button>` : '');
    const itemsEl = document.getElementById('selection-list-items');
    itemsEl.innerHTML = selectionListOrder.map(id => {
      const active = multiSelected.has(id);
      return `<div class="selection-list-item${active ? '' : ' deselected'}" data-id="${id}">
        <span class="selection-list-item-name">${nodes[id]?.title ?? id}</span>
        <button class="selection-list-item-btn">${active ? '×' : '+'}</button>
      </div>`;
    }).join('');
    itemsEl.querySelectorAll('.selection-list-item').forEach(row => {
      row.querySelector('.selection-list-item-btn').onclick = e => {
        e.stopPropagation();
        const rid = row.dataset.id;
        if (multiSelected.has(rid)) multiSelected.delete(rid);
        else multiSelected.add(rid);
        refreshSelectionClasses();
      };
    });
    listEl.classList.add('visible');
  } else {
    listEl.classList.remove('visible');
  }
}

export async function connectMultiSelected() {
  const [idA, idB] = [...multiSelected];
  multiSelected.clear();
  refreshSelectionClasses();
  await createEdgeDirect(idA, idB, true);
}

export function isolateSelected() {
  if (multiSelected.size < 2) return;
  savedZoomIsolation = d3.zoomTransform(svgRoot.node());
  isolatedNodes = new Set([...multiSelected]);
  focusDistances = null; selectedId = null; selectedType = null;
  multiSelected.clear();
  selectionListOrder = [];
  document.getElementById('graph-detail-panel').style.display = 'none';
  applyFocusView();
  applyIsolationView();
  refreshSelectionClasses();
}

export function exitIsolation() {
  isolatedNodes = null;
  applyIsolationView();
  if (savedZoomIsolation) {
    svgRoot.transition().duration(1000).ease(d3.easeQuadInOut).call(zoomBehavior.transform, savedZoomIsolation);
    savedZoomIsolation = null;
  }
  refreshSelectionClasses();
  _syncGraphOptionsBtn();
}

function applyIsolationView() {
  if (!gZoom) return;
  const isIsolated = isolatedNodes !== null;
  gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
    const visible = !isIsolated || isolatedNodes.has(d.id);
    d3.select(this).transition().duration(480)
      .style('opacity', visible ? null : 0)
      .style('pointer-events', visible ? null : 'none');
  });
  gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
    const visible = !isIsolated || (isolatedNodes.has(d.source.id) && isolatedNodes.has(d.target.id));
    d3.select(this).transition().duration(480)
      .style('opacity', visible ? null : 0)
      .style('pointer-events', visible ? null : 'none');
  });
  document.getElementById('isolation-pill').classList.toggle('visible', isIsolated);
  if (isIsolated)
    document.getElementById('isolation-pill-label').textContent = `${isolatedNodes.size} nodes isolated`;
}

// ---- Detail Panel ----

let _dirChangeUnlocked = false;
let _rewireUnlocked = false;
let _edgeRewireUnlocked = false;
let _edgeDirUnlocked = false;

function showBranchPanel(v, event) {
  const panel   = document.getElementById('graph-detail-panel');
  const content = document.getElementById('detail-content');
  panel.style.display = '';
  panel.classList.remove('panel-edge');
  panel.style.height = '';
  if (panel._connRo) { panel._connRo.disconnect(); panel._connRo = null; }

  // Position panel near cursor (same logic as showDetailPanel)
  if (event) {
    const container = document.getElementById('graph-container');
    const rect = container.getBoundingClientRect();
    const PW = panel.offsetWidth || 440, PH = panel.offsetHeight || 200;
    let left = event.clientX - rect.left + 14;
    let top  = event.clientY - rect.top  - PH / 2;
    if (left + PW + 8 > container.clientWidth) left = event.clientX - rect.left - PW - 14;
    left = Math.max(8, Math.min(left, container.clientWidth  - PW - 8));
    top  = Math.max(8, Math.min(top,  container.clientHeight - PH - 8));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  } else if (!panel.style.left && !panel.style.top) {
    const container = document.getElementById('graph-container');
    const PW = panel.offsetWidth || 440;
    panel.style.left = Math.max(8, container.clientWidth - PW - 8) + 'px';
    panel.style.top  = '60px';
  }

  // Highlight all edges in the group as selected
  gZoom.select('.edges-layer').selectAll('.g-edge').classed('branch-active', false);
  gZoom.select('.edges-layer').selectAll('.g-edge')
    .filter(d => v.edgeIds.includes(d.id))
    .classed('branch-active', true);

  const hubTitle = nodes[v.hubNode.id]?.title ?? v.hubNode.id;
  const edgeRows = v.edgeIds.map(eid => {
    const e = edges[eid];
    if (!e) return '';
    const spokeId    = e.node_a_id === v.hubNode.id ? e.node_b_id : e.node_a_id;
    const spokeTitle = nodes[spokeId]?.title ?? '?';
    const dir        = e.bidirectional ? '↔' : (e.source_id === v.hubNode.id ? '→' : '←');
    return `<div class="branch-edge-row" data-edge-id="${eid}">
      <span class="branch-edge-endpoints"><span class="branch-edge-dir">${dir}</span> ${spokeTitle}</span>
      <button class="branch-edge-view-btn" data-edge-id="${eid}">View</button>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="branch-panel-header">
      <span class="branch-icon">⑂</span>
      <span class="branch-title">${v.edgeIds.length} connections — <strong>${hubTitle}</strong></span>
    </div>
    <p class="branch-body${v.body ? '' : ' branch-body-empty'}" title="Click to edit label">${v.body || 'No label'}</p>
    <div class="branch-edges-list">${edgeRows}</div>
    <div class="branch-footer">
      <button class="branch-action-btn branch-delete-btn">Delete all</button>
      ${currentState !== 'FirstOutline' ? `<button class="branch-action-btn branch-attach-btn">+ Add connection</button>` : ''}
    </div>
  `;

  // Inline edit description — patches all edges in group (read-only in FirstOutline)
  const bodyEl = content.querySelector('.branch-body');
  if (currentState !== 'FirstOutline') bodyEl.title = 'Click to edit label';
  bodyEl.addEventListener('click', () => {
    if (currentState === 'FirstOutline') return;
    if (bodyEl.contentEditable === 'true') return;
    bodyEl.contentEditable = 'true'; bodyEl.spellcheck = false;
    bodyEl.classList.add('branch-body-editing');
    bodyEl.focus();
    const range = document.createRange(); range.selectNodeContents(bodyEl); range.collapse(false);
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    let saved = false;
    const done = (cancel = false) => {
      if (saved) return; saved = true;
      bodyEl.contentEditable = 'false';
      bodyEl.classList.remove('branch-body-editing');
      if (cancel) { bodyEl.textContent = v.body || 'No label'; bodyEl.classList.toggle('branch-body-empty', !v.body); return; }
      const val = bodyEl.textContent.trim() || null;
      if (val === (v.body || null)) return;
      for (const eid of v.edgeIds) {
        apiRequest('PATCH', `${API}/edges/${eid}`, { body: val });
        if (edges[eid]) edges[eid].body = val;
      }
      v.body = val || '';
      bodyEl.textContent = val || 'No label';
      bodyEl.classList.toggle('branch-body-empty', !val);
      gZoom.select('.labels-layer').selectAll('.edge-label').filter(d => v.edgeIds.includes(d.id)).text(val || '');
    };
    bodyEl.addEventListener('blur', () => done(), { once: true });
    bodyEl.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); bodyEl.blur(); }
      if (ev.key === 'Escape') { done(true); }
    });
  });

  // View individual edge — clicking the row or the View button both work
  const openEdge = (eid) => {
    gZoom.select('.edges-layer').selectAll('.g-edge').classed('branch-active', false);
    selectEdge(eid, null);
  };
  content.querySelectorAll('.branch-edge-row').forEach(row => {
    row.addEventListener('click', () => openEdge(row.dataset.edgeId));
  });
  content.querySelectorAll('.branch-edge-view-btn').forEach(btn => {
    btn.addEventListener('click', ev => { ev.stopPropagation(); openEdge(btn.dataset.edgeId); });
  });

  // Delete all
  content.querySelector('.branch-delete-btn').addEventListener('click', () => {
    showConfirm(`Delete all ${v.edgeIds.length} connections in this branch?`, async () => {
      for (const eid of v.edgeIds) await fetch(`${API}/edges/${eid}`, { method: 'DELETE' });
      deselectAll();
      loadData();
    }, { okLabel: 'Delete all', okClass: 'btn-danger' });
  });

  // Add connection (enters attach mode from hub node)
  content.querySelector('.branch-attach-btn')?.addEventListener('click', () => {
    _selectedBranchKey = null;
    enterAttachFrom(v.hubNode.id);
  });

  // Shared edge color picker
  const colorIdx     = nodeSimData[v.edgeIds[0]]?.colorIdx ?? 0;
  const swatchClr    = i => EDGE_PALETTE[i]?.color ?? EDGE_PALETTE[0].color;
  const dropContainer = document.getElementById('palette-dropdown-container');
  dropContainer.style.display = '';
  dropContainer.innerHTML = `
    <details class="palette-details">
      <summary style="background:${swatchClr(colorIdx)};" title="Change color"></summary>
      <div class="palette-popup">
        <div class="detail-palette">
          ${EDGE_PALETTE.map((p, i) => `<button class="palette-swatch${i === colorIdx ? ' active' : ''}" data-idx="${i}" title="${p.name}" style="background:${swatchClr(i)};"></button>`).join('')}
        </div>
      </div>
    </details>
  `;
  const detailsEl = dropContainer.querySelector('.palette-details');
  const summaryEl = dropContainer.querySelector('summary');
  detailsEl.addEventListener('toggle', () => {
    document.getElementById('graph-container').classList.toggle('color-picking', detailsEl.open);
  });
  _setupPaletteDismiss(detailsEl);
  dropContainer.querySelectorAll('.palette-swatch').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      _branchColors.set(v.key, idx);
      for (const eid of v.edgeIds) {
        if (!nodeSimData[eid]) nodeSimData[eid] = {};
        nodeSimData[eid].colorIdx = idx;
      }
      saveSimData(); ticked();
      dropContainer.querySelectorAll('.palette-swatch').forEach(s => s.classList.toggle('active', parseInt(s.dataset.idx) === idx));
      summaryEl.style.background = swatchClr(idx);
    };
  });

  document.getElementById('detail-edit-btn').style.display = 'none';
  document.getElementById('detail-delete-btn').style.display = 'none';
}

export function showDetailPanel(type, id, event) {
  const panel   = document.getElementById('graph-detail-panel');
  const content = document.getElementById('detail-content');
  panel.style.display = '';
  if (panel._connRo) { panel._connRo.disconnect(); panel._connRo = null; }
  _dirChangeUnlocked = false;
  _rewireUnlocked = false;
  _edgeRewireUnlocked = false;
  _edgeDirUnlocked = false;
  _edgePanelOpen = (type === 'edge');
  _syncGraphOptionsBtn();

  if (type === 'node') {
    panel.classList.remove('panel-edge');
    if (!panel.style.height) panel.style.height = panel.offsetHeight + 'px';
    const n = nodes[id];
    const connEdges = Object.values(edges).filter(e => e.node_a_id === id || e.node_b_id === id);
    const connRows = connEdges.map(e => {
      const otherId    = e.node_a_id === id ? e.node_b_id : e.node_a_id;
      const otherTitle = nodes[otherId]?.title ?? otherId;
      const dir        = e.bidirectional ? '↔' : (e.source_id === id ? '→' : '←');
      const ro = currentState === 'FirstOutline';
      return `<div class="detail-conn-row${ro ? ' detail-conn-ro' : ''}" data-edge-id="${e.id}" data-other-id="${otherId}">
        <span class="detail-conn-dir"${ro ? '' : ' title="Click to change direction"'}>${dir}</span>
        <span class="detail-conn-node"${ro ? '' : ' title="Click to reconnect"'}>${otherTitle}</span>
        <span class="detail-conn-label${e.body ? '' : ' detail-conn-label-empty'}"${ro ? '' : ' title="Click to edit label"'}>${e.body || (ro ? '' : 'add label…')}</span>
        ${ro ? '' : '<button class="detail-conn-delete" title="Delete connection">×</button>'}
      </div>`;
    }).join('');
    content.innerHTML = `
      ${n.node_type === 'Subject' ? '<span class="detail-subject-badge">Subject</span>' : ''}
      <h4 class="editable-title" title="Click to edit title">${n.title}</h4>
      <div class="detail-tab-bar">
        <button class="detail-tab-btn active" data-tab="notes">Notes</button>
        <button class="detail-tab-btn" data-tab="links">Connections${connEdges.length ? ` (${connEdges.length})` : ''}</button>
      </div>
      <div class="detail-tab-pane active" data-tab="notes">
        <p class="editable-body${n.body ? '' : ' detail-body-empty'}" title="Click to edit"></p>
      </div>
      <div class="detail-tab-pane" data-tab="links">
        ${connEdges.length
          ? `<div class="detail-connections">${connRows}</div>`
          : `<p class="detail-no-connections">No connections yet!</p>`}
        <button class="detail-create-link-btn" data-node-id="${id}">+ Create connection</button>
      </div>
    `;

    content.querySelectorAll('.detail-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.remove('active'));
        content.querySelectorAll('.detail-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        content.querySelector(`.detail-tab-pane[data-tab="${btn.dataset.tab}"]`).classList.add('active');
      });
    });

    const createLinkBtn = content.querySelector('.detail-create-link-btn');
    if (createLinkBtn) {
      if (currentState === 'FirstOutline') {
        createLinkBtn.style.display = 'none';
      } else {
        createLinkBtn.addEventListener('click', () => {
          _returnToNodeId = id;
          enterAttachFrom(id);
        });
      }
    }

    const titleEl = content.querySelector('.editable-title');

    const bodyEl = content.querySelector('.editable-body');
    if (n.body) bodyEl.innerHTML = n.body;
    else bodyEl.textContent = '';

    content.querySelectorAll('.detail-conn-row').forEach(row => {
      if (currentState === 'FirstOutline') return;
      const edgeId  = row.dataset.edgeId;
      const otherId = row.dataset.otherId;

      row.querySelector('.detail-conn-delete').addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteEdge(edgeId);
      });

      row.querySelector('.detail-conn-dir').addEventListener('click', async () => {
        if (!_dirChangeUnlocked) {
          showConfirm('Change direction of this connection?', () => {
            _dirChangeUnlocked = true;
            row.querySelector('.detail-conn-dir').click();
          }, { okLabel: 'Change', okClass: 'btn-secondary' });
          return;
        }
        const e = edges[edgeId];
        let newBidir, newSrc;
        if (e.bidirectional)          { newBidir = false; newSrc = id; }
        else if (e.source_id === id)  { newBidir = false; newSrc = otherId; }
        else                          { newBidir = true;  newSrc = null; }
        const ok = await apiRequest('PATCH', `${API}/edges/${edgeId}`, { bidirectional: newBidir, source_id: newSrc });
        if (!ok) return;
        addHistory(`Changed direction: "${nodes[id]?.title}" ${newBidir ? '↔' : '→'} "${nodes[otherId]?.title}"`, '⇄');
        edges[edgeId].bidirectional = newBidir;
        edges[edgeId].source_id     = newSrc;
        row.querySelector('.detail-conn-dir').textContent = newBidir ? '↔' : (newSrc === id ? '→' : '←');
        gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
          if (d.id === edgeId) { d.bidirectional = newBidir; d.source_id = newSrc; }
        });
        ticked();
      });

      const nodeEl = row.querySelector('.detail-conn-node');
      nodeEl.addEventListener('click', () => {
        if (!_rewireUnlocked) {
          showConfirm('Reconnect this connection to a different idea?', () => {
            _rewireUnlocked = true;
            nodeEl.click();
          }, { okLabel: 'Reconnect', okClass: 'btn-secondary' });
          return;
        }
        const e = edges[edgeId];
        const field = e.node_a_id === otherId ? 'node_a_id' : 'node_b_id';
        enterRewireMode(edgeId, field, id, id);
      });

    });

    // Multi-line connections rows: update clamp based on available height per row
    const connListEl = content.querySelector('.detail-connections');
    if (connListEl && connEdges.length) {
      const updateConnLines = () => {
        const pane = connListEl.closest('.detail-tab-pane');
        if (!pane || !pane.classList.contains('active')) return;
        const paneH = pane.offsetHeight;
        const createBtn = content.querySelector('.detail-create-link-btn');
        const createBtnH = createBtn ? createBtn.offsetHeight + 8 : 0;
        const availH = paneH - createBtnH - connListEl.offsetTop;
        const perRow = availH / connEdges.length;
        connListEl.classList.remove('lines-2', 'lines-3');
        if (perRow >= 52) connListEl.classList.add('lines-3');
        else if (perRow >= 36) connListEl.classList.add('lines-2');
      };
      panel._connRo = new ResizeObserver(updateConnLines);
      panel._connRo.observe(panel);
      // Also update when switching to links tab
      content.querySelectorAll('.detail-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => setTimeout(updateConnLines, 0));
      });
    }

    document.getElementById('detail-edit-btn').style.display = 'none';
    const isSubject = nodes[id]?.node_type === 'Subject';
    const deleteBtn = document.getElementById('detail-delete-btn');
    deleteBtn.style.display = isSubject ? 'none' : '';
    deleteBtn.onclick = () => { deselectAll(); deleteNode(id); };

    const colorIdx = nodeSimData[id]?.colorIdx ?? 0;
    const swatchColor = i => `hsla(${NODE_PALETTE[i].h},${NODE_PALETTE[i].s + 10}%,${NODE_PALETTE[i].l + 14}%,0.92)`;
    const dropContainer = document.getElementById('palette-dropdown-container');
    dropContainer.style.display = '';
    dropContainer.innerHTML = `
      <details class="palette-details">
        <summary style="background:${swatchColor(colorIdx)};" title="Change color"></summary>
        <div class="palette-popup">
          <div class="detail-palette">
            ${NODE_PALETTE.map((p, i) => `<button class="palette-swatch${i === colorIdx ? ' active' : ''}" data-idx="${i}" title="${p.name}" style="background:${swatchColor(i)};"></button>`).join('')}
          </div>
        </div>
      </details>
    `;
    const detailsEl  = dropContainer.querySelector('.palette-details');
    const summaryEl  = dropContainer.querySelector('summary');
    const paletteEl  = dropContainer.querySelector('.detail-palette');
    _setupPaletteDismiss(detailsEl);
    paletteEl.querySelectorAll('.palette-swatch').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        if (!nodeSimData[id]) nodeSimData[id] = {};
        nodeSimData[id].colorIdx = idx;
        saveSimData();
        const vars = nodeColorVars(idx);
        gZoom.select('.nodes-layer').selectAll('.g-node').filter(d => d.id === id)
          .each(function() { Object.entries(vars).forEach(([k, v]) => d3.select(this).style(k, v)); });
        paletteEl.querySelectorAll('.palette-swatch').forEach(s => s.classList.toggle('active', parseInt(s.dataset.idx) === idx));
        summaryEl.style.background = swatchColor(idx);
      };
    });

  } else {
    panel.classList.add('panel-edge');
    panel.style.height = '';
    const e = edges[id];
    const aTitle = nodes[e.node_a_id]?.title ?? e.node_a_id;
    const bTitle = nodes[e.node_b_id]?.title ?? e.node_b_id;
    const dirSymbol = () => e.bidirectional ? '↔' : (e.source_id === e.node_a_id ? '→' : '←');
    const edgeRo = currentState === 'FirstOutline';
    content.innerHTML = `
      <p class="editable-body${e.body ? '' : ' detail-body-empty'}"${edgeRo ? '' : ' title="Click to edit label"'}>${e.body || (edgeRo ? '' : 'Add a label…')}</p>
      <div class="edge-direction-row">
        <span class="edge-node-label"${edgeRo ? '' : ` data-field="node_a_id" data-staying-id="${e.node_b_id}" title="Click to reconnect"`}>${aTitle}</span>
        <span class="detail-conn-dir edge-dir-btn"${edgeRo ? '' : ' title="Click to change direction"'}>${dirSymbol()}</span>
        <span class="edge-node-label"${edgeRo ? '' : ` data-field="node_b_id" data-staying-id="${e.node_a_id}" title="Click to reconnect"`}>${bTitle}</span>
      </div>
    `;

    const bodyEl = content.querySelector('.editable-body');
    if (!edgeRo) bodyEl.addEventListener('click', () => {
      const inp = document.createElement('div');
      inp.className = 'inline-edge-label-input';
      inp.contentEditable = 'true'; inp.spellcheck = false;
      inp.textContent = e.body || '';
      bodyEl.replaceWith(inp); inp.focus();
      // place cursor at end
      const range = document.createRange(); range.selectNodeContents(inp); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      let saved = false;
      const save = async () => {
        if (saved) return; saved = true;
        const val = inp.textContent.trim() || null;
        if (val === (e.body || null)) { inp.replaceWith(bodyEl); return; }
        const ok = await apiRequest('PATCH', `${API}/edges/${id}`, { body: val });
        if (!ok) { saved = false; inp.replaceWith(bodyEl); return; }
        if (val) addHistory(`Labeled "${nodes[e.node_a_id]?.title}"–"${nodes[e.node_b_id]?.title}": "${val}"`, '✎');
        edges[id].body = val;
        bodyEl.textContent = val || 'Add a label…';
        bodyEl.classList.toggle('detail-body-empty', !val);
        inp.replaceWith(bodyEl);
        gZoom.select('.labels-layer').selectAll('.edge-label').filter(d => d.id === id).text(val || '');
      };
      inp.addEventListener('blur', save);
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { saved = true; inp.replaceWith(bodyEl); }
      });
    });

    const dirBtn = content.querySelector('.edge-dir-btn');
    if (!edgeRo) dirBtn.addEventListener('click', async () => {
      if (!_edgeDirUnlocked) {
        showConfirm('Change direction of this connection?', () => {
          _edgeDirUnlocked = true;
          dirBtn.click();
        }, { okLabel: 'Change', okClass: 'btn-secondary' });
        return;
      }
      let newBidir, newSrc;
      if (e.bidirectional)                  { newBidir = false; newSrc = e.node_a_id; }
      else if (e.source_id === e.node_a_id) { newBidir = false; newSrc = e.node_b_id; }
      else                                  { newBidir = true;  newSrc = null; }
      const ok = await apiRequest('PATCH', `${API}/edges/${id}`, { bidirectional: newBidir, source_id: newSrc });
      if (!ok) return;
      addHistory(`Changed direction: "${nodes[e.node_a_id]?.title}" ${newBidir ? '↔' : '→'} "${nodes[e.node_b_id]?.title}"`, '⇄');
      edges[id].bidirectional = newBidir;
      edges[id].source_id     = newSrc;
      dirBtn.textContent = dirSymbol();
      gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
        if (d.id === id) { d.bidirectional = newBidir; d.source_id = newSrc; }
      });
      ticked();
    });

    if (!edgeRo) content.querySelectorAll('.edge-node-label').forEach(lbl => {
      lbl.addEventListener('click', () => {
        if (!_edgeRewireUnlocked) {
          showConfirm('Reconnect this connection to a different idea?', () => {
            _edgeRewireUnlocked = true;
            lbl.click();
          }, { okLabel: 'Reconnect', okClass: 'btn-secondary' });
          return;
        }
        enterRewireMode(id, lbl.dataset.field, lbl.dataset.stayingId);
      });
    });

    document.getElementById('detail-edit-btn').style.display = 'none';
    document.getElementById('detail-delete-btn').style.display = '';
    document.getElementById('detail-delete-btn').onclick = () => { deselectAll(); deleteEdge(id); };

    const edgeColorIdx  = nodeSimData[id]?.colorIdx ?? 0;
    const edgeSwatchClr = i => EDGE_PALETTE[i]?.color ?? EDGE_PALETTE[0].color;
    const dropContainer = document.getElementById('palette-dropdown-container');
    dropContainer.style.display = '';
    dropContainer.innerHTML = `
      <details class="palette-details">
        <summary style="background:${edgeSwatchClr(edgeColorIdx)};" title="Change color"></summary>
        <div class="palette-popup">
          <div class="detail-palette">
            ${EDGE_PALETTE.map((p, i) => `<button class="palette-swatch${i === edgeColorIdx ? ' active' : ''}" data-idx="${i}" title="${p.name}" style="background:${edgeSwatchClr(i)};"></button>`).join('')}
          </div>
        </div>
      </details>
    `;
    const detailsEl = dropContainer.querySelector('.palette-details');
    const summaryEl = dropContainer.querySelector('summary');
    const paletteEl = dropContainer.querySelector('.detail-palette');
    detailsEl.addEventListener('toggle', () => {
      document.getElementById('graph-container').classList.toggle('color-picking', detailsEl.open);
    });
    _setupPaletteDismiss(detailsEl);
    paletteEl.querySelectorAll('.palette-swatch').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        if (!nodeSimData[id]) nodeSimData[id] = {};
        nodeSimData[id].colorIdx = idx;
        saveSimData();
        gZoom.select('.edges-layer').selectAll('.g-edge')
          .filter(d => d.id === id)
          .style('--edge-color', edgeSwatchClr(idx));
        paletteEl.querySelectorAll('.palette-swatch').forEach(s => s.classList.toggle('active', parseInt(s.dataset.idx) === idx));
        summaryEl.style.background = edgeSwatchClr(idx);
      };
    });
  }

  document.getElementById('btn-enter-focus').style.display = type === 'node' ? '' : 'none';

  // ---- Questions panel ----
  const qPanel   = document.getElementById('detail-questions-panel');
  const qList    = document.getElementById('detail-questions-list');
  const qInput   = document.getElementById('detail-questions-input');
  const qAddBtn  = document.getElementById('detail-questions-add');
  const qToggle  = document.getElementById('btn-detail-questions');
  const targetType = type; // 'node' or 'edge'

  qPanel.style.display = 'none';
  qInput.value = '';

  const renderQuestions = (questions) => {
    if (!questions.length) {
      qList.innerHTML = '<p class="detail-no-questions">No questions yet.</p>';
      return;
    }
    qList.innerHTML = questions.map(q => `
      <div class="detail-question-row" data-id="${q.id}">
        <span class="detail-question-text">${q.text}</span>
        <button class="detail-question-delete" data-id="${q.id}" title="Delete question">×</button>
      </div>
    `).join('');
    qList.querySelectorAll('.detail-question-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`${API}/questions/${btn.dataset.id}`, { method: 'DELETE' });
        const updated = await fetch(`${API}/questions?target_id=${id}`).then(r => r.json());
        renderQuestions(updated);
      });
    });
  };

  const openQuestions = async () => {
    const questions = await fetch(`${API}/questions?target_id=${id}`).then(r => r.json());
    renderQuestions(questions);
    qPanel.style.display = '';
    qInput.focus();
  };

  qToggle.onclick = () => {
    if (qPanel.style.display === 'none') {
      openQuestions();
    } else {
      qPanel.style.display = 'none';
    }
  };

  const submitQuestion = async () => {
    const text = qInput.value.trim();
    if (!text) return;
    qInput.value = '';
    await fetch(`${API}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: id, target_type: targetType, text }),
    });
    addHistory(`Asked: "${text}"`, '?');
    const updated = await fetch(`${API}/questions?target_id=${id}`).then(r => r.json());
    renderQuestions(updated);
  };

  qAddBtn.onclick = submitQuestion;
  qInput.onkeydown = e => { if (e.key === 'Enter') submitQuestion(); };

  if (event) {
    const container = document.getElementById('graph-container');
    const rect = container.getBoundingClientRect();
    const PW = panel.offsetWidth || 440, PH = panel.offsetHeight || 200;
    let left = event.clientX - rect.left + 14;
    let top  = event.clientY - rect.top  - PH / 2;
    if (left + PW + 8 > container.clientWidth) left = event.clientX - rect.left - PW - 14;
    left = Math.max(8, Math.min(left, container.clientWidth  - PW - 8));
    top  = Math.max(8, Math.min(top,  container.clientHeight - PH - 8));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  } else if (!panel.style.left && !panel.style.top) {
    const container = document.getElementById('graph-container');
    const PW = panel.offsetWidth || 440;
    panel.style.left = Math.max(8, container.clientWidth - PW - 8) + 'px';
    panel.style.top  = '60px';
  }
}

// ---- Deep focus mode ----

export function enterDeepFocusMode() {
  if (!focusDistances || !simulation) return;
  _deepFocusActive = true;
  _syncGraphOptionsBtn();
  document.getElementById('graph-detail-panel').style.display = 'none';
  document.getElementById('deep-focus-exit').style.display = '';
  const focusedNodes = simulation.nodes().filter(n => focusDistances[n.id] !== undefined);
  if (focusedNodes.length) {
    const xs = focusedNodes.map(n => n.x);
    const ys = focusedNodes.map(n => n.y);
    const PAD = 280;
    zoomBehavior.translateExtent([
      [Math.min(...xs) - PAD, Math.min(...ys) - PAD],
      [Math.max(...xs) + PAD, Math.max(...ys) + PAD],
    ]);
    svgRoot.call(zoomBehavior.transform, d3.zoomTransform(svgRoot.node()));
  }
}

export function exitDeepFocusMode() {
  _deepFocusActive = false;
  document.getElementById('deep-focus-exit').style.display = 'none';
  const PAD = 600;
  zoomBehavior.translateExtent([[-PAD, -PAD], [graphW + PAD, graphH + PAD]]);
  svgRoot.call(zoomBehavior.transform, d3.zoomTransform(svgRoot.node()));
  deselectAll();
}

// ---- Draggable detail panel ----
(function () {
  const panel  = document.getElementById('graph-detail-panel');
  const header = panel.querySelector('.detail-header');
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
    panel.style.left  = left + 'px';
    panel.style.top   = top  + 'px';
  });
  document.addEventListener('mouseup', () => {
    _dragging = false;
    header.classList.remove('dragging');
  });
})();

// ---- Resizable detail panel ----
(function () {
  const panel = document.getElementById('graph-detail-panel');
  const MIN_W = 300, MIN_H = 380;
  const maxW = () => window.innerWidth;
  const maxH = () => window.innerHeight;
  let _dir = null, _sx, _sy, _sw, _sh, _pl, _pt;

  panel.querySelectorAll('[class^="detail-resize-"]').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _dir = handle.dataset.dir;
      const r = panel.getBoundingClientRect();
      const cr = document.getElementById('graph-container').getBoundingClientRect();
      if (!panel.style.height) panel.style.height = r.height + 'px';
      _sx = e.clientX; _sy = e.clientY;
      _sw = r.width;   _sh = r.height;
      _pl = r.left - cr.left;
      _pt = r.top  - cr.top;
      e.preventDefault();
      e.stopPropagation();
    });
  });

  document.addEventListener('mousemove', e => {
    if (!_dir) return;
    const container = document.getElementById('graph-container');
    const cw = container.clientWidth, ch = container.clientHeight;
    const dx = e.clientX - _sx, dy = e.clientY - _sy;
    const isEdge = panel.classList.contains('panel-edge');
    const minH = isEdge ? 150 : MIN_H;
    const capH = isEdge ? Math.min(maxH(), 320) : maxH();
    if (_dir === 'r' || _dir === 'br') {
      const newW = Math.max(MIN_W, Math.min(_sw + dx, maxW(), cw - _pl));
      panel.style.width = newW + 'px';
    }
    if (_dir === 'b' || _dir === 'br') {
      const newH = Math.max(minH, Math.min(_sh + dy, capH, ch - _pt));
      panel.style.height = newH + 'px';
    }
    if (_dir === 'l' || _dir === 'tl' || _dir === 'bl') {
      const newW = Math.max(MIN_W, Math.min(_sw - dx, maxW(), _pl + _sw));
      panel.style.width = newW + 'px';
      panel.style.left  = (_pl + _sw - newW) + 'px';
    }
    if (_dir === 't' || _dir === 'tl' || _dir === 'tr') {
      const newH = Math.max(minH, Math.min(_sh - dy, capH, _pt + _sh));
      panel.style.height = newH + 'px';
      panel.style.top    = (_pt + _sh - newH) + 'px';
    }
    if (_dir === 'tr') {
      const newW = Math.max(MIN_W, Math.min(_sw + dx, maxW(), cw - _pl));
      panel.style.width = newW + 'px';
    }
    if (_dir === 'bl') {
      const newH = Math.max(minH, Math.min(_sh + dy, capH, ch - _pt));
      panel.style.height = newH + 'px';
    }
  });

  document.addEventListener('mouseup', () => { _dir = null; });
})();

// Hold 'A' to be in attach mode
let _attachHeld = false;
document.addEventListener('keydown', e => {
  if (e.key !== 'a' && e.key !== 'A') return;
  if (currentState === 'FirstOutline') return;
  if (e.repeat) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  if (attachMode) return;
  if (focusDistances !== null) return;
  if (document.getElementById('modal-overlay')?.classList.contains('open')) return;
  if (document.getElementById('attach-result')?.classList.contains('visible')) return;
  if (document.getElementById('node-result')?.classList.contains('visible')) return;
  if (document.getElementById('graph-detail-panel')?.style.display !== 'none') return;
  if (document.getElementById('history-drawer')?.classList.contains('open')) return;
  if (document.getElementById('questions-drawer')?.classList.contains('open')) return;
  toggleAttachMode(true); _attachHeld = true;
});
document.addEventListener('keyup', e => {
  if (e.key !== 'a' && e.key !== 'A') return;
  if (!_attachHeld) return;
  _attachHeld = false;
  if (attachMode) toggleAttachMode();
});

// ---- Add Node (graph-coupled, lives here) ----

export async function openAddNode() {
  if (currentState === 'FirstOutline') return;
  if (document.getElementById('node-result').classList.contains('visible')) {
    showPillError('node-result-error', 'node-title-input'); return;
  }
  if (_nodeResultStack.length >= 10) return;
  const res = await fetch(`${API}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New Idea', body: null }),
  });
  if (!res.ok) return;
  const newNode = await res.json();
  if (attachMode && _attachSource) {
    const sourceId = _attachSource.id;
    _pendingTargetNodeId = newNode.id;
    _nodeResultOnEnter = async (newNodeId) => {
      await createEdgeDirect(sourceId, newNodeId, false);
    };
  } else if (attachMode) {
    _nodeResultOnEnter = async (newNodeId) => {
      enterAttachFrom(newNodeId);
    };
  }
  await loadData();
  if (isolatedNodes !== null) {
    isolatedNodes.add(newNode.id);
    applyIsolationView();
  }
  showNodeResult(newNode.id);
}

// ---- Cmd+Z Undo (FirstOutline only) ----

document.addEventListener('keydown', async (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.key !== 'z') return;
  if (currentState !== 'FirstOutline') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  e.preventDefault();
  const entry = undoStack.pop();
  if (!entry) return;

  if (entry.type === 'delete-node') {
    const res = await fetch(`${API}/nodes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: entry.node.title, body: entry.node.body ?? null, node_type: entry.node.node_type }),
    });
    if (!res.ok) { undoStack.push(entry); return; }
    const newNode = await res.json();
    for (const edge of entry.edges) {
      const aId  = edge.node_a_id === entry.node.id ? newNode.id : edge.node_a_id;
      const bId  = edge.node_b_id === entry.node.id ? newNode.id : edge.node_b_id;
      const srcId = edge.source_id ? (edge.source_id === entry.node.id ? newNode.id : edge.source_id) : null;
      await fetch(`${API}/edges`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_a_id: aId, node_b_id: bId, body: edge.body ?? null, bidirectional: edge.bidirectional, source_id: srcId }),
      });
    }
    await loadData();
    showToast(`Undo: restored "${entry.node.title}"`);
  } else if (entry.type === 'delete-edge') {
    const edge = entry.edge;
    const res = await fetch(`${API}/edges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_a_id: edge.node_a_id, node_b_id: edge.node_b_id, body: edge.body ?? null, bidirectional: edge.bidirectional, source_id: edge.source_id ?? null }),
    });
    if (res.ok) { await loadData(); showToast('Undo: restored connection'); }
    else undoStack.push(entry);
  } else if (entry.type === 'edit-node-title') {
    const ok = await apiRequest('PATCH', `${API}/nodes/${entry.id}`, { title: entry.oldTitle });
    if (ok) { await loadData(); showToast('Undo: reverted title'); }
    else undoStack.push(entry);
  } else if (entry.type === 'edit-node-body') {
    const ok = await apiRequest('PATCH', `${API}/nodes/${entry.id}`, { body: entry.oldBody });
    if (ok) { await loadData(); showToast('Undo: reverted notes'); }
    else undoStack.push(entry);
  }
});

// ---- Window exports (for inline HTML handlers) ----

Object.assign(window, {
  toggleAttachMode, openAddNode, toggleCheeseMode,
  zoomIn, zoomOut,
  connectMultiSelected, isolateSelected, exitIsolation,
  deselectAll, enterDeepFocusMode, exitDeepFocusMode,
  setLassoMode, openLassoFilter, closeLassoFilter,
  openGraphOptions, closeGraphOptions, toggleFloatMode,
  selectNodeById, selectEdgeById,
});
