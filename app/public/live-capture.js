import {language} from './i18n.js';
import {ProductionTools} from './live-production.js';
import {videoAspects,videoDimensions} from './video-geometry.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(en,pt)=>language()==='pt-PT'?pt:en;
export const LIVE_BUFFER_LIMIT=8*1024*1024;

// One ordered, bounded upload queue: never retain a full recording on disk or in memory.
export class LiveUploader {
 constructor({fetchChunk,stopRemote,onError,limit=LIVE_BUFFER_LIMIT}){
  Object.assign(this,{fetchChunk,stopRemote,onError,limit});
  this.pending=Promise.resolve();this.bytes=0;this.sequence=0;this.closed=false;this.ending=false;this.error=null;
 }
 push(blob){
  if(this.closed||this.ending||!blob.size)return;
  if(this.bytes+blob.size>this.limit){this.fail(Error('Live upload is too slow. The broadcast was stopped to avoid accumulating a recording.'));return;}
  this.bytes+=blob.size;
  this.pending=this.pending.then(async()=>{
   if(this.closed)return;
   await this.fetchChunk(blob,this.sequence++);
  }).catch(error=>this.fail(error)).finally(()=>{this.bytes-=blob.size;});
 }
 stopOnce(){return this.stopPromise ||= Promise.resolve().then(()=>this.stopRemote());}
 fail(error){if(this.closed)return;this.error=error;this.closed=true;void this.stopOnce().catch(()=>{});this.onError(error);}
 finish(){
  if(this.finishing)return this.finishing;this.ending=true;
  this.finishing=(async()=>{try{await this.pending;}catch(error){this.error ||= error;}this.closed=true;try{await this.stopOnce();}catch(error){this.error ||= error;}if(this.error)throw this.error;})();return this.finishing;
 }
}

