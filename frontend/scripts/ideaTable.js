import { nodes, edges } from './api.js';

function _populate() {
  const body = document.getElementById('idea-table-body');

  const nodeRows = Object.values(nodes)
    .filter(n => n.node_type !== 'Subject')
    .map(n => `
      <tr>
        <td class="it-cell it-title">${n.title}</td>
        <td class="it-cell it-body">${n.body ?? '<span class="it-empty">—</span>'}</td>
      </tr>
    `).join('');

  const edgeRows = Object.values(edges).map(e => {
    const a = nodes[e.node_a_id]?.title ?? '?';
    const b = nodes[e.node_b_id]?.title ?? '?';
    const arrow = e.bidirectional ? '↔' : '→';
    return `
      <tr>
        <td class="it-cell it-conn">${a} ${arrow} ${b}</td>
        <td class="it-cell it-body">${e.body ?? '<span class="it-empty">—</span>'}</td>
      </tr>
    `;
  }).join('');

  body.innerHTML = `
    <div id="it-header-ideas" class="it-section-title it-section-title-ideas">Ideas</div>
    <div class="it-table-wrap">
      <table class="it-table">
        <thead><tr><th class="it-th">Title</th><th class="it-th">Description</th></tr></thead>
        <tbody>${nodeRows || '<tr><td class="it-cell it-empty" colspan="2">No ideas yet</td></tr>'}</tbody>
      </table>
    </div>
    <div id="it-header-connections" class="it-section-title it-section-title-connections">Connections</div>
    <div class="it-table-wrap">
      <table class="it-table">
        <thead><tr><th class="it-th">Connection</th><th class="it-th">Label</th></tr></thead>
        <tbody>${edgeRows || '<tr><td class="it-cell it-empty" colspan="2">No connections yet</td></tr>'}</tbody>
      </table>
    </div>
  `;

  const ideasHeader = body.querySelector('#it-header-ideas');
  const connHeader  = body.querySelector('#it-header-connections');

  // Update CSS var so connections sticky-top offset matches ideas header height
  const updateOffset = () => {
    body.style.setProperty('--ideas-header-h', ideasHeader.offsetHeight + 'px');
  };
  updateOffset();

  // Switch connections header between sticky-bottom and sticky-top
  body.addEventListener('scroll', () => {
    const connTop = connHeader.getBoundingClientRect().top;
    const bodyTop = body.getBoundingClientRect().top;
    const ideasH  = ideasHeader.offsetHeight;
    connHeader.classList.toggle('at-top', connTop - bodyTop <= ideasH + 1);
  });

  // Click section titles to scroll to them
  ideasHeader.addEventListener('click', () => body.scrollTo({ top: 0, behavior: 'smooth' }));
  connHeader.addEventListener('click',  () => {
    body.scrollTo({ top: connHeader.offsetTop - ideasHeader.offsetHeight, behavior: 'smooth' });
  });
}

export function toggleIdeaTableDrawer() {
  const drawer  = document.getElementById('idea-table-drawer');
  const overlay = document.getElementById('idea-table-overlay');
  const opening = !drawer.classList.contains('open');
  drawer.classList.toggle('open', opening);
  overlay.classList.toggle('open', opening);
  if (opening) _populate();
}
