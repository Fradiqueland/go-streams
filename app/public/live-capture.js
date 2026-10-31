import {language} from './i18n.js';
import {ProductionTools} from './live-production.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(en,pt)=>language()==='pt-PT'?pt:en;
export const LIVE_BUFFER_LIMIT=8*1024*1024;

// One ordered, bounded upload queue: never retain a full recording on disk or in memory.
export class LiveUploader {
 constructor({fetchChunk,stopRemote,onError,limit=LIVE_BUFFER_LIMIT}){
  Object.assign(this,{fetchChunk,stopRemote,onError,limit});
  this.pending=Promise.resolve();this.bytes=0;this.sequence=0;this.closed=false;
 }
 push(blob){
  if(this.closed||!blob.size)return;
  if(this.bytes+blob.size>this.limit){this.fail(Error('Live upload is too slow. The broadcast was stopped to avoid accumulating a recording.'));return;}
  this.bytes+=blob.size;
  this.pending=this.pending.then(async()=>{
   if(this.closed)return;
   await this.fetchChunk(blob,this.sequence++);
  }).catch(error=>this.fail(error)).finally(()=>{this.bytes-=blob.size;});
 }
 fail(error){if(this.closed)return;this.closed=true;void this.stopRemote().catch(()=>{});this.onError(error);}
 async finish(){await this.pending;this.closed=true;await this.stopRemote();}
}

