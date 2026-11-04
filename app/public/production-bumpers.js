import {language} from './i18n.js';
const t=(en,pt)=>language()==='pt-PT'?pt:en;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cancelled=()=>new DOMException('Clip cancelled','AbortError');

// The same composed programme feeds the live encoder and the local recorder.
// Clips always use authenticated library URLs, including proxied online sources.
export class ProductionBumpers {
 constructor(tools){
  this.tools=tools;this.sessions=new Map();this.media=[];this.key=tools.sceneStorageKey+'-bumpers';
  this.config={intro:'',outro:'',recording:true,live:true};
  try{const saved=JSON.parse(localStorage.getItem(this.key));for(const phase of ['intro','outro'])if(typeof saved?.[phase]==='string')this.config[phase]=saved[phase];for(const target of ['recording','live'])if(typeof saved?.[target]==='boolean')this.config[target]=saved[target];}catch{}
 }
 mount(parent){
  const panel=this.element=document.createElement('div');panel.className='automatic-bumpers';
  panel.innerHTML=`<h3>${t('Automatic intro and outro','Intro e encerramento automáticos')}</h3><div class="bumper-grid">${['intro','outro'].map(phase=>`<fieldset><legend>${phase==='intro'?t('Intro · before starting','Intro · ao iniciar'):t('Outro · before stopping','Encerramento · ao terminar')}</legend><label>${t('Library video','Vídeo da biblioteca')}<select data-bumper-source="${phase}"></select></label><div class="actions"><button type="button" class="secondary small" data-bumper-import="${phase}">${t('Add video to library','Adicionar vídeo à biblioteca')}</button></div><label>${t('Or add a video link','Ou adicionar uma ligação de vídeo')}<input type="url" maxlength="4000" data-bumper-link="${phase}" placeholder="https://…"></label><button type="button" class="secondary small" data-bumper-add="${phase}">${t('Add link and select','Adicionar ligação e selecionar')}</button></fieldset>`).join('')}</div><div class="actions"><label class="check"><input type="checkbox" data-bumper-target="recording">${t('Use in recordings','Usar nas gravações')}</label>${this.tools.recordingControls?`<label class="check"><input type="checkbox" data-bumper-target="live">${t('Use in live broadcasts','Usar nas transmissões')}</label>`:''}<button type="button" class="secondary small" data-bumper-refresh>${t('Refresh library','Atualizar biblioteca')}</button></div><p class="form-hint">${t('Select either video or both. The intro plays when starting; Stop plays the outro before saving or ending the broadcast. Clip sound replaces the microphone and screen audio, even when the main recording has no sound. Use MP4 or WebM playable in this browser; convert other files in the library first. Links: public HTTPS MP4 or individual YouTube videos supported by the library. Online videos need an Internet connection.','Selecione um dos vídeos ou ambos. A intro é reproduzida ao iniciar; Parar reproduz o encerramento antes de guardar ou terminar a transmissão. O som do vídeo substitui o microfone e o áudio do ecrã, mesmo quando a gravação principal não tem som. Use MP4 ou WebM compatível com o navegador; converta outros ficheiros na biblioteca primeiro. Ligações: MP4 HTTPS público ou vídeos individuais do YouTube suportados pela biblioteca. Vídeos online precisam de ligação à Internet.')}</p>${this.tools.recordingControls?`<p class="form-hint">${t('In this studio, clips appear in every active output: live broadcasts and simultaneous recordings.','Neste estúdio, os vídeos aparecem em todas as saídas ativas: transmissões e gravações simultâneas.')}</p>`:''}<p class="bumper-status" role="status" aria-live="polite"></p><button type="button" class="secondary" data-bumper-skip hidden>${t('Skip video / return to programme','Saltar vídeo / regressar ao programa')}</button>`;
  parent.prepend(panel);
  panel.addEventListener('change',event=>{
   const el=event.target;if(this.locked)return;
   if(el.dataset.bumperSource)this.config[el.dataset.bumperSource]=el.value;
   if(el.dataset.bumperTarget)this.config[el.dataset.bumperTarget]=el.checked;
   try{localStorage.setItem(this.key,JSON.stringify(this.config));}catch{this.tools.toast?.(t('The selection works for this session but could not be saved.','A seleção funciona nesta sessão, mas não pôde ser guardada.'),true);}
  });
  panel.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;if(button.hasAttribute('data-bumper-skip')){this.skip();return;}void this.libraryAction(button);});
  this.update();
 }
 get locked(){return this.sessions.size>0||Boolean(this.libraryBusy);}
 enabled(owner){return this.config[owner]&&(this.config.intro||this.config.outro);}
 status(message=''){if(this.element)this.element.querySelector('.bumper-status').textContent=message;}
 update(media){
  if(media)this.media=media;if(!this.element)return;
  for(const phase of ['intro','outro']){
   const select=this.element.querySelector(`[data-bumper-source="${phase}"]`),selected=this.config[phase];
   const html=`<option value="">${t('None','Nenhum')}</option>`+this.media.map(item=>`<option value="${escape(item.id)}">${escape(item.title)}${item.source?t(' (online)',' (online)'):''}</option>`).join('')+(selected&&!this.media.some(item=>item.id===selected)?`<option value="${escape(selected)}">${t('Unavailable video — select another','Vídeo indisponível — selecione outro')}</option>`:'');
   if(select.innerHTML!==html)select.innerHTML=html;select.value=selected;
  }
  for(const el of this.element.querySelectorAll('[data-bumper-target]'))el.checked=this.config[el.dataset.bumperTarget];
  for(const el of this.element.querySelectorAll('input,select,button'))el.disabled=this.locked;
  const skip=this.element.querySelector('[data-bumper-skip]');skip.hidden=!this.active;skip.disabled=false;
 }
 async libraryAction(button){
  if(this.locked)return;this.libraryBusy=true;this.update();
  try{
   const phase=button.dataset.bumperAdd||button.dataset.bumperImport;let id;
   if(button.hasAttribute('data-bumper-add')){
    const input=this.element.querySelector(`[data-bumper-link="${phase}"]`),url=input.value.trim();if(!url)throw Error(t('Enter a video link.','Introduza uma ligação de vídeo.'));
    this.status(t('Adding video link…','A adicionar ligação de vídeo…'));({id}=await this.tools.api('/api/media/link',{url}));input.value='';
   }else if(button.hasAttribute('data-bumper-import')){
    const {paths}=await this.tools.api('/api/media/pick',{});if(!paths?.length)return;
    this.status(t('Adding video to library…','A adicionar vídeo à biblioteca…'));const result=await this.tools.api('/api/media/import',{paths});
    if(result.errors?.length)this.tools.toast?.(result.errors.map(error=>error.error||error.message||error).join('\n'),true);
    id=result.imported?.[0];
   }
   const state=await this.tools.api('/api/state');this.update(state.media||[]);
   // importMedia returns its added entries; never silently select an unrelated file.
   if(phase&&id){this.config[phase]=id;try{localStorage.setItem(this.key,JSON.stringify(this.config));}catch{}}
   this.status(t('Library updated.','Biblioteca atualizada.'));
  }catch(error){this.status(error.message);this.tools.toast?.(error.message,true);}
  finally{this.libraryBusy=false;this.update();}
 }
 async load(id,signal){
  const video=document.createElement('video');video.playsInline=true;video.preload='auto';video.muted=false;
  try{
   await new Promise((resolve,reject)=>{
    const clear=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};
    const ready=()=>{if(video.readyState<2)return;clear();if(!Number.isFinite(video.duration)||video.duration<=0||!video.videoWidth)reject(Error(t('Choose a finite, playable video.','Escolha um vídeo reproduzível com duração definida.')));else resolve();};
    const fail=()=>{clear();reject(Error(t('The selected video could not be opened. Check the link or convert it in the library.','Não foi possível abrir o vídeo selecionado. Verifique a ligação ou converta-o na biblioteca.')));};
    const abort=()=>{clear();reject(cancelled());};
    const timer=setTimeout(fail,30000);video.addEventListener('loadeddata',ready);video.addEventListener('error',fail);signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted){abort();return;}video.src='/api/media/'+encodeURIComponent(id);video.load();
   });return video;
  }catch(error){this.dispose(video);throw error;}
 }
 dispose(video){if(!video)return;video.pause();video.removeAttribute('src');video.load();}
 async prepare(owner){
  if(!this.enabled(owner))return;
  if(this.active||[...this.sessions.values()].some(session=>session.loading))throw Error(t('Wait for the current intro or outro to finish.','Aguarde o fim da intro ou do encerramento em curso.'));
  this.finish(owner);const session={controller:new AbortController(),clips:{},loading:true};this.sessions.set(owner,session);this.update();this.status(t('Preparing intro / outro…','A preparar intro / encerramento…'));
  try{
   for(const phase of ['intro','outro'])if(this.config[phase])session.clips[phase]=await this.load(this.config[phase],session.controller.signal);
   if(session.controller.signal.aborted)throw cancelled();session.loading=false;this.status();this.update();
  }catch(error){for(const video of Object.values(session.clips))this.dispose(video);if(this.sessions.get(owner)===session)this.finish(owner);throw error;}
 }
 arm(owner,phase='intro'){
  const session=this.sessions.get(owner),video=session?.clips[phase];if(!video)return;
  this.skip();this.tools.stopClip();
  const active=this.active={owner,phase,video};this.tools.clip=video;this.tools.automaticClip=true;
  try{this.tools.setClipAudio?.(video);this.tools.onChange?.();}catch(error){this.skip();throw error;}
  this.status(phase==='intro'?t('Playing intro…','A reproduzir intro…'):t('Playing outro before finishing…','A reproduzir encerramento antes de terminar…'));this.update();return active;
 }
 async play(owner,phase){
  const active=this.active?.owner===owner&&this.active.phase===phase?this.active:this.arm(owner,phase);if(!active)return;
  const video=active.video;
  await new Promise(resolve=>{
   let last=performance.now(),position=video.currentTime;
   const complete=error=>{if(active.complete!==complete)return;clearInterval(timer);video.removeEventListener('ended',ended);video.removeEventListener('error',failed);active.complete=null;if(this.active===active){video.pause();if(phase!=='outro'||error||!video.ended){this.active=null;this.tools.clip=null;this.tools.automaticClip=false;this.tools.setClipAudio?.(null);}this.tools.onChange?.();this.status(error?.message||'');this.update();}if(error)this.tools.toast?.(error.message,true);resolve();};
   const ended=()=>complete(),failed=()=>complete(Error(t('Video playback failed. Returning to the programme.','A reprodução falhou. A regressar ao programa.')));
   const timer=setInterval(()=>{if(video.currentTime!==position){position=video.currentTime;last=performance.now();}else if(performance.now()-last>15000)failed();},1000);
   active.complete=complete;video.addEventListener('ended',ended,{once:true});video.addEventListener('error',failed,{once:true});
   try{Promise.resolve(video.play()).catch(failed);}catch{failed();}
  });
 }
 start(owner){void this.play(owner,'intro').catch(error=>{this.skip();this.tools.toast?.(error.message,true);});}
 async end(owner){await this.play(owner,'outro');}
 skip(){
  const active=this.active;if(!active)return;if(active.complete){active.complete();return;}
  this.active=null;active.video.pause();this.tools.clip=null;this.tools.automaticClip=false;this.tools.setClipAudio?.(null);this.tools.onChange?.();this.status();this.update();
 }
 finish(owner){
  const session=this.sessions.get(owner);if(!session)return;session.controller.abort();if(this.active?.owner===owner)this.skip();for(const video of Object.values(session.clips))this.dispose(video);this.sessions.delete(owner);this.update();
 }
 cancel(){for(const owner of [...this.sessions.keys()])this.finish(owner);this.status();}
}
