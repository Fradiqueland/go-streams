import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness} from './ui-harness.mjs';

const blocked={getItem(){throw Error('Storage disabled');},setItem(){throw Error('Storage disabled');}};
test('the interface loads and renders when browser preference storage is blocked',()=>{
 const h=uiHarness({storage:blocked,locale:'en'});h.run('draw()');assert.ok(h.element('#content').innerHTML.includes('Overview'));assert.equal(h.run('mediaLayout'),'list');
});
test('list and grid controls still work for this session when preference writes fail',async()=>{
 const h=uiHarness({storage:{getItem:()=>null,setItem:blocked.setItem},locale:'en'});h.run("page='media';draw()");
 await h.click('media-grid');assert.equal(h.run('mediaLayout'),'grid');assert.ok(h.element('#content').innerHTML.includes('data-action="media-grid"'));assert.equal(h.element('#toast').textContent,'This preference applies to this session only.');
 await h.click('media-list');assert.equal(h.run('mediaLayout'),'list');assert.equal(h.requests.length,0);
});
test('invalid saved layouts fall back to list without hiding either view control',()=>{
 const h=uiHarness({storage:{getItem:()=> 'obsolete',setItem(){}}});assert.equal(h.run('mediaLayout'),'list');
});
test('English dashboard and schedule statuses do not retain Portuguese labels',()=>{
 const h=uiHarness({locale:'en'});h.run('draw()');const html=h.element('#content').innerHTML;
 assert.ok(!html.includes('CANAIS'));assert.ok(!html.includes('AGENDAMENTOS'));assert.ok(html.includes('CHANNELS'));assert.ok(html.includes('SCHEDULES'));assert.equal(h.run("labels.triggered"),'Started');
 h.run("page='history';draw()");assert.ok(h.element('#content').innerHTML.includes('placeholder="Channel, video or programme…"'));
});


test('dashboard labels and triggered statuses follow Spanish, French and Arabic',()=>{
 for(const [locale,channels,started] of [['es','CANALES','Iniciado'],['fr','CHAÎNES','Démarré'],['ar','القنوات','بدأ']]){
  const h=uiHarness({locale});h.run('draw()');assert.ok(h.element('#content').innerHTML.includes(channels));assert.equal(h.run('labels.triggered'),started);
 }
});


test('an outstanding refresh cannot replace the closing screen after exit',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const h=uiHarness({locale:'en',fetch:async url=>{if(url==='/api/state'){await gate;return {ok:true,json:async()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}})};}return {ok:true,json:async()=>({ok:true})};}});
 const pending=h.run('refresh()');await h.element('#exit').onclick();const closing=h.element('#content').innerHTML;
 try{release();await pending;h.run('draw()');assert.equal(h.element('#content').innerHTML,closing);assert.equal(h.element('#exit').disabled,true);}finally{release();await pending;}
});

test('repeated exit clicks share one shutdown request',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const h=uiHarness({fetch:async()=>{await gate;return {ok:true,json:async()=>({ok:true})};}});
 const first=h.element('#exit').onclick(),second=h.element('#exit').onclick();try{assert.equal(h.requests.length,1);}finally{release();await Promise.all([first,second]);}
});

test('a failed exit request leaves the interface usable and allows retry',async()=>{
 let count=0;const h=uiHarness({fetch:async()=>({ok:++count>1,json:async()=>({error:'Controlled failure'})})});
 await h.element('#exit').onclick();assert.equal(h.element('#exit').disabled,false);await h.element('#exit').onclick();assert.equal(count,2);assert.equal(h.element('#exit').disabled,true);
});
