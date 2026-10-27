import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness} from './ui-harness.mjs';
const empty=()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{}});
const ok=value=>({ok:true,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function ready(options={}){const h=uiHarness({fetch:async()=>ok(empty()),...options});h.run(`state={...state,media:[{id:'m',title:'Video',duration:5}],channels:[{id:'c',name:'Channel',platform:'YouTube'}],playlists:[{id:'p',name:'First',mediaIds:['m']},{id:'q',name:'Second',mediaIds:['m']}],channelPlans:{c:{mediaId:'m',quality:'1080p'}}};`);return h;}
const selection={sourceMode:'video',mediaId:'m',quality:'1080p',channelIds:['c'],countdown:'10',autoRestart:'default',pauseOnDisconnect:true,endOnVideoFailure:true,autoReconnect:false,confirmed:true};
test('prepared-channel Schedule creates a new schedule; existing schedule Edit updates its ID',async()=>{
 for(const edit of [false,true]){
  const h=ready();if(edit)h.run(`state.schedules=[{id:'s',mediaId:'m',channelIds:['c'],timeZone:'UTC',at:'2099-01-01T12:00:00Z'}]`);
  await h.click(edit?'schedule-edit':'plan-schedule',edit?'s':'c');
  await h.submit({...selection,at:'2099-01-01T12:00',timeZone:'UTC',disambiguation:'reject',armed:false});
  const req=h.requests.find(r=>r.url.startsWith('/api/schedules'));assert.equal(req.url,edit?'/api/schedules/s':'/api/schedules');assert.equal(req.method,edit?'PUT':'POST');assert.equal(JSON.parse(req.body).armed,false);
 }
});
test('playlist Transmit preselects that exact playlist and sends only that source',async()=>{
 const h=ready();await h.click('playlist-live','q');const html=h.element('#dialog-content').innerHTML;
 assert.match(html,/<option value="q" selected>/);assert.match(html,/<option value="playlist" selected>/);
 await h.submit({...selection,sourceMode:'playlist',playlistId:'q'});const body=JSON.parse(h.requests.find(r=>r.url==='/api/start').body);assert.equal(body.playlistId,'q');assert.equal(body.mediaId,undefined);
});
test('individual offline test requests no channel or broadcast confirmation',async()=>{const h=ready();await h.click('test-media','m');assert.deepEqual(JSON.parse(h.requests[0].body),{mediaId:'m',preview:true});});
test('modal completion cannot close or overwrite a newer modal after the first was closed',async()=>{
 const pending=deferred(),h=ready();h.context.save=()=>pending.promise;h.run(`dialog('First','',save)`);const first=h.submit({name:'one'});h.element('#dialog').close();h.run(`dialog('Second','<p>Keep me</p>')`);pending.resolve();await first;assert.equal(h.element('#dialog').open,true);assert.match(h.element('#dialog-content').innerHTML,/Keep me/);
});
test('modal double submit sends once and failure restores fields while keeping errors visible',async()=>{
 const pending=deferred(),h=ready();let count=0;h.context.save=()=>{count++;return pending.promise;};h.run(`dialog('Save','',save)`);const form=h.fields('modal-form',{name:'draft'}),event={target:form,preventDefault(){}};const a=form.onsubmit(event);await form.onsubmit(event);assert.equal(count,1);assert.equal(form.elements[0].disabled,true);pending.reject(Error('Validation failed'));await a;assert.equal(form.elements[0].disabled,false);assert.equal(h.element('#modal-form .form-error').textContent,'Validation failed');assert.equal(h.element('#dialog').open,true);
});
test('late modal errors are reported without modifying a different dialog',async()=>{
 const pending=deferred(),h=ready();h.context.save=()=>pending.promise;h.run(`dialog('Old','',save)`);const work=h.submit({});h.element('#dialog').close();h.run(`dialog('New','Unchanged')`);pending.reject(Error('Failed earlier'));await work;assert.match(h.element('#dialog-content').innerHTML,/Unchanged/);assert.equal(h.element('#toast').textContent,'Failed earlier');
});
test('overlapping state responses cannot overwrite a newer applied response',async()=>{
 const first=deferred(),second=deferred();let call=0;const h=ready({fetch:()=>++call===1?first.promise:second.promise});const a=h.run('refresh(false)'),b=h.run('refresh(false)');second.resolve(ok({...empty(),marker:'new'}));await b;first.resolve(ok({...empty(),marker:'old'}));await a;assert.equal(h.run('state.marker'),'new');
});
test('pending actions block replacement buttons created by refresh',async()=>{
 const pending=deferred();const h=ready({fetch:url=>url.endsWith('/stop')?pending.promise:Promise.resolve(ok(empty()))});const first=h.click('stop-job','j');await h.click('stop-job','j');assert.equal(h.requests.filter(r=>r.url.endsWith('/stop')).length,1);pending.resolve(ok({ok:true}));await first;assert.equal(h.run('pendingActions.size'),0);
});
test('settings save preserves other unsaved form values and clears only its own draft',async()=>{
 const h=ready();h.run("page='settings'");const notification=h.fields('notification-form',{host:'smtp.draft.test',password:'UNSAVED'});await h.emit('input',notification.elements[0]);const encoding=h.fields('encoding-form',{copy:false,videoBitrate:'4500',audioBitrate:'128',fps:'30',aspect:'16:9'});await h.emit('input',encoding.elements[0]);await h.emit('submit',encoding);
 assert.equal(h.run("settingsDrafts.has('notification-form')"),true);assert.equal(h.run("settingsDrafts.has('encoding-form')"),false);assert.equal(notification.elements.namedItem('password').value,'UNSAVED');assert.deepEqual(JSON.parse(h.requests[0].body).encoding,{copy:false,videoBitrate:4500,audioBitrate:128,fps:30,aspect:'16:9'});
});
test('declined confirmations never send start, resume, restart, deletion, email or clear requests',async()=>{
 const h=ready({confirm:false});h.run("state.schedules=[{id:'s',armed:false}]");for(const [action,id]of [['plan-start','c'],['resume-job','j'],['restart-job','j'],['delete-media','m'],['delete-channel','c'],['delete-playlist','p'],['delete-schedule','s'],['stop-all'],['clear-history'],['clear-schedules'],['test-email'],['arm','s']])await h.click(action,id);assert.equal(h.requests.length,0);
});
test('poll failure is visible and reconnect clears warning after successful state fetch',async()=>{
 let fail=true;const h=ready({fetch:async url=>{if(fail)throw Error('offline');return ok(url==='/api/health'?{tools:{ffmpeg:{available:true},ffprobe:{available:true}}}:empty());}});await h.intervals[0]();assert.equal(h.element('#connection-warning').hidden,false);fail=false;await h.click('reconnect');assert.equal(h.element('#connection-warning').hidden,true);
});
test('file picker writes only to its original form, never into a replacement dialog',async()=>{
 const pending=deferred();const h=ready({fetch:()=>pending.promise});await h.click('import');const old=h.element('textarea[name=paths]');const work=h.element('#pick-files').onclick();h.element('#dialog').close();h.run("dialog('Other','Unrelated')");pending.resolve(ok({paths:['D:/video.mp4']}));await work;assert.equal(old.value,'D:/video.mp4');assert.match(h.element('#dialog-content').innerHTML,/Unrelated/);
});
test('titles are escaped, dialog is labelled, navigation exposes the current page, and removal text is accurate',async()=>{
 const h=ready();h.run(`dialog('<img src=x onerror=alert(1)>','');draw()`);assert.ok(!h.element('#dialog-content').innerHTML.includes('<img'));assert.match(h.element('#dialog-content').innerHTML,/id="dialog-title"/);assert.match(h.element('#nav').innerHTML,/aria-current="page"/);await h.click('remove-download','d');assert.match(h.element('#toast').textContent,/ficheiro no computador/);assert.ok(!h.element('#toast').textContent.includes('biblioteca'));
});

test('password visibility toggles only the typed field and never requests saved secrets',async()=>{
 const h=ready();await h.click('channel-new');const form=h.fields('modal-form',{key:'TYPED'}),input=form.elements.namedItem('key');input.type='password';const button=h.element('show-key');button.dataset={secret:'key'};button.form=form;
 await h.emit('click',button);assert.equal(input.type,'text');assert.equal(button['aria-pressed'],'true');await h.emit('click',button);assert.equal(input.type,'password');assert.equal(h.requests.length,0);
});
test('removing media from playlists requires an explicit checked form and sends detach intent',async()=>{
 const h=ready();await h.click('delete-media','m');assert.equal(h.requests.length,0);assert.match(h.element('#dialog-content').innerHTML,/detachFromPlaylists/);await h.submit({detachFromPlaylists:true});assert.equal(h.requests[0].url,'/api/media/m');assert.equal(h.requests[0].method,'DELETE');assert.deepEqual(JSON.parse(h.requests[0].body),{detachFromPlaylists:true});
});


test('poll response respects a field focused after the request started',async()=>{
 const pending=deferred(),h=ready({fetch:()=>pending.promise});
 h.element('#content').innerHTML='Keep the current editor';
 const work=h.intervals[0]();
 h.context.document.activeElement={tagName:'INPUT'};
 pending.resolve(ok({...empty(),marker:'latest'}));await work;
 assert.equal(h.run('state.marker'),'latest');
 assert.equal(h.element('#content').innerHTML,'Keep the current editor');
});

test('poll response respects navigation to a static page while the request was in flight',async()=>{
 const pending=deferred(),h=ready({fetch:()=>pending.promise});
 const work=h.intervals[0]();h.run("page='media'");h.element('#content').innerHTML='Current library';
 pending.resolve(ok(empty()));await work;
 assert.equal(h.element('#content').innerHTML,'Current library');
});

test('read-only modal never performs native form navigation on submit',async()=>{
 const h=ready();h.run("dialog('Preview','<video></video>')");let prevented=false;
 const form=h.element('#modal-form');assert.equal(typeof form.onsubmit,'function');
 await form.onsubmit({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(h.requests.length,0);
});

test('paused queue offers to save without claiming it resumes transmission',async()=>{
 const h=ready();h.run("state.jobs=[{id:'j',status:'paused',queue:[{id:'m',title:'Video'}],current:{index:0}}]");
 await h.click('job-queue','j');assert.match(h.element('#dialog-content').innerHTML,/Guardar fila/);
 assert.ok(!h.element('#dialog-content').innerHTML.includes('Aplicar e retomar'));
});


test('direct-copy mode disables transcoding controls but preserves their profile when saving',async()=>{
 const h=ready();h.run("page='settings'");
 const form=h.fields('encoding-form',{copy:true,videoBitrate:'4500',audioBitrate:'192',fps:'60',aspect:'9:16'});
 await h.emit('change',form.elements.namedItem('copy'));
 for(const name of ['videoBitrate','audioBitrate','fps','aspect'])assert.equal(form.elements.namedItem(name).disabled,true);
 await h.emit('submit',form);
 assert.deepEqual(JSON.parse(h.requests[0].body).encoding,{copy:true,videoBitrate:4500,audioBitrate:192,fps:60,aspect:'9:16'});
 form.elements.namedItem('copy').checked=false;await h.emit('change',form.elements.namedItem('copy'));
 for(const name of ['videoBitrate','audioBitrate','fps','aspect'])assert.equal(form.elements.namedItem(name).disabled,false);
});

test('playlist addition retains the selected video instead of resetting to the first',async()=>{
 const h=ready();h.run("state.media.push({id:'second',title:'Second',duration:8})");
 await h.click('playlist-new');h.fields('modal-form',{name:'Programme',quality:'720p',loop:false});
 h.element('#add-media').value='second';h.element('#add-media-button').onclick();
 assert.equal(h.element('#add-media').value,'second');
 h.fields('modal-form',{name:'Programme',quality:'720p',loop:false});h.element('#add-media-button').onclick();
 await h.submit({name:'Programme',quality:'720p',loop:false});
 assert.deepEqual(JSON.parse(h.requests[0].body).mediaIds,['second','second']);
});


test('background redraw retains keyboard focus on the same monitor action',()=>{
 const h=ready();let focused=false;
 const button=()=>({tagName:'BUTTON',dataset:{action:'stop-job',id:'j'},getAttribute:()=>null,closest:q=>q==='#content'?h.element('#content'):null,focus(){focused=true;}});
 const old=button(),replacement=button();let buttons=[old];h.context.document.activeElement=old;
 const query=h.context.document.querySelectorAll;h.context.document.querySelectorAll=q=>q==='#content button,#content a'?buttons:query(q);
 Object.defineProperty(h.element('#content'),'innerHTML',{set(){buttons=[replacement];},get(){return '';}});
 h.run('draw()');assert.equal(focused,true);
});

test('unchanged navigation is not replaced during periodic page redraw',()=>{
 const h=ready();let html='',replacements=0;
 Object.defineProperty(h.element('#nav'),'innerHTML',{get:()=>html,set:value=>{html=value;replacements++;}});
 h.run('draw();draw()');assert.equal(replacements,1);
 h.run("page='tools';draw()");assert.equal(replacements,2);
});
