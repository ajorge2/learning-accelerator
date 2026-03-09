import { edges, getAlgoliaSearchIdx } from './api.js';
import { switchView } from './ui.js';
import { zoomToNode, showDetailPanel } from './graph.js';

// ---- Search ----

let _searchDebounce = null;

async function handleSearch(query) {
  const container = document.getElementById('search-results');
  const idx = getAlgoliaSearchIdx();
  if (!idx || !query.trim()) { hideSearchResults(); return; }
  try {
    const { hits } = await idx.search(query, { hitsPerPage: 8 });
    if (!hits.length) {
      container.innerHTML = '<div class="search-no-results">No results found</div>';
    } else {
      container.innerHTML = hits.map(hit => {
        if (hit.type === 'node') {
          const title = hit._highlightResult?.title?.value || hit.title || 'Untitled';
          const sub   = hit.body ? hit.body.slice(0, 65) : '';
          return `<div class="search-result-item" onclick="navigateToResult('node','${hit.nodeId}')">
            <span class="search-result-type node">Idea</span>
            <div class="search-result-text">
              <div class="search-result-title">${title}</div>
              ${sub ? `<div class="search-result-sub">${sub}</div>` : ''}
            </div>
          </div>`;
        } else {
          const label = hit.body || '<span style="font-style:italic;color:#2d3f52">No description</span>';
          const ctx   = `${hit.nodeATitle || '?'} → ${hit.nodeBTitle || '?'}`;
          return `<div class="search-result-item" onclick="navigateToResult('edge','${hit.edgeId}')">
            <span class="search-result-type edge">Conn</span>
            <div class="search-result-text">
              <div class="search-result-title">${ctx}</div>
              <div class="search-result-sub">${label}</div>
            </div>
          </div>`;
        }
      }).join('');
    }
    container.classList.add('visible');
  } catch (err) {
    console.warn('Algolia search failed:', err);
  }
}

function hideSearchResults() {
  document.getElementById('search-results').classList.remove('visible');
}

function closeSearch() {
  document.getElementById('search-input').value = '';
  hideSearchResults();
}

function navigateToResult(type, id) {
  closeSearch();
  switchView('graph');
  if (type === 'node') {
    zoomToNode(id);
    showDetailPanel('node', id, null);
  } else {
    const edge = edges[id];
    if (edge) { zoomToNode(edge.node_a_id); showDetailPanel('edge', id, null); }
  }
}

document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => handleSearch(e.target.value), 250);
});
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
});
document.addEventListener('click', e => {
  if (!document.getElementById('search-wrapper').contains(e.target)) hideSearchResults();
});

// ---- Window exports (for inline HTML handlers in search results) ----

Object.assign(window, { navigateToResult });
