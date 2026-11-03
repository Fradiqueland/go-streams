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

test('Sidebar, Settings and Help show the running application version instead of a stale release literal',()=>{
 const h=uiHarness({locale:'en'});h.run("health={version:'7.8.9-review',tools:{}};showHealth();page='settings';draw()");
 assert.equal(h.element('.version').textContent,'v7.8.9-review');
 assert.match(h.element('#content').innerHTML,/Streamland 7\.8\.9-review/);
 assert.doesNotMatch(h.element('#content').innerHTML,/Streamland 0\.17\.0/);
 h.run("page='help';draw()");assert.match(h.element('#content').innerHTML,/Streamland 7\.8\.9-review/);
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
 const first=h.element('#exit').onclick(),second=h.element('#exit').onclick();try{await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,1);}finally{release();await Promise.all([first,second]);}
});

test('a failed exit request leaves the interface usable and allows retry',async()=>{
 let count=0;const h=uiHarness({fetch:async()=>({ok:++count>1,json:async()=>({error:'Controlled failure'})})});
 await h.element('#exit').onclick();assert.equal(h.element('#exit').disabled,false);await h.element('#exit').onclick();assert.equal(count,2);assert.equal(h.element('#exit').disabled,true);
});

test('navigating back during a save keeps the replacement saving form locked and other drafts editable',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const value={media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}};
 const h=uiHarness({fetch:async(url,init)=>{if(url==='/api/settings'&&init?.method==='PUT')await gate;return {ok:true,json:async()=>url==='/api/state'?value:url==='/api/health'?{version:'1.0.0',tools:{}}:{ok:true}};}});
 const original=h.fields('settings-form',{ffmpeg:'D:/ffmpeg.exe'}),saving=h.emit('submit',original);
 assert.equal(original.elements[0].disabled,true);
 h.run("page='channels';draw()");
 let html='',replacement,other;
 Object.defineProperty(h.element('#content'),'innerHTML',{configurable:true,get:()=>html,set:value=>{html=value;if(value.includes('id="settings-form"')){replacement=h.fields('settings-form',{ffmpeg:'D:/ffmpeg.exe'});other=h.fields('notification-form',{host:'smtp.example.test'});}}});
 try{
  h.run("page='settings';draw()");
  assert.equal(replacement.elements[0].disabled,true);
  assert.equal(other.elements[0].disabled,false);
 }finally{release();await saving;}
 assert.equal(h.element('#settings-form').elements[0].disabled,false);
});

for(const page of ['settings','help'])test('reconnect redraws '+page+' with newly available health and version',async()=>{
 const state={media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}};
 const h=uiHarness({fetch:async url=>({ok:true,json:async()=>url==='/api/health'?{version:'9.1.2',tools:{ffmpeg:{available:true},ffprobe:{available:true}},secureStorage:'Private vault',dataDirectory:'D:/saved-data'}:state})});
 h.run("page='"+page+"';draw()");await h.click('reconnect');
 assert.match(h.element('#content').innerHTML,/Streamland 9\.1\.2/);
 if(page==='settings')assert.match(h.element('#content').innerHTML,/Private vault/);
});

test('language changes wait for a submitted operation even after its modal closes',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const h=uiHarness({locale:'en',fetch:async()=>({ok:true,json:async()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}})})});
 let reloads=0;h.context.location.reload=()=>reloads++;h.context.save=()=>gate;
 h.run("dialog('Pending operation','',save)");const work=h.submit({});h.element('#dialog').close();
 const select=h.element('#language-select');select.value='fr';
 try{select.onchange({target:select});assert.equal(reloads,0);assert.equal(select.value,'en');}
 finally{release();await work;}
 select.value='fr';select.onchange({target:select});assert.equal(reloads,1);
});

test('English media, playlist, download and event actions use translated labels',async()=>{
 const h=uiHarness({locale:'en'});
 h.run("state.media=[{id:'m',title:'Clip',duration:2,size:10,width:640,height:360,fps:30,codec:'h264'}];state.playlists=[{id:'p',name:'Show',quality:'720p',mediaIds:['m']}];state.history=[{id:'e',kind:'event',message:'Activity',time:'2026-10-31T12:00:00Z',level:'info'}]");
 for(const page of ['media','playlists']){h.run('page='+JSON.stringify(page)+';draw()');assert.match(h.element('#content').innerHTML,/>Stream<\/button>/);}
 await h.click('download-new');assert.match(h.element('#dialog-content').innerHTML,/>Download<\/button>/);
 h.element('#dialog').close();h.run("page='history';draw()");assert.match(h.element('#content').innerHTML,/>Event<\/span>/);
});

for(const [name,panel] of [
 ['pending chat operation','chatPanel={busy:true}'],
 ['unsent chat draft','chatPanel={hasUnsavedChanges:true}'],
 ['recording folder operation','capturePanel={production:{preferencesBusy:true}}'],
 ['unsaved recording folder','capturePanel={production:{recordingPreferencesDirty:true}}']
])test('language changes preserve a '+name,()=>{
 const h=uiHarness({locale:'en'});let reloads=0;h.context.location.reload=()=>reloads++;
 h.run(panel);const select=h.element('#language-select');select.value='fr';select.onchange({target:select});
 assert.equal(reloads,0);assert.equal(select.value,'en');assert.ok(h.element('#toast').textContent);
 h.run('chatPanel=undefined;capturePanel=undefined');select.value='fr';select.onchange({target:select});assert.equal(reloads,1);
});
