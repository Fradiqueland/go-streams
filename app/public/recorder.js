import {language,localeTag} from './i18n.js';
import {cropRect,cameraRect,frameSize,containedRect,selectionRect} from './recorder-geometry.js';
const t=(en,pt)=>language()==='pt-PT'?pt:en;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const elapsed=ms=>{const s=Math.floor(ms/1000);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};

export class RecordingUpload {
 constructor(send,onError,limit=8*1024*1024){Object.assign(this,{send,onError,limit});this.pending=Promise.resolve();this.bytes=0;this.sequence=0;this.error=null;}
 push(blob){
  if(!blob.size||this.error)return;
  if(this.bytes+blob.size>this.limit){this.fail(Error(t('The disk cannot keep up. Recording stopped; received data stays available for recovery.','O disco não acompanha a gravação. A gravação parou; os dados recebidos ficam disponíveis para recuperação.')));return;}
  this.bytes+=blob.size;
  this.pending=this.pending.then(async()=>{if(!this.error)await this.send(blob,this.sequence++);}).catch(error=>this.fail(error)).finally(()=>{this.bytes-=blob.size;});
 }
 fail(error){if(this.error)return;this.error=error;this.onError(error);}
 async finish(){await this.pending;if(this.error)throw this.error;}
}

export function countdown(seconds,onTick,signal){
 return new Promise(resolve=>{
  if(signal.aborted)return resolve(false);
  const end=Date.now()+seconds*1000;let timer;
  const done=value=>{clearInterval(timer);signal.removeEventListener('abort',cancel);onTick(null);resolve(value);};
  const cancel=()=>done(false),tick=()=>{const left=Math.ceil((end-Date.now())/1000);if(left<=0)done(true);else onTick(left);};
  signal.addEventListener('abort',cancel,{once:true});if(!seconds)return done(true);timer=setInterval(tick,100);tick();
 });
}