export class LiveCapturePanel {
 constructor({api,toast,getState}){
  Object.assign(this,{api,toast,getState});this.streams=[];this.session=null;this.preparing=false;this.stopping=false;this.muted=false;this.captureEpoch=0;
 }
 get busy(){return this.preparing||Boolean(this.output)||Boolean(this.session)||Boolean(this.releasing);}
 get formatLocked(){return Boolean(this.preparing||this.stopping||this.releasing||this.session||this.feedStarting||this.feedSession||this.feedClosing||this.production?.recording);}
 mount(container,state){
  if(!this.element){
   this.element=document.createElement('section');this.element.className='live-capture-studio';
   this.element.innerHTML=`<div class="page-heading"><div><h1>${text('Live camera & screen','Câmara e ecrã ao vivo')}</h1><p>${text('Preview locally, then send the same live feed to your selected destinations.','Pré-visualize localmente e envie o mesmo direto para os destinos selecionados.')}</p></div></div>
    <div class="capture-layout"><section class="panel"><h2>${text('1. Prepare your source','1. Preparar a origem')}</h2><form id="capture-form">
    <label>${text('Source','Origem')}<select name="source"><option value="camera">${text('Camera','Câmara')}</option><option value="microphone">${text('Microphone only','Apenas microfone')}</option><option value="screen">${text('Screen or window','Ecrã ou janela')}</option><option value="screen-camera">${text('Screen + camera','Ecrã + câmara')}</option></select></label>
    <div class="form-row"><label>${text('Quality','Qualidade')}<select name="quality"><option value="720p">720p</option><option value="1080p">1080p</option></select></label><label>${text('Output aspect ratio','Proporção do vídeo')}<select name="aspect">${videoAspects.map(aspect=>`<option value="${aspect}">${aspect}</option>`).join('')}</select></label></div><p class="form-hint">${text('Choose the output shape before broadcasting or recording. Change a local preview without reopening devices.','Escolha o formato antes de transmitir ou gravar. Pode alterar a pré-visualização sem voltar a abrir os dispositivos.')} <span class="capture-frame-size"></span></p>
    <label>${text('Camera','Câmara')}<select name="camera"><option value="">${text('Default camera','Câmara predefinida')}</option></select></label><label>${text('Microphone','Microfone')}<select name="microphone"><option value="">${text('Default microphone','Microfone predefinido')}</option></select></label>
    <label class="check"><input type="checkbox" name="useMic" checked> ${text('Include microphone','Incluir microfone')}</label>
    <label class="check"><input type="checkbox" name="systemAudio"> ${text('Request shared screen/tab audio when supported','Pedir áudio do ecrã/separador quando suportado')}</label>
    <p class="form-hint">${text('Your browser or operating system asks permission. Preview does not broadcast. Shared audio availability depends on the selected source and operating system.','O navegador ou sistema pede autorização. A pré-visualização não transmite. O áudio partilhado depende da origem e do sistema.')}</p>
    <button type="submit" class="secondary" data-capture="preview">${text('Open local preview','Abrir pré-visualização local')}</button></form></section>
    <section class="panel"><h2>${text('Local preview','Pré-visualização local')}</h2><video class="capture-preview" autoplay muted playsinline></video><p class="capture-status" role="status">${text('Camera and microphone are off.','A câmara e o microfone estão desligados.')}</p><div class="actions"><button class="secondary" data-capture="mute" disabled>${text('Mute microphone','Silenciar microfone')}</button><button class="danger" data-capture="release" disabled>${text('Close preview & release devices','Fechar pré-visualização e libertar dispositivos')}</button></div></section></div>
    <section class="panel"><h2>${text('2. Choose live destinations','2. Escolher destinos')}</h2><div class="capture-destinations"></div><p class="form-hint">${text('Each destination uses its configured RTMP/RTMPS server and key. Upload bandwidth and encoder load increase with each destination. Confirm reception in the platform dashboard.','Cada destino usa o servidor e a chave configurados. O upload e a carga de codificação aumentam com cada destino. Confirme a receção no painel da plataforma.')}</p><label class="check"><input type="checkbox" data-capture="consent"> ${text('I confirm the selected destinations and authorize this live broadcast.','Confirmo os destinos selecionados e autorizo esta transmissão ao vivo.')}</label><div class="actions"><button class="primary" data-capture="start" disabled>${text('Start live broadcast','Iniciar transmissão ao vivo')}</button><button class="danger" data-capture="stop" disabled>${text('Stop all live destinations','Parar todos os destinos ao vivo')}</button></div><div class="capture-results" aria-live="polite"></div></section>`;
   this.element.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void this.preview();});
   this.element.addEventListener('click',event=>{
    const button=event.target.closest('button[data-capture]');if(!button||button.disabled)return;
    if(button.dataset.capture==='start')void this.start();
    if(button.dataset.capture==='stop')void this.stop();
    if(button.dataset.capture==='release')void this.release();
    if(button.dataset.capture==='mute')this.toggleMute();
   });
   this.element.addEventListener('change',event=>{if(event.target.closest?.('#capture-form')&&['aspect','quality'].includes(event.target.name))this.changeFormat(event.target.name,event.target.value);this.controls();});
   window.addEventListener('beforeunload',event=>{if(this.busy){event.preventDefault();event.returnValue='';}});
   window.addEventListener('pagehide',()=>{
    this.releaseDevices();
    if(this.session)void fetch(`/api/live/${this.session.id}/stop`,{method:'POST',headers:{'Content-Type':'application/json','X-Go-Streams':'1'},body:'{}',keepalive:true}).catch(()=>{});
   });
  }
  this.production ||= new ProductionTools({api:this.api,toast:this.toast,getStream:()=>this.releasing?null:this.output,getRecordingConfig:()=>({mimeType:this.captureMimeType,videoBitsPerSecond:this.config?.quality==='1080p'?4500000:2500000,audioBitsPerSecond:128000}),onRecordingStateChange:()=>this.syncFormatControls(),setVolume:(name,value)=>this.setInputVolume(name,value),setClipAudio:video=>this.setClipAudio(video),snapshot:async()=>{
   if(!this.canvas||!this.output){this.toast(text('Open a local preview first.','Abra primeiro a pré-visualização local.'),true);return;}
   this.drawFrame?.();
   const blob=await new Promise((resolve,reject)=>this.canvas.toBlob(value=>value?resolve(value):reject(Error(text('The PNG image could not be created. Try again.','Não foi possível criar a imagem PNG. Tente novamente.'))),'image/png'));
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Streamland-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),10000);}
  }});
  this.production.mount(this.element);
  if(this.element.parentNode!==container){container.innerHTML='';container.appendChild(this.element);}
  this.update(state);
 }
 status(value,error=false){const el=this.element.querySelector('.capture-status');el.textContent=value;el.className='capture-status'+(error?' job-error':'');}
 controls(){
  const active=Boolean(this.session)||this.preparing||this.stopping||Boolean(this.releasing);
  for(const input of this.element.querySelectorAll('#capture-form input,#capture-form select'))input.disabled=active||Boolean(this.output);
  this.syncFormatControls();
  const source=this.element.querySelector('[name="source"]')?.value,microphoneOnly=source==='microphone';
  for(const [name,disabled]of [['camera',!['camera','screen-camera'].includes(source)],['systemAudio',!['screen','screen-camera'].includes(source)],['useMic',microphoneOnly]]){
   const input=this.element.querySelector(`[name="${name}"]`);if(input){input.disabled=active||Boolean(this.output)||disabled;if(name==='useMic'&&microphoneOnly)input.checked=true;}
  }
  this.element.querySelector('[data-capture="preview"]').disabled=active||Boolean(this.output);
  this.element.querySelector('[data-capture="release"]').disabled=!this.output||active;
  this.element.querySelector('[data-capture="mute"]').disabled=!this.mic;
  this.element.querySelector('[data-capture="stop"]').disabled=!this.session||this.stopping;
  const hasDestinations=Boolean(this.element.querySelector('.capture-destinations input:checked:not(:disabled)'));
  this.element.querySelector('[data-capture="start"]').disabled=!this.output||active||Boolean(this.production?.bumpers?.libraryBusy)||!hasDestinations||!this.element.querySelector('[data-capture="consent"]').checked;
  this.production?.update(this.recordings||[],this.recordingPreferences);
 }
 syncFormatControls(){
  const fields={};for(const name of ['aspect','quality']){const input=this.element?.querySelector(`#capture-form [name="${name}"]`);if(input){input.disabled=this.formatLocked;fields[name]=input.value;}}
  const label=this.element?.querySelector('.capture-frame-size');if(!label)return;
  const dimensions=this.output&&this.canvas?[this.canvas.width,this.canvas.height]:videoDimensions(fields.quality,videoAspects.includes(fields.aspect)?fields.aspect:'16:9'),value=dimensions.join(' × ');
  if(label.textContent!==value)label.textContent=value;
 }
 changeFormat(name,value){
  if(!['aspect','quality'].includes(name))return false;
  const input=this.element?.querySelector(`#capture-form [name="${name}"]`),allowed=name==='aspect'?videoAspects:['720p','1080p'];
  if(this.formatLocked||!allowed.includes(value)){if(input)input.value=this.config?.[name]||(name==='aspect'?'16:9':'720p');return false;}
  if(this.output&&this.config){this.config[name]=value;this.resizePreview();this.drawFrame?.();}return true;
 }
 resizePreview(){
  if(!this.canvas||!this.config)return;
  [this.canvas.width,this.canvas.height]=videoDimensions(this.config.quality,this.config.aspect);
  const label=this.element?.querySelector('.capture-frame-size');if(label)label.textContent=`${this.canvas.width} × ${this.canvas.height}`;
 }
 update(state){
  if(!this.element)return;
  this.production?.bumpers?.update(state.media);
  this.recordings=state.recordings||[];
  this.recordingPreferences=state.recordingPreferences;
  const selected=new Set([...this.element.querySelectorAll('.capture-destinations input:checked')].map(el=>el.value));
  const signature=JSON.stringify(state.channels.map(c=>[c.id,c.name,c.platform,c.hasKey,state.jobs.some(j=>!j.ended&&j.channelId===c.id)]));
  if(signature!==this.destinationsSignature){
   this.destinationsSignature=signature;
   this.element.querySelector('.capture-destinations').innerHTML=state.channels.map(c=>{
    const busy=state.jobs.some(j=>!j.ended&&j.channelId===c.id);
    return `<label class="destination"><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?'checked':''} ${busy||!c.hasKey?'disabled':''}><span><strong>${esc(c.name)}</strong><small>${esc(c.platform)}${busy?' — '+text('In use','Em utilização'):!c.hasKey?' — '+text('Missing stream key','Sem chave'):''}</small></span></label>`;
   }).join('')||`<p>${text('Add destinations in Channels first.','Adicione primeiro os destinos em Canais.')}</p><a href="#channels">${text('Open Channels','Abrir Canais')}</a>`;
  }
  const jobs=this.session?state.jobs.filter(j=>j.liveSessionId===this.session.id):[];
  this.element.querySelector('.capture-results').innerHTML=jobs.map(j=>`<p><strong>${esc(j.channelName)}</strong> — ${esc(j.status)}${j.error?': '+esc(j.error):''}</p>`).join('');
  if(this.session&&jobs.length&&jobs.every(j=>j.ended)&&!this.stopping)void this.stop();
  this.controls();
 }
 async preview(){
  if(this.busy)return;
  const form=new FormData(this.element.querySelector('form'));
  const epoch=this.captureEpoch;
  const current=()=>epoch===this.captureEpoch;
  const retain=stream=>{
   if(!current()){for(const track of stream.getTracks())track.stop();throw Error('Local preview was cancelled.');}
   this.streams.push(stream);
   for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(current())void this.release();},{once:true});
   if(stream.getTracks().some(track=>track.readyState==='ended')){void this.release();throw Error('The selected capture source has ended.');}
   return stream;
  };
  const check=()=>{if(!current())throw Error('Local preview was cancelled.');};
  this.preparing=true;this.controls();
  try{
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error(text('Live capture requires Chrome, Edge, Safari 18.4+ or the Electron edition, with media permissions enabled.','A captação requer Chrome, Edge, Safari 18.4+ ou a edição Electron, com permissões de multimédia.'));
   this.config={source:form.get('source'),quality:form.get('quality'),aspect:form.get('aspect')};
   if(!['720p','1080p'].includes(this.config.quality)||!videoAspects.includes(this.config.aspect))throw Error(text('Choose a supported live video format.','Escolha um formato de vídeo ao vivo suportado.'));
   const device=value=>value?{deviceId:{exact:value}}:true;
   if(['screen','screen-camera'].includes(this.config.source)){
    if(!navigator.mediaDevices.getDisplayMedia)throw Error('Screen sharing is unavailable in this browser.');
    this.screen=retain(await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:form.has('systemAudio')}));
   }
   if(this.config.source!=='screen'||form.has('useMic')){
    const microphoneOnly=this.config.source==='microphone';
    const stream=await navigator.mediaDevices.getUserMedia({video:['camera','screen-camera'].includes(this.config.source)?device(form.get('camera')):false,audio:microphoneOnly||form.has('useMic')?device(form.get('microphone')):false});
    retain(stream);this.mic=stream.getAudioTracks()[0];
    if(stream.getVideoTracks().length)this.camera=stream;
   }
   const video=async stream=>{if(!stream)return null;const el=document.createElement('video');el.muted=true;el.playsInline=true;el.srcObject=stream;try{await el.play();check();return el;}catch(error){el.pause();el.srcObject=null;throw error;}};
   this.screenVideo=await video(this.screen);this.cameraVideo=await video(this.camera);
   this.captureMimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!this.captureMimeType)throw Error('Live WebM capture is unavailable. Use Chrome, Edge or Safari 18.4+.');
   this.canvas=document.createElement('canvas');
   this.resizePreview();
   // VP8 needs a stable canvas color path: WebM records the first frame's tags.
   const ctx=this.canvas.getContext('2d',this.captureMimeType.includes('vp9')?undefined:{colorSpace:'srgb',willReadFrequently:true});
   const draw=()=>{
    const w=this.canvas.width,h=this.canvas.height;
    const fit=(v,x,y,w,h)=>{if(!v?.videoWidth)return;const scale=Math.min(w/v.videoWidth,h/v.videoHeight),vw=v.videoWidth*scale,vh=v.videoHeight*scale;ctx.drawImage(v,x+(w-vw)/2,y+(h-vh)/2,vw,vh);};
    this.production.draw(ctx,w,h,this.cameraVideo,this.screenVideo,fit);
    if(this.featuredComment){
     ctx.fillStyle='rgba(10,10,20,0.88)';ctx.fillRect(w*.04,h*.74,w*.92,h*.22);ctx.fillStyle='#fff';ctx.font=`bold ${Math.round(h*.032)}px sans-serif`;ctx.fillText(this.featuredComment.author,w*.06,h*.79,w*.88);ctx.font=`${Math.round(h*.029)}px sans-serif`;
     const words=this.featuredComment.text.split(/\s+/);let line='',row=0;for(const word of words){if(ctx.measureText(line+' '+word).width>w*.86){ctx.fillText(line,w*.06,h*(.84+row*.045));line=word;if(++row>=2)break;}else line+=(line?' ':'')+word;}if(row<2)ctx.fillText(line,w*.06,h*(.84+row*.045),w*.86);
    }
   };
   this.drawFrame=draw;draw();this.drawTimer=setInterval(draw,1000/30);
   this.audio=new AudioContext();await this.audio.resume();check();const destination=this.audio.createMediaStreamDestination();
   this.master=this.audio.createGain();this.master.connect(destination);this.analyser=this.audio.createAnalyser();this.master.connect(this.analyser);this.audioInputs=[];
   // Keep the audio rendering clock active on Windows Chromium without playing
   // microphone/system sound back through the speakers.
   const clockSink=this.audio.createGain();clockSink.gain.value=0;this.master.connect(clockSink).connect(this.audio.destination);
   this.silence=this.audio.createOscillator();const silentGain=this.audio.createGain();silentGain.gain.value=0;this.silence.connect(silentGain).connect(this.master);this.silence.start();
   for(const stream of this.streams)if(stream.getAudioTracks().length){const gain=this.audio.createGain(),name=stream===this.screen?'screenVolume':'micVolume';gain.gain.value=Number(this.production.element.querySelector(`[name="${name}"]`).value);this.audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(gain).connect(this.master);this.audioInputs.push({name,gain});}
   const samples=new Uint8Array(this.analyser.fftSize);this.meterTimer=setInterval(()=>{this.analyser.getByteTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+((v-128)/128)**2,0)/samples.length);this.production.element.querySelector('meter').value=Math.min(1,rms*3);},100);
   this.output=new MediaStream([...this.canvas.captureStream(30).getVideoTracks(),...destination.stream.getAudioTracks()]);
   this.element.querySelector('.capture-preview').srcObject=this.output;
   this.muted=false;this.element.querySelector('[data-capture="mute"]').textContent=text('Mute microphone','Silenciar microfone');
   await this.listDevices(epoch);check();this.status(text('Local preview only - nothing is being broadcast.','Apenas pré-visualização local - nada está a ser transmitido.'));
  }catch(error){if(current()){this.releaseDevices();this.status(error.message,true);this.toast(error.message,true);}}
  finally{this.preparing=false;this.controls();}
 }
 async listDevices(epoch=this.captureEpoch){
  try{const devices=await navigator.mediaDevices.enumerateDevices();if(epoch!==this.captureEpoch)return;for(const [name,kind]of [['camera','videoinput'],['microphone','audioinput']]){const select=this.element.querySelector(`[name="${name}"]`),previous=select.value;select.innerHTML='<option value="">'+text('Default','Predefinido')+'</option>'+devices.filter(d=>d.kind===kind).map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`${kind} ${i+1}`)}</option>`).join('');select.value=previous;}}catch{}
 }
 toggleMute(){if(!this.mic)return;this.muted=!this.muted;this.mic.enabled=!this.muted;this.element.querySelector('[data-capture="mute"]').textContent=this.muted?text('Unmute microphone','Ativar microfone'):text('Mute microphone','Silenciar microfone');}
 setInputVolume(name,value){for(const input of this.audioInputs||[])if(input.name===name)input.gain.gain.value=this.clipAudio?0:value;}
 setClipAudio(video){
  this.clipAudio?.disconnect();this.clipAudio=null;
  if(video&&this.audio){this.clipAudio=this.audio.createMediaElementSource(video);this.clipAudio.connect(this.master);}
  for(const input of this.audioInputs||[])input.gain.gain.value=this.clipAudio?0:Number(this.production.element.querySelector(`[name="${input.name}"]`).value);
 }
 async acquireFeed(role){
  const source=this.output,epoch=this.captureEpoch,current=()=>Boolean(source)&&this.output===source&&this.captureEpoch===epoch&&!this.releasing;
  const check=()=>{if(!current())throw Error(text('Local preview was cancelled before capture could start.','A pré-visualização foi cancelada antes de iniciar a captação.'));};
  check();if(this.feedClosing)await this.feedClosing;check();
  this.feedUsers ||= new Set();this.feedUsers.add(role);
  try{
  if(this.feedStarting)return await this.feedStarting;
  if(this.feedSession)return this.feedSession.id;
  this.feedStarting=(async()=>{
   try{
   const mimeType=this.captureMimeType||['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType)throw Error('Live WebM capture is unavailable. Use Chrome, Edge or Safari 18.4+.');
   const recorder=new MediaRecorder(source,{mimeType,videoBitsPerSecond:this.config.quality==='1080p'?4500000:2500000,audioBitsPerSecond:128000});
   const session=await this.api('/api/capture/start',{...this.config,confirmed:true});
   if(!current()){await this.api(`/api/capture/${session.id}/stop`,{}).catch(()=>{});check();}
   this.feedSession=session;this.feedMime=mimeType;const id=session.id;
   this.feedUploader=new LiveUploader({stopRemote:()=>this.api(`/api/capture/${id}/stop`,{}),onError:error=>{this.status(error.message,true);this.toast(error.message,true);void this.stop(error);},fetchChunk:async(blob,sequence)=>{
    const response=await fetch(`/api/capture/${id}/chunks?sequence=${sequence}`,{method:'POST',headers:{'Content-Type':'video/webm','X-Go-Streams':'1'},body:blob,signal:AbortSignal.timeout(15000)});if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'Live capture disconnected.');}
   }});
   this.feedRecorder=recorder;recorder.ondataavailable=event=>this.feedUploader?.push(event.data);recorder.onerror=()=>this.feedUploader?.fail(Error('Live capture failed. Start a new capture.'));recorder.start(1000);return id;
   }catch(error){if(this.feedSession)await this.api(`/api/capture/${this.feedSession.id}/stop`,{}).catch(()=>{});this.feedSession=null;this.feedRecorder=null;this.feedUploader=null;throw error;}
  })();
  const starting=this.feedStarting;try{return await starting;}finally{if(this.feedStarting===starting)this.feedStarting=null;}
  }catch(error){this.feedUsers.delete(role);throw error;}
 }
 async releaseFeed(role){
  this.feedUsers?.delete(role);if(this.feedStarting)await this.feedStarting.catch(()=>{});
  if(this.feedUsers?.size||!this.feedSession)return;
  if(this.feedClosing)return this.feedClosing;
  this.feedClosing=(async()=>{
   try{const recorder=this.feedRecorder;if(recorder&&recorder.state!=='inactive')await new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});recorder.stop();});await this.feedUploader?.finish();}
   finally{this.feedSession=null;this.feedRecorder=null;this.feedUploader=null;this.feedClosing=null;}
  })();return this.feedClosing;
 }
 async start(){
  if(!this.output||this.session||this.preparing||this.stopping||this.releasing||this.production?.bumpers?.libraryBusy)return;this.preparing=true;this.controls();
  const epoch=this.captureEpoch,source=this.output,attempt=this.liveStart={},current=()=>epoch===this.captureEpoch&&this.output===source&&this.liveStart===attempt;
  try{
   const channelIds=[...this.element.querySelectorAll('.capture-destinations input:checked:not(:disabled)')].map(el=>el.value);
   if(!channelIds.length||!this.element.querySelector('[data-capture="consent"]').checked)throw Error('Confirm at least one live destination.');
   if(this.production?.bumpers?.enabled('live')){await this.production.bumpers.prepare('live');if(!current())throw Error('Live capture was released before broadcasting.');this.production.bumpers.arm('live');}
   const feedId=await this.acquireFeed('live');if(!current())throw Error('Live capture was released before broadcasting.');
   const session=await this.api('/api/live/start',{...this.config,mimeType:this.feedMime,feedId,channelIds,confirmed:true});
   if(!current()){await this.api(`/api/live/${session.id}/stop`,{}).catch(()=>{});throw Error('Live capture was released before broadcasting.');}this.session=session;
   this.production?.bumpers?.start('live');this.status(text('Live feed is being sent. Confirm reception in each platform dashboard.','O sinal está a ser enviado. Confirme a receção no painel de cada plataforma.'));
  }catch(error){if(this.session)await this.api(`/api/live/${this.session.id}/stop`,{}).catch(()=>{});this.session=null;await this.releaseFeed('live').catch(()=>{});if(current()){this.status(error.message,true);this.toast(error.message,true);}}
  finally{if(!this.session)this.production?.bumpers?.finish('live');if(this.liveStart===attempt)this.liveStart=null;this.preparing=false;this.controls();}
 }
 async stop(reason){
  if(reason||!this.session||this.releasing)this.production?.bumpers?.finish('live');
  this.liveStart=null;
  if(this.stopping){if(reason)this.stopFailure ||= reason;return this.stopDone;}
  this.stopFailure=reason||null;this.stopping=true;this.controls();
  this.stopDone=(async()=>{
   let stopped=!this.session;
   try{if(this.session){if(!reason&&!this.releasing&&this.production?.bumpers?.sessions.has('live')){await this.production.bumpers.end('live');try{await this.releaseFeed('live');}catch(error){this.stopFailure ||= error;}}await this.api(`/api/live/${this.session.id}/stop`,{});}stopped=true;}
   catch(error){this.stopFailure ||= error;}
   finally{this.production?.bumpers?.finish('live');try{await this.releaseFeed('live');}catch(error){this.stopFailure ||= error;}if(stopped)this.session=null;this.stopping=false;this.status(this.stopFailure?.message||text('Broadcast stopped. Local preview is still active.','Transmissão parada. A pré-visualização local continua ativa.'),Boolean(this.stopFailure));this.element.querySelector('[data-capture="consent"]').checked=false;this.controls();this.stopDone=null;}
  })();return this.stopDone;
 }
 releaseDevices(){
  this.captureEpoch++;
  clearInterval(this.drawTimer);
  this.production?.stopVisuals?.();
  this.drawFrame=null;
  clearInterval(this.meterTimer);this.audioInputs=[];
  this.clipAudio?.disconnect();this.clipAudio=null;
  for(const stream of [...this.streams,this.output].filter(Boolean))for(const track of stream.getTracks())track.stop();
  this.streams=[];this.output=null;this.mic=null;this.camera=null;this.screen=null;
  for(const v of [this.cameraVideo,this.screenVideo])if(v){v.pause();v.srcObject=null;}
  this.cameraVideo=null;this.screenVideo=null;
  if(this.audio){void this.audio.close().catch(()=>{});this.audio=null;}
  if(this.element){this.element.querySelector('.capture-preview').srcObject=null;for(const meter of this.element.querySelectorAll?.('meter')||[])meter.value=0;}
 }
 async release({throwOnError=false}={}){
  if(!this.releasing){
   this.production?.bumpers?.cancel();
   this.captureEpoch++;
   if(!this.session&&!this.feedSession&&!this.feedStarting&&!this.production?.recordingId&&!this.production?.finishing)this.releaseDevices();
   this.releasing=(async()=>{
    let error;
    try{
     try{await this.production?.stopRecording({throwOnError:true});}catch(failure){error=failure;}
     try{this.production?.stopClip();await this.stop();error ||= this.stopFailure;}catch(failure){error ||= failure;}
     this.releaseDevices();this.status(error?.message||text('Camera and microphone are off.','A câmara e o microfone estão desligados.'),Boolean(error));
     return {error};
    }finally{this.releasing=null;this.controls();}
   })();this.controls();
  }
  const result=await this.releasing;if(throwOnError&&result?.error)throw result.error;
 }
}
