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