export class RecorderPanel {
 constructor({api,toast}){Object.assign(this,{api,toast});this.streams=[];this.crop=cropRect();this.cameraPosition={x:.96,y:.96,size:.28};this.generation=0;this.preferences={directory:'',askEveryTime:true};}
 get busy(){return Boolean(this.output||this.preparing||this.starting||this.id||this.finishing||this.folderBusy);}
 get hasUnsavedChanges(){return Boolean(this.folderDirty);}
 $(selector){return this.element.querySelector(selector);}
 mount(container,state){
  if(!this.element){
   this.element=document.createElement('section');this.element.className='recorder-studio';
   this.element.innerHTML=`<div class="page-heading"><div><h1>${t('Video & audio recorder','Gravador de vídeo e áudio')}</h1><p>${t('Record locally to a folder on this computer. Prepare your picture and sound, then start the countdown.','Grave numa pasta deste computador. Prepare a imagem e o som e inicie a contagem decrescente.')}</p></div></div>
   <div class="recorder-grid"><section class="panel recorder-setup"><h2>${t('1. Picture and sound','1. Imagem e som')}</h2><form id="recorder-form">
   <label>${t('Recording mode','Modo de gravação')}<select name="mode"><option value="screen">${t('Screen / window / selected area','Ecrã / janela / área selecionada')}</option><option value="screen-camera">${t('Screen + square camera overlay','Ecrã + câmara em quadrado')}</option><option value="camera">${t('Camera video','Vídeo da câmara')}</option><option value="audio">${t('Audio recorder','Gravador de áudio')}</option></select></label>
   <label>${t('Sound source','Origem do som')}<select name="sound"><option value="microphone">${t('Microphone','Microfone')}</option><option value="system">${t('Computer audio','Áudio do PC')}</option><option value="both">${t('Computer audio + microphone','Áudio do PC + microfone')}</option><option value="none">${t('Video without sound','Vídeo sem som')}</option></select></label>
   <div class="form-row"><label>${t('Camera','Câmara')}<select name="camera"><option value="">${t('Default camera','Câmara predefinida')}</option></select></label><label>${t('Microphone','Microfone')}<select name="microphone"><option value="">${t('Default microphone','Microfone predefinido')}</option></select></label></div>
   <div class="form-row"><label>${t('Maximum quality','Qualidade máxima')}<select name="quality"><option value="1080">1080p</option><option value="720">720p</option></select></label><label>${t('Countdown','Contagem decrescente')}<select name="countdown"><option value="0">${t('No countdown','Sem contagem')}</option><option value="3" selected>3 s</option><option value="5">5 s</option><option value="10">10 s</option></select></label></div>
   <p class="form-hint">${t('Choose a screen, window or tab in the system picker. To capture computer audio, enable audio sharing there. If no audio track is provided, preparation stops so you can choose another source. In audio-only mode, selecting a screen supplies sound; no video is saved.','Escolha o ecrã, janela ou separador no seletor do sistema. Para captar o som do PC, ative aí a partilha de áudio. Se a origem não fornecer som, a preparação para e pode escolher outra. No modo só áudio, a escolha de um ecrã fornece o som; não é guardado vídeo.')}</p>
   <button class="secondary" data-recorder="prepare">${t('Prepare preview','Preparar pré-visualização')}</button></form></section>
   <section class="panel recorder-preview-panel"><h2>${t('Preview of the saved result','Pré-visualização do resultado guardado')}</h2><div class="recorder-stage"><video class="recorder-preview" autoplay muted playsinline></video><div class="recorder-camera-box" tabindex="0" role="group" aria-label="${t('Move camera with arrow keys. Resize using the slider.','Mova a câmara com as setas. Use o controlo de tamanho para redimensionar.')}" hidden><span>${t('Drag camera','Arrastar câmara')}</span><button type="button" data-recorder="resize-camera" aria-label="${t('Drag to resize camera','Arraste para redimensionar a câmara')}">↘</button></div><div class="recorder-countdown" role="status" hidden></div><div class="recorder-audio-only" hidden>${t('Audio only — no video is saved','Só áudio — não é guardado vídeo')}<meter min="0" max="1" value="0" aria-label="${t('Audio level','Nível de áudio')}"></meter></div></div>
   <p class="recorder-status" role="status">${t('Devices are off. Prepare a preview first.','Os dispositivos estão desligados. Prepare primeiro a pré-visualização.')}</p><div class="actions"><button class="secondary" data-recorder="release" disabled>${t('Close preview and release devices','Fechar pré-visualização e libertar dispositivos')}</button></div>
   <div class="recorder-camera-controls" hidden><label>${t('Camera size','Tamanho da câmara')}<input name="cameraSize" type="range" min="10" max="65" value="28"></label><div class="form-row"><label>${t('Camera horizontal position (%)','Posição horizontal da câmara (%)')}<input name="cameraX" type="number" min="0" max="100" value="96"></label><label>${t('Camera vertical position (%)','Posição vertical da câmara (%)')}<input name="cameraY" type="number" min="0" max="100" value="96"></label></div><p class="form-hint">${t('Drag the square on the preview; drag its lower-right handle to resize. These controls are not included in the saved video.','Arraste o quadrado na pré-visualização; use o canto inferior direito para redimensionar. Estes controlos não aparecem no vídeo guardado.')}</p></div></section></div>
   <section class="panel recorder-region" hidden><h2>${t('Select the screen area to record','Escolher a área do ecrã a gravar')}</h2><p>${t('Drag a rectangle over the source below, or enter percentages. Only that area appears in the result above. Choose the area before starting.','Arraste um retângulo na origem abaixo ou introduza percentagens. Só essa área aparece no resultado acima. Escolha a área antes de iniciar.')}</p><div class="recorder-source-stage"><video class="recorder-source" autoplay muted playsinline></video><div class="recorder-crop-box"></div></div><div class="recorder-crop-fields">${[['x','Left (%)','Esquerda (%)',0],['y','Top (%)','Topo (%)',0],['width','Width (%)','Largura (%)',100],['height','Height (%)','Altura (%)',100]].map(([name,en,pt,value])=>`<label>${t(en,pt)}<input name="crop-${name}" type="number" min="${['width','height'].includes(name)?5:0}" max="100" step="1" value="${value}"></label>`).join('')}<button class="secondary" data-recorder="full-area">${t('Use full source','Usar origem completa')}</button></div></section>
   <section class="panel recorder-destination"><h2>${t('2. Save and record','2. Guardar e gravar')}</h2><label>${t('Recording folder','Pasta da gravação')}<input name="directory" maxlength="4096"></label><label class="check"><input name="askFolder" type="checkbox" checked> ${t('Ask for a folder whenever recording starts','Perguntar a pasta ao iniciar cada gravação')}</label><div class="actions"><button class="secondary" data-recorder="folder">${t('Choose folder','Escolher pasta')}</button><button class="secondary" data-recorder="default-folder">${t('Use saved default','Usar pasta predefinida')}</button><button class="secondary" data-recorder="save-folder">${t('Save as default','Guardar como predefinição')}</button></div><p class="form-hint">${t('Video: MP4 (H.264/AAC). Audio: M4A (AAC). The selected folder is used directly. Nothing is uploaded to cloud storage.','Vídeo: MP4 (H.264/AAC). Áudio: M4A (AAC). A pasta escolhida é usada diretamente. Não é enviada nenhuma gravação para a nuvem.')}</p><div class="recorder-record-actions"><button class="primary" data-recorder="start" disabled>${t('Start recording','Iniciar gravação')}</button><button class="danger" data-recorder="stop" disabled>${t('Stop and save','Parar e guardar')}</button><button class="secondary" data-recorder="cancel" hidden>${t('Cancel countdown','Cancelar contagem')}</button><output class="recorder-countdown-inline" role="status" hidden></output><output class="recorder-elapsed" aria-live="off">00:00:00</output></div></section>
   <section class="panel"><h2>${t('Local recordings','Gravações locais')}</h2><div class="recorder-files"></div></section>`;
   this.element.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void this.prepare();});
   this.element.addEventListener('click',event=>{const button=event.target.closest('[data-recorder]');if(!button||button.disabled)return;const action=button.dataset.recorder;
    const task=action==='start'?this.start():action==='stop'?this.stop():action==='release'?this.release():action==='folder'?this.chooseFolder():action==='save-folder'?this.saveFolder():action==='recover'?this.recover(button.dataset.id):null;
    if(task)void task.catch(error=>this.error(error));
    if(action==='cancel')this.countdownAbort?.abort();
    if(action==='default-folder'){this.folderDirty=false;this.applyPreferences(this.preferences);}
    if(action==='full-area'&&!this.starting&&!this.id){this.crop=cropRect();this.syncCrop();this.resizeCanvas();}
   });
   this.element.addEventListener('input',event=>{
    const name=event.target.name;
    if(['directory','askFolder'].includes(name))this.folderDirty=true;
    if(name?.startsWith('crop-')&&!this.id&&!this.starting){this.crop=cropRect(Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(this.$(`[name="crop-${k}"]`).value)/100])));this.syncCrop();this.resizeCanvas();}
    if(['cameraSize','cameraX','cameraY'].includes(name)){this.cameraPosition={size:Number(this.$('[name="cameraSize"]').value)/100,x:Number(this.$('[name="cameraX"]').value)/100,y:Number(this.$('[name="cameraY"]').value)/100};this.positionBoxes();}
   });
   this.element.addEventListener('change',()=>this.controls());
   this.$('.recorder-source-stage').addEventListener('pointerdown',event=>this.selectRegion(event));
   this.$('.recorder-camera-box').addEventListener('pointerdown',event=>this.moveCamera(event));
   this.$('.recorder-camera-box').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const delta=event.shiftKey?.1:.01;this.cameraPosition.x=Math.max(0,Math.min(1,this.cameraPosition.x+(event.key==='ArrowRight'?delta:event.key==='ArrowLeft'?-delta:0)));this.cameraPosition.y=Math.max(0,Math.min(1,this.cameraPosition.y+(event.key==='ArrowDown'?delta:event.key==='ArrowUp'?-delta:0)));this.syncCamera();});
   window.addEventListener('resize',()=>this.positionBoxes());
   window.addEventListener('beforeunload',event=>{if(this.busy){event.preventDefault();event.returnValue='';}});
   window.addEventListener('pagehide',()=>{this.generation++;this.countdownAbort?.abort();this.recorder?.state!=='inactive'&&this.recorder?.stop();this.releaseDevices();});
  }
  if(this.element.parentNode!==container){container.innerHTML='';container.appendChild(this.element);}
  this.update(state);this.positionBoxes();
 }
 status(message){this.$('.recorder-status').textContent=message;}
 error(error){this.status(error.message);this.toast(error.message,true);}
 applyPreferences(preferences){this.$('[name="directory"]').value=preferences.directory;this.$('[name="askFolder"]').checked=preferences.askEveryTime;}
 update(state={}){
  if(!this.element)return;
  if(state.recordingPreferences){this.preferences={...state.recordingPreferences};if(!this.folderDirty&&!this.folderBusy&&!this.starting&&!this.id)this.applyPreferences(this.preferences);}
  if(state.recordings){
   const signature=JSON.stringify(state.recordings);if(signature!==this.filesSignature){this.filesSignature=signature;this.$('.recorder-files').innerHTML=state.recordings.slice(0,20).map(item=>`<div class="recorder-file"><strong>${item.kind==='audio'?t('Audio','Áudio'):t('Video','Vídeo')} · ${esc(new Date(item.created).toLocaleString(localeTag()))} · ${esc(item.format||'webm')}</strong><p>${item.status==='completed'?`<a href="/api/recordings/${esc(item.id)}/file">${t('Download','Transferir')} (${(item.bytes/1048576).toFixed(1)} MB)</a>`:item.status==='interrupted'?`<button class="secondary small" data-recorder="recover" data-id="${esc(item.id)}">${t('Recover recording','Recuperar gravação')}</button>`:esc(item.status)}</p><small>${esc(item.directory||this.preferences.directory)} / ${esc(item.id)}.${esc(item.format||'webm')}</small></div>`).join('')||`<p>${t('No recordings yet.','Ainda não existem gravações.')}</p>`;}
   const own=state.recordings.find(item=>item.id===this.id);if(own&&!this.finishing&&!this.starting&&['completed','interrupted'].includes(own.status)){this.error(Error(own.error||t('Recording ended.','A gravação terminou.')));void this.stop().catch(()=>{});}
  }
  this.controls();
 }
 controls(){
  if(!this.element)return;
  const running=Boolean(this.id||this.starting||this.finishing),prepared=Boolean(this.output),locked=running||this.preparing;
  const mode=this.$('[name="mode"]').value,sound=this.$('[name="sound"]').value;
  for(const control of this.element.querySelectorAll('#recorder-form select'))control.disabled=locked||prepared;
  this.$('[name="camera"]').disabled=locked||prepared||!['camera','screen-camera'].includes(mode);
  this.$('[name="microphone"]').disabled=locked||prepared||!['microphone','both'].includes(sound);
  this.$('[name="quality"]').disabled=locked||prepared||mode==='audio';
  this.$('[data-recorder="prepare"]').disabled=locked||prepared;
  this.$('[data-recorder="start"]').disabled=!prepared||locked||this.folderBusy;
  this.$('[data-recorder="stop"]').disabled=!this.id||this.finishing;
  this.$('[data-recorder="release"]').disabled=(!prepared&&!this.preparing)||this.finishing;
  this.$('[data-recorder="cancel"]').hidden=!this.starting;
  for(const control of this.element.querySelectorAll('.recorder-destination input,.recorder-destination .actions button'))control.disabled=locked||this.folderBusy;
  for(const control of this.element.querySelectorAll('.recorder-crop-fields input,.recorder-crop-fields button'))control.disabled=locked;
  this.$('.recorder-region').hidden=!this.screenVideo||this.config?.mode==='audio';
  this.$('.recorder-camera-controls').hidden=!prepared||this.config?.mode!=='screen-camera';
  this.$('.recorder-camera-box').hidden=!prepared||this.config?.mode!=='screen-camera';
  this.$('.recorder-audio-only').hidden=!prepared||this.config?.mode!=='audio';
 }
 async chooseFolder(){
  if(this.folderBusy)return null;this.folderBusy=true;this.controls();
  try{const result=await this.api('/api/recordings/pick-directory',{directory:this.$('[name="directory"]').value});if(result.directory!==null){this.$('[name="directory"]').value=result.directory;this.folderDirty=true;}return result.directory;}
  finally{this.folderBusy=false;this.controls();}
 }
 async saveFolder(){
  if(this.folderBusy||this.id||this.starting)return;this.folderBusy=true;this.controls();
  try{this.preferences=await this.api('/api/recordings/preferences',{directory:this.$('[name="directory"]').value,askEveryTime:this.$('[name="askFolder"]').checked},'PUT');this.folderDirty=false;this.applyPreferences(this.preferences);this.toast(t('Default recording folder saved.','Pasta de gravação predefinida guardada.'));}
  finally{this.folderBusy=false;this.controls();}
 }
 async prepare(){
  if(this.busy)return;const generation=++this.generation;this.preparing=true;this.controls();
  const current=()=>this.generation===generation;
  const retain=stream=>{if(!current()){stream.getTracks().forEach(track=>track.stop());throw Error(t('Preview cancelled.','Pré-visualização cancelada.'));}this.streams.push(stream);if(stream.getTracks().some(track=>track.readyState==='ended'))throw Error(t('The selected source has ended. Choose it again.','A origem selecionada terminou. Escolha-a novamente.'));for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(current())void this.release().catch(error=>this.error(error));},{once:true});return stream;};
  try{
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error(t('Recording requires a browser with WebM recording support, or the Windows Electron edition.','A gravação requer um navegador com suporte WebM ou a edição Electron do Windows.'));
   const mode=this.$('[name="mode"]').value,sound=this.$('[name="sound"]').value;this.config={mode,sound,quality:Number(this.$('[name="quality"]').value),countdown:Number(this.$('[name="countdown"]').value)};
   if(mode==='audio'&&sound==='none')throw Error(t('Choose microphone, computer audio or both.','Escolha microfone, áudio do PC ou ambos.'));
   const system=['system','both'].includes(sound),mic=['microphone','both'].includes(sound),camera=['camera','screen-camera'].includes(mode);
   if(['screen','screen-camera'].includes(mode)||system){
    if(!navigator.mediaDevices.getDisplayMedia)throw Error(t('Screen or computer audio capture is unavailable in this browser.','A captura de ecrã ou áudio do PC não está disponível neste navegador.'));
    this.screen=retain(await navigator.mediaDevices.getDisplayMedia({video:{frameRate:30},audio:system,systemAudio:'include'}));
    if(system&&!this.screen.getAudioTracks().some(track=>track.readyState==='live'))throw Error(t('The selected source did not provide computer audio. Enable Share audio in the picker, select an audio-capable source, or choose microphone.','A origem escolhida não forneceu áudio do PC. Ative Partilhar áudio no seletor, escolha uma origem com som ou selecione microfone.'));
   }
   const device=name=>this.$(`[name="${name}"]`).value?{deviceId:{exact:this.$(`[name="${name}"]`).value}}:true;
   if(camera||mic)this.device=retain(await navigator.mediaDevices.getUserMedia({video:camera?device('camera'):false,audio:mic?device('microphone'):false}));
   if(mic&&!this.device.getAudioTracks().length)throw Error(t('The selected microphone did not provide audio.','O microfone selecionado não forneceu áudio.'));
   if(!current())throw Error('Preview cancelled');
   const video=async stream=>{if(!stream?.getVideoTracks().length)return null;const v=document.createElement('video');v.muted=true;v.playsInline=true;v.srcObject=stream;this.videoElements||=[];this.videoElements.push(v);await v.play();if(!current())throw Error('Preview cancelled');return v;};
   this.screenVideo=await video(this.screen);this.cameraVideo=await video(this.device);
   this.crop=cropRect();this.canvas=document.createElement('canvas');this.resizeCanvas();this.syncCrop();
   if(mode!=='audio'){
    this.draw();this.drawTimer=setInterval(()=>this.draw(),1000/30);
    this.$('.recorder-source').srcObject=this.screen||null;
   }
   const audioTracks=[];
   if(sound!=='none'){
    this.audio=new AudioContext();await this.audio.resume();if(!current())throw Error('Preview cancelled');const destination=this.audio.createMediaStreamDestination(),mix=this.audio.createGain();mix.connect(destination);this.analyser=this.audio.createAnalyser();mix.connect(this.analyser);
    const silentSink=this.audio.createGain();silentSink.gain.value=0;mix.connect(silentSink).connect(this.audio.destination);
    const inputs=this.streams.filter(stream=>stream.getAudioTracks().length);mix.gain.value=1/Math.max(1,inputs.length);for(const stream of inputs)this.audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(mix);
    audioTracks.push(...destination.stream.getAudioTracks());
    const samples=new Uint8Array(this.analyser.fftSize);this.meterTimer=setInterval(()=>{this.analyser.getByteTimeDomainData(samples);this.$('meter').value=Math.min(1,Math.sqrt(samples.reduce((sum,v)=>sum+((v-128)/128)**2,0)/samples.length)*3);},100);
   }
   if(!current())throw Error('Preview cancelled');
   this.output=new MediaStream([...(mode==='audio'?[]:this.canvas.captureStream(30).getVideoTracks()),...audioTracks]);
   this.$('.recorder-preview').srcObject=this.output;this.$('.recorder-preview').hidden=mode==='audio';
   this.status(t('Preview ready. Choose the area, camera position and folder, then start recording.','Pré-visualização pronta. Escolha a área, a posição da câmara e a pasta e inicie a gravação.'));
   this.syncCamera();void this.listDevices(generation);
  }catch(error){if(current()){this.releaseDevices();this.error(error);}}
  finally{if(current()){this.preparing=false;this.controls();this.positionBoxes();}}
 }
 async listDevices(generation){
  try{const devices=await navigator.mediaDevices.enumerateDevices();if(generation!==this.generation)return;for(const [name,kind]of [['camera','videoinput'],['microphone','audioinput']]){const el=this.$(`[name="${name}"]`),previous=el.value;el.innerHTML=`<option value="">${t('Default device','Dispositivo predefinido')}</option>`+devices.filter(d=>d.kind===kind).map(d=>`<option value="${esc(d.deviceId)}">${esc(d.label||d.kind)}</option>`).join('');el.value=previous;}}
  catch{}
 }
 resizeCanvas(){
  if(!this.canvas)return;const source=['screen','screen-camera'].includes(this.config.mode)?this.screenVideo:this.cameraVideo;
  const size=frameSize(source?.videoWidth||1280,source?.videoHeight||720,['screen','screen-camera'].includes(this.config.mode)?this.crop:{},this.config.quality);this.canvas.width=size.width;this.canvas.height=size.height;this.positionBoxes();
 }
 draw(){
  const ctx=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;ctx.fillStyle='#111827';ctx.fillRect(0,0,w,h);
  const screen=['screen','screen-camera'].includes(this.config.mode);
  if(screen&&this.screenVideo?.videoWidth){const v=this.screenVideo,r=this.crop;ctx.drawImage(v,r.x*v.videoWidth,r.y*v.videoHeight,r.width*v.videoWidth,r.height*v.videoHeight,0,0,w,h);}
  if(this.cameraVideo?.videoWidth&&['camera','screen-camera'].includes(this.config.mode)){
   const v=this.cameraVideo,r=this.config.mode==='camera'?{x:0,y:0,width:w,height:h}:cameraRect(this.cameraPosition,w,h),sourceRatio=v.videoWidth/v.videoHeight,targetRatio=r.width/r.height;
   const sw=sourceRatio>targetRatio?v.videoHeight*targetRatio:v.videoWidth,sh=sourceRatio>targetRatio?v.videoHeight:v.videoWidth/targetRatio;
   ctx.drawImage(v,(v.videoWidth-sw)/2,(v.videoHeight-sh)/2,sw,sh,r.x,r.y,r.width,r.height);
  }
 }
 syncCrop(){for(const name of ['x','y','width','height'])this.$(`[name="crop-${name}"]`).value=Math.round(this.crop[name]*100);this.positionBoxes();}
 syncCamera(){for(const [field,key]of [['cameraSize','size'],['cameraX','x'],['cameraY','y']])this.$(`[name="${field}"]`).value=Math.round(this.cameraPosition[key]*100);this.positionBoxes();}
 positionBoxes(){
  if(!this.canvas||!this.element.isConnected)return;
  const stage=this.$('.recorder-stage'),view=containedRect(stage.getBoundingClientRect(),this.canvas.width,this.canvas.height),base=stage.getBoundingClientRect(),camera=cameraRect(this.cameraPosition,view.width,view.height);
  const place=(el,r)=>{el.style.left=r.x+'px';el.style.top=r.y+'px';el.style.width=r.width+'px';el.style.height=r.height+'px';};
  place(this.$('.recorder-camera-box'),{...camera,x:view.left-base.left+camera.x,y:view.top-base.top+camera.y});
  if(this.screenVideo?.videoWidth){const source=this.$('.recorder-source-stage'),b=source.getBoundingClientRect(),r=containedRect(b,this.screenVideo.videoWidth,this.screenVideo.videoHeight);place(this.$('.recorder-crop-box'),{x:r.left-b.left+this.crop.x*r.width,y:r.top-b.top+this.crop.y*r.height,width:this.crop.width*r.width,height:this.crop.height*r.height});}
 }
 pointerSession(event,move){
  event.preventDefault();const target=event.currentTarget;target.setPointerCapture(event.pointerId);const onMove=e=>move(e),end=()=>{target.removeEventListener('pointermove',onMove);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);};target.addEventListener('pointermove',onMove);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);target.addEventListener('lostpointercapture',end,{once:true});
 }
 selectRegion(event){
  if(!this.screenVideo||this.id||this.starting||this.preparing||event.button!==0)return;
  const b=containedRect(this.$('.recorder-source-stage').getBoundingClientRect(),this.screenVideo.videoWidth,this.screenVideo.videoHeight),point=e=>({x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))}),start=point(event);
  this.pointerSession(event,e=>{this.crop=selectionRect(start,point(e));this.syncCrop();this.resizeCanvas();});
 }
 moveCamera(event){
  if(!this.output||event.button!==0)return;const b=containedRect(this.$('.recorder-stage').getBoundingClientRect(),this.canvas.width,this.canvas.height),r=cameraRect(this.cameraPosition,b.width,b.height),start={...this.cameraPosition},resize=Boolean(event.target.closest('[data-recorder="resize-camera"]'));
  this.pointerSession(event,e=>{const dx=e.clientX-event.clientX,dy=e.clientY-event.clientY;if(resize)this.cameraPosition.size=Math.max(.1,Math.min(.65,start.size+Math.max(dx,dy)/Math.min(b.width,b.height)));else{this.cameraPosition.x=Math.max(0,Math.min(1,start.x+dx/Math.max(1,b.width-r.width)));this.cameraPosition.y=Math.max(0,Math.min(1,start.y+dy/Math.max(1,b.height-r.height)));}this.syncCamera();});
 }
 async start(){
  if(!this.output||this.id||this.starting||this.finishing||this.folderBusy)return;
  this.starting=true;const generation=this.generation;this.startDone=new Promise(resolve=>{this.resolveStart=resolve;});this.controls();this.countdownAbort=new AbortController();
  try{
   let directory=this.$('[name="directory"]').value;if(this.$('[name="askFolder"]').checked||!directory){directory=await this.chooseFolder();if(directory===null)return;}
   if(generation!==this.generation||this.countdownAbort.signal.aborted||!this.output)return;
   const audio=this.config.mode==='audio',mimeType=(audio?['audio/webm;codecs=opus','audio/webm']:['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm']).find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType)throw Error(t('This browser cannot record WebM. Use the Windows Electron edition or a compatible browser.','Este navegador não consegue gravar WebM. Use a edição Electron do Windows ou um navegador compatível.'));
   const recorder=new MediaRecorder(this.output,{mimeType,...(audio?{}:{videoBitsPerSecond:4500000}),audioBitsPerSecond:192000});
   const ready=await countdown(this.config.countdown,value=>{this.$('.recorder-countdown').hidden=value===null;this.$('.recorder-countdown').textContent=value??'';this.$('.recorder-countdown-inline').hidden=value===null;this.$('.recorder-countdown-inline').textContent=value===null?'':t('Recording starts in ','A gravação começa em ')+value+' s';},this.countdownAbort.signal);
   if(!ready||generation!==this.generation||this.countdownAbort.signal.aborted||!this.output){this.status(t('Countdown cancelled. No recording was started.','Contagem cancelada. Não foi iniciada nenhuma gravação.'));return;}
   const {id}=await this.api('/api/recordings/start',{confirmed:true,directory,kind:audio?'audio':'video',format:audio?'m4a':'mp4'});
   if(generation!==this.generation||this.countdownAbort.signal.aborted||!this.output){await this.api(`/api/recordings/${id}/finish`,{}).catch(()=>{});return;}
   this.id=id;this.recorder=recorder;this.upload=new RecordingUpload(async(blob,sequence)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(`/api/recordings/${id}/chunks?sequence=${sequence}`,{method:'POST',headers:{'X-Go-Streams':'1','Content-Type':audio?'audio/webm':'video/webm'},body:blob,signal:controller.signal});if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Recording upload failed');}finally{clearTimeout(timer);}},error=>{this.error(error);void this.stop().catch(()=>{});});
   this.recorderDone=new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});});recorder.addEventListener('dataavailable',event=>this.upload.push(event.data));recorder.addEventListener('error',()=>{this.error(Error(t('The browser recording stopped unexpectedly.','A gravação do navegador parou inesperadamente.')));void this.stop().catch(()=>{});});
   recorder.start(500);this.startedAt=Date.now();this.elapsedTimer=setInterval(()=>{this.$('.recorder-elapsed').textContent=elapsed(Date.now()-this.startedAt);},250);
   this.status(t('Recording to: ','A gravar para: ')+directory+' / '+id+(audio?'.m4a':'.mp4'));
  }catch(error){if(this.id)await this.stopWriter().catch(()=>{});this.error(error);}
  finally{this.starting=false;this.resolveStart();this.startDone=null;this.controls();}
 }
 async stopWriter(){
  const id=this.id;if(!id)return;clearInterval(this.elapsedTimer);
  if(this.recorder&&this.recorder.state!=='inactive'){this.recorder.stop();await this.recorderDone;}
  let uploadError;try{await this.upload?.finish();}catch(error){uploadError=error;}
  try{await this.api(`/api/recordings/${id}/finish`,{});if(uploadError)throw uploadError;this.status(t('Recording saved locally.','Gravação guardada localmente.'));}
  finally{this.id=null;this.recorder=null;this.upload=null;}
 }
 async stop(){
  if(this.stopDone)return this.stopDone;
  if(this.starting){this.countdownAbort?.abort();await this.startDone;}
  if(!this.id)return;this.finishing=true;this.controls();this.status(t('Saving recording…','A guardar a gravação…'));
  this.stopDone=(async()=>{try{await this.stopWriter();await this.reloadFiles();}finally{this.finishing=false;this.stopDone=null;this.controls();}})();return this.stopDone;
 }
 async reloadFiles(){const state=await this.api('/api/state');this.update(state);}
 async recover(id){await this.api(`/api/recordings/${id}/finish`,{});await this.reloadFiles();this.toast(t('Recording recovered.','Gravação recuperada.'));}
 releaseDevices(){
  clearInterval(this.drawTimer);clearInterval(this.meterTimer);clearInterval(this.elapsedTimer);
  for(const stream of [...this.streams,...(this.output?[this.output]:[])])for(const track of stream.getTracks())track.stop();
  for(const video of this.videoElements||[]){video.pause();video.srcObject=null;}this.videoElements=[];this.streams=[];void this.audio?.close().catch(()=>{});this.audio=null;this.output=null;this.screen=null;this.device=null;this.screenVideo=null;this.cameraVideo=null;
  if(this.element){this.$('.recorder-preview').srcObject=null;this.$('.recorder-source').srcObject=null;this.$('meter').value=0;}
 }
 async release(){
  if(this.releaseDone)return this.releaseDone;
  this.generation++;this.countdownAbort?.abort();
  this.releaseDone=(async()=>{try{await this.stop();}finally{this.releaseDevices();this.preparing=false;this.releaseDone=null;this.controls();this.status(t('Devices are off.','Os dispositivos estão desligados.'));}})();return this.releaseDone;
 }
}
