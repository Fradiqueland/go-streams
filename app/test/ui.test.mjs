import * as i18n from '../public/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as ui from '../public/studio-ui.js';
import * as extras from '../public/extras.js';
import * as zones from '../public/timezones.js';
// Exercises the actual view functions with DOM entry points stubbed. This is not a browser/layout test.
function harness(){
 i18n.setLanguage('pt-PT',{persist:false});
 const elements=new Map();const element=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',textContent:'',value:selector==='#source-mode'?'video':'',open:false,hidden:false,elements:{namedItem(){return null;}},addEventListener(){},querySelectorAll(){return[];},querySelector(q){return element(q);},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(selector);};
 const document={querySelector:element,querySelectorAll:()=>[],getElementById:id=>element('#'+id)};
 const context=vm.createContext({...i18n,...ui,...extras,...zones,document,location:{hash:''},localStorage:{getItem:()=>null},Intl,Date,structuredClone,URL,console,setTimeout,clearTimeout,fetch:()=>{throw Error('Unexpected request');}});
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .+;\r?\n/gm,'').split("document.addEventListener('click'")[0];vm.runInContext(source,context);
 return{context,elements,element,run:code=>vm.runInContext(code,context)};
}
test('all eleven views render both empty and populated state without exceptions or unescaped content',()=>{
 const h=harness();const pages=['dashboard','golive','live','media','channels','playlists','schedules','tools','history','settings','help'];
 for(const page of pages){h.run('page='+JSON.stringify(page)+';draw()');assert.ok(h.element('#content').innerHTML.includes('<h1>'),page);}
 h.run(`state={media:[{id:'m',title:'<script>alert(1)</script>',path:'x',duration:10,size:123456,width:1280,height:720,fps:30,codec:'h264'}],channels:[{id:'c',name:'<svg onload=x>',platform:'YouTube',url:'rtmp://example.test/live',hasKey:true}],playlists:[{id:'p',name:'Programme',mediaIds:['m','m'],quality:'720p',loop:true}],schedules:[{id:'s',mediaId:'m',channelIds:['c'],status:'pending',at:new Date().toISOString(),timeZone:'Europe/Lisbon'}],history:[{id:'h',kind:'video',video:'<script>x</script>',channel:'Local',time:new Date().toISOString(),result:'completed'}],jobs:[],settings:{}};`);
 for(const page of pages){h.run('page='+JSON.stringify(page)+';draw()');const html=h.element('#content').innerHTML;assert.ok(!html.includes('<script>'),page);assert.ok(!html.includes('<svg onload'),page);assert.ok(!html.includes('NaN'),page);}
});
test('live preparation contains a direct source, countdown, repetition and per-platform guidance',()=>{const h=harness();h.run("state.media=[{id:'m',title:'Clip',duration:10}];state.channels=[{id:'c',name:'Local',platform:'YouTube'}];liveForm(false,null,'video','m')");const html=h.element('#dialog-content').innerHTML;for(const name of ['sourceMode','mediaId','countdown','autoRestart','pauseOnDisconnect','confirmed'])assert.ok(html.includes('name="'+name+'"'),name);assert.equal(h.element('#source-playlist').hidden,true);assert.equal(h.element('#source-video').hidden,false);});
test('monitor renders a cancellable countdown and paused network controls',()=>{const h=harness();h.run("state.channels=[{id:'c',name:'Local',channelUrl:'https://example.test/watch'}]");let html=h.run("jobCard({id:'j',channelId:'c',channelName:'Local',playlistName:'Clip',status:'countdown',fps:0,elapsed:0,countdownUntil:new Date(Date.now()+10000).toISOString()})");assert.ok(html.includes('Cancelar transmissão'));assert.ok(!html.includes('data-action="restart-job"'));assert.ok(html.includes('data-countdown='));html=h.run("jobCard({id:'j',channelId:'c',channelName:'Local',playlistName:'Clip',status:'paused',pauseReason:'network',fps:0,elapsed:4})");assert.ok(html.includes('data-action="resume-job"'));assert.ok(html.includes('Ligação perdida'));});
test('library supports list and grid, while schedule renders a direct video title',()=>{const h=harness();h.run("state.media=[{id:'m',title:'Direct',duration:5,width:1280,height:720,fps:30,size:123,codec:'h264'}];state.schedules=[{id:'s',mediaId:'m',channelIds:[],status:'pending',at:new Date().toISOString()}]");assert.ok(h.run('mediaView()').includes('media-table'));assert.ok(h.run("mediaLayout='grid';mediaView()").includes('media-grid'));assert.ok(h.run('schedules()').includes('Direct'));});
test('prepared channel cards expose separate preparation, start and scheduling actions',()=>{const h=harness();h.run("state.channels=[{id:'c',name:'Channel',platform:'YouTube'}];state.media=[{id:'m',title:'Prepared clip',duration:10}];state.channelPlans={c:{mediaId:'m',countdown:5}};");const html=h.run('goLiveView()');for(const action of ['plan-channel','plan-start','plan-schedule'])assert.ok(html.includes('data-action="'+action+'"'));assert.ok(html.includes('Prepared clip'));h.run("liveForm(false,null,null,null,'c')");const form=h.element('#dialog-content').innerHTML;assert.ok(form.includes('Guardar preparação'));assert.ok(form.includes('value="5" selected'));assert.ok(!form.includes('name="confirmed" required'));});
test('collection pagination and filtering render the expected window without losing totals',()=>{const h=harness();h.run("state.playlists=Array.from({length:27},(_,i)=>({id:'p'+i,name:'Programme '+i,mediaIds:[],quality:'720p'}));");let html=h.run('playlists()');assert.equal((html.match(/class="panel playlist-card"/g)||[]).length,10);assert.ok(html.includes('de 27'));html=h.run("paging.playlists={page:3,size:10};playlists()");assert.equal((html.match(/class="panel playlist-card"/g)||[]).length,7);html=h.run("query='Programme 26';playlists()");assert.equal((html.match(/class="panel playlist-card"/g)||[]).length,1);assert.ok(html.includes('de 1'));});

