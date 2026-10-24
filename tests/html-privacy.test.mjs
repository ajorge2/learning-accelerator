import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><body></body>',{url:'https://learning-accelerator.vercel.app'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
const {sanitizeHtml}=await import('../frontend/scripts/safeHtml.js');
test('untrusted graph HTML cannot execute code, navigate javascript, or load tracking pixels',()=>{
 const safe=sanitizeHtml('<img src="https://tracker.example/pixel" onerror="alert(1)"><script>alert(1)</script><b onclick="alert(2)">Useful</b><a href="javascript:alert(3)">unsafe</a>');
 const el=document.createElement('div');el.innerHTML=safe;
 assert.equal(el.querySelector('img,script'),null);
 assert.equal(el.querySelector('b').getAttribute('onclick'),null);
 assert.equal(el.querySelector('a').getAttribute('href'),null);
 assert.equal(el.querySelector('b').textContent,'Useful');
});
test('sanitized application controls still invoke only delegated known actions',()=>{
 let selected=null;window.selectNodeById=(id)=>{selected=id;};
 const el=document.createElement('div');el.innerHTML=sanitizeHtml('<button data-ui-action="selectNodeById" data-ui-id="fixture-node">View</button>');document.body.append(el);
 el.querySelector('button').click();assert.equal(selected,'fixture-node');
});
