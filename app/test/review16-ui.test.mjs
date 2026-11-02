import test from 'node:test';
import assert from 'node:assert/strict';
import {uiHarness} from './ui-harness.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const noFile=()=>({size:0,type:''});
function overlayHarness(asset='saved-image.png'){
 const h=uiHarness({locale:'en'}),handlers=new Map();let form,submit;
 h.context.imageData=async file=>file.data;
 // Keep the real editor values/markup and production event callback. Layout
 // styling is covered by browser checks; this fixture controls image timing.
 h.context.styleOverlayPreview=()=>{};
 h.context.dialog=(_title,html,onSubmit)=>{
  h.element('#dialog-content').innerHTML=html;
  form=h.fields('modal-form',{imageEnabled:true,imageWidth:'15',imageX:'95',imageY:'15',imageOpacity:'1',overlayImage:noFile()});
  form.isConnected=true;form.addEventListener=(event,fn)=>handlers.set(event,fn);submit=onSubmit;
 };
 h.run('state.settings.overlays='+JSON.stringify({image:{enabled:true,asset,width:15,x:95,y:15,opacity:1}})+';overlaysForm()');
 return {h,form,field:form.elements.namedItem('overlayImage'),preview:h.element('#modal-form [data-overlay-preview]'),change:()=>handlers.get('change')(),input:()=>handlers.get('input')(),save:()=>submit(new h.context.FormData(form))};
}

for(const asset of ['saved-image.png',''])test('clearing an overlay replacement restores the saved preview and save semantics: '+(asset||'no saved image'),async()=>{
 const f=overlayHarness(asset);f.field.value={size:12,type:'image/png',data:'data:image/png;base64,bmV3'};await f.change();
 assert.match(f.preview.innerHTML,/data:image\/png;base64,bmV3/);
 f.field.value=noFile();await f.change();
 if(asset)assert.match(f.preview.innerHTML,/src="\/api\/overlays\/saved-image.png"/);else assert.equal(f.preview.innerHTML,'');
 assert.doesNotMatch(f.preview.innerHTML,/data:image/);
 await f.save();const request=f.h.requests.find(r=>r.url==='/api/settings'),image=JSON.parse(request.body).overlays.image;
 assert.equal(image.asset,asset);assert.equal(Object.hasOwn(image,'data'),false);
});

test('an obsolete image decode cannot reappear after clearing its replacement and editing other overlay controls',async()=>{
 const f=overlayHarness(),image=deferred();f.h.context.imageData=()=>image.promise;
 f.field.value={size:12,type:'image/png'};const pending=f.change();f.field.value=noFile();await f.change();
 assert.match(f.preview.innerHTML,/\/api\/overlays\/saved-image.png/);
 image.resolve('data:image/png;base64,b2xk');await pending;await f.input();
 assert.match(f.preview.innerHTML,/\/api\/overlays\/saved-image.png/);assert.doesNotMatch(f.preview.innerHTML,/data:image/);
});

test('closing an overlay editor suppresses a late image-read error from the detached form',async()=>{
 const f=overlayHarness(),image=deferred();f.h.context.imageData=()=>image.promise;
 f.field.value={size:12,type:'image/png'};const pending=f.change();f.form.isConnected=false;
 image.reject(Error('Old image failed to decode'));await pending;
 assert.equal(f.h.element('#toast').textContent,'');
});

test('an active overlay image failure remains visible and a later valid selection still previews and saves',async()=>{
 const f=overlayHarness();f.h.context.imageData=async()=>{throw Error('Invalid selected image');};
 f.field.value={size:12,type:'image/png'};await f.change();assert.equal(f.h.element('#toast').textContent,'Invalid selected image');
 f.h.context.imageData=async file=>file.data;f.field.value={size:12,type:'image/png',data:'data:image/png;base64,bmV3'};await f.change();await f.save();
 assert.match(f.preview.innerHTML,/data:image\/png;base64,bmV3/);assert.equal(JSON.parse(f.h.requests.at(-1).body).overlays.image.data,f.field.value.data);
});
