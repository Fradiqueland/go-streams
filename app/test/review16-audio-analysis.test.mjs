import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmTonePowers} from '../scripts/audio-analysis.mjs';

function pcm({mic=.2,screen=.4,micOffset=0,screenOffset=0,jumps=[]}={}){
 const bytes=new Uint8Array(4800*2),view=new DataView(bytes.buffer);
 for(let n=0;n<4800;n++){
  const time=n/8000,phase=jumps.filter(at=>time>=at).length*Math.PI;
  const value=mic*Math.sin(2*Math.PI*(440+micOffset)*time+phase)+screen*Math.sin(2*Math.PI*(880+screenOffset)*time+.47);
  view.setInt16(n*2,Math.round(value*32767),true);
 }
 return bytes;
}
const balance=bytes=>{const powers=pcmTonePowers(bytes,[440,660,880]);return {powers,ratio:powers[880]/powers[440]};};
const variations=[{}, {micOffset:1.5,screenOffset:-1.5}, {jumps:[.21]}, {micOffset:-1.5,jumps:[.05,.15,.25,.35,.45,.55]}];

test('audio energy preserves scene and clip gains across clock drift and phase discontinuities',()=>{
 for(const variation of variations)for(const [mic,screen,min,max]of [[.2,.4,2.8,5.3],[.25,.375,1.5,3.5]]){
  const {powers,ratio}=balance(pcm({...variation,mic,screen}));
  assert.ok(ratio>min&&ratio<max,JSON.stringify({variation,mic,screen,powers,ratio}));
  assert.ok(powers[440]>powers[660]*100&&powers[880]>powers[660]*100,'Both tones remain distinguishable from background energy');
 }
});
test('audio energy rejects stale, swapped, equal or missing scene gains',()=>{
 for(const variation of variations)for(const [mic,screen]of [[.45,.05],[.4,.2],[.2,.2],[0,.4],[.2,0],[0,0]]){
  const {powers,ratio}=balance(pcm({...variation,mic,screen}));
  const accepted=ratio>2.8&&ratio<5.3&&powers[440]>powers[660]*100&&powers[880]>powers[660]*100;
  assert.ok(!accepted,JSON.stringify({variation,mic,screen,powers,ratio}));
 }
});
test('audio energy rejects incomplete PCM and invalid analysis parameters',()=>{
 assert.throws(()=>pcmTonePowers(new Uint8Array(3),[440]),TypeError);
 assert.throws(()=>pcmTonePowers(new Uint8Array(100),[440]),RangeError);
 assert.throws(()=>pcmTonePowers(pcm(),[440],0),TypeError);
 assert.throws(()=>pcmTonePowers(pcm(),[4000]),RangeError);
});
