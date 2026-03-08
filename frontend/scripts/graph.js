import * as d3 from 'd3';
import { nodes, edges, loadData, apiRequest, API } from './api.js';
import { showConfirm, openEditNode, deleteNode, openEdgeModal, deleteEdge } from './ui.js';

const NODE_R         = 14;  // base SVG radius of every node circle
const HOVER_VISUAL_R = 17;  // screen-pixel radius a hovered node grows to

// Node palette (HSL): fill/hover/selected/stroke derived automatically per hue.
const NODE_PALETTE = [
  // Default
  { name: 'Pearl',       h: 40,  s: 18, l: 90 },  // index 0 — default for new nodes
  // Blues & teals
  { name: 'Blue',        h: 215, s: 48, l: 40 },
  { name: 'Sky',         h: 198, s: 52, l: 40 },
  { name: 'Seafoam',     h: 172, s: 36, l: 38 },
  { name: 'Teal',        h: 184, s: 42, l: 28 },
  // Greens
  { name: 'Sage',        h: 145, s: 32, l: 38 },
  { name: 'Forest',      h: 145, s: 38, l: 22 },
  // Purples & pinks
  { name: 'Lavender',    h: 262, s: 30, l: 48 },
  { name: 'Plum',        h: 292, s: 24, l: 40 },
  { name: 'Violet',      h: 270, s: 40, l: 28 },
  { name: 'Rose',        h: 338, s: 36, l: 46 },
  { name: 'Crimson',     h: 350, s: 45, l: 28 },
  // Warm tones
  { name: 'Terra',       h: 14,  s: 40, l: 40 },
  { name: 'Rust',        h: 14,  s: 50, l: 26 },
  { name: 'Sand',        h: 34,  s: 42, l: 42 },
  { name: 'Gold',        h: 46,  s: 48, l: 42 },
  { name: 'Umber',       h: 28,  s: 32, l: 24 },
  // Neutrals
  { name: 'Slate',       h: 215, s: 16, l: 36 },
  { name: 'Steel',       h: 215, s: 10, l: 28 },
  { name: 'Charcoal',    h: 220, s:  8, l: 20 },
  { name: 'Stone',       h: 30,  s:  8, l: 32 },
  { name: 'Ash',         h: 30,  s:  4, l: 24 },
];

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
let selectedType  = null;  // 'node' | 'edge'
let hoveredNodeId = null;
let focusDistances = null;
let savedZoom = null;
let isolatedNodes = null;
let _deepFocusActive = false;
let savedZoomIsolation = null;
let _pendingNodePos = null;
let multiSelected = new Set();
let selectionListOrder = [];
const SIM_STORAGE_KEY = 'nodeSimData';
let nodeSimData = (() => {
  try { return JSON.parse(localStorage.getItem(SIM_STORAGE_KEY)) || {}; } catch { return {}; }
})();
export let cheeseMode = localStorage.getItem('cheeseMode') === '1';
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
    simulation.nodes().forEach(n => { n.fx = null; n.fy = null; });
    simulation.force('x', null).force('y', null);
    simulation.force('boundary', makeBoundaryForce());
    simulation.force('link').distance(d => {
      const h = String(d.id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
      return 180 + Math.abs(h % 200);
    });
    simulation.velocityDecay(0.4);
  }
  simulation.alpha(0.5).alphaDecay(0.007).restart();
  updateVisualScales();
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

