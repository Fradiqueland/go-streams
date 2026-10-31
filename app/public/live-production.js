import {language} from './i18n.js';
const t=(en,pt)=>language()==='pt-PT'?pt:en;
const defaults={layout:'pip',background:'#111827',accent:'#e70952',name:'',title:'',banner:'',ticker:'',mirror:false,logo:'',backgroundImage:''};
export function layoutRects(layout,width,height,hasCamera,hasScreen){
 if(!hasScreen)return hasCamera?[{source:'camera',x:0,y:0,w:width,h:height}]:[];
 if(!hasCamera||layout==='screen')return [{source:'screen',x:0,y:0,w:width,h:height}];
 if(layout==='camera')return [{source:'camera',x:0,y:0,w:width,h:height}];
 if(layout==='split')return [{source:'screen',x:0,y:height*.1,w:width*.64,h:height*.8},{source:'camera',x:width*.66,y:height*.1,w:width*.34,h:height*.8}];
 return [{source:'screen',x:0,y:0,w:width,h:height},{source:'camera',x:width*.70,y:height*.70,w:width*.28,h:height*.28}];
}
export class ProductionTools {
 constructor({api,toast,getStream,uploaderClass,setVolume,setClipAudio,snapshot,acquireFeed,releaseFeed}){Object.assign(this,{api,toast,getStream,uploaderClass,setVolume,setClipAudio,snapshot,acquireFeed,releaseFeed});this.values={...defaults};this.images={};this.scenes={};try{const saved=JSON.parse(localStorage.getItem('go-streams-scenes')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))this.scenes=saved;}catch{}this.level=0;}
 get recording(){return Boolean(this.recordingId)||Boolean(this.finishing)||Boolean(this.starting);}
 mount(parent){
  if(this.element)return;
  this.element=document.createElement('section');this.element.className='panel production-tools';
  this.element.innerHTML=`<h2>${t('Studio production','Produção do estúdio')}</h2><div class="production-grid"><div><label>${t('Live layout','Layout ao vivo')}<select name="layout"><option value="pip">${t('Picture in picture','Imagem na imagem')}</option><option value="split">${t('Screen + presenter side by side','Ecrã e apresentador lado a lado')}</option><option value="camera">${t('Camera only','Apenas câmara')}</option><option value="screen">${t('Screen only','Apenas ecrã')}</option></select></label><label class="check"><input type="checkbox" name="mirror">${t('Mirror camera','Espelhar câmara')}</label><div class="form-row"><label>${t('Background','Fundo')}<input name="background" type="color" value="#111827"></label><label>${t('Brand color','Cor da marca')}<input name="accent" type="color" value="#e70952"></label></div><label>${t('Logo image','Imagem do logótipo')}<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label><label>${t('Background image','Imagem de fundo')}<input type="file" name="backgroundImage" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="secondary small" data-production="clear-images">${t('Remove images','Remover imagens')}</button></div><div><label>${t('Presenter name','Nome do apresentador')}<input name="name" maxlength="80"></label><label>${t('Presenter title','Título do apresentador')}<input name="title" maxlength="100"></label><label>${t('On-screen banner','Faixa no vídeo')}<input name="banner" maxlength="160"></label><label>${t('Scrolling ticker','Texto em movimento')}<input name="ticker" maxlength="500"></label><label>${t('Microphone volume','Volume do microfone')}<input type="range" name="micVolume" min="0" max="1.5" step="0.05" value="1"></label><label>${t('Shared audio volume','Volume do áudio partilhado')}<input type="range" name="screenVolume" min="0" max="1.5" step="0.05" value="1"></label><label>${t('Mixed audio level','Nível do áudio misturado')}<meter class="capture-audio-meter" min="0" max="1" value="0"></meter></label></div></div><div class="form-row"><label>${t('Saved studio scene','Cena guardada')}<select name="scene"><option value="intro">Intro</option><option value="main">${t('Main','Principal')}</option><option value="presentation">${t('Presentation','Apresentação')}</option><option value="outro">Outro</option></select></label><div class="actions"><button type="button" class="secondary" data-production="save-scene">${t('Save scene','Guardar cena')}</button><button type="button" class="secondary" data-production="load-scene">${t('Load scene','Carregar cena')}</button></div></div><details><summary>${t('Private notes & teleprompter','Notas privadas e teleponto')}</summary><label>${t('These notes are not drawn into the program frame.','Estas notas não são desenhadas no vídeo do programa.')}<textarea name="notes" rows="4" maxlength="30000"></textarea></label><div class="teleprompter" tabindex="0"></div><button type="button" class="secondary" data-production="teleprompter">${t('Start / pause scrolling','Iniciar / pausar movimento')}</button></details><h3>${t('Local recording','Gravação local')}</h3><p>${t('Record the composed video and mixed audio to this computer, with or without broadcasting. Files are saved locally; no cloud recording is used.','Grave o vídeo composto e o áudio misturado neste computador, com ou sem transmissão. Os ficheiros ficam guardados localmente; não é usada gravação na nuvem.')}</p><div class="actions"><button type="button" class="secondary" data-production="record" disabled>${t('Start local recording','Iniciar gravação local')}</button><button type="button" class="danger" data-production="stop-record" disabled>${t('Stop & save recording','Parar e guardar gravação')}</button></div><p class="recording-status" role="status"></p><div class="recording-files"></div>`;
  parent.appendChild(this.element);
  const clips=document.createElement('div');clips.className='production-clips';clips.innerHTML=`<h3>${t('Intro, outro & video clips','Introdução, encerramento e clips')}</h3><label>${t('Local video file','Vídeo local')}<input type="file" name="clipFile" accept="video/mp4,video/webm"></label><p class="form-hint">${t('The clip replaces the live picture and temporarily mutes the live microphone/shared audio. At the end, the live picture and audio return.','O clip substitui a imagem ao vivo e silencia temporariamente o microfone/áudio partilhado. No final regressam a imagem e o áudio ao vivo.')}</p><div class="actions"><button type="button" class="secondary" data-production="play-clip">${t('Play selected clip','Reproduzir clip selecionado')}</button><button type="button" class="secondary" data-production="stop-clip">${t('Return to live','Regressar ao direto')}</button><button type="button" class="secondary" data-production="snapshot">${t('Save frame as PNG','Guardar imagem PNG')}</button></div><p class="form-hint">${t('Shortcuts: Ctrl+Alt+1–4 changes layouts. Ctrl+Alt+R starts/stops local recording.','Atalhos: Ctrl+Alt+1–4 muda o layout. Ctrl+Alt+R inicia/para a gravação local.')}</p>`;
  this.element.appendChild(clips);
  window.addEventListener('keydown',event=>{if(!event.ctrlKey||!event.altKey||event.repeat)return;const layouts={'1':'camera','2':'screen','3':'pip','4':'split'};if(layouts[event.key]){event.preventDefault();this.values.layout=layouts[event.key];this.element.querySelector('[name=layout]').value=this.values.layout;}if(event.code==='KeyR'&&this.getStream()){event.preventDefault();if(this.recording)void this.stopRecording();else void this.startRecording();}});
  this.element.addEventListener('input',event=>{
   const el=event.target;if(['background','accent','name','title','banner','ticker','layout'].includes(el.name))this.values[el.name]=el.value;if(el.name==='mirror')this.values.mirror=el.checked;
   if(el.name==='micVolume'||el.name==='screenVolume')this.setVolume(el.name,Number(el.value));
   if(el.name==='notes')this.element.querySelector('.teleprompter').textContent=el.value;
  });
  this.element.addEventListener('change',event=>{const el=event.target;if(el.type==='file'&&el.name!=='clipFile')void this.loadImage(el.name,el.files[0]);if(el.name==='layout')this.values.layout=el.value;});
  this.element.addEventListener('click',event=>{const b=event.target.closest('[data-production]');if(b&&!b.disabled)void this.action(b);});
 }
 async loadImage(name,file){
  if(!file)return;
  const token={};this.imageLoads ||= {};this.imageLoads[name]=token;
  try{
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error(t('Choose a PNG, JPEG or WebP image up to 2 MB.','Escolha uma imagem PNG, JPEG ou WebP até 2 MB.'));
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
   if(this.imageLoads[name]!==token)return;
   const image=new Image();image.src=data;await image.decode();if(this.imageLoads[name]!==token)return;const canvas=document.createElement('canvas'),max=name==='logo'?600:1600,ratio=Math.min(1,max/Math.max(image.width,image.height));canvas.width=Math.round(image.width*ratio);canvas.height=Math.round(image.height*ratio);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   this.values[name]=canvas.toDataURL(name==='logo'?'image/png':'image/jpeg',.85);this.images[name]=image;
  }catch(error){if(this.imageLoads[name]===token)this.toast(error.message||'Image could not be opened.',true);}
 }
 draw(ctx,w,h,camera,screen,fit){
  const v=this.values;ctx.fillStyle=v.background;ctx.fillRect(0,0,w,h);if(this.images.backgroundImage)ctx.drawImage(this.images.backgroundImage,0,0,w,h);
  for(const rect of layoutRects(v.layout,w,h,Boolean(camera),Boolean(screen))){
   ctx.save();if(rect.source==='camera'&&v.mirror){ctx.translate(rect.x+rect.w,rect.y);ctx.scale(-1,1);fit(camera,0,0,rect.w,rect.h);}else fit(rect.source==='camera'?camera:screen,rect.x,rect.y,rect.w,rect.h);ctx.restore();
  }
  if(this.clip&&!this.clip.paused&&!this.clip.ended){ctx.fillStyle='#111';ctx.fillRect(0,0,w,h);fit(this.clip,0,0,w,h);}
  if(this.images.logo){const image=this.images.logo,scale=Math.min(w*.13/image.width,h*.2/image.height),iw=image.width*scale,ih=image.height*scale;ctx.drawImage(image,w-iw-w*.03,h*.03,iw,ih);}
  const band=(value,y,height)=>{ctx.fillStyle=v.accent;ctx.fillRect(w*.03,y,w*.94,height);ctx.fillStyle='#fff';ctx.font=`bold ${Math.round(h*.032)}px sans-serif`;ctx.fillText(value,w*.05,y+height*.65,w*.9);};
  if(v.name){band(v.name+(v.title?' — '+v.title:''),h*.82,h*.08);}
  if(v.banner)band(v.banner,h*.72,h*.08);
  if(v.ticker){ctx.fillStyle=v.accent;ctx.fillRect(0,h*.94,w,h*.06);ctx.font=`${Math.round(h*.03)}px sans-serif`;ctx.fillStyle='#fff';const span=ctx.measureText(v.ticker).width+w;ctx.fillText(v.ticker,w-(performance.now()/20)%span,h*.982);}
 }
 update(recordings=this.recordings||[]){
  if(!this.element)return;
  this.recordings=recordings;
  const current=recordings.find(item=>item.id===this.recordingId);
  if(current&&!this.finishing&&!this.starting&&!['recording','finalizing'].includes(current.status)){
   this.recordingId=null;void this.releaseFeed('recording').catch(error=>this.toast(error.message,true));this.element.querySelector('.recording-status').textContent=current.status==='completed'?t('Recording saved locally.','Gravação guardada localmente.'):current.error||t('Recording interrupted. Original local data is available for recovery.','Gravação interrompida. Os dados locais originais estão disponíveis para recuperação.');
  }
  this.element.querySelector('[data-production="record"]').disabled=!this.getStream()||this.recording;
  this.element.querySelector('[data-production="stop-record"]').disabled=!this.recordingId||Boolean(this.finishing);
  const signature=JSON.stringify(recordings);if(signature!==this.fileSignature){this.fileSignature=signature;this.element.querySelector('.recording-files').innerHTML=recordings.slice(0,10).map(item=>`<p>${item.created.replace(/[^0-9TZ:.+-]/g,'')} — ${item.status==='completed'?`<a href="/api/recordings/${item.id}/file">${t('Download local recording','Transferir gravação local')} (${(item.bytes/1048576).toFixed(1)} MB)</a>`:item.status==='interrupted'?`<button class="secondary small" data-production="recover" data-id="${item.id}">${t('Recover local recording','Recuperar gravação local')}</button>`:item.status}</p>`).join('');}
 }
 async startRecording(){
  if(!this.getStream()||this.recording)return;
  this.starting=true;this.startDone=new Promise(resolve=>{this.resolveStart=resolve;});this.update();
  try{const feedId=await this.acquireFeed('recording');const {id}=await this.api('/api/recordings/start',{confirmed:true,feedId});this.recordingId=id;this.element.querySelector('.recording-status').textContent=t('Recording locally to this computer.','A gravar localmente neste computador.');}
  catch(error){await this.releaseFeed('recording').catch(()=>{});this.recordingId=null;this.toast(error.message,true);}
  finally{this.starting=false;this.resolveStart();this.startDone=null;this.update();}
 }
 async stopRecording(){
  if(this.startDone)await this.startDone;if(this.finishing)return this.finishing;if(!this.recordingId)return;
  this.finishing=(async()=>{
   this.element.querySelector('.recording-status').textContent=t('Finalizing local recording...','A finalizar gravação local...');
   let saved=false;
   try{await this.api(`/api/recordings/${this.recordingId}/finish`,{});saved=true;await this.releaseFeed('recording');this.element.querySelector('.recording-status').textContent=t('Recording saved locally.','Gravação guardada localmente.');}
   catch(error){this.element.querySelector('.recording-status').textContent=error.message;this.toast(error.message,true);}
   finally{if(saved)this.recordingId=null;this.finishing=null;this.update();}
  })();this.update();return this.finishing;
 }
 async action(button){
  button.disabled=true;
  try{
   const action=button.dataset.production;
   if(action==='record')await this.startRecording();if(action==='stop-record')await this.stopRecording();
   if(action==='recover'){button.disabled=true;await this.api(`/api/recordings/${button.dataset.id}/finish`,{});this.toast(t('Recording recovered.','Gravação recuperada.'));}
   if(action==='clear-images'){this.imageLoads={};this.values.logo='';this.values.backgroundImage='';this.images={};for(const name of ['logo','backgroundImage'])this.element.querySelector(`[name="${name}"]`).value='';}
   if(action==='snapshot')this.snapshot();
   if(action==='stop-clip')this.stopClip();
   if(action==='play-clip'){
    if(!this.getStream())throw Error(t('Open a local preview first.','Abra primeiro a pré-visualização local.'));
    const file=this.element.querySelector('[name=clipFile]').files[0];if(!file||!['video/mp4','video/webm'].includes(file.type))throw Error(t('Choose a local MP4 or WebM video.','Escolha um vídeo local MP4 ou WebM.'));
    this.stopClip();this.clipUrl=URL.createObjectURL(file);const clip=this.clip=document.createElement('video');clip.playsInline=true;clip.src=this.clipUrl;clip.onended=()=>{if(this.clip===clip)this.stopClip();};clip.onerror=()=>{if(this.clip!==clip)return;this.stopClip();this.toast(t('This clip could not be played. Normalize it in Tools first.','Este clip não pôde ser reproduzido. Normalize-o em Ferramentas.'),true);};try{this.setClipAudio(clip);await clip.play();}catch(error){if(this.clip!==clip)return;this.stopClip();throw error;}
   }
   if(action==='save-scene'){const scenes={...this.scenes,[this.element.querySelector('[name=scene]').value]:{...this.values}};try{localStorage.setItem('go-streams-scenes',JSON.stringify(scenes));this.scenes=scenes;this.toast(t('Studio scene saved.','Cena do estúdio guardada.'));}catch{throw Error(t('The browser could not save this scene. Reduce image sizes.','O navegador não conseguiu guardar esta cena. Reduza o tamanho das imagens.'));}}
   if(action==='load-scene'){const values=this.scenes[this.element.querySelector('[name=scene]').value];if(!values)throw Error(t('Save this scene first.','Guarde primeiro esta cena.'));this.values={...defaults,...values};const scene=this.values;for(const [name,value]of Object.entries(scene)){const el=this.element.querySelector(`[name="${name}"]`);if(el){if(el.type==='file')el.value='';else if(el.type==='checkbox')el.checked=value;else el.value=value;}}this.images={};const pending={logo:{},backgroundImage:{}};this.imageLoads={...pending};for(const name of ['logo','backgroundImage'])if(this.imageLoads[name]===pending[name]&&/^data:image\/(png|jpeg|webp);base64,/.test(scene[name])){const image=new Image();image.src=scene[name];await image.decode();if(this.imageLoads[name]===pending[name])this.images[name]=image;}}
   if(action==='teleprompter'){if(this.scrollTimer){clearInterval(this.scrollTimer);this.scrollTimer=null;}else this.scrollTimer=setInterval(()=>{const el=this.element.querySelector('.teleprompter');el.scrollTop+=1;},50);}
  }catch(error){this.toast(error.message,true);}finally{button.disabled=false;this.update();}
 }
 stopClip(){if(this.clip){this.clip.onended=null;this.clip.onerror=null;this.clip.pause();this.clip.src='';this.clip=null;}if(this.clipUrl){URL.revokeObjectURL(this.clipUrl);this.clipUrl=null;}this.setClipAudio(null);}
}
