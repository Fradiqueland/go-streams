import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness} from './ui-harness.mjs';

const empty=()=>({media:[],channels:[],playlists:[],schedules:[],jobs:[],history:[],settings:{ffmpeg:'/old/ffmpeg'}});
const ok=value=>({ok:true,json:async()=>value});

function settingsHarness(fetch){
 const h=uiHarness({locale:'en',fetch});
 h.run("page='settings';state.settings.ffmpeg='/old/ffmpeg'");
 // Recreate the visible form on redraw, as innerHTML does in the browser.
 let html='';Object.defineProperty(h.element('#content'),'innerHTML',{get:()=>html,set:value=>{html=value;h.fields('settings-form',{ffmpeg:h.run('state.settings.ffmpeg')});}});
 return h;
}

test('saved settings survive a failed state refresh and report the completed save accurately',async()=>{
 const h=settingsHarness(async url=>{if(url==='/api/state')throw Error('State unavailable');return ok({ok:true});});
 const form=h.fields('settings-form',{ffmpeg:'/new/ffmpeg'});
 await h.emit('submit',form);
 assert.equal(h.element('#settings-form').elements.namedItem('ffmpeg').value,'/new/ffmpeg');
 assert.match(h.element('#toast').textContent,/Settings saved.*State unavailable/);
 assert.equal(h.element('#connection-warning').hidden,false);
 assert.equal(h.run("settingsDrafts.has('settings-form')"),true);
 assert.equal(h.run('settingsSaving'),false);
});

test('saved settings refresh before health and remain visible if only health fails',async()=>{
 const calls=[],state=empty();state.settings.ffmpeg='/new/ffmpeg';
 const h=settingsHarness(async url=>{calls.push(url);if(url==='/api/health')throw Error('Health unavailable');return ok(url==='/api/state'?state:{ok:true});});
 await h.emit('submit',h.fields('settings-form',{ffmpeg:'/new/ffmpeg'}));
 assert.deepEqual(calls,['/api/settings','/api/state','/api/health']);
 assert.equal(h.element('#settings-form').elements.namedItem('ffmpeg').value,'/new/ffmpeg');
 assert.equal(h.run("settingsDrafts.has('settings-form')"),false);
 assert.match(h.element('#toast').textContent,/Settings saved.*Health unavailable/);
});

test('failed settings mutations keep the submitted draft without claiming it was saved',async()=>{
 const h=settingsHarness(async()=>({ok:false,json:async()=>({error:'Invalid tool'})}));
 await h.emit('submit',h.fields('settings-form',{ffmpeg:'/missing/ffmpeg'}));
 assert.equal(h.element('#settings-form').elements.namedItem('ffmpeg').value,'/missing/ffmpeg');
 assert.equal(h.element('#toast').textContent,'Invalid tool');
 assert.equal(h.requests.length,1);
});

test('a confirmed SMTP save clears the typed secret even when refreshing state fails',async()=>{
 const h=uiHarness({locale:'en',fetch:async url=>{if(url==='/api/state')throw Error('State unavailable');return ok({hasPassword:true});}});
 h.run("page='settings'");
 const form=h.fields('notification-form',{host:'smtp.example.test',password:'private-draft',port:'587',enabled:false});
 await h.emit('submit',form);
 assert.equal(form.elements.namedItem('password').value,'');
 assert.equal(h.run("settingsDrafts.get('notification-form').find(field=>field.name==='password').value"),'');
 assert.equal(h.run("settingsDrafts.get('notification-form').find(field=>field.name==='host').value"),'smtp.example.test');
 assert.match(h.element('#toast').textContent,/Settings saved/);
});

for(const [action,label]of [['channel-edit',/no longer available/],['playlist-edit',/Playlist unavailable/]])test('a stale '+action+' button cannot silently become a new-item form',async()=>{
 const h=uiHarness({locale:'en',fetch:async()=>ok(empty())});
 // Static lists can still show an entry after another window removes it and
 // a background poll has applied the newer state without repainting the list.
 h.run("state.channels=[];state.playlists=[]");await h.click(action,'removed-id');
 assert.equal(h.element('#dialog').open,false);assert.equal(h.element('#dialog-content').innerHTML,'');assert.equal(h.requests.length,0);assert.match(h.element('#toast').textContent,label);
});

test('explicit new channel and playlist actions still open their creation forms',async()=>{
 const h=uiHarness({locale:'en'});await h.click('channel-new');assert.equal(h.element('#dialog').open,true);assert.match(h.element('#dialog-content').innerHTML,/Add channel/);
 h.element('#dialog').close();await h.click('playlist-new');assert.equal(h.element('#dialog').open,true);assert.match(h.element('#dialog-content').innerHTML,/New playlist/);
});
