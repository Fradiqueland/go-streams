import test from 'node:test';
import assert from 'node:assert/strict';
import {wireCapturePermissions} from '../electron/capture-policy.cjs';

function fixture(overrides={}){
 const base='http://127.0.0.1:4317';
 const contents={mainFrame:{},isDestroyed:()=>false,getURL:()=>base+'/'};
 const session={setPermissionCheckHandler(fn){this.check=fn;},setPermissionRequestHandler(fn){this.request=fn;},setDisplayMediaRequestHandler(fn){this.display=fn;}};
 wireCapturePermissions(session,{contents,base,confirmMedia:async()=>true,getSources:async()=>[],chooseSource:async()=>null,...overrides});
 const ask=(types,details={})=>new Promise(resolve=>session.request(contents,'media',resolve,{requestingUrl:base+'/',isMainFrame:true,mediaTypes:types,...details}));
 const check=(type,details={})=>session.check(contents,'media',base,{mediaType:type,isMainFrame:true,requestingUrl:base+'/',...details});
 return {base,contents,session,ask,check};
}

test('microphone consent cannot silently authorize a camera or an embedded frame',async()=>{
 const confirmations=[],f=fixture({confirmMedia:async types=>{confirmations.push(types);return true;}});
 assert.equal(await f.ask(['audio']),true);
 assert.equal(f.check('audio'),true);
 assert.equal(f.check('video'),false);
 assert.equal(f.check('unknown'),false);
 assert.equal(f.check('audio',{isMainFrame:false}),false);
 assert.equal(f.check('audio',{requestingUrl:f.base+'/api/state'}),false);
 assert.equal(f.session.check(null,'media',f.base,{mediaType:'audio'}),false);
 assert.equal(await f.ask(['video']),true);
 assert.equal(f.check('video'),true);
 assert.equal(f.check('unknown'),true);
 assert.deepEqual(confirmations,[['audio'],['video']]);
});

test('capture denies consent failures, unexpected types and navigation during confirmation',async()=>{
 for(const confirmMedia of [()=>{throw Error('dialog unavailable');},async()=>{throw Error('dialog closed');},async()=>false]){
  const f=fixture({confirmMedia});assert.equal(await f.ask(['audio']),false);assert.equal(f.check('audio'),false);
 }
 const invalid=fixture();assert.equal(await invalid.ask(['screen']),false);
 let decide;
 const f=fixture({confirmMedia:()=>new Promise(resolve=>decide=resolve)});
 const pending=f.ask(['audio']);await Promise.resolve();
 f.contents.getURL=()=>f.base+'/api/state';decide(true);
 assert.equal(await pending,false);
 f.contents.getURL=()=>f.base+'/';assert.equal(f.check('audio'),false);
});

test('screen permission is never cached to bypass a fresh source selection',async()=>{
 const f=fixture();
 assert.equal(await new Promise(resolve=>f.session.request(f.contents,'display-capture',resolve,{requestingUrl:f.base+'/',isMainFrame:true})),true);
 assert.equal(f.session.check(f.contents,'display-capture',f.base,{isMainFrame:true}),false);
});

test('Electron display capture accepts both serialized forms of the trusted origin',async()=>{
 for(const suffix of ['', '/']){
  const source={id:'screen:1',name:'Screen'};let selections=0;
  const f=fixture({platform:'win32',getSources:async()=>[source],chooseSource:async()=>{selections++;return source;}});
  const answer=await new Promise(resolve=>f.session.display({frame:f.contents.mainFrame,securityOrigin:f.base+suffix,userGesture:true,videoRequested:true,audioRequested:true},resolve));
  assert.deepEqual(answer,{video:source,audio:'loopback'},'serialized origin '+suffix);
  assert.equal(selections,1,'each capture still requires source selection');
 }
});

test('canonical display origin matching rejects other origins and non-origin URLs before selection',async()=>{
 let enumerated=0;
 const f=fixture({getSources:async()=>{enumerated++;return [];}});
 for(const origin of ['http://localhost:4317/','http://127.0.0.1:4318/','https://127.0.0.1:4317/',f.base+'/api/state',f.base+'/?token=untrusted',f.base+'/#capture','http://user@127.0.0.1:4317/','http://127.0.0.1.evil.test:4317/','null','']){
  const answer=await new Promise(resolve=>f.session.display({frame:f.contents.mainFrame,securityOrigin:origin,userGesture:true,videoRequested:true},resolve));
  assert.equal(answer,null,origin);
 }
 assert.equal(enumerated,0);
});

test('screen picker settles a destroyed-frame callback once without retrying it',async()=>{
 const source={id:'screen:1',name:'Screen'},f=fixture({getSources:async()=>[source],chooseSource:async()=>source});
 const calls=[];f.session.display({frame:f.contents.mainFrame,securityOrigin:f.base,userGesture:true,videoRequested:true,audioRequested:false},value=>{calls.push(value);if(calls.length===1)throw Error('Frame was destroyed');});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
});

test('closing while screen sources are enumerated does not open a stale picker',async()=>{
 let release,picked=0;const pending=new Promise(resolve=>{release=resolve;}),f=fixture({getSources:()=>pending,chooseSource:async()=>{picked++;return null;}});
 const answer=new Promise(resolve=>f.session.display({frame:f.contents.mainFrame,securityOrigin:f.base,userGesture:true,videoRequested:true,audioRequested:false},resolve));
 f.contents.isDestroyed=()=>true;release([{id:'screen:1',name:'Screen'}]);
 assert.equal(await answer,null);assert.equal(picked,0);
});