export class LiveCapturePanel {
 constructor({api,toast,getState}){
  Object.assign(this,{api,toast,getState});this.streams=[];this.session=null;this.preparing=false;this.stopping=false;this.muted=false;
 }
 get busy(){return this.preparing||Boolean(this.output)||Boolean(this.session);}
 mount(container,state){
  if(!this.element){
   this.element=document.createElement('section');this.element.className='live-capture-studio';
   this.element.innerHTML=`<div class="page-heading"><div><h1>${text('Live camera & screen','Câmara e ecrã ao vivo')}</h1><p>${text('Preview locally, then send the same live feed to your selected destinations.','Pré-visualize localmente e envie o mesmo direto para os destinos selecionados.')}</p></div></div>
    <div class="capture-layout"><section class="panel"><h2>${text('1. Prepare your source','1. Preparar a origem')}</h2><form id="capture-form">
    <label>${text('Source','Origem')}<select name="source"><option value="camera">${text('Camera','Câmara')}</option><option value="screen">${text('Screen or window','Ecrã ou janela')}</option><option value="screen-camera">${text('Screen + camera','Ecrã + câmara')}</option></select></label>
    <div class="form-row"><label>${text('Quality','Qualidade')}<select name="quality"><option value="720p">720p</option><option value="1080p">1080p</option></select></label><label>${text('Orientation','Orientação')}<select name="aspect"><option value="16:9">16:9 — ${text('Landscape','Horizontal')}</option><option value="9:16">9:16 — ${text('Portrait','Vertical')}</option></select></label></div>
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
   this.element.addEventListener('change',()=>this.controls());
   window.addEventListener('beforeunload',event=>{if(this.busy){event.preventDefault();event.returnValue='';}});
   window.addEventListener('pagehide',()=>{
    this.releaseDevices();
    if(this.session)void fetch(`/api/live/${this.session.id}/stop`,{method:'POST',headers:{'Content-Type':'application/json','X-Go-Streams':'1'},body:'{}',keepalive:true}).catch(()=>{});
   });
  }
  this.production ||= new ProductionTools({api:this.api,toast:this.toast,getStream:()=>this.output,uploaderClass:LiveUploader,acquireFeed:role=>this.acquireFeed(role),releaseFeed:role=>this.releaseFeed(role),setVolume:(name,value)=>{for(const input of this.audioInputs||[])if(input.name===name)input.gain.gain.value=value;},setClipAudio:video=>{
   this.clipAudio?.disconnect();this.clipAudio=null;
   if(video&&this.audio){this.clipAudio=this.audio.createMediaElementSource(video);this.clipAudio.connect(this.master);}
   for(const input of this.audioInputs||[])input.gain.gain.value=video?0:Number(this.production.element.querySelector(`[name="${input.name}"]`).value);
  },snapshot:()=>{
   if(!this.canvas||!this.output){this.toast(text('Open a local preview first.','Abra primeiro a pré-visualização local.'),true);return;}
   this.canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='GoStreams-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},'image/png');
  }});
  this.production.mount(this.element);
  if(this.element.parentNode!==container){container.innerHTML='';container.appendChild(this.element);}
  this.update(state);
 }
 status(value,error=false){const el=this.element.querySelector('.capture-status');el.textContent=value;el.className='capture-status'+(error?' job-error':'');}
 controls(){
  const active=Boolean(this.session)||this.preparing||this.stopping;
  for(const input of this.element.querySelectorAll('#capture-form input,#capture-form select'))input.disabled=active||Boolean(this.output);
  this.element.querySelector('[data-capture="preview"]').disabled=active||Boolean(this.output);
  this.element.querySelector('[data-capture="release"]').disabled=!this.output||active;
  this.element.querySelector('[data-capture="mute"]').disabled=!this.mic;
  this.element.querySelector('[data-capture="stop"]').disabled=!this.session||this.stopping;
  const hasDestinations=Boolean(this.element.querySelector('.capture-destinations input:checked:not(:disabled)'));
  this.element.querySelector('[data-capture="start"]').disabled=!this.output||active||!hasDestinations||!this.element.querySelector('[data-capture="consent"]').checked;
  this.production?.update(this.recordings||[]);
 }
 update(state){
  if(!this.element)return;
  this.recordings=state.recordings||[];
  const selected=new Set([...this.element.querySelectorAll('.capture-destinations input:checked')].map(el=>el.value));
  const signature=JSON.stringify(state.channels.map(c=>[c.id,c.name,c.platform,c.hasKey,state.jobs.some(j=>!j.ended&&j.channelId===c.id)]));
  if(signature!==this.destinationsSignature){
   this.destinationsSignature=signature;
   this.element.querySelector('.capture-destinations').innerHTML=state.channels.map(c=>{
    const busy=state.jobs.some(j=>!j.ended&&j.channelId===c.id);
    return `<label class="destination"><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?'checked':''} ${busy||!c.hasKey?'disabled':''}><span><strong>${esc(c.name)}</strong><small>${esc(c.platform)}${busy?' — '+text('In use','Em utilização'):!c.hasKey?' — '+text('Missing stream key','Sem chave'):''}</small></span></label>`;
   }).join('')||`<p>${text('Add destinations in Channels first.','Adicione primeiro os destinos em Canais.')}</p><a href="#channels">${text('Open Channels','Abrir Canais')}</a>`;
  }
  const jobs=state.jobs.filter(j=>j.liveSessionId===this.session?.id);
  this.element.querySelector('.capture-results').innerHTML=jobs.map(j=>`<p><strong>${esc(j.channelName)}</strong> — ${esc(j.status)}${j.error?': '+esc(j.error):''}</p>`).join('');
  if(this.session&&jobs.length&&jobs.every(j=>j.ended)&&!this.stopping)void this.stop();
  this.controls();
 }
 async preview(){
  if(this.busy)return;
  const form=new FormData(this.element.querySelector('form'));
  this.preparing=true;this.controls();
  try{
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error(text('Live capture requires Chrome, Edge or the Electron edition, with media permissions enabled.','A captação requer Chrome, Edge ou a edição Electron, com permissões de multimédia.'));
   this.config={source:form.get('source'),quality:form.get('quality'),aspect:form.get('aspect')};
   const device=value=>value?{deviceId:{exact:value}}:true;
   if(this.config.source!=='camera'){
    if(!navigator.mediaDevices.getDisplayMedia)throw Error('Screen sharing is unavailable in this browser.');
    this.screen=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:form.has('systemAudio')});this.streams.push(this.screen);
   }
   if(this.config.source!=='screen'||form.has('useMic')){
    const stream=await navigator.mediaDevices.getUserMedia({video:this.config.source==='screen'?false:device(form.get('camera')),audio:form.has('useMic')?device(form.get('microphone')):false});
    this.streams.push(stream);this.mic=stream.getAudioTracks()[0];
    if(stream.getVideoTracks().length)this.camera=stream;
   }
   const video=async stream=>{if(!stream)return null;const el=document.createElement('video');el.muted=true;el.playsInline=true;el.srcObject=stream;await el.play();return el;};
   this.screenVideo=await video(this.screen);this.cameraVideo=await video(this.camera);
   this.canvas=document.createElement('canvas');
   const height=this.config.quality==='1080p'?1080:720;
   [this.canvas.width,this.canvas.height]=this.config.aspect==='9:16'?[height,Math.round(height*16/9/2)*2]:[Math.round(height*16/9/2)*2,height];
   const ctx=this.canvas.getContext('2d');
   const draw=()=>{
    const w=this.canvas.width,h=this.canvas.height;
    const fit=(v,x,y,w,h)=>{if(!v?.videoWidth)return;const scale=Math.min(w/v.videoWidth,h/v.videoHeight),vw=v.videoWidth*scale,vh=v.videoHeight*scale;ctx.drawImage(v,x+(w-vw)/2,y+(h-vh)/2,vw,vh);};
    this.production.draw(ctx,w,h,this.cameraVideo,this.screenVideo,fit);
    if(this.featuredComment){
     ctx.fillStyle='rgba(10,10,20,0.88)';ctx.fillRect(w*.04,h*.74,w*.92,h*.22);ctx.fillStyle='#fff';ctx.font=`bold ${Math.round(h*.032)}px sans-serif`;ctx.fillText(this.featuredComment.author,w*.06,h*.79,w*.88);ctx.font=`${Math.round(h*.029)}px sans-serif`;
     const words=this.featuredComment.text.split(/\s+/);let line='',row=0;for(const word of words){if(ctx.measureText(line+' '+word).width>w*.86){ctx.fillText(line,w*.06,h*(.84+row*.045));line=word;if(++row>=2)break;}else line+=(line?' ':'')+word;}if(row<2)ctx.fillText(line,w*.06,h*(.84+row*.045),w*.86);
    }
   };
   draw();this.drawTimer=setInterval(draw,1000/30);
   this.audio=new AudioContext();await this.audio.resume();const destination=this.audio.createMediaStreamDestination();
   this.master=this.audio.createGain();this.master.connect(destination);this.analyser=this.audio.createAnalyser();this.master.connect(this.analyser);this.audioInputs=[];
   this.silence=this.audio.createOscillator();const silentGain=this.audio.createGain();silentGain.gain.value=0;this.silence.connect(silentGain).connect(this.master);this.silence.start();
   for(const stream of this.streams)if(stream.getAudioTracks().length){const gain=this.audio.createGain(),name=stream===this.screen?'screenVolume':'micVolume';gain.gain.value=Number(this.production.element.querySelector(`[name="${name}"]`).value);this.audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(gain).connect(this.master);this.audioInputs.push({name,gain});}
   const samples=new Uint8Array(this.analyser.fftSize);this.meterTimer=setInterval(()=>{this.analyser.getByteTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+((v-128)/128)**2,0)/samples.length);this.production.element.querySelector('meter').value=Math.min(1,rms*3);},100);
   this.output=new MediaStream([...this.canvas.captureStream(30).getVideoTracks(),...destination.stream.getAudioTracks()]);
   this.element.querySelector('.capture-preview').srcObject=this.output;
   this.muted=false;this.element.querySelector('[data-capture="mute"]').textContent=text('Mute microphone','Silenciar microfone');
   for(const stream of this.streams)for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(this.output)void this.release();},{once:true});
   await this.listDevices();this.status(text('Local preview only — nothing is being broadcast.','Apenas pré-visualização local — nada está a ser transmitido.'));
  }catch(error){this.releaseDevices();this.status(error.message,true);this.toast(error.message,true);}
  finally{this.preparing=false;this.controls();}
 }
 async listDevices(){
  try{const devices=await navigator.mediaDevices.enumerateDevices();for(const [name,kind]of [['camera','videoinput'],['microphone','audioinput']]){const select=this.element.querySelector(`[name="${name}"]`),previous=select.value;select.innerHTML='<option value="">'+text('Default device','Dispositivo predefinido')+'</option>'+devices.filter(d=>d.kind===kind).map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`${kind} ${i+1}`)}</option>`).join('');select.value=previous;}}catch{}
 }
 toggleMute(){if(!this.mic)return;this.muted=!this.muted;this.mic.enabled=!this.muted;this.element.querySelector('[data-capture="mute"]').textContent=this.muted?text('Unmute microphone','Ativar microfone'):text('Mute microphone','Silenciar microfone');}
 async acquireFeed(role){
  this.feedUsers ||= new Set();this.feedUsers.add(role);
  if(this.feedStarting)return this.feedStarting;
  if(this.feedSession)return this.feedSession.id;
  this.feedStarting=(async()=>{
   const mimeType=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType)throw Error('Live WebM capture is unavailable. Use Chrome or Edge.');
   const recorder=new MediaRecorder(this.output,{mimeType,videoBitsPerSecond:this.config.quality==='1080p'?4500000:2500000,audioBitsPerSecond:128000});
   this.feedSession=await this.api('/api/capture/start',{...this.config,confirmed:true});this.feedMime=mimeType;const id=this.feedSession.id;
   this.feedUploader=new LiveUploader({stopRemote:()=>this.api(`/api/capture/${id}/stop`,{}),onError:error=>{this.status(error.message,true);this.toast(error.message,true);void this.stop();void this.production.stopRecording();},fetchChunk:async(blob,sequence)=>{
    const response=await fetch(`/api/capture/${id}/chunks?sequence=${sequence}`,{method:'POST',headers:{'Content-Type':'video/webm','X-Go-Streams':'1'},body:blob,signal:AbortSignal.timeout(15000)});if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'Live capture disconnected.');}
   }});
   this.feedRecorder=recorder;recorder.ondataavailable=event=>this.feedUploader?.push(event.data);recorder.onerror=()=>this.feedUploader?.fail(Error('Live capture failed. Start a new capture.'));recorder.start(1000);return id;
  })();
  try{return await this.feedStarting;}catch(error){this.feedUsers.delete(role);if(this.feedSession)await this.api(`/api/capture/${this.feedSession.id}/stop`,{}).catch(()=>{});this.feedSession=null;throw error;}finally{this.feedStarting=null;}
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
  if(!this.output||this.session||this.preparing)return;this.preparing=true;this.controls();
  try{
   const channelIds=[...this.element.querySelectorAll('.capture-destinations input:checked:not(:disabled)')].map(el=>el.value);
   if(!channelIds.length||!this.element.querySelector('[data-capture="consent"]').checked)throw Error('Confirm at least one live destination.');
   const feedId=await this.acquireFeed('live');this.session=await this.api('/api/live/start',{...this.config,mimeType:this.feedMime,feedId,channelIds,confirmed:true});
   this.status(text('Live feed is being sent. Confirm reception in each platform dashboard.','O sinal está a ser enviado. Confirme a receção no painel de cada plataforma.'));
  }catch(error){if(this.session)await this.api(`/api/live/${this.session.id}/stop`,{}).catch(()=>{});this.session=null;await this.releaseFeed('live').catch(()=>{});this.status(error.message,true);this.toast(error.message,true);}
  finally{this.preparing=false;this.controls();}
 }
 async stop(){
  if(this.stopping)return;this.stopping=true;this.controls();
  try{if(this.session)await this.api(`/api/live/${this.session.id}/stop`,{});await this.releaseFeed('live');this.status(text('Broadcast stopped. Local preview is still active.','Transmissão parada. A pré-visualização local continua ativa.'));}
  catch(error){this.status(error.message,true);}
  finally{this.session=null;this.stopping=false;this.element.querySelector('[data-capture="consent"]').checked=false;this.controls();}
 }
 releaseDevices(){
  clearInterval(this.drawTimer);
  clearInterval(this.meterTimer);this.audioInputs=[];
  for(const stream of [...this.streams,this.output].filter(Boolean))for(const track of stream.getTracks())track.stop();
  this.streams=[];this.output=null;this.mic=null;this.camera=null;this.screen=null;
  for(const v of [this.cameraVideo,this.screenVideo])if(v){v.pause();v.srcObject=null;}
  this.cameraVideo=null;this.screenVideo=null;
  if(this.audio){void this.audio.close().catch(()=>{});this.audio=null;}
  if(this.element)this.element.querySelector('.capture-preview').srcObject=null;
 }
 async release(){await this.production?.stopRecording();this.production?.stopClip();await this.stop();this.releaseDevices();this.status(text('Camera and microphone are off.','A câmara e o microfone estão desligados.'));this.controls();}
}
