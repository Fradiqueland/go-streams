import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness} from './ui-harness.mjs';

function selectionHarness(){
 const h=uiHarness({locale:'en'});
 h.run("state.media=[{id:'kept-video',title:'Different video',duration:3},{id:'wanted-video',title:'Wanted video',duration:4}];state.playlists=[{id:'kept-playlist',name:'Different playlist',mediaIds:['kept-video'],quality:'720p'},{id:'wanted-playlist',name:'Wanted playlist',mediaIds:['wanted-video'],quality:'720p'}];state.channels=[{id:'kept-channel',name:'Remaining channel',platform:'YouTube',hasKey:true}];state.schedules=[];state.jobs=[]");
 return h;
}

for(const [action,message]of [
 ['single-live',/video is no longer available/i],
 ['playlist-live',/Playlist unavailable/i],
 ['schedule-edit',/schedule is no longer available/i],
 ['plan-channel',/channel is no longer available/i],
 ['plan-schedule',/channel is no longer available/i],
 ['plan-start',/channel is no longer available/i],
 ['rename-media',/video is no longer available/i],
 ['arm',/schedule is no longer available/i]
])test('a stale '+action+' action does not substitute another saved item or send an API request',async()=>{
 const h=selectionHarness();
 // Static lists may still contain a removed item after a poll applies state
 // without repainting the list. Another valid item remains available.
 await h.click(action,'removed-item');
 assert.equal(h.element('#dialog').open,false);
 assert.equal(h.element('#dialog-content').innerHTML,'');
 assert.equal(h.requests.length,0);
 assert.match(h.element('#toast').textContent,message);
 assert.equal(h.buttons.at(-1).disabled,false);
 assert.equal(h.run('pendingActions.size'),0);
});

test('an emptied playlist cannot fall back to a different playable playlist',async()=>{
 const h=selectionHarness();h.run("state.playlists.push({id:'empty-playlist',name:'Emptied playlist',mediaIds:[],quality:'720p'})");
 await h.click('playlist-live','empty-playlist');
 assert.equal(h.element('#dialog').open,false);
 assert.equal(h.requests.length,0);
 assert.match(h.element('#toast').textContent,/playlist is empty/i);
});

for(const [action,id,field]of [
 ['single-live','wanted-video','mediaId'],
 ['playlist-live','wanted-playlist','playlistId']
])test(action+' retains the exact existing item selected by the user',async()=>{
 const h=selectionHarness();await h.click(action,id);
 assert.equal(h.element('#dialog').open,true);
 const html=h.element('#dialog-content').innerHTML;
 const select=html.match(new RegExp('<select name="'+field+'">([\\s\\S]*?)<\\/select>'))?.[1];
 assert.ok(select);assert.match(select,new RegExp('<option value="'+id+'" selected>'));
 assert.equal(h.requests.length,0,'Opening the preparation form cannot start a transmission');
});

test('new broadcast and schedule preparation still open without an existing-item identifier',async()=>{
 const h=selectionHarness();await h.click('go-live');assert.equal(h.element('#dialog').open,true);
 h.element('#dialog').close();await h.click('schedule-new');assert.equal(h.element('#dialog').open,true);
 assert.equal(h.requests.length,0);
});

for(const [label,setup,clean]of [
 ['live composition',"capturePanel={production:{hasUnsavedChanges:true}}","capturePanel.production.hasUnsavedChanges=false"],
 ['recorder composition',"recorderPanel={hasUnsavedChanges:true}","recorderPanel.hasUnsavedChanges=false"]
])test('language changes preserve an unsaved '+label+' and allow a clean scene',()=>{
 const h=uiHarness({locale:'en'});let reloads=0;h.context.location.reload=()=>reloads++;h.run(setup);
 const select=h.element('#language-select');select.value='fr';select.onchange({target:select});
 assert.equal(reloads,0);assert.equal(select.value,'en');assert.ok(h.element('#toast').textContent);
 h.run(clean);select.value='fr';select.onchange({target:select});assert.equal(reloads,1);
});

for(const [locale,placeholder,hint]of [
 ['en','Leave blank to keep it for the same SMTP configuration','SMTP server, port, security and username are unchanged'],
 ['pt-PT','Deixe vazio para manter na mesma configuração SMTP','servidor, porta, segurança e utilizador SMTP não mudarem']
])test('SMTP password help explains retention only for unchanged connection details in '+locale,()=>{
 const h=uiHarness({locale});h.run("state.notifications={enabled:true,host:'smtp.example.test',port:587,security:'starttls',username:'studio',hasPassword:true};page='settings';draw()");
 const html=h.element('#content').innerHTML;
 assert.ok(html.includes('placeholder="'+placeholder+'"'));
 assert.ok(html.includes(hint));
 assert.match(html,/<input type="password" name="password" autocomplete="new-password" placeholder="/);
 assert.ok(!html.includes('name="password" value='));
});