test('dashboard and download searches paginate all matching records instead of truncating silently',()=>{
 const h=harness();h.run(`state.history=Array.from({length:31},(_,i)=>({id:'h'+i,time:'2026-10-24T10:00:00Z',channel:'Channel '+i,playlist:'Programme',result:'completed'}));paging.dashboard={page:3,size:10};`);
 let html=h.run('dashboard()');assert.ok(html.includes('de 31'));assert.equal((html.match(/<tr><td><strong>Channel/g)||[]).length,10);
 h.run(`state.downloads=Array.from({length:28},(_,i)=>({id:'d'+i,title:'Download '+i,url:'https://example.test/'+i,status:'completed',created:'2026-10-24T10:00:00Z'}));paging.downloads={page:3,size:10};`);
 html=h.run('tools()');assert.ok(html.includes('de 28'));assert.equal((html.match(/data-action="preview-download"/g)||[]).length,8);
 html=h.run("downloadsQuery='Download 27';tools()");assert.equal((html.match(/data-action=\"preview-download\"/g)||[]).length,1);assert.ok(html.includes('de 1'));
});
test('live search matches channel, programme and current video without hiding the stop-all control',()=>{
 const h=harness();h.run(`state.jobs=[{id:'j',channelName:'Music',playlistName:'Evening',current:{title:'Concert',index:0,offset:0,duration:10},status:'running',fps:30,elapsed:0}];query='Concert'`);assert.ok(h.run('liveView()').includes('data-action="stop-job"'));let html=h.run("query='missing';liveView()");assert.ok(!html.includes('data-action="stop-job"'));assert.ok(html.includes('data-action="stop-all"'));assert.ok(html.includes('Nenhuma emissão neste filtro'));
});


test('monitor exposes escaped error detail and the configured producer link',()=>{
 const h=harness();h.run("state.channels=[{id:'c',producerUrl:'https://example.test/producer'}]");
 const html=h.run("jobCard({id:'j',channelId:'c',channelName:'Local',status:'retrying',fps:0,elapsed:0,error:'<img src=x onerror=alert(1)>'})");
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('href="https://example.test/producer"'));assert.ok(html.includes('rel="noopener noreferrer"'));
 const history=h.run("sessionTable([{channel:'Local',playlist:'Video',result:'error',error:'Authentication <failed>'}])");assert.ok(history.includes('Authentication &lt;failed&gt;'));
});
test('stopping monitor disables repeat stop requests while keeping its status visible',()=>{
 const h=harness(),html=h.run("jobCard({id:'j',channelName:'Local',status:'stopping',fps:0,elapsed:0})");assert.match(html,/<button disabled data-unavailable="true"[^>]+data-action="stop-job"/);assert.ok(html.includes('A parar'));
});

test('portable settings and download recovery explain bundled tools without asking for separate installs',()=>{
 const h=harness();i18n.setLanguage('en',{persist:false});h.run("page='settings';draw()");
 assert.match(h.element('#content').innerHTML,/No separate installation is needed/);
 h.run("page='tools';health=null;draw()");assert.ok(!h.element('#content').innerHTML.includes('Extract the complete'));
 h.run("health={tools:{ytdlp:{available:false}}};draw()");assert.match(h.element('#content').innerHTML,/Extract the complete application folder/);
 i18n.setLanguage('pt-PT',{persist:false});
});