export function initGraph() {
  const container = document.getElementById('graph-container');
  const W = container.clientWidth || 800;
  const H = 600;

  svgRoot = d3.select('#graph-svg');

  const defs = svgRoot.append('defs');
  defs.append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -3.5 10 7')
    .attr('refX', 10)
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
      updateVisualScales();
    });
  svgRoot.call(zoomBehavior);

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
    showNodeResult(newNode.id);
  };

  svgRoot.on('mousedown.lasso', e => {
    if (attachMode) return;
    if (!e.shiftKey) return;
    if (e.target !== svgRoot.node() && e.target.id !== 'grid-bg') return;
    e.preventDefault();

    const x0 = e.clientX, y0 = e.clientY;
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute', border: '1.5px dashed #fbbf24',
      background: 'rgba(251,191,36,0.08)', pointerEvents: 'none', zIndex: '99',
    });
    const containerEl = document.getElementById('graph-container');
    containerEl.appendChild(overlay);

    const containerRect = containerEl.getBoundingClientRect();
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
        _suppressClick = true;
        gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
          const hidden = focusDistances && focusDistances[d.id] === undefined;
          if (hidden) return;
          const nb = this.getBoundingClientRect();
          const cx = nb.left + nb.width / 2, cy = nb.top + nb.height / 2;
          if (cx >= lassoBox.left && cx <= lassoBox.right &&
              cy >= lassoBox.top  && cy <= lassoBox.bottom) {
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
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  simulation = d3.forceSimulation()
    .force('link',    d3.forceLink().id(d => d.id).distance(d => {
      const h = String(d.id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
      return 180 + Math.abs(h % 200);
    }))
    .force('charge',   d3.forceManyBody().strength(-650).distanceMin(NODE_R))
    .force('collide',  d3.forceCollide(NODE_R * 2.2).strength(0.25))
    .force('boundary', makeBoundaryForce())
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
      gZoom.select('.labels-layer').selectAll('.edge-label')
        .filter(l => l.id === d.id).style('opacity', 1);
    })
    .on('mouseleave', (e, d) => {
      if (!(d.id === selectedId && selectedType === 'edge')) {
        gZoom.select('.labels-layer').selectAll('.edge-label')
          .filter(l => l.id === d.id).style('opacity', 0);
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

  nodeGs.select('text').text(d => d.title);

  simulation.nodes(simNodes);
  simulation.force('link').links(simEdges);
  simulation.alpha(0.3).restart();
  updateVisualScales();

  if (_attachSource) {
    const fresh = simulation.nodes().find(n => n.id === _attachSource.id);
    if (fresh) _attachSource = fresh;
  }
}

function ticked() {
  gZoom.select('.nodes-layer').selectAll('.g-node')
    .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

  if (_attachSource && !_ghostHidden) {
    const ghost = gZoom.select('.attach-ghost');
    if (!ghost.empty()) {
      const tip = _ghostTipPos();
      if (tip) ghost.attr('x1', _attachSource.x ?? 0).attr('y1', _attachSource.y ?? 0)
                    .attr('x2', tip.x).attr('y2', tip.y);
    }
  }

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
    let pathD, labelX, labelY;
    if (focusDistances !== null) {
      pathD  = `M${x1},${y1} L${x2},${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = (y1 + y2) / 2 - 9;
    } else {
      const h  = String(d.id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
      const h2 = (h * 1664525 + 1013904223) | 0;
      const sign = (h & 1) ? 1 : -1;
      const t    = Math.max(0, 1 - dist / 200);
      const base = 5 + Math.abs(h % 10) + t * t * 460;
      const curl = sign * t * t * Math.PI * 0.65;
      const f2   = (Math.abs(h2 % 19) - 6) / 10;
      const rot  = (θ, mag) => [
        mag * ((-uy) * Math.cos(θ) - ux * Math.sin(θ)),
        mag * ((-uy) * Math.sin(θ) + ux * Math.cos(θ)),
      ];
      const [o1x, o1y] = rot(curl,      base);
      const [o2x, o2y] = rot(curl * f2, base);
      const cp1x = x1 + (x2-x1)*0.35 + o1x, cp1y = y1 + (y2-y1)*0.35 + o1y;
      const cp2x = x1 + (x2-x1)*0.65 + o2x, cp2y = y1 + (y2-y1)*0.65 + o2y;
      pathD  = `M${x1},${y1} C${cp1x},${cp1y} ${cp2x},${cp2y} ${x2},${y2}`;
      labelX = 0.125*x1 + 0.375*cp1x + 0.375*cp2x + 0.125*x2;
      labelY = 0.125*y1 + 0.375*cp1y + 0.375*cp2y + 0.125*y2 - 9;
    }

    d3.select(this).select('.edge-hit').attr('d', pathD);
    d3.select(this).select('.edge-line').attr('d', pathD).attr('marker-end', arrow);
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

export function toggleAttachMode() {
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
    escHint.classList.add('visible');
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
}

function showAttachResult(edgeId, onComplete) {
  clearTimeout(_attachResultTimer);
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
      showToast('Link created!');
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
      toggleAttachMode();
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
      if (!e.active) simulation.alphaTarget(0.3).restart();
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
      d.fx = e.x; d.fy = e.y;
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
      if (!e.active) simulation.alphaTarget(0);
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
        d.fx = null; d.fy = null;
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

function selectEdge(id, event) {
  selectedId   = id;
  selectedType = 'edge';
  refreshSelectionClasses();
  showDetailPanel('edge', id, event);
  zoomToEdge(id);
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
  multiSelected.clear();
  selectionListOrder = [];
  refreshSelectionClasses();
  applyFocusView();
  if (wasFocused && savedZoom) {
    svgRoot.transition().duration(1000).ease(d3.easeQuadInOut).call(zoomBehavior.transform, savedZoom);
    savedZoom = null;
  }
  document.getElementById('graph-detail-panel').style.display = 'none';
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

export function showDetailPanel(type, id, event) {
  const panel   = document.getElementById('graph-detail-panel');
  const content = document.getElementById('detail-content');
  panel.style.display = '';

  if (type === 'node') {
    const n = nodes[id];
    const connEdges = Object.values(edges).filter(e => e.node_a_id === id || e.node_b_id === id);
    const connRows = connEdges.map(e => {
      const otherId    = e.node_a_id === id ? e.node_b_id : e.node_a_id;
      const otherTitle = nodes[otherId]?.title ?? otherId;
      const dir        = e.bidirectional ? '↔' : (e.source_id === id ? '→' : '←');
      return `<div class="detail-conn-row" data-edge-id="${e.id}" data-other-id="${otherId}">
        <span class="detail-conn-dir" title="Click to change direction">${dir}</span>
        <span class="detail-conn-node" title="Click to rename">${otherTitle}</span>
        <span class="detail-conn-label${e.body ? '' : ' detail-conn-label-empty'}" title="Click to edit label">${e.body || 'add label…'}</span>
        <button class="detail-conn-delete" title="Delete connection">×</button>
      </div>`;
    }).join('');
    content.innerHTML = `
      <h4 class="editable-title" title="Click to edit title">${n.title}</h4>
      <div class="detail-tab-bar">
        <button class="detail-tab-btn active" data-tab="notes">Notes</button>
        <button class="detail-tab-btn" data-tab="links">Links${connEdges.length ? ` (${connEdges.length})` : ''}</button>
      </div>
      <div class="detail-tab-pane active" data-tab="notes">
        <p class="editable-body${n.body ? '' : ' detail-body-empty'}" title="Click to edit"></p>
      </div>
      <div class="detail-tab-pane" data-tab="links">
        ${connEdges.length
          ? `<div class="detail-connections">${connRows}</div>`
          : `<p class="detail-no-connections">No connections yet!</p>`}
        <button class="detail-create-link-btn" data-node-id="${id}">+ Create link</button>
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
      createLinkBtn.addEventListener('click', () => {
        _returnToNodeId = id;
        enterAttachFrom(id);
      });
    }

    const titleEl = content.querySelector('.editable-title');
    titleEl.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = nodes[id].title;
      input.className = 'inline-title-input';
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      let saved = false;
      const save = async () => {
        if (saved) return;
        saved = true;
        const newTitle = input.value.trim();
        if (!newTitle || newTitle === nodes[id].title) { input.replaceWith(titleEl); return; }
        const ok = await apiRequest('PATCH', `${API}/nodes/${id}`, { title: newTitle });
        if (!ok) { saved = false; input.replaceWith(titleEl); return; }
        nodes[id].title = newTitle;
        titleEl.textContent = newTitle;
        input.replaceWith(titleEl);
        gZoom.select('.nodes-layer').selectAll('.g-node').each(function(d) {
          if (d.id === id) { d.title = newTitle; d3.select(this).select('text').text(newTitle); }
        });
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { saved = true; input.replaceWith(titleEl); }
      });
    });

    const bodyEl = content.querySelector('.editable-body');
    if (n.body) bodyEl.innerHTML = n.body;
    else bodyEl.textContent = '✏️ Click to add notes…';

    bodyEl.addEventListener('click', () => {
      const editor = document.createElement('div');
      editor.contentEditable = 'true';
      editor.className = 'inline-body-editor';
      editor.spellcheck = true;
      const existing = nodes[id].body || '';
      editor.innerHTML = (existing && !/<[a-z][\s\S]*>/i.test(existing))
        ? existing.replace(/\n/g, '<br>')
        : existing;
      bodyEl.replaceWith(editor);
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let saved = false;
      const save = async () => {
        if (saved) return;
        saved = true;
        const newBody = editor.innerHTML.replace(/<br\s*\/?>/gi, '<br>').trim();
        const clean = newBody === '<br>' ? null : (newBody || null);
        if (clean === (nodes[id].body || null)) { editor.replaceWith(bodyEl); return; }
        const ok = await apiRequest('PATCH', `${API}/nodes/${id}`, { body: clean });
        if (!ok) { saved = false; editor.replaceWith(bodyEl); return; }
        nodes[id].body = clean;
        if (clean) bodyEl.innerHTML = clean;
        else bodyEl.textContent = '✏️ Click to add notes…';
        bodyEl.classList.toggle('detail-body-empty', !clean);
        editor.replaceWith(bodyEl);
      };

      editor.addEventListener('blur', save);
      editor.addEventListener('keydown', e => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key === 'b') { e.preventDefault(); document.execCommand('bold'); return; }
        if (mod && e.key === 'i') { e.preventDefault(); document.execCommand('italic'); return; }
        if (mod && e.key === 'u') { e.preventDefault(); document.execCommand('underline'); return; }
        if (e.key === 'Tab') {
          e.preventDefault();
          e.shiftKey ? document.execCommand('outdent') : document.execCommand('indent');
          return;
        }
        if (e.key === ' ') {
          const sel = window.getSelection();
          if (sel.rangeCount) {
            const r = sel.getRangeAt(0);
            const textBefore = r.startContainer.textContent?.slice(0, r.startOffset);
            if (textBefore === '-') {
              e.preventDefault();
              const del = document.createRange();
              del.setStart(r.startContainer, r.startOffset - 1);
              del.setEnd(r.startContainer, r.startOffset);
              sel.removeAllRanges(); sel.addRange(del);
              document.execCommand('delete');
              document.execCommand('insertUnorderedList');
              return;
            }
          }
        }
        if (e.key === 'Escape') { saved = true; editor.replaceWith(bodyEl); }
      });
    });

    content.querySelectorAll('.detail-conn-row').forEach(row => {
      const edgeId  = row.dataset.edgeId;
      const otherId = row.dataset.otherId;

      row.querySelector('.detail-conn-delete').addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteEdge(edgeId);
      });

      row.querySelector('.detail-conn-dir').addEventListener('click', async () => {
        const e = edges[edgeId];
        let newBidir, newSrc;
        if (e.bidirectional)          { newBidir = false; newSrc = id; }
        else if (e.source_id === id)  { newBidir = false; newSrc = otherId; }
        else                          { newBidir = true;  newSrc = null; }
        const ok = await apiRequest('PATCH', `${API}/edges/${edgeId}`, { bidirectional: newBidir, source_id: newSrc });
        if (!ok) return;
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
        const e = edges[edgeId];
        const field = e.node_a_id === otherId ? 'node_a_id' : 'node_b_id';
        enterRewireMode(edgeId, field, id, id);
      });

      const labelEl = row.querySelector('.detail-conn-label');
      labelEl.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.className = 'detail-conn-input label-input'; inp.type = 'text';
        inp.value = edges[edgeId]?.body || ''; inp.placeholder = 'label…';
        labelEl.replaceWith(inp); inp.focus();
        let saved = false;
        const save = async () => {
          if (saved) return; saved = true;
          const val = inp.value.trim() || null;
          if (val === (edges[edgeId]?.body || null)) { inp.replaceWith(labelEl); return; }
          const ok = await apiRequest('PATCH', `${API}/edges/${edgeId}`, { body: val });
          if (!ok) { saved = false; inp.replaceWith(labelEl); return; }
          edges[edgeId].body = val;
          labelEl.textContent = val || 'add label…';
          labelEl.classList.toggle('detail-conn-label-empty', !val);
          inp.replaceWith(labelEl);
        };
        inp.addEventListener('blur', save);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { saved = true; inp.replaceWith(labelEl); } });
      });
    });
    document.getElementById('detail-edit-btn').style.display = 'none';
    document.getElementById('detail-delete-btn').onclick = () => { deselectAll(); deleteNode(id); };

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
        detailsEl.removeAttribute('open');
      };
    });

  } else {
    const e = edges[id];
    const aTitle = nodes[e.node_a_id]?.title ?? e.node_a_id;
    const bTitle = nodes[e.node_b_id]?.title ?? e.node_b_id;
    const dirSymbol = () => e.bidirectional ? '↔' : (e.source_id === e.node_a_id ? '→' : '←');
    content.innerHTML = `
      <p class="editable-body${e.body ? '' : ' detail-body-empty'}" title="Click to edit label">${e.body || 'Add a label…'}</p>
      <div class="edge-direction-row">
        <span class="edge-node-label" data-field="node_a_id" data-staying-id="${e.node_b_id}" title="Move this endpoint">${aTitle}</span>
        <span class="detail-conn-dir edge-dir-btn" title="Click to change direction">${dirSymbol()}</span>
        <span class="edge-node-label" data-field="node_b_id" data-staying-id="${e.node_a_id}" title="Move this endpoint">${bTitle}</span>
      </div>
    `;

    const bodyEl = content.querySelector('.editable-body');
    bodyEl.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'inline-title-input';
      inp.value = e.body || ''; inp.placeholder = 'Add a label…';
      bodyEl.replaceWith(inp); inp.focus(); inp.select();
      let saved = false;
      const save = async () => {
        if (saved) return; saved = true;
        const val = inp.value.trim() || null;
        if (val === (e.body || null)) { inp.replaceWith(bodyEl); return; }
        const ok = await apiRequest('PATCH', `${API}/edges/${id}`, { body: val });
        if (!ok) { saved = false; inp.replaceWith(bodyEl); return; }
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
    dirBtn.addEventListener('click', async () => {
      let newBidir, newSrc;
      if (e.bidirectional)                  { newBidir = false; newSrc = e.node_a_id; }
      else if (e.source_id === e.node_a_id) { newBidir = false; newSrc = e.node_b_id; }
      else                                  { newBidir = true;  newSrc = null; }
      const ok = await apiRequest('PATCH', `${API}/edges/${id}`, { bidirectional: newBidir, source_id: newSrc });
      if (!ok) return;
      edges[id].bidirectional = newBidir;
      edges[id].source_id     = newSrc;
      dirBtn.textContent = dirSymbol();
      gZoom.select('.edges-layer').selectAll('.g-edge').each(function(d) {
        if (d.id === id) { d.bidirectional = newBidir; d.source_id = newSrc; }
      });
      ticked();
    });

    content.querySelectorAll('.edge-node-label').forEach(lbl => {
      lbl.addEventListener('click', () => enterRewireMode(id, lbl.dataset.field, lbl.dataset.stayingId));
    });

    document.getElementById('detail-edit-btn').style.display = 'none';
    document.getElementById('detail-delete-btn').onclick = () => { deselectAll(); deleteEdge(id); };
    document.getElementById('palette-dropdown-container').style.display = 'none';
  }

  document.getElementById('btn-enter-focus').style.display = type === 'node' ? '' : 'none';

  if (event) {
    const container = document.getElementById('graph-container');
    const rect = container.getBoundingClientRect();
    const PW = 260, PH = panel.offsetHeight || 200;
    let left = event.clientX - rect.left + 14;
    let top  = event.clientY - rect.top  - PH / 2;
    if (left + PW + 8 > container.clientWidth) left = event.clientX - rect.left - PW - 14;
    left = Math.max(8, Math.min(left, container.clientWidth  - PW - 8));
    top  = Math.max(8, Math.min(top,  container.clientHeight - PH - 8));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  }
}

