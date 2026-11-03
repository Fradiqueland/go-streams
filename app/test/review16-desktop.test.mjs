import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCaptureSource,wireCapturePermissions} from '../electron/capture-policy.cjs';

const sources=count=>Array.from({length:count},(_,i)=>({id:'window:'+i,name:'Window '+(i+1)}));
test('desktop picker can select every source beyond the former twenty-window limit',async()=>{
 const all=sources(35);
 for(let target=0;target<all.length;target++){
  const dialogs=[];
  const selected=await chooseCaptureSource(all,{systemAudio:true,showMessageBox:async options=>{
   dialogs.push(options);assert.equal(options.cancelId,0);assert.equal(options.defaultId,0);assert.ok(options.buttons.length<=11);
   assert.match(options.detail,/System audio will also be captured/);
   const index=options.buttons.indexOf(`${target+1}. ${all[target].name}`);
   return {response:index<0?options.buttons.indexOf('Next page'):index};
  }});
  assert.equal(selected,all[target]);assert.equal(dialogs.length,Math.floor(target/8)+1);
 }
});
test('desktop picker supports returning to a previous page without selecting its navigation controls',async()=>{
 const all=sources(19),actions=['Next page','Next page','Previous page','10. Window 10'],seen=[];
 const selected=await chooseCaptureSource(all,{showMessageBox:async options=>{seen.push(options.detail);return {response:options.buttons.indexOf(actions.shift())};}});
 assert.equal(selected,all[9]);assert.equal(actions.length,0);assert.match(seen[2],/Page 3 of 3/);assert.match(seen[3],/Page 2 of 3/);
});
test('desktop picker cancellation and invalid responses never choose a source',async()=>{
 const all=sources(25);
 for(const response of [0,-1,999,1.5,undefined]){
  let calls=0;const selected=await chooseCaptureSource(all,{showMessageBox:async options=>({response:++calls===1?options.buttons.indexOf('Next page'):response})});
  assert.equal(selected,null);assert.equal(calls,2);
 }
 assert.equal(await chooseCaptureSource([],{showMessageBox:()=>{throw Error('Empty picker opened');}}),null);
});
test('choosing a later source does not authorize capture after the requesting frame closes',async()=>{
 const all=sources(28),base='http://127.0.0.1:4317';let destroyed=false;
 const contents={mainFrame:{},isDestroyed:()=>destroyed,getURL:()=>base+'/'};
 const session={setPermissionCheckHandler(){},setPermissionRequestHandler(){},setDisplayMediaRequestHandler(handler){this.display=handler;}};
 wireCapturePermissions(session,{contents,base,platform:'win32',confirmMedia:async()=>true,getSources:async()=>all,chooseSource:list=>chooseCaptureSource(list,{showMessageBox:async options=>{const index=options.buttons.indexOf('26. Window 26');if(index>=0)destroyed=true;return {response:index<0?options.buttons.indexOf('Next page'):index};}})});
 const answer=await new Promise(resolve=>session.display({frame:contents.mainFrame,securityOrigin:base,userGesture:true,videoRequested:true,audioRequested:true},resolve));
 assert.equal(answer,null);
});
