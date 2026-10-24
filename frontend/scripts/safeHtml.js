import DOMPurify from 'dompurify';
export function sanitizeHtml(value) {
 return DOMPurify.sanitize(String(value ?? ''), {FORBID_TAGS:['img','iframe','video','audio','svg','math','object','embed'], FORBID_ATTR:['srcset']});
}
const clickActions=new Set(['selectNodeById','deleteNode','selectEdgeById','deleteEdge','navigateToResult','isolateSelected']);
document.addEventListener('click', event => {
 const el=event.target.closest('[data-ui-action]');
 if(!el || !clickActions.has(el.dataset.uiAction))return;
 const fn=window[el.dataset.uiAction];
 if(typeof fn !== 'function')return;
 if(el.dataset.uiAction==='navigateToResult')fn(el.dataset.uiKind,el.dataset.uiId);
 else if(el.dataset.uiAction==='isolateSelected')fn();
 else fn(el.dataset.uiId);
});
document.addEventListener('change',event=>{
 const action=event.target.dataset.uiChange;
 if(action==='handleNodeSelect')window.handleNodeSelect?.(event.target);
 if(action==='toggleSourceField')window.toggleSourceField?.();
});
