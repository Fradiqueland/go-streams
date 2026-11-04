import {language,localeTag,localized} from './i18n.js';
import {ProductionTools,layoutRects} from './live-production.js';
import {RecordingUpload} from './recording-upload.js';
export {RecordingUpload} from './recording-upload.js';
import {cropRect,cameraRect,cameraPosition as normalizedCameraPosition,resizedCameraPosition,frameSize,containedRect,selectionRect,recordingAspects,watermarkRect} from './recorder-geometry.js';
const t=localized;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const elapsed=ms=>{const s=Math.floor(ms/1000);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};

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
 get hasUnsavedChanges(){return Boolean(this.folderDirty||this.production?.hasUnsavedChanges);}
 $(selector){return this.element.querySelector(selector);}
 mount(container,state){
  if(!this.element){
   this.element=document.createElement('section');this.element.className='recorder-studio';
   this.element.innerHTML=`<div class="page-heading"><div><h1>${t('Video & audio recorder','Gravador de vídeo e áudio')}</h1><p>${t('Record locally to a folder on this computer. Prepare your picture and sound, then start the countdown.','Grave numa pasta deste computador. Prepare a imagem e o som e inicie a contagem decrescente.')}</p></div></div>
   <div class="recorder-grid"><section class="panel recorder-setup"><h2>${t('1. Picture and sound','1. Imagem e som')}</h2><form id="recorder-form">
   <label>${t('Recording mode','Modo de gravação')}<select name="mode"><option value="screen">${t('Screen / window / selected area','Ecrã / janela / área selecionada')}</option><option value="screen-camera">${t('Screen + square camera overlay','Ecrã + câmara em quadrado')}</option><option value="camera">${t('Camera video','Vídeo da câmara')}</option><option value="audio">${t('Audio recorder','Gravador de áudio')}</option></select></label>
   <label>${t('Sound source','Origem do som')}<select name="sound"><option value="microphone">${t('Microphone','Microfone')}</option><option value="system">${t('Computer audio','Áudio do PC')}</option><option value="both">${t('Computer audio + microphone','Áudio do PC + microfone')}</option><option value="none">${t('Video without sound','Vídeo sem som')}</option></select></label>
   <div class="form-row"><label>${t('Camera','Câmara')}<select name="camera"><option value="">${t('Default','Predefinido')}</option></select></label><label>${t('Microphone','Microfone')}<select name="microphone"><option value="">${t('Default','Predefinido')}</option></select></label></div>
   <div class="form-row"><label>${t('Maximum quality','Qualidade máxima')}<select name="quality"><option value="1080">1080p</option><option value="720">720p</option></select></label><label>${t('Countdown','Contagem decrescente')}<select name="countdown"><option value="0">${t('No countdown','Sem contagem')}</option><option value="3" selected>3 s</option><option value="5">5 s</option><option value="10">10 s</option></select></label></div>
   <p class="form-hint">${t('Choose a screen, window or tab in the system picker. To capture computer audio, enable audio sharing there. If no audio track is provided, preparation stops so you can choose another source. In audio-only mode, selecting a screen supplies sound; no video is saved.','Escolha o ecrã, janela ou separador no seletor do sistema. Para captar o som do PC, ative aí a partilha de áudio. Se a origem não fornecer som, a preparação para e pode escolher outra. No modo só áudio, a escolha de um ecrã fornece o som; não é guardado vídeo.')}</p>
   <button class="secondary" data-recorder="prepare">${t('Prepare preview','Preparar pré-visualização')}</button></form></section>
   <section class="panel recorder-preview-panel"><h2>${t('Preview of the saved result','Pré-visualização do resultado guardado')}</h2><div class="recorder-preview-toolbar"><label class="recorder-aspect">${t('Output aspect ratio','Proporção do vídeo')}<select name="aspect">${recordingAspects.map(value=>`<option value="${value}">${value==='original'?t('Original','Original'):value}</option>`).join('')}</select></label><output class="recorder-frame-size"></output><div class="recorder-record-actions"><button class="primary" data-recorder="start" disabled>${t('Start recording','Iniciar gravação')}</button><button class="danger" data-recorder="stop" disabled>${t('Stop and save','Parar e guardar')}</button><button class="secondary" data-recorder="cancel" hidden>${t('Cancel countdown','Cancelar contagem')}</button><output class="recorder-countdown-inline" role="status" hidden></output><output class="recorder-elapsed" aria-live="off">00:00:00</output></div></div><div class="recorder-stage"><video class="recorder-preview" autoplay muted playsinline></video><div class="recorder-camera-box" tabindex="0" role="group" aria-label="${t('Move camera with arrow keys. Resize using the slider.','Mova a câmara com as setas. Use o controlo de tamanho para redimensionar.')}" hidden><span>${t('Drag camera','Arrastar câmara')}</span><button type="button" data-recorder="resize-camera" aria-label="${t('Drag to resize camera','Arraste para redimensionar a câmara')}">↘</button></div><img class="recorder-watermark" src="/program.png" alt="" aria-hidden="true" hidden><div class="recorder-countdown" role="status" hidden></div><div class="recorder-audio-only" hidden>${t('Audio only — no video is saved','Só áudio — não é guardado vídeo')}<meter min="0" max="1" value="0" aria-label="${t('Audio level','Nível de áudio')}"></meter></div></div>
   <p class="form-hint recorder-aspect-hint">${t('Screen content keeps its proportions, with dark bars when needed. Camera video fills the frame.','O ecrã mantém as proporções, com barras escuras quando necessário. O vídeo da câmara preenche o enquadramento.')}</p><p class="recorder-status" role="status">${t('Devices are off. Prepare a preview first.','Os dispositivos estão desligados. Prepare primeiro a pré-visualização.')}</p><div class="actions"><button class="secondary" data-recorder="release" disabled>${t('Close preview and release devices','Fechar pré-visualização e libertar dispositivos')}</button></div>
   <div class="recorder-camera-controls" hidden><label>${t('Camera size','Tamanho da câmara')}<input name="cameraSize" type="range" min="10" max="65" value="28"></label><div class="form-row"><label>${t('Camera horizontal position (%)','Posição horizontal da câmara (%)')}<input name="cameraX" type="number" min="0" max="100" value="96"></label><label>${t('Camera vertical position (%)','Posição vertical da câmara (%)')}<input name="cameraY" type="number" min="0" max="100" value="96"></label></div><p class="form-hint">${t('Drag the square on the preview; drag its lower-right handle to resize. These controls are not included in the saved video.','Arraste o quadrado na pré-visualização; use o canto inferior direito para redimensionar. Estes controlos não aparecem no vídeo guardado.')}</p></div></section></div>
   <section class="panel recorder-region" hidden><h2>${t('Select the screen area to record','Escolher a área do ecrã a gravar')}</h2><p>${t('Drag a rectangle over the source below, or enter percentages. Only that area appears in the result above. Choose the area before starting.','Arraste um retângulo na origem abaixo ou introduza percentagens. Só essa área aparece no resultado acima. Escolha a área antes de iniciar.')}</p><div class="recorder-source-stage"><video class="recorder-source" autoplay muted playsinline></video><div class="recorder-crop-box"></div></div><div class="recorder-crop-fields">${[['x','Left (%)','Esquerda (%)',0],['y','Top (%)','Topo (%)',0],['width','Width (%)','Largura (%)',100],['height','Height (%)','Altura (%)',100]].map(([name,en,pt,value])=>`<label>${t(en,pt)}<input name="crop-${name}" type="number" min="${['width','height'].includes(name)?5:0}" max="100" step="1" value="${value}"></label>`).join('')}<button class="secondary" data-recorder="full-area">${t('Use full source','Usar origem completa')}</button></div></section>
   <section class="panel recorder-destination"><h2>${t('2. Save and record','2. Guardar e gravar')}</h2><label>${t('Recording folder','Pasta da gravação')}<input name="directory" maxlength="4096"></label><label class="check"><input name="askFolder" type="checkbox" checked> ${t('Ask for a folder whenever recording starts','Perguntar a pasta ao iniciar cada gravação')}</label><div class="actions"><button class="secondary" data-recorder="folder">${t('Choose folder','Escolher pasta')}</button><button class="secondary" data-recorder="default-folder">${t('Use saved default','Usar pasta predefinida')}</button><button class="secondary" data-recorder="save-folder">${t('Save as default','Guardar como predefinição')}</button></div><p class="form-hint">${t('Video: MP4 (H.264/AAC). Audio: M4A (AAC). The selected folder is used directly. Nothing is uploaded to cloud storage.','Vídeo: MP4 (H.264/AAC). Áudio: M4A (AAC). A pasta escolhida é usada diretamente. Não é enviada nenhuma gravação para a nuvem.')}</p></section>
   <section class="panel"><h2>${t('Local recordings','Gravações locais')}</h2><div class="recorder-files"></div></section>`;
   this.element.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void this.prepare();});
   this.element.addEventListener('click',event=>{const button=event.target.closest('[data-recorder]');if(!button||button.disabled)return;const action=button.dataset.recorder;
    const task=action==='start'?this.start():action==='stop'?this.stop():action==='release'?this.release():action==='folder'?this.chooseFolder():action==='save-folder'?this.saveFolder():action==='recover'?this.recover(button.dataset.id):action==='delete'?this.deleteRecording(button.dataset.id):null;
    if(task)void task.catch(error=>this.error(error));
    if(action==='cancel')this.countdownAbort?.abort();
    if(action==='default-folder'){this.folderDirty=false;this.applyPreferences(this.preferences);}
    if(action==='full-area'&&!this.starting&&!this.id){this.crop=cropRect();this.syncCrop();this.resizeCanvas();}
   });
   this.element.addEventListener('input',event=>{
    const name=event.target.name;
    if(['directory','askFolder'].includes(name))this.folderDirty=true;
    if(name?.startsWith('crop-')&&!this.id&&!this.starting){this.crop=cropRect(Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(this.$(`[name="crop-${k}"]`).value)/100])));this.syncCrop();this.resizeCanvas();}
    if(['cameraSize','cameraX','cameraY'].includes(name)){this.cameraPosition={size:Number(this.$('[name="cameraSize"]').value)/100,x:Number(this.$('[name="cameraX"]').value)/100,y:Number(this.$('[name="cameraY"]').value)/100};this.syncCamera();}
   });
   this.element.addEventListener('change',event=>{if(event.target.name==='aspect')this.changeAspect(event.target.value);this.controls();});
   this.$('.recorder-source-stage').addEventListener('pointerdown',event=>this.selectRegion(event));
   this.$('.recorder-camera-box').addEventListener('pointerdown',event=>this.moveCamera(event));
   this.$('.recorder-camera-box').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const delta=event.shiftKey?.1:.01;this.cameraPosition.x=Math.max(0,Math.min(1,this.cameraPosition.x+(event.key==='ArrowRight'?delta:event.key==='ArrowLeft'?-delta:0)));this.cameraPosition.y=Math.max(0,Math.min(1,this.cameraPosition.y+(event.key==='ArrowDown'?delta:event.key==='ArrowUp'?-delta:0)));this.syncCamera();});
   window.addEventListener('resize',()=>this.positionBoxes());
   window.addEventListener('beforeunload',event=>{if(this.busy){event.preventDefault();event.returnValue='';}});
   window.addEventListener('pagehide',()=>{this.generation++;this.countdownAbort?.abort();this.recorder?.state!=='inactive'&&this.recorder?.stop();this.releaseDevices();});
   navigator.mediaDevices?.addEventListener?.('devicechange',()=>{void this.listDevices(this.generation);});
   void this.listDevices(this.generation);
  }
  if(this.element.parentNode!==container){container.innerHTML='';container.appendChild(this.element);}
  this.production ||= new ProductionTools({api:this.api,toast:this.toast,recordingControls:false,sceneStorageKey:'go-streams-recorder-scenes',getStream:()=>this.config?.mode==='audio'||this.releaseDone?null:this.output,setVolume:(name,value)=>this.setInputVolume(name,value),setClipAudio:video=>this.setClipAudio(video),snapshot:()=>this.snapshot(),toggleRecording:()=>{if(this.finishing||this.preparing||this.starting||this.folderBusy)return;return this.id?this.stop():this.start();},onChange:()=>{this.controls();if(this.output&&this.config.mode!=='audio')this.draw();}});
  this.production.mount(this.element);
  this.$('.recorder-destination').before(this.production.element);
  this.production.element.querySelector('h2').textContent=t('Video composition','Composição do vídeo');
  this.update(state);this.positionBoxes();
 }
 status(message){this.$('.recorder-status').textContent=message;}
 error(error){this.status(error.message);this.toast(error.message,true);}
 recordingFailed(error){this.recordingError ||= error;this.error(error);void this.stop({skipOutro:true}).catch(()=>{});}
 applyPreferences(preferences){this.$('[name="directory"]').value=preferences.directory;this.$('[name="askFolder"]').checked=preferences.askEveryTime;}
 update(state={}){
  if(!this.element)return;
  this.production?.bumpers?.update(state.media);
  if(state.recordingPreferences&&(state.recordingPreferences.revision||0)>=(this.preferences.revision||0)){this.preferences={...state.recordingPreferences};if(!this.folderDirty&&!this.folderBusy&&!this.starting&&!this.id)this.applyPreferences(this.preferences);}
  if(state.recordings){
   const signature=JSON.stringify(state.recordings);if(signature!==this.filesSignature){this.filesSignature=signature;this.$('.recorder-files').innerHTML=state.recordings.slice(0,20).map(item=>`<div class="recorder-file"><strong>${item.kind==='audio'?t('Audio','Áudio'):t('Video','Vídeo')} · ${esc(new Date(item.created).toLocaleString(localeTag()))} · ${esc(item.format||'webm')}</strong><p>${item.status==='completed'?`<a href="/api/recordings/${esc(item.id)}/file" download="Streamland-${esc(item.id)}.${esc(item.format||'webm')}">${t('Download','Transferir')} (${(item.bytes/1048576).toFixed(1)} MB)</a>`:item.status==='interrupted'?`<button class="secondary small" data-recorder="recover" data-id="${esc(item.id)}">${t('Recover recording','Recuperar gravação')}</button>`:esc(item.status)}${['completed','interrupted'].includes(item.status)?` <button type="button" class="secondary small delete-recording" data-recorder="delete" data-id="${esc(item.id)}">${t('Delete recording','Apagar gravação')}</button>`:''}</p><small>${esc(item.directory||this.preferences.directory)} / ${esc(item.id)}.${esc(item.format||'webm')}</small></div>`).join('')||`<p>${t('No recordings yet.','Ainda não existem gravações.')}</p>`;}
   const own=state.recordings.find(item=>item.id===this.id);if(own&&!this.finishing&&!this.starting&&['completed','interrupted'].includes(own.status))this.recordingFailed(Error(own.error||t('Recording ended.','A gravação terminou.')));
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
  this.$('[name="aspect"]').disabled=locked||mode==='audio';
  this.$('.recorder-aspect-hint').hidden=mode==='audio';
  this.$('[data-recorder="prepare"]').disabled=locked||prepared;
  this.$('[data-recorder="start"]').disabled=!prepared||locked||this.folderBusy;
  this.$('[data-recorder="stop"]').disabled=!this.id||this.finishing;
  this.$('[data-recorder="release"]').disabled=(!prepared&&!this.preparing)||this.finishing;
  this.$('[data-recorder="cancel"]').hidden=!this.starting;
  for(const control of this.element.querySelectorAll('.recorder-destination input,.recorder-destination .actions button'))control.disabled=locked||this.folderBusy;
  for(const control of this.element.querySelectorAll('.recorder-crop-fields input,.recorder-crop-fields button'))control.disabled=locked;
  this.$('.recorder-region').hidden=!this.screenVideo||!['screen','screen-camera'].includes(this.config?.mode);
  const cameraOverlay=prepared&&this.config?.mode==='screen-camera'&&(!this.production||this.production.values.layout==='pip')&&!this.production?.clip;
  this.$('.recorder-camera-controls').hidden=!cameraOverlay;
  this.$('.recorder-camera-box').hidden=!cameraOverlay;
  this.$('.recorder-audio-only').hidden=!prepared||this.config?.mode!=='audio';
  this.$('.recorder-watermark').hidden=!prepared||this.config?.mode==='audio';
  this.$('.recorder-frame-size').hidden=!prepared||this.config?.mode==='audio';
  if(this.production?.element){
   this.production.element.hidden=mode==='audio';
   for(const [name,available]of [['micVolume',['microphone','both'].includes(sound)],['screenVolume',['system','both'].includes(sound)]])this.production.element.querySelector(`[name="${name}"]`).disabled=!available;
  }
 }
 async chooseFolder(){
  if(this.folderBusy)return null;this.folderBusy=true;this.controls();
  try{const result=await this.api('/api/recordings/pick-directory',{directory:this.$('[name="directory"]').value});if(result.directory!==null){this.$('[name="directory"]').value=result.directory;this.folderDirty=true;}return result.directory;}
  finally{this.folderBusy=false;this.controls();}
 }
 async saveFolder(){
  if(this.folderBusy||this.id||this.starting)return;this.folderBusy=true;this.controls();
  try{const saved=await this.api('/api/recordings/preferences',{directory:this.$('[name="directory"]').value,askEveryTime:this.$('[name="askFolder"]').checked},'PUT');if((saved.revision||0)>=(this.preferences.revision||0))this.preferences=saved;this.folderDirty=false;this.applyPreferences(this.preferences);this.toast(t('Default recording folder saved.','Pasta de gravação predefinida guardada.'));}
  finally{this.folderBusy=false;this.controls();}
 }
 async prepare(){
  if(this.busy)return;const generation=++this.generation;this.preparing=true;this.controls();
  const current=()=>this.generation===generation;
  const retain=stream=>{if(!current()){stream.getTracks().forEach(track=>track.stop());throw Error(t('Preview cancelled.','Pré-visualização cancelada.'));}this.streams.push(stream);if(stream.getTracks().some(track=>track.readyState==='ended'))throw Error(t('The selected source has ended. Choose it again.','A origem selecionada terminou. Escolha-a novamente.'));for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(current())void this.release().catch(error=>this.error(error));},{once:true});return stream;};
  try{
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error(t('Recording requires a browser with WebM recording support, or the Windows Electron edition.','A gravação requer um navegador com suporte WebM ou a edição Electron do Windows.'));
   const mode=this.$('[name="mode"]').value,sound=this.$('[name="sound"]').value;this.config={mode,sound,quality:Number(this.$('[name="quality"]').value),countdown:Number(this.$('[name="countdown"]').value),aspect:this.$('[name="aspect"]').value};
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
   this.captureMimeType=(mode==='audio'?['audio/webm;codecs=opus','audio/webm']:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']).find(type=>MediaRecorder.isTypeSupported(type));
   if(!this.captureMimeType)throw Error(t('This browser cannot record WebM. Use the Windows Electron edition or a compatible browser.','Este navegador não consegue gravar WebM. Use a edição Electron do Windows ou um navegador compatível.'));
   this.crop=cropRect();this.canvas=document.createElement('canvas');this.resizeCanvas();this.syncCrop();
   // VP8 cannot signal later frame color changes. Keep its canvas on the
   // software sRGB path so GPU/CPU readback cannot change range mid-recording.
   if(mode!=='audio'&&!this.captureMimeType.includes('vp9'))this.canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
   if(mode!=='audio'){
    this.draw();this.drawTimer=setInterval(()=>this.draw(),1000/30);
    this.$('.recorder-source').srcObject=this.screen||null;
   }
   const audioTracks=[];
   if(sound!=='none'){
    this.audio=new AudioContext();await this.audio.resume();if(!current())throw Error('Preview cancelled');const destination=this.audio.createMediaStreamDestination(),mix=this.audio.createGain();mix.connect(destination);this.analyser=this.audio.createAnalyser();mix.connect(this.analyser);
    const silentSink=this.audio.createGain();silentSink.gain.value=0;mix.connect(silentSink).connect(this.audio.destination);
    const inputs=this.streams.filter(stream=>stream.getAudioTracks().length);this.audioMix=mix;this.audioInputScale=1/Math.max(1,inputs.length);this.audioInputs=[];
    for(const stream of inputs){const name=stream===this.screen?'screenVolume':'micVolume',gain=this.audio.createGain();gain.gain.value=this.inputVolume(name)*this.audioInputScale;this.audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(gain).connect(mix);this.audioInputs.push({name,gain});}
    audioTracks.push(...destination.stream.getAudioTracks());
    const samples=new Uint8Array(this.analyser.fftSize);this.meterTimer=setInterval(()=>{this.analyser.getByteTimeDomainData(samples);const level=Math.min(1,Math.sqrt(samples.reduce((sum,v)=>sum+((v-128)/128)**2,0)/samples.length)*3);for(const meter of this.element.querySelectorAll('meter'))meter.value=level;},100);
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
  const request=this.deviceListRequest=(this.deviceListRequest||0)+1;
  try{const devices=await navigator.mediaDevices.enumerateDevices();if(generation!==this.generation||request!==this.deviceListRequest)return;for(const [name,kind]of [['camera','videoinput'],['microphone','audioinput']]){const el=this.$(`[name="${name}"]`),previous=el.value,available=devices.filter(d=>d.kind===kind);el.innerHTML=`<option value="">${t('Default','Predefinido')}</option>`+available.map(d=>`<option value="${esc(d.deviceId)}">${esc(d.label||d.kind)}</option>`).join('');el.value=available.some(d=>d.deviceId===previous)?previous:'';}}
  catch{}
 }
 changeAspect(value){
  if(this.starting||this.id||this.finishing||this.preparing||this.config?.mode==='audio')return;
  if(!recordingAspects.includes(value))return;
  if(this.config){this.config.aspect=value;this.resizeCanvas();if(this.output)this.draw();}
 }
 resizeCanvas(){
  if(!this.canvas)return;const source=['screen','screen-camera'].includes(this.config.mode)?this.screenVideo:this.cameraVideo;
  const size=frameSize(source?.videoWidth||1280,source?.videoHeight||720,['screen','screen-camera'].includes(this.config.mode)?this.crop:{},this.config.quality,this.config.aspect);this.canvas.width=size.width;this.canvas.height=size.height;this.$('.recorder-frame-size').textContent=`${size.width} × ${size.height}`;this.positionBoxes();
 }
 draw(){
  const ctx=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;
  const fit=(video,x,y,width,height)=>{if(!video?.videoWidth)return;const box=containedRect({left:x,top:y,width,height},video.videoWidth,video.videoHeight);ctx.drawImage(video,box.left,box.top,box.width,box.height);};
  if(this.production)this.production.draw(ctx,w,h,this.cameraVideo,this.screenVideo,fit,(context,width,height,values)=>this.drawSources(context,width,height,values));
  else{ctx.fillStyle='#111827';ctx.fillRect(0,0,w,h);this.drawSources(ctx,w,h);}
 }
 drawSources(ctx,w,h,values={layout:'pip',mirror:false}){
  const screen=['screen','screen-camera'].includes(this.config.mode)&&Boolean(this.screenVideo?.videoWidth),camera=['camera','screen-camera'].includes(this.config.mode)&&Boolean(this.cameraVideo?.videoWidth);
  const rectangles=layoutRects(values.layout,w,h,camera,screen);
  for(const rect of rectangles){
   if(rect.source==='screen'){const video=this.screenVideo,r=this.crop,sw=r.width*video.videoWidth,sh=r.height*video.videoHeight,fit=containedRect({left:rect.x,top:rect.y,width:rect.w,height:rect.h},sw,sh);ctx.drawImage(video,r.x*video.videoWidth,r.y*video.videoHeight,sw,sh,fit.left,fit.top,fit.width,fit.height);continue;}
   const video=this.cameraVideo,r=screen&&values.layout==='pip'?cameraRect(this.cameraPosition,w,h):{x:rect.x,y:rect.y,width:rect.w,height:rect.h},ratio=video.videoWidth/video.videoHeight,target=r.width/r.height,sw=ratio>target?video.videoHeight*target:video.videoWidth,sh=ratio>target?video.videoHeight:video.videoWidth/target;
   if(values.mirror){ctx.save();ctx.translate(r.x+r.width,r.y);ctx.scale(-1,1);ctx.drawImage(video,(video.videoWidth-sw)/2,(video.videoHeight-sh)/2,sw,sh,0,0,r.width,r.height);ctx.restore();}
   else ctx.drawImage(video,(video.videoWidth-sw)/2,(video.videoHeight-sh)/2,sw,sh,r.x,r.y,r.width,r.height);
  }
 }
 inputVolume(name){const value=Number(this.production?.element?.querySelector(`[name="${name}"]`)?.value??1);return Number.isFinite(value)?Math.max(0,Math.min(1.5,value)):1;}
 setInputVolume(name,value){for(const input of this.audioInputs||[])if(input.name===name)input.gain.gain.value=this.clipAudio?0:Math.max(0,Math.min(1.5,value))*(this.audioInputScale||1);}
 setClipAudio(video){
  this.clipAudio?.disconnect();this.clipAudio=null;
  if(video){video.muted=!this.audio||!this.audioMix;if(!video.muted){this.clipAudio=this.audio.createMediaElementSource(video);this.clipAudio.connect(this.audioMix);}}
  for(const input of this.audioInputs||[])input.gain.gain.value=this.clipAudio?0:this.inputVolume(input.name)*(this.audioInputScale||1);
 }
 async ensureBumperAudio(){
  if(this.audio||this.config?.mode==='audio'||!this.production?.bumpers?.enabled('recording'))return;
  const output=this.output,audio=this.audio=new AudioContext();await audio.resume();
  if(this.output!==output||this.audio!==audio)throw Error(t('Preview cancelled.','Pré-visualização cancelada.'));
  const destination=audio.createMediaStreamDestination(),mix=this.audioMix=audio.createGain(),sink=audio.createGain();sink.gain.value=0;mix.connect(destination);mix.connect(sink).connect(audio.destination);this.audioInputs=[];
  for(const track of destination.stream.getAudioTracks())output.addTrack(track);
 }
 async snapshot(){
  if(!this.canvas||!this.output||this.config?.mode==='audio'){this.toast(t('Open a video preview first.','Abra primeiro uma pré-visualização de vídeo.'),true);return;}
  this.draw();
  const canvas=document.createElement('canvas');canvas.width=this.canvas.width;canvas.height=this.canvas.height;const ctx=canvas.getContext('2d');ctx.drawImage(this.canvas,0,0);
  const mark=this.$('.recorder-watermark');if(!mark?.complete||!mark.naturalWidth)await mark?.decode();
  if(mark?.complete&&mark.naturalWidth){const r=watermarkRect(canvas.width,canvas.height);ctx.globalAlpha=.5;ctx.drawImage(mark,r.x,r.y,r.width,r.height);ctx.globalAlpha=1;}
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error(t('The PNG image could not be created. Try again.','Não foi possível criar a imagem PNG. Tente novamente.'))),'image/png'));
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Streamland-frame-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';try{link.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),10000);}
 }
 syncCrop(){for(const name of ['x','y','width','height'])this.$(`[name="crop-${name}"]`).value=Math.round(this.crop[name]*100);this.positionBoxes();}
 syncCamera(){this.cameraPosition=normalizedCameraPosition(this.cameraPosition);for(const [field,key]of [['cameraSize','size'],['cameraX','x'],['cameraY','y']])this.$(`[name="${field}"]`).value=Math.round(this.cameraPosition[key]*100);this.positionBoxes();}
 positionBoxes(){
  if(!this.canvas||!this.element.isConnected)return;
  const stage=this.$('.recorder-stage'),view=containedRect(stage.getBoundingClientRect(),this.canvas.width,this.canvas.height),base=stage.getBoundingClientRect(),camera=cameraRect(this.cameraPosition,view.width,view.height);
  const place=(el,r)=>{el.style.left=r.x+'px';el.style.top=r.y+'px';el.style.width=r.width+'px';el.style.height=r.height+'px';};
  place(this.$('.recorder-camera-box'),{...camera,x:view.left-base.left+camera.x,y:view.top-base.top+camera.y});
  const watermark=watermarkRect(this.canvas.width,this.canvas.height),scale=view.width/this.canvas.width;place(this.$('.recorder-watermark'),{x:view.left-base.left+watermark.x*scale,y:view.top-base.top+watermark.y*scale,width:watermark.width*scale,height:watermark.height*scale});
  if(this.screenVideo?.videoWidth){const source=this.$('.recorder-source-stage'),b=source.getBoundingClientRect(),r=containedRect(b,this.screenVideo.videoWidth,this.screenVideo.videoHeight);place(this.$('.recorder-crop-box'),{x:r.left-b.left+this.crop.x*r.width,y:r.top-b.top+this.crop.y*r.height,width:this.crop.width*r.width,height:this.crop.height*r.height});}
 }
 pointerSession(event,move){
  event.preventDefault();const target=event.currentTarget;target.setPointerCapture(event.pointerId);const onMove=e=>move(e),end=()=>{target.removeEventListener('pointermove',onMove);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);};target.addEventListener('pointermove',onMove);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);target.addEventListener('lostpointercapture',end,{once:true});
 }
 selectRegion(event){
  if(!this.screenVideo||this.id||this.starting||this.preparing||event.button!==0)return;
  const b=containedRect(this.$('.recorder-source-stage').getBoundingClientRect(),this.screenVideo.videoWidth,this.screenVideo.videoHeight),point=e=>({x:Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))}),start=point(event);
  this.pointerSession(event,e=>{if(!this.screenVideo||this.id||this.starting||this.preparing||this.finishing)return;this.crop=selectionRect(start,point(e));this.syncCrop();this.resizeCanvas();});
 }
 moveCamera(event){
  if(!this.output||event.button!==0)return;const b=containedRect(this.$('.recorder-stage').getBoundingClientRect(),this.canvas.width,this.canvas.height),r=cameraRect(this.cameraPosition,b.width,b.height),start={...this.cameraPosition},resize=Boolean(event.target.closest('[data-recorder="resize-camera"]'));
  this.pointerSession(event,e=>{if(!this.output)return;const dx=e.clientX-event.clientX,dy=e.clientY-event.clientY;if(resize)this.cameraPosition=resizedCameraPosition(start,b.width,b.height,dx,dy);else{this.cameraPosition.x=Math.max(0,Math.min(1,start.x+dx/Math.max(1,b.width-r.width)));this.cameraPosition.y=Math.max(0,Math.min(1,start.y+dy/Math.max(1,b.height-r.height)));}this.syncCamera();});
 }
 async start(){
  if(!this.output||this.id||this.starting||this.finishing||this.folderBusy)return;
  this.starting=true;this.recordingError=null;const generation=this.generation;this.startDone=new Promise(resolve=>{this.resolveStart=resolve;});this.controls();this.countdownAbort=new AbortController();
  try{
   let directory=this.$('[name="directory"]').value;if(this.$('[name="askFolder"]').checked||!directory){directory=await this.chooseFolder();if(directory===null)return;}
   if(generation!==this.generation||this.countdownAbort.signal.aborted||!this.output)return;
   // VP9 carries the canvas color range/matrix in its bitstream. Native VP8
   // decoders can replace full-range WebM metadata with limited-range defaults.
   const audio=this.config.mode==='audio',mimeType=this.captureMimeType||(audio?['audio/webm;codecs=opus','audio/webm']:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']).find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType)throw Error(t('This browser cannot record WebM. Use the Windows Electron edition or a compatible browser.','Este navegador não consegue gravar WebM. Use a edição Electron do Windows ou um navegador compatível.'));
   const ready=await countdown(this.config.countdown,value=>{this.$('.recorder-countdown').hidden=value===null;this.$('.recorder-countdown').textContent=value??'';this.$('.recorder-countdown-inline').hidden=value===null;this.$('.recorder-countdown-inline').textContent=value===null?'':t('Recording starts in ','A gravação começa em ')+value+' s';},this.countdownAbort.signal);
   if(!ready||generation!==this.generation||this.countdownAbort.signal.aborted||!this.output){this.status(t('Countdown cancelled. No recording was started.','Contagem cancelada. Não foi iniciada nenhuma gravação.'));return;}
   if(!audio){await this.production?.bumpers?.prepare('recording');await this.ensureBumperAudio();}
   if(generation!==this.generation||this.countdownAbort.signal.aborted||!this.output)return;
   this.production?.bumpers?.arm('recording');
   const recorder=new MediaRecorder(this.output,{mimeType,...(audio?{}:{videoBitsPerSecond:4500000}),audioBitsPerSecond:192000});
   const {id}=await this.api('/api/recordings/start',{confirmed:true,directory,kind:audio?'audio':'video',format:audio?'m4a':'mp4'});
   if(generation!==this.generation||this.countdownAbort.signal.aborted||!this.output){await this.api(`/api/recordings/${id}/finish`,{discardEmpty:true}).catch(()=>{});return;}
   this.id=id;this.recorder=recorder;this.upload=new RecordingUpload(async(blob,sequence)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{const response=await fetch(`/api/recordings/${id}/chunks?sequence=${sequence}`,{method:'POST',headers:{'X-Go-Streams':'1','Content-Type':audio?'audio/webm':'video/webm'},body:blob,signal:controller.signal});if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Recording upload failed');}finally{clearTimeout(timer);}},error=>this.recordingFailed(error));
   const upload=this.upload;this.recorderStarted=false;this.writerStopping=false;
   this.recorderDone=new Promise(resolve=>{recorder.addEventListener('stop',()=>{resolve();queueMicrotask(()=>{if(this.id===id&&this.recorder===recorder&&!this.finishing&&!this.writerStopping)void this.stop({skipOutro:true}).catch(error=>this.error(error));});},{once:true});});recorder.addEventListener('dataavailable',event=>upload.push(event.data));recorder.addEventListener('error',()=>this.recordingFailed(Error(t('The browser recording stopped unexpectedly.','A gravação do navegador parou inesperadamente.'))));
   recorder.start(500);this.recorderStarted=true;this.production?.bumpers?.start('recording');this.startedAt=Date.now();this.$('.recorder-elapsed').textContent=elapsed(0);this.elapsedTimer=setInterval(()=>{this.$('.recorder-elapsed').textContent=elapsed(Date.now()-this.startedAt);},250);
   this.status(t('Recording to: ','A gravar para: ')+directory+' / '+id+(audio?'.m4a':'.mp4'));
  }catch(error){if(this.id)await this.stopWriter().catch(()=>{});this.error(error);}
  finally{if(!this.id)this.production?.bumpers?.finish('recording');this.starting=false;this.resolveStart();this.startDone=null;this.controls();}
 }
 async stopWriter(){
  const id=this.id;if(!id)return;this.writerStopping=true;clearInterval(this.elapsedTimer);
  // An error makes MediaRecorder inactive before its final dataavailable/stop events.
  // Drain that last event even when stop() is no longer necessary.
  if(this.recorderStarted){if(this.recorder.state!=='inactive')this.recorder.stop();await this.recorderDone;}
  let uploadError;try{await this.upload?.finish();}catch(error){uploadError=error;}
  try{await this.api(`/api/recordings/${id}/finish`,{});if(uploadError||this.recordingError)throw uploadError||this.recordingError;this.status(t('Recording saved locally.','Gravação guardada localmente.'));}
  finally{this.id=null;this.recorder=null;this.recorderStarted=false;this.recorderDone=null;this.upload=null;this.recordingError=null;this.writerStopping=false;}
 }
 async stop({skipOutro=false}={}){
  if(skipOutro||this.starting)this.production?.bumpers?.finish('recording');
  if(this.stopDone)return this.stopDone;
  if(this.starting){this.countdownAbort?.abort();await this.startDone;}
  if(this.stopDone)return this.stopDone;
  if(!this.id)return;this.finishing=true;this.controls();this.status(t('Saving recording…','A guardar a gravação…'));
  this.stopDone=(async()=>{try{if(!skipOutro&&!this.recordingError)await this.production?.bumpers?.end('recording');await this.stopWriter();try{await this.reloadFiles();}catch{this.toast(t('Recording saved, but the file list could not be refreshed. Open this page again to refresh it.','Gravação guardada, mas não foi possível atualizar a lista de ficheiros. Volte a abrir esta página para a atualizar.'),true);}}catch(error){this.status(error.message);throw error;}finally{this.production?.bumpers?.finish('recording');this.finishing=false;this.stopDone=null;this.controls();}})();return this.stopDone;
 }
 async reloadFiles(){const state=await this.api('/api/state');this.update(state);}
 async deleteRecording(id){
  if(!window.confirm(t('Permanently delete this recording and its recovery data from this computer? This cannot be undone.','Apagar definitivamente esta gravação e os respetivos dados de recuperação deste computador? Esta ação não pode ser anulada.')+'\n'+id))return;
  await this.api('/api/recordings/'+encodeURIComponent(id),{confirmed:true},'DELETE');await this.reloadFiles();this.toast(t('Local recording deleted.','Gravação local apagada.'));
 }
 async recover(id){await this.api(`/api/recordings/${id}/finish`,{});const message=t('Recording recovered.','Gravação recuperada.');if(!this.id&&!this.starting&&!this.finishing)this.status(message);try{await this.reloadFiles();this.toast(message);}catch{this.toast(t('Recording recovered, but the file list could not be refreshed. Open this page again to refresh it.','Gravação recuperada, mas não foi possível atualizar a lista de ficheiros. Volte a abrir esta página para a atualizar.'),true);}}
 releaseDevices(){
  clearInterval(this.drawTimer);clearInterval(this.meterTimer);clearInterval(this.elapsedTimer);
  this.production?.stopVisuals();this.clipAudio?.disconnect();this.clipAudio=null;this.audioInputs=[];this.audioMix=null;
  for(const stream of [...this.streams,...(this.output?[this.output]:[])])for(const track of stream.getTracks())track.stop();
  for(const video of this.videoElements||[]){video.pause();video.srcObject=null;}this.videoElements=[];this.streams=[];void this.audio?.close().catch(()=>{});this.audio=null;this.output=null;this.screen=null;this.device=null;this.screenVideo=null;this.cameraVideo=null;
  if(this.element){this.$('.recorder-preview').srcObject=null;this.$('.recorder-source').srcObject=null;for(const meter of this.element.querySelectorAll?.('meter')||[this.$('meter')])if(meter)meter.value=0;}
 }
 async release(){
  if(this.releaseDone)return this.releaseDone;
  this.generation++;this.countdownAbort?.abort();this.production?.bumpers?.cancel();
  if(!this.id){this.releaseDevices();this.controls();}
  this.releaseDone=(async()=>{let failure;try{await this.stop({skipOutro:true});}catch(error){failure=error;throw error;}finally{this.releaseDevices();this.preparing=false;this.releaseDone=null;this.controls();this.status(failure?failure.message:t('Devices are off.','Os dispositivos estão desligados.'));}})();return this.releaseDone;
 }
}