// ---- Deep focus mode ----

export function enterDeepFocusMode() {
  if (!focusDistances || !simulation) return;
  _deepFocusActive = true;
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
  const MIN_W = 220, MIN_H = 220;
  const maxW = () => window.innerWidth;
  const maxH = () => window.innerHeight;
  let _dir = null, _sx, _sy, _sw, _sh, _pl, _pt;

  panel.querySelectorAll('[class^="detail-resize-"]').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _dir = handle.dataset.dir;
      const r = panel.getBoundingClientRect();
      const cr = document.getElementById('graph-container').getBoundingClientRect();
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
    if (_dir === 'r' || _dir === 'br') {
      const newW = Math.max(MIN_W, Math.min(_sw + dx, maxW(), cw - _pl));
      panel.style.width = newW + 'px';
    }
    if (_dir === 'b' || _dir === 'br') {
      const newH = Math.max(MIN_H, Math.min(_sh + dy, maxH(), ch - _pt));
      panel.style.height = newH + 'px';
    }
    if (_dir === 'l' || _dir === 'tl' || _dir === 'bl') {
      const newW = Math.max(MIN_W, Math.min(_sw - dx, maxW(), _pl + _sw));
      panel.style.width = newW + 'px';
      panel.style.left  = (_pl + _sw - newW) + 'px';
    }
    if (_dir === 't' || _dir === 'tl' || _dir === 'tr') {
      const newH = Math.max(MIN_H, Math.min(_sh - dy, maxH(), _pt + _sh));
      panel.style.height = newH + 'px';
      panel.style.top    = (_pt + _sh - newH) + 'px';
    }
    if (_dir === 'tr') {
      const newW = Math.max(MIN_W, Math.min(_sw + dx, maxW(), cw - _pl));
      panel.style.width = newW + 'px';
    }
    if (_dir === 'bl') {
      const newH = Math.max(MIN_H, Math.min(_sh + dy, maxH(), ch - _pt));
      panel.style.height = newH + 'px';
    }
  });

  document.addEventListener('mouseup', () => { _dir = null; });
})();

// 'A' key toggles attach mode
document.addEventListener('keydown', e => {
  if (e.key !== 'a' && e.key !== 'A') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  if (attachMode) { toggleAttachMode(); return; }
  if (focusDistances !== null) return;
  if (isolatedNodes !== null) return;
  if (document.getElementById('modal-overlay')?.classList.contains('open')) return;
  if (document.getElementById('attach-result')?.classList.contains('visible')) return;
  if (document.getElementById('node-result')?.classList.contains('visible')) return;
  toggleAttachMode();
});

// ---- Add Node (graph-coupled, lives here) ----

export async function openAddNode() {
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
  showNodeResult(newNode.id);
}

// ---- Window exports (for inline HTML handlers) ----

Object.assign(window, {
  toggleAttachMode, openAddNode, toggleCheeseMode,
  zoomIn, zoomOut,
  connectMultiSelected, isolateSelected, exitIsolation,
  deselectAll, enterDeepFocusMode, exitDeepFocusMode,
});
