import {overlayEditor,overlayValues,renderBanner,imageData,overlayPreview,styleOverlayPreview} from './overlays-ui.js';
import {tr,language,localeTag,setLanguage,applyLocale} from './i18n.js';
import { localToUtc, utcToLocal } from './timezones.js';
import { advancedSettings, downloadsPanel } from './extras.js';
import {icon,filterHistory,filterToolbar,platformGuidance,helpPanel,updatePanel,paginate,paginationBar} from './studio-ui.js';
const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const names = {dashboard:tr("Visão geral"),golive:tr("Entrar em direto"),live:tr("Em direto agora"),media:tr("Biblioteca de vídeos"),channels:tr("Canais"),playlists:tr("Playlists"),schedules:tr("Agendamento"),tools:tr("Ferramentas"),history:tr("Histórico"),settings:tr("Definições"),help:tr("Ajuda")};
const paging={};
let interfaceClosing=false,exitPending=false;
let downloadsQuery='';
const pendingActions=new Set(), settingsDrafts=new Map();
let refreshRequested=0, refreshApplied=0, dialogGeneration=0, settingsSaving=false;
function pageRows(rows,key){const result=paginate(rows,paging[key]||{});paging[key]={page:result.page,size:result.size};return result;}
const searchBar=(label)=>`<div class="toolbar"><input id="search" class="search" placeholder="${tr("Pesquisar…")}" aria-label="${label}" value="${esc(query)}"></div>`;
let mediaLayout='list';try{const saved=localStorage.getItem('media-layout');if(['list','grid'].includes(saved))mediaLayout=saved;}catch{}
const filters={dashboard:{period:'all',sort:'newest'},history:{period:'all',kind:'all',sort:'newest',search:''}};
let state = { media: [], channels: [], playlists: [], schedules: [], history: [], jobs: [], settings: {} }, health, page = location.hash.slice(1) || 'dashboard', query = '', loading = false;
const active = job => ['countdown', 'starting', 'running', 'pausing', 'paused', 'retrying', 'reconfiguring', 'stopping'].includes(job.status);
const labels = { cancelled:tr("Cancelado"),countdown:tr("Contagem decrescente"),reconfiguring:tr("A atualizar emissão"), pausing: tr("A pausar"), paused: tr("Pausado"), retrying: tr("A recuperar ligação"), starting: tr("A iniciar"), running: tr("Em transmissão"), stopping: tr("A parar"), stopped: tr("Parado"), completed: tr("Concluído"), error: tr("Erro"), pending: tr("Pendente"), triggered: tr("Iniciado"), missed: tr("Horário ultrapassado"), interrupted: tr("Interrompido") };
const fmt = seconds => { const n = Math.floor(seconds || 0); return `${Math.floor(n / 3600) ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const bytes = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : (n / 1048576).toFixed(1) + ' MB';
const date = (v, timeZone) => v ? new Date(v).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }) : '—';
const playlistDuration = p => p.mediaIds.reduce((sum, id) => sum + (state.media.find(m => m.id === id)?.duration || 0), 0);
const status = s => `<span class="badge ${esc(s)}">${esc(labels[s] || s)}</span>`;
const empty = (icon, title, subtitle, action = '') => `<div class="empty"><div class="empty-icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p>${action}</div>`;
const btn = (action, text, cls = 'primary', id = '', disabled = false) => `<button ${disabled?'disabled data-unavailable="true"':''} class="${cls}" data-action="${action}" data-id="${esc(id)}">${text}</button>`;
const thumb = m => m.thumbnail ? `<img src="/api/thumb/${m.id}" alt="" loading="lazy">` : '<span class="film-icon">▷</span>';
async function api(url, data, method = 'POST') {
  const res = await fetch(url, data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json', 'X-Go-Streams': '1' }, body: JSON.stringify(data) });
  const result = await res.json().catch(() => ({ error: tr("A sessão local terminou. Volte a abrir o Go Streams.") }));
  if (!res.ok) throw Error(tr(result.error || "Não foi possível concluir a operação.")); return result;
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = tr(message); el.className = error ? 'error' : ''; el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, error ? 9000 : 4500);
}
async function refresh(render = true) {
  if(interfaceClosing)return;
  const request=++refreshRequested, next=await api('/api/state');
  if(interfaceClosing||request<refreshApplied)return;
  refreshApplied=request;state=next;
  if(typeof render==='function'?render():render)draw();
  if(typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('go-streams-ready'));
  const banner=$('#connection-warning');if(banner)banner.hidden=true;
}
function connectionFailed(){if(interfaceClosing)return;const banner=$('#connection-warning');if(banner)banner.hidden=false;}
function applyBusyActions(){document.querySelectorAll('[data-action]').forEach(b=>{if(pendingActions.has(b.dataset.action+':'+(b.dataset.id||'')))b.disabled=true;});}
function rememberSettings(event){
 const form=event.target.closest('form');
 if(!form||!['settings-form','encoding-form','notification-form','operation-form','update-form'].includes(form.id))return;
 settingsDrafts.set(form.id,[...form.elements].filter(e=>e.name).map(e=>({name:e.name,value:e.value,checked:e.checked})));
}
function restoreSettings(){
 for(const [id,fields] of settingsDrafts){const form=document.getElementById(id);if(!form)continue;for(const field of fields){const el=form.elements.namedItem(field.name);if(el){el.value=field.value;if(el.type==='checkbox')el.checked=field.checked;}}if(id==='update-form')form.closest('details').open=true;}
 document.querySelectorAll('#content form button').forEach(b=>{if(settingsSaving)b.disabled=true;});
 syncEncodingControls();
}
function syncEncodingControls(){
 const form=document.getElementById('encoding-form');if(!form)return;
 const copy=form.elements.namedItem('copy');if(!copy)return;
 for(const name of ['videoBitrate','audioBitrate','fps','aspect']){const control=form.elements.namedItem(name);if(control)control.disabled=copy.checked||settingsSaving;}
}

function navigate(next) { location.hash = next; }
function heading(title, subtitle, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${tr("ESTÚDIO /")} ${esc(names[page]?.toUpperCase())}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`; }
function draw() {
  if(interfaceClosing)return;
  const focused=document.activeElement;
  const focusKey=focused?.closest?.('#content')&&['BUTTON','A'].includes(focused.tagName)?{tag:focused.tagName,action:focused.dataset.action,id:focused.dataset.id,href:focused.getAttribute('href')}:null;
  const matchesFocus=el=>focusKey&&el.tagName===focusKey.tag&&el.dataset.action===focusKey.action&&el.dataset.id===focusKey.id&&el.getAttribute('href')===focusKey.href;
  const focusIndex=focusKey?[...document.querySelectorAll('#content button,#content a')].filter(matchesFocus).indexOf(focused):-1;
  const retained = [...document.querySelectorAll('#normalize-select,#preview-select')].map(el => [el.id,el.value]);
  if (!names[page]) page = 'dashboard';
  $('#crumb').textContent = names[page];
  const navigation = Object.entries(names).map(([key, name], index) => `${index === 6 ? '<div class="nav-divider"></div>' : ''}<a href="#${key}" title="${esc(name)}" aria-label="${esc(name)}" ${key===page?'aria-current="page"':''} class="nav-item ${key === page ? 'selected' : ''}"><span>${icon(key)}</span>${name}${key === 'media' && state.media.length ? `<b>${state.media.length}</b>` : ''}</a>`).join('');
  if($('#nav').innerHTML!==navigation)$('#nav').innerHTML=navigation;
  $('#content').innerHTML = ({ dashboard, golive:goLiveView, live:liveView, media: mediaView, channels, playlists, schedules, tools, history, settings, help:helpView }[page])();
  if(page==='settings')restoreSettings();
  applyBusyActions();
  for (const [id,value] of retained) { const el=document.getElementById(id); if(el&&[...el.options].some(o=>o.value===value))el.value=value; }
  if(focusIndex>=0)[...document.querySelectorAll('#content button,#content a')].filter(matchesFocus)[focusIndex]?.focus({preventScroll:true});
}
function dashboard() {
 const jobs=state.jobs.filter(active),upcoming=state.schedules.filter(s=>s.status==='pending').toSorted((a,b)=>a.at.localeCompare(b.at));
 const sessions=filterHistory(state.history.filter(r=>(r.kind==='session'||!r.kind)&&r.result&&!r.preview),filters.dashboard);
 return heading(tr("Visão geral"),tr("A sua programação, os seus canais e cada direto num só lugar."),btn('go-live',icon('live')+tr(" Preparar transmissão")))+
 `<div class="stats">${[[tr("EM DIRETO"),jobs.filter(j=>!j.preview&&j.status==='running').length,tr("Canais a transmitir"),'live'],[tr("VÍDEOS"),state.media.length,fmt(state.media.reduce((n,m)=>n+m.duration,0))+tr(" de conteúdo"),'media'],[tr("CANAIS"),state.channels.length,tr("Destinos configurados"),'channels'],[tr("AGENDAMENTOS"),upcoming.length,upcoming.filter(s=>s.armed).length+tr(" ativos"),'schedules']].map(([label,n,sub,i])=>`<div class="stat"><div class="stat-top"><span>${label}</span>${icon(i)}</div><strong>${n}</strong><small>${sub}</small></div>`).join('')}</div>
 <div class="dashboard-grid"><section class="panel"><div class="panel-title"><h2><span class="dot"></span> ${tr("Monitor de transmissão")}</h2><a href="#live">${tr("Abrir monitor")} ${icon('arrow')}</a></div>${jobs.length?`<div class="job-list">${jobs.slice(0,2).map(jobCard).join('')}</div>`:`<div class="monitor-idle"><div class="monitor-orbit"><span>${icon('play')}</span></div><h3>${tr("O próximo direto começa aqui.")}</h3><p>${tr("Escolha um vídeo ou uma playlist")}<br>${tr("e prepare os seus destinos.")}</p>${btn('go-live',tr("Preparar transmissão"),'secondary')}</div>`}</section>
 <section class="panel"><div class="panel-title"><h2>${tr("A seguir")}</h2><a href="#schedules">${tr("Agendamentos")} ${icon('arrow')}</a></div>${upcoming.length?upcoming.slice(0,4).map(s=>`<div class="schedule-summary"><span class="calendar-icon">${icon('schedules')}</span><div><strong>${esc(sourceName(s))}</strong><small>${date(s.at,s.timeZone)}</small><small>${s.channelIds.map(id=>esc(state.channels.find(c=>c.id===id)?.name)).join(', ')}</small></div><span class="badge ${s.armed?'ready':''}">${s.armed?tr("Ativo"):tr("Pausado")}</span></div>`).join(''):`<div class="side-empty">${icon('schedules')}<h3>${tr("Espaço para o próximo programa")}</h3><p>${tr("Escolha quando quer entrar em direto.")}</p>${btn('schedule-new',tr("Agendar transmissão"),'secondary')}</div>`}<div class="quick-links"><a href="#media">${icon('media')} ${tr("Biblioteca")}</a><a href="#channels">${icon('channels')} ${tr("Canais")}</a><a href="#help">${icon('help')} ${tr("Guia rápido")}</a></div></section></div>
 <section class="panel recent"><div class="panel-title"><h2>${tr("Transmissões terminadas")}</h2><a href="#history">${tr("Todos os registos")} ${icon('arrow')}</a></div>${filterToolbar(filters.dashboard,{prefix:'dashboard',kinds:false})}${sessionTable(pageRows(sessions,'dashboard').rows)}${paginationBar(pageRows(sessions,'dashboard'),'dashboard')}</section>`+
 (state.jobs.some(j=>j.preview&&j.status==='completed')?`<div class="preview-bar">${icon('check')} ${tr("Teste local concluído")} ${btn('view-preview',tr("Ver resultado"),'secondary small',state.jobs.filter(j=>j.preview&&j.status==='completed').at(-1).id)}</div>`:'');
}
function sourceName(s){return s.mediaId?state.media.find(m=>m.id===s.mediaId)?.title||tr("Vídeo indisponível"):state.playlists.find(p=>p.id===s.playlistId)?.name||tr("Playlist indisponível");}
function channelLink(record){const channel=state.channels.find(c=>record.channelId?c.id===record.channelId:c.name===record.channel);return channel?.channelUrl?`<a class="button secondary small" href="${esc(channel.channelUrl)}" target="_blank" rel="noopener noreferrer">${tr("Abrir")}</a>`:'—';}
function sessionTable(rows){
 return rows.length?`<div class="table-scroll"><table><thead><tr><th>${tr("Canal / plataforma")}</th><th>${tr("Programa")}</th><th>${tr("Início")}</th><th>${tr("Fim")}</th><th>${tr("Resultado")}</th><th>${tr("Repetição")}</th><th>${tr("Ver")}</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.channel||'—')}</strong><small>${esc(tr(r.platform||''))}</small></td><td>${esc(r.playlist)}${r.result==='error'?`<small class="session-error">${esc(r.detail||r.error||'')}</small>`:''}</td><td>${date(r.started)}</td><td>${date(r.ended)}</td><td>${status(r.result)}</td><td>${r.autoRestart?tr("Ativa"):'—'}</td><td>${channelLink(r)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="quiet">${tr("Não há transmissões terminadas neste período.")}</div>`;
}
function goLiveView(){
 const list=state.channels.filter(c=>(c.name+' '+c.platform).toLocaleLowerCase('pt-PT').includes(query.toLocaleLowerCase('pt-PT')));
 return `<div class="overlay-shortcut">${btn('overlays',tr("Banners e imagem"),'secondary')}</div>`+heading(tr("Entrar em direto"),tr("Prepare o conteúdo de cada canal. As escolhas ficam guardadas para a próxima sessão."),btn('go-live',tr("Preparar vários destinos")))+
 `<div class="toolbar"><input id="search" class="search" placeholder="${tr("Pesquisar canais…")}" aria-label="${tr("Pesquisar canais")}" value="${esc(query)}"><span>${state.channels.length} ${tr("canais")}</span></div>`+
 (list.length?`<div class="channel-grid">${list.map(c=>{const plan=state.channelPlans?.[c.id],job=state.jobs.find(j=>j.channelId===c.id&&active(j));return `<article class="panel channel-card"><div class="channel-heading"><span class="platform-icon">${icon('channels')}</span><span class="badge">${esc(tr(c.platform))}</span></div><h2>${esc(c.name)}</h2><div class="channel-source"><small>${tr("CONTEÚDO PREPARADO")}</small><strong>${plan?esc(sourceName(plan)):tr("Escolha um vídeo ou uma playlist")}</strong><small>${plan?(plan.mediaId?tr("Vídeo único"):tr("Playlist"))+' · '+(plan.countdown??10)+tr(" s antes de emitir"):tr("Preparar não inicia a transmissão")}</small></div>${job?status(job.status):`<span class="badge">${tr("Pronto para preparar")}</span>`}<div class="card-actions">${job?`<a class="button secondary" href="#live">${tr("Controlar emissão")}</a>`:btn('plan-channel',plan?tr("Alterar conteúdo"):tr("Preparar canal"),'secondary',c.id)+(plan?btn('plan-start',tr("Entrar em direto"),'primary',c.id):'')}${btn('plan-schedule',tr("Agendar"),'text-button',c.id)}</div></article>`;}).join('')}</div>`:empty(icon('channels'),query?tr("Nenhum canal encontrado"):tr("Adicione um canal para entrar em direto"),query?tr("Experimente outro nome ou plataforma."):tr("Depois escolha o vídeo ou a playlist que quer emitir."),query?'':btn('channel-new',tr("Adicionar canal"))))+
 `<section class="panel preflight"><h2>${tr("Preparação rápida")}</h2><div>${[['media',tr("Importar vídeos")],['playlists',tr("Organizar playlists")],['tools',tr("Fazer um teste local")]].map(([i,t])=>`<a href="#${i}">${icon(i)} ${t} ${icon('arrow')}</a>`).join('')}</div></section>`;
}
function jobSettings(id){
 const job=state.jobs.find(j=>j.id===id);if(!job)return;
 dialog(tr("Opções desta emissão"),`<label class="check"><input type="checkbox" name="autoRestart" ${job.autoRestart?'checked':''}> ${tr("Repetir automaticamente")}</label><label class="check"><input type="checkbox" name="endOnVideoFailure" ${job.endOnVideoFailure?'checked':''}> ${tr("Terminar se um vídeo falhar")}</label><label class="check"><input type="checkbox" name="autoReconnect" ${job.autoReconnect?'checked':''}> ${tr("Recuperar ligação automaticamente")}</label><label class="check"><input type="checkbox" name="pauseOnDisconnect" ${job.pauseOnDisconnect?'checked':''}> ${tr("Pausar após perda de ligação")}</label><p class="form-hint">${tr("Alterar a repetição reabre a ligação, mantendo a posição. Pode existir uma interrupção no destino. As outras opções entram em vigor sem reabrir a ligação.")}</p>`,async form=>{await api(`/api/jobs/${id}/configuration`,{autoRestart:form.has('autoRestart'),endOnVideoFailure:form.has('endOnVideoFailure'),autoReconnect:form.has('autoReconnect'),pauseOnDisconnect:form.has('pauseOnDisconnect'),confirmed:true},'PUT');toast(tr("Opções da emissão atualizadas."));},{submit:tr("Aplicar opções")});
}
function queueForm(id){
 const job=state.jobs.find(j=>j.id===id);if(!job?.queue?.length)return;
 let draft=job.queue.map(m=>m.id);const protectedIndex=job.current?.index??0;
 function render(){
 dialog(tr("Fila desta emissão"),`<p class="form-hint">${tr("Pode alterar os próximos vídeos. O atual e os anteriores ficam preservados. A alteração aplica-se apenas a esta emissão.")} ${job.status==='paused'?tr("A sessão permanece pausada até escolher Retomar."):tr("A ligação é reaberta na posição guardada.")}</p><div class="sequence">${draft.map((mid,i)=>`<div><span class="sequence-number">${i+1}</span><span class="sequence-name">${esc(state.media.find(m=>m.id===mid)?.title||job.queue.find(m=>m.id===mid)?.title)}${i===protectedIndex?tr(" · A reproduzir"):''}</span>${i>protectedIndex?`<button type="button" class="icon-button" data-queue-move="${i}" data-dir="-1" aria-label="${tr("Subir vídeo")}" ${i===protectedIndex+1?'disabled':''}>↑</button><button type="button" class="icon-button" data-queue-move="${i}" data-dir="1" aria-label="${tr("Descer vídeo")}" ${i===draft.length-1?'disabled':''}>↓</button><button type="button" class="icon-button" data-queue-remove="${i}" aria-label="${tr("Retirar vídeo")}">×</button>`:`<span class="badge">${tr("Preservado")}</span>`}</div>`).join('')}</div><div class="form-row add-row"><select id="queue-add" aria-label="${tr("Vídeo a acrescentar")}">${state.media.map(m=>`<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select><button type="button" id="queue-add-button" class="secondary">${tr("Adicionar")}</button></div>`,async()=>{await api(`/api/jobs/${id}/configuration`,{mediaIds:draft,confirmed:true},'PUT');toast(job.status==='paused'?tr("Fila guardada. A sessão continua pausada."):tr("Fila atualizada. Confirme a receção do sinal no destino."));},{submit:job.status==='paused'?tr("Guardar fila"):tr("Aplicar fila")});
 $('#queue-add-button').onclick=()=>{if($('#queue-add').value)draft.push($('#queue-add').value);render();};
 $('#dialog').querySelectorAll('[data-queue-move]').forEach(b=>{b.onclick=()=>{const i=Number(b.dataset.queueMove),j=i+Number(b.dataset.dir);[draft[i],draft[j]]=[draft[j],draft[i]];render();};});
 $('#dialog').querySelectorAll('[data-queue-remove]').forEach(b=>{b.onclick=()=>{draft.splice(Number(b.dataset.queueRemove),1);render();};});
 }render();
}
function liveView(){
 const allJobs=state.jobs.filter(active),jobs=allJobs.filter(j=>[j.channelName,j.playlistName,j.current?.title].some(value=>String(value||'').toLocaleLowerCase('pt-PT').includes(query.toLocaleLowerCase('pt-PT'))));
 return heading(tr("Em direto agora"),tr("Acompanhe o vídeo atual e controle cada destino."),btn('go-live',tr("+ Preparar transmissão"))+(allJobs.length?btn('stop-all',tr("Parar todas"),'danger'):''))+searchBar(tr("Pesquisar emissões"))+
 (jobs.length?`<div class="live-grid">${jobs.map(jobCard).join('')}</div>`:empty(icon('live'),allJobs.length?tr("Nenhuma emissão neste filtro"):tr("Nenhuma transmissão ativa"),allJobs.length?tr("Pesquise pelo canal, programa ou vídeo atual."):tr("Prepare um vídeo ou uma playlist para os seus canais."),btn('go-live',tr("Preparar transmissão"))))+
 (state.jobs.some(j=>j.ended&&!j.preview)?`<section class="panel recent"><div class="panel-title"><h2>${tr("Últimas sessões")}</h2></div>${sessionTable(state.jobs.filter(j=>j.ended&&!j.preview).toReversed().map(j=>({...j,channel:j.channelName,playlist:j.playlistName,result:j.status})))}</section>`:'');
}
function helpView(){return heading(tr("Ajuda e primeiros passos"),tr("Um guia prático para preparar, emitir e recuperar a sua programação."))+helpPanel('0.16.0');}
function jobCard(j) {
  const current = j.current; const channel=state.channels.find(c=>c.id===j.channelId);
  return `<article class="job"><div class="job-top"><div><h3>${esc(j.channelName)}</h3><small>${esc(j.playlistName)}${j.preview ? tr(" · teste local") : ''}</small></div>${status(j.status)}</div>${j.countdownUntil?`<div class="countdown"><span>${tr("Entrará em direto dentro de")}</span><strong data-countdown="${esc(j.countdownUntil)}">${Math.max(0,Math.ceil((Date.parse(j.countdownUntil)-Date.now())/1000))}</strong><span>${tr("segundos · cancele para impedir o envio")}</span></div>`:''}<div class="job-metrics"><span><b>${fmt(j.elapsed)}</b> ${tr("reproduzidos")}</span><span><b>${j.fps.toFixed(0)}</b> fps</span><span><b>${esc(j.bitrate || '—')}</b></span></div>${current ? `<p>${tr("Vídeo")} ${current.index+1}: <strong>${esc(current.title)}</strong><br><small>${fmt(current.offset)} / ${fmt(current.duration)}</small></p>` : ''}${j.error?`<p class="job-error" role="${j.status==='error'?'alert':'status'}">${esc(j.error)}</p>`:''}${j.skippedVideos?.length?`<p>${j.skippedVideos.length} ${tr("vídeo(s) ignorado(s):")} ${j.skippedVideos.map(m=>esc(m.title)).join(', ')}</p>`:''}${j.encoding?`<small>${j.encoding.copy?tr("Cópia direta"):`${j.encoding.aspect} · ${j.encoding.fps} fps · ${j.encoding.videoBitrate} kbps`}</small>`:''}${j.autoRestart?`<span class="badge loop">${tr("Repetição automática")}</span>`:''}${j.pauseReason==='network'?`<p class="connection-warning">${tr("Ligação perdida. A posição foi guardada. Retome quando a ligação estiver disponível.")}</p>`:''}${j.autoReconnect ? `<small>${tr("Recuperação automática ·")} ${j.retries}/3 tentativas utilizadas</small>` : ''}${j.nextRetry ? `<p>${tr("Próxima tentativa:")} ${date(j.nextRetry)}</p>` : ''}${j.status === 'paused' ? `<p class="form-hint">${tr("Ligação interrompida. Retomar abre uma nova ligação a partir da posição guardada; a continuidade do direto depende da plataforma.")}</p>` : ''}<div class="actions">${!j.preview && ['starting','running','retrying'].includes(j.status) ? btn('pause-job', tr("Pausar"), 'secondary small', j.id) : ''}${j.status === 'paused' ? btn('resume-job', tr("Retomar"), 'primary small', j.id) : ''}${!j.preview && !['stopping','countdown','reconfiguring'].includes(j.status)?btn('restart-job',tr("Recomeçar"),'secondary small',j.id):''}${!j.preview&&['running','starting','paused','retrying'].includes(j.status)?btn('job-settings',tr("Opções"),'secondary small',j.id)+(j.playlistId&&!['Facebook','Restream'].includes(j.platform)?btn('job-queue',tr("Editar fila"),'secondary small',j.id):''):''}${channel?.channelUrl?`<a class="button secondary small" href="${esc(channel.channelUrl)}" target="_blank" rel="noopener noreferrer">${tr("Ver direto")}</a>`:''}${channel?.producerUrl?`<a class="button secondary small" href="${esc(channel.producerUrl)}" target="_blank" rel="noopener noreferrer">${tr("Painel do produtor")}</a>`:''}${btn('stop-job', j.status==='countdown'?tr("Cancelar transmissão"):j.status==='stopping'?tr("A parar…"):tr("Parar"), j.status==='countdown'?'danger small':'secondary small', j.id,j.status==='stopping')}</div></article>`;
}
function mediaView() {
 const matches=state.media.filter(m=>m.title.toLocaleLowerCase('pt-PT').includes(query.toLocaleLowerCase('pt-PT')));
 const pageInfo=pageRows(matches,'media'),list=pageInfo.rows;
 const controls=m=>btn('single-live','Transmitir','secondary small',m.id)+btn('test-media',tr("Testar"),'secondary small',m.id)+btn('rename-media',tr("Renomear"),'text-button',m.id)+btn('delete-media',tr("Remover"),'text-button',m.id);
 return heading(tr("Biblioteca de vídeos"),tr("Vídeos locais e por ligação, prontos para transmitir."),btn('import',icon('upload')+tr(" Importar vídeos")))+
 `<div class="toolbar"><input id="search" class="search" placeholder="${tr("Pesquisar vídeos…")}" value="${esc(query)}" aria-label="${tr("Pesquisar vídeos")}"><div class="actions"><span>${state.media.length} ${tr("vídeos ·")} ${bytes(state.media.reduce((s,m)=>s+m.size,0))}</span><div class="view-toggle">${btn('media-list',icon('playlists')+`<span class="sr-only">${tr("Vista em lista")}</span>`,mediaLayout==='list'?'secondary selected':'secondary')}${btn('media-grid',icon('dashboard')+`<span class="sr-only">${tr("Vista em grelha")}</span>`,mediaLayout==='grid'?'secondary selected':'secondary')}</div></div></div>`+
 (!list.length?empty(icon('media'),query?tr("Nenhum vídeo encontrado"):tr("A sua programação começa com um vídeo"),query?tr("Experimente outro nome."):tr("Importe vídeos do computador. Os originais permanecem na sua localização."),btn('import',tr("Importar vídeos"))):
 mediaLayout==='list'?`<section class="panel table-scroll"><table class="media-table"><thead><tr><th>${tr("Vídeo")}</th><th>${tr("Título / formato")}</th><th>${tr("Duração")}</th><th>${tr("Resolução")}</th><th>${tr("Ações")}</th></tr></thead><tbody>${list.map(m=>`<tr><td><button class="thumbnail mini-thumb" data-action="preview-media" data-id="${m.id}" aria-label="${tr("Pré-visualizar")} ${esc(m.title)}">${thumb(m)}<span class="play-overlay">${icon('play')}</span></button></td><td><strong>${esc(m.title)}</strong><small>${esc(m.codec?.toUpperCase())} · ${m.source?tr("Online · sem cópia local"):bytes(m.size)}</small></td><td>${fmt(m.duration)}</td><td>${m.width} × ${m.height}<small>${m.fps.toFixed(1)} fps</small></td><td><div class="actions">${controls(m)}</div></td></tr>`).join('')}</tbody></table></section>`:
 `<div class="media-grid">${list.map(m=>`<article class="media-card"><button class="thumbnail" data-action="preview-media" data-id="${m.id}" aria-label="${tr("Pré-visualizar")} ${esc(m.title)}">${thumb(m)}<span class="duration">${fmt(m.duration)}</span><span class="play-overlay">${icon('play')}</span></button><div class="media-info"><h3 title="${esc(m.title)}">${esc(m.title)}</h3><p>${m.width} × ${m.height} · ${m.fps.toFixed(1)} fps · ${m.source?tr("Online · sem cópia local"):bytes(m.size)}</p><div><span class="badge">${esc(m.codec?.toUpperCase())}</span>${controls(m)}</div></div></article>`).join('')}</div>`) + paginationBar(pageInfo,'media');
}
function channels() {
 const pageInfo=pageRows(state.channels.filter(c=>(c.name+' '+c.platform).toLowerCase().includes(query.toLowerCase())),'channels'),list=pageInfo.rows;
  return heading(tr("Os seus canais"), tr("Um só estúdio. Os destinos que escolher."), btn('channel-new', tr("＋ Adicionar canal"))) +
  searchBar(tr("Pesquisar canais")) + (list.length ? `<div class="channel-grid">${list.map(c => `<article class="panel channel-card"><div class="channel-heading"><span class="platform-icon ${esc(c.platform.toLowerCase())}">${c.platform === 'YouTube' ? '▶' : c.platform === 'Facebook' ? 'f' : c.platform === 'Twitch' ? '▣' : '⌁'}</span><span class="badge">${esc(tr(c.platform))}</span></div><h2>${esc(c.name)}</h2><p class="mono truncate">${esc(c.url)}</p><p class="key-status">${c.hasKey ? tr("◆ Chave guardada e protegida") : tr("◇ Falta configurar a chave")}</p><div class="actions">${c.channelUrl ? `<a class="button secondary small" target="_blank" rel="noopener noreferrer" href="${esc(c.channelUrl)}">${tr("Ver canal")}</a>` : ''}${c.producerUrl ? `<a class="button secondary small" target="_blank" rel="noopener noreferrer" href="${esc(c.producerUrl)}">${tr("Painel do produtor")}</a>` : ''}</div><div class="card-actions">${btn('channel-edit', tr("Editar canal"), 'secondary', c.id)}${btn('delete-channel', tr("Remover"), 'text-button', c.id)}</div></article>`).join('')}</div>` : empty('⌁', query?tr("Nenhum canal encontrado"):tr("Onde quer transmitir?"), query?tr("Experimente outro nome ou plataforma."):tr("Adicione o servidor RTMP e a chave fornecidos pela sua plataforma."), query?'':btn('channel-new', tr("Adicionar primeiro canal")))) + paginationBar(pageInfo,'channels');
}
function playlists() {
 const pageInfo=pageRows(state.playlists.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())),'playlists'),list=pageInfo.rows;
  return heading(tr("Playlists"), tr("Organize a sequência dos vídeos e prepare transmissões contínuas."), btn('playlist-new', tr("＋ Criar playlist"))) +
  searchBar(tr("Pesquisar playlists")) + (list.length ? `<div class="playlist-grid">${list.map(p => `<article class="panel playlist-card"><div class="playlist-art">${p.mediaIds.slice(0, 3).map(mid => { const m = state.media.find(x => x.id === mid); return `<div>${m ? thumb(m) : ''}</div>`; }).join('') || '<span>☷</span>'}</div><div class="playlist-info"><div><span class="badge">${p.quality}</span>${p.loop ? `<span class="badge loop">${tr("∞ Em repetição")}</span>` : ''}</div><h2>${esc(p.name)}</h2><p>${p.mediaIds.length} ${tr("vídeos ·")} ${fmt(playlistDuration(p))}</p><div class="card-actions">${p.mediaIds.length?btn('playlist-live','Transmitir','primary',p.id):''}${btn('playlist-rename',tr("Renomear"),'text-button',p.id)}${btn('playlist-edit', tr("Editar sequência"), 'secondary', p.id)}${btn('preview-playlist', tr("▷ Testar"), 'secondary', p.id,!p.mediaIds.length)}${btn('delete-playlist', tr("Remover"), 'text-button', p.id)}</div></div></article>`).join('')}</div>` : empty('☷', query?tr("Nenhuma playlist encontrada"):tr("Dê uma sequência ao seu conteúdo"), query?tr("Experimente outro nome."):tr("Crie playlists, ordene os vídeos e ative a repetição quando precisar."), query?'':btn('playlist-new', tr("Criar primeira playlist")))) + paginationBar(pageInfo,'playlists');
}
function schedules() {
  return heading(tr("Agendamento"), tr("Planeie o próximo direto no seu fuso horário."), btn('schedule-new', tr("+ Agendar transmissão")) + (state.schedules.length ? btn('clear-schedules', tr("Remover todos"), 'secondary') : '')) +
  `<div class="info-banner">${tr("◷ Mantenha o Go Streams aberto e o computador ligado, sem suspensão.")} ${state.settings.operations?.persistSchedules?tr("Os agendamentos já ativados mantêm-se ativos ao reabrir."):tr("Ao reabrir, reative os agendamentos ou configure a sua manutenção em Definições.")} ${tr("Fuso:")} <strong>${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</strong>.</div>` +
  (state.schedules.length ? `<section class="panel table-scroll"><table><thead><tr><th>${tr("Data e hora")}</th><th>${tr("Playlist / canais")}</th><th>${tr("Estado")}</th><th>${tr("Controlo")}</th></tr></thead><tbody>${state.schedules.toSorted((a,b) => a.at.localeCompare(b.at)).map(s => `<tr><td><strong>${date(s.at, s.timeZone)}</strong><small>${esc(s.timeZone || 'UTC')}</small></td><td>${esc(sourceName(s))}<small>${s.channelIds.map(id => esc(state.channels.find(c => c.id === id)?.name || '—')).join(', ')}</small></td><td>${status(s.status)}<small>${s.status === 'pending' ? s.armed ? tr("● Ativo") : tr("Pausado") : esc(s.error)}</small></td><td><div class="actions">${s.status === 'pending' ? btn('arm', s.armed ? tr("Pausar") : tr("Ativar"), 'secondary small', s.id) : ''}${['pending','missed','error'].includes(s.status)?btn('schedule-edit',tr("Editar"),'secondary small',s.id):''}${btn('delete-schedule', tr("Remover"), 'text-button', s.id)}</div></td></tr>`).join('')}</tbody></table></section>` : empty('◷', tr("Cada direto, à sua hora"), tr("Escolha uma playlist, os canais e a hora de início."), btn('schedule-new', tr("Criar agendamento"))));
}
function mediaOperationsPanel(){
 const operations=state.mediaOperations||[];if(!operations.length)return '';
 const phases={probing:tr("A analisar o original"),converting:tr("A converter"),importing:tr("A incorporar na biblioteca"),cancelling:tr("A cancelar")};
 return `<section class="panel conversion-panel"><h2>${tr("Conversões em curso")}</h2><p>${tr("O original é preservado. Cancelar remove apenas o resultado incompleto; a incorporação final na biblioteca precisa de terminar.")}</p>${operations.map(op=>`<div class="conversion-row"><div><strong>${esc(op.title)}</strong><small>${op.kind==='normalize'?tr("Normalização 720p"):tr("Conversão MP4")} · ${esc(phases[op.phase]||op.phase)} ${tr("· Início")} ${date(op.started)}</small></div>${op.canCancel?btn('cancel-conversion',tr("Cancelar"),'secondary small',op.mediaId):`<span class="badge">${esc(phases[op.phase]||op.phase)}</span>`}</div>`).join('')}</section>`;
}
function tools() {
  return heading(tr("Ferramentas de vídeo"), tr("Prepare ficheiros consistentes para uma transmissão estável.")) + `<div class="tool-grid"><section class="panel tool-card"><div class="tool-icon">◇</div><h2>${tr("Normalizar para transmissão")}</h2><p>${tr("Cria uma nova cópia em MP4, 720p, 30 fps, H.264 e áudio AAC estéreo. Use estas cópias para combinar vídeos com formatos diferentes na mesma playlist.")}</p><label>${tr("Vídeo original")}<select id="normalize-select">${state.media.filter(m=>!m.source).map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></label>${btn('normalize', tr("Criar cópia normalizada"),'primary','',!state.media.some(m=>!m.source))}<small>${tr("O original é preservado. A conversão pode demorar vários minutos.")}</small></section><section class="panel tool-card"><div class="tool-icon">▷</div><h2>${tr("Teste local de transmissão")}</h2><p>${tr("Execute o mesmo motor de codificação e guarde até 8 segundos de vídeo no computador. Pode verificar o resultado antes de entrar em direto.")}</p><label>${tr("Playlist")}<select id="preview-select">${state.playlists.filter(p=>p.mediaIds.length).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>${btn('tool-preview', tr("Executar teste local"), 'secondary','',!state.playlists.some(p=>p.mediaIds.length))}<small>${tr("Sem ligação aos seus canais. O teste aparece no monitor.")}</small></section></div>` + mediaOperationsPanel() + downloadsPanel(state,health,esc,date,btn,{query:downloadsQuery,...paging.downloads});
}
function history() {
 const filtered=filterHistory(state.history,filters.history),pageInfo=pageRows(filtered,'history'),rows=pageInfo.rows;
 return heading(tr("Histórico de atividade"),tr("Cada transmissão e cada vídeo, com os seus tempos e resultados."),`<a class="button secondary" href="/api/history.csv" download>${tr("Exportar CSV")}</a>`+btn('clear-history',tr("Limpar histórico"),'secondary'))+
 `<section class="panel">${filterToolbar(filters.history)}<div class="results-count">${filtered.length} ${tr("registos")}</div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>${tr("Tipo / plataforma")}</th><th>${tr("Vídeo / programa")}</th><th>${tr("Canal")}</th><th>${tr("Início / fim")}</th><th>${tr("Resultado")}</th><th>${tr("Detalhes")}</th></tr></thead><tbody>${rows.map(r=>`<tr><td><span class="badge">${r.kind==='schedule'?tr("Agendamento"):r.kind==='video'?tr("Vídeo"):r.result?tr("Transmissão"):'Evento'}</span><small>${esc(tr(r.platform||''))}</small></td><td><strong>${esc(r.video||r.playlist||r.message)}</strong><small>${r.sequence?tr("Posição ")+r.sequence+tr(" · Ciclo ")+r.cycle:''}</small></td><td>${esc(r.channel||'—')}</td><td class="nowrap">${date(r.started||r.time)}<small>${date(r.ended)}</small></td><td>${r.result?status(r.result):esc(r.level)}<small>${r.elapsed!==undefined?fmt(r.elapsed):''}</small></td><td class="log-detail">${esc(r.detail||r.message)}</td></tr>`).join('')}</tbody></table></div>`:empty(icon('history'),tr("Nenhum registo neste filtro"),tr("Altere o período ou a pesquisa para consultar mais atividade."))}</section>` + paginationBar(pageInfo,'history');
}
function settings() {
  return heading(tr("Definições"), tr("O motor e os dados do seu estúdio local.")) + `<div class="tool-grid"><section class="panel tool-card"><h2>${tr("Motor de transmissão")}</h2><p>${tr("Deixe os campos vazios para utilizar o FFmpeg, FFprobe e yt-dlp incluídos na aplicação. Não é necessário instalá-los.")}</p><form id="settings-form"><label>${tr("Caminho do FFmpeg")}<input name="ffmpeg" value="${esc(state.settings.ffmpeg)}" placeholder="${tr("Detetar automaticamente")}"></label><label>${tr("Caminho do FFprobe")}<input name="ffprobe" value="${esc(state.settings.ffprobe)}" placeholder="${tr("Detetar automaticamente")}"></label><label>${tr("Caminho do yt-dlp")}<input name="ytdlp" value="${esc(state.settings.ytdlp||'')}" placeholder="${tr("Detetar automaticamente")}"></label><button class="primary">${tr("Guardar definições")}</button></form><div class="tool-health">${['ffmpeg', 'ffprobe','ytdlp'].map(k => `<div><span class="dot ${health?.tools[k]?.available ? '' : 'offline'}"></span><strong>${k}</strong><small>${esc(health?.tools[k]?.version || health?.tools[k]?.error || tr("A verificar…"))}</small></div>`).join('')}</div></section><section class="panel tool-card"><h2>${tr("Dados e privacidade")}</h2><p>${tr("A exportação simples omite as chaves. A cópia completa inclui-as protegidas por palavra-passe.")}</p><dl><dt>${tr("Proteção das chaves")}</dt><dd>${esc(health?.secureStorage || tr("A verificar…"))}</dd><dt>${tr("Pasta de dados")}</dt><dd class="mono">${esc(health?.dataDirectory || '')}</dd><dt>${tr("Versão")}</dt><dd>Go Streams 0.16.0</dd></dl><div class="actions"><a class="button secondary" href="/api/export" download>${tr("Exportar projeto sem chaves")}</a>${btn('import-project', tr("Importar projeto"), 'secondary')}</div><h2>${tr("Cópia de segurança completa")}</h2><p>${tr("Exporte e restaure projetos, definições ou tudo, incluindo chaves e palavras-passe, num ficheiro protegido por palavra-passe. O restauro substitui os dados da categoria escolhida e mantém os identificadores, sem duplicar conteúdos. Os vídeos não são incluídos.")}</p><div class="actions">${btn('backup-export',tr("Exportar cópia de segurança"),'secondary')}${btn('backup-restore',tr("Restaurar cópia de segurança"),'secondary')}</div><small>${tr("A importação simples acrescenta conteúdos e não inclui chaves. Para recuperar tudo sem duplicados, utilize Restaurar cópia de segurança.")}</small></section></div>` + `<section class="panel tool-card"><h2>${tr("Banners e imagem")}</h2><p>${tr("Dois textos rolantes com emojis e uma imagem sobreposta, sem alterar os vídeos originais.")}</p>${btn('overlays',tr("Configurar sobreposições"),'secondary')}</section>` + advancedSettings(state,health,esc,date) + updatePanel(state,esc);
}
function interfacePreferences(){return {language:language(),layout:mediaLayout,compact:$('html').dataset.compactNav==='true'};}
function downloadJson(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function dialog(title, content, onSubmit, options = {}) {
  const generation=++dialogGeneration, el=$('#dialog');
  $('#dialog-content').innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="close" aria-label="${tr("Fechar")}">×</button></div><form id="modal-form">${content}<div class="form-error" role="alert" hidden></div><p class="form-progress" role="status" hidden>${tr("A concluir a operação. Fechar esta janela não cancela a operação.")}</p>${onSubmit?`<div class="dialog-actions"><button type="button" class="secondary cancel">${tr("Cancelar")}</button><button class="primary">${esc(options.submit||tr("Guardar"))}</button></div>`:''}</form>`;
  $('.close',el).onclick=()=>el.close();$('.cancel',el)?.addEventListener('click',()=>el.close());
  $('#modal-form').onsubmit=event=>event.preventDefault();
  if(onSubmit){
    const form=$('#modal-form');let submitting=false;
    form.onsubmit=async event=>{
      event.preventDefault();if(submitting)return;submitting=true;
      const values=new FormData(form),controls=[...form.elements].map(control=>[control,control.disabled]);
      for(const [control] of controls)control.disabled=true;
      const progress=$('.form-progress',form),box=$('.form-error',form);progress.hidden=false;box.hidden=true;
      try{
        await onSubmit(values);
        if(dialogGeneration===generation&&el.open)el.close();
        await refresh(!el.open);
      }catch(error){
        if(dialogGeneration===generation&&el.open){box.textContent=tr(error.message);box.hidden=false;}else toast(error.message,true);
        // Imports may have committed valid files before reporting another file's error.
        await refresh(false).catch(()=>{});
      }finally{for(const [control,disabled] of controls)control.disabled=disabled;progress.hidden=true;submitting=false;}
    };
  }
  if(!el.open)el.showModal();
}

function overlaysForm(){
 const previous=structuredClone(state.settings.overlays||{});let selectedImage=previous.image?.asset?'/api/overlays/'+previous.image.asset:'';let generation=0;
 dialog(tr('Banners e imagem'),overlayEditor(previous,esc),async form=>{
  const config=overlayValues(form,previous);
  for(const k of ['top','bottom'])if(config[k].enabled)config[k].data=await renderBanner(config[k]);
  const file=form.get('overlayImage');if(file?.size)config.image.data=await imageData(file);
  await api('/api/settings',{overlays:config},'PUT');toast(tr('Sobreposições guardadas. Aplicam-se às próximas emissões.'));
 },{submit:tr('Guardar sobreposições')});
 const form=$('#modal-form');
 const update=async()=>{
  const request=++generation,values=new FormData(form),config=overlayValues(values,previous),file=values.get('overlayImage');
  if(file?.size)try{selectedImage=await imageData(file);}catch(error){if(request===generation)toast(error.message,true);return;}
  if(request!==generation||!form.isConnected)return;
  const preview=$('[data-overlay-preview]',form);preview.innerHTML=overlayPreview(config,selectedImage,esc);styleOverlayPreview(preview,config);
 };
 form.addEventListener('input',update);form.addEventListener('change',update);update();
}

function channelForm(channelId) {
  const c = state.channels.find(c => c.id === channelId) || {};
  dialog(c.id ? tr("Editar canal") : tr("Adicionar canal"), `<label>${tr("Nome do canal")}<input name="name" value="${esc(c.name)}" maxlength="100" required placeholder="${tr("O meu canal de música")}"></label><label>${tr("Plataforma")}<select name="platform">${['YouTube','Facebook','Twitch','Instagram','TikTok','LinkedIn','Restream','Amazon Live','Personalizado'].map(p => `<option value="${esc(p)}" ${p === c.platform ? 'selected' : ''}>${esc(tr(p))}</option>`).join('')}</select></label><label>${tr("Servidor RTMP / RTMPS")}<input name="url" value="${esc(c.url)}" placeholder="rtmps://servidor/app" required></label><label>${tr("Chave de transmissão")}<input name="key" type="password" autocomplete="new-password" ${c.hasKey ? '' : 'required'} placeholder="${c.hasKey ? tr("Deixe vazio para manter a chave atual") : tr("Cole a chave fornecida pela plataforma")}"></label><button type="button" class="secondary small secret-toggle" data-secret="key" aria-pressed="false">${tr("Mostrar chave introduzida")}</button><label>${tr("Ligação pública do canal (opcional)")}<input name="channelUrl" type="url" value="${esc(c.channelUrl)}" placeholder="https://..."></label><label>${tr("Painel do produtor (opcional)")}<input name="producerUrl" type="url" value="${esc(c.producerUrl)}" placeholder="https://..."></label><label class="check"><input type="checkbox" name="autoRestart" ${c.autoRestart?'checked':''}> ${tr("Repetir automaticamente o conteúdo neste canal")}</label><p class="form-hint">${tr("Guardar um canal não inicia uma transmissão.")}</p>`, async form => { await api(c.id ? `/api/channels/${c.id}` : '/api/channels', {...Object.fromEntries(form),autoRestart:form.has('autoRestart')}, c.id ? 'PUT' : 'POST'); toast(tr("Canal guardado.")); });
}
function playlistForm(playlistId) {
  let mediaSearch='',selectedMediaId='';
  const old = state.playlists.find(p => p.id === playlistId); let draft = old ? structuredClone(old) : { name: '', mediaIds: [], loop: false, quality: '720p' };
  function render() {
    dialog(old ? tr("Editar playlist") : tr("Nova playlist"), `<label>${tr("Nome")}<input name="name" value="${esc(draft.name)}" placeholder="${tr("A minha programação")}" required maxlength="100"></label><div class="form-row"><label>${tr("Qualidade")}<select name="quality"><option ${draft.quality === '720p' ? 'selected' : ''}>720p</option><option ${draft.quality === '1080p' ? 'selected' : ''}>1080p</option></select></label><label class="check"><input type="checkbox" name="loop" ${draft.loop ? 'checked' : ''}> ${tr("Repetir playlist")}</label></div><div class="sequence-label"><strong>${tr("Sequência de reprodução")}</strong><span>${draft.mediaIds.length} ${tr("vídeos")}</span></div><div class="sequence">${draft.mediaIds.map((mid, i) => `<div draggable="true" data-sequence-index="${i}"><span class="sequence-number">${String(i+1).padStart(2,'0')}</span><span class="sequence-name">${esc(state.media.find(m => m.id === mid)?.title)}</span><button type="button" class="icon-button" data-move="${i}" data-dir="-1" aria-label="${tr("Subir vídeo")}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-move="${i}" data-dir="1" aria-label="${tr("Descer vídeo")}" ${i === draft.mediaIds.length-1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-remove="${i}" aria-label="${tr("Retirar vídeo")}">×</button></div>`).join('') || `<p class="muted">${tr("Adicione vídeos à sequência.")}</p>`}</div><label>${tr("Pesquisar vídeos")}<input id="playlist-media-search" type="search" value="${esc(mediaSearch)}" placeholder="${tr("Nome do vídeo")}"></label><div class="form-row add-row"><select id="add-media" aria-label="${tr("Vídeo a adicionar")}">${state.media.map(m => `<option value="${m.id}" ${m.id===selectedMediaId?'selected':''}>${esc(m.title)} · ${fmt(m.duration)}</option>`).join('')}</select><button type="button" class="secondary" id="add-media-button" ${state.media.length ? '' : 'disabled'}>${tr("＋ Adicionar")}</button></div><p class="form-hint">${tr("Pode adicionar o mesmo vídeo várias vezes. Vídeos com formatos diferentes devem ser normalizados em Ferramentas.")}</p>`, async form => { draft.name = form.get('name'); draft.quality = form.get('quality'); draft.loop = form.has('loop'); await api(old ? `/api/playlists/${old.id}` : '/api/playlists', draft, old ? 'PUT' : 'POST'); toast(tr("Playlist guardada.")); });
    const filterMedia=()=>{mediaSearch=$('#playlist-media-search').value;const matches=state.media.filter(m=>m.title.toLocaleLowerCase('pt-PT').includes(mediaSearch.toLocaleLowerCase('pt-PT')));const previous=$('#add-media').value||selectedMediaId;$('#add-media').innerHTML=matches.map(m=>`<option value="${m.id}">${esc(m.title)} · ${fmt(m.duration)}</option>`).join('');selectedMediaId=matches.some(m=>m.id===previous)?previous:matches[0]?.id||'';$('#add-media').value=selectedMediaId;$('#add-media-button').disabled=!matches.length;};
    $('#playlist-media-search').oninput=filterMedia;filterMedia();
    let dragged=null;
    $('#dialog').querySelectorAll('[data-sequence-index]').forEach(row=>{
      row.addEventListener('dragstart',event=>{dragged=Number(row.dataset.sequenceIndex);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(dragged));});
      row.addEventListener('dragover',event=>event.preventDefault());
      row.addEventListener('drop',event=>{event.preventDefault();if(dragged===null)return;capture();const [mid]=draft.mediaIds.splice(dragged,1);draft.mediaIds.splice(Number(row.dataset.sequenceIndex),0,mid);render();});
    });
    const capture = () => { selectedMediaId=$('#add-media').value;const f = new FormData($('#modal-form')); draft.name = f.get('name'); draft.quality = f.get('quality'); draft.loop = f.has('loop'); };
    $('#add-media-button').onclick = () => { capture(); if ($('#add-media').value) draft.mediaIds.push($('#add-media').value); render(); };
    $('#dialog').querySelectorAll('[data-move]').forEach(b => { b.onclick = () => { capture(); const i = Number(b.dataset.move), j = i + Number(b.dataset.dir); [draft.mediaIds[i], draft.mediaIds[j]] = [draft.mediaIds[j], draft.mediaIds[i]]; render(); }; });
    $('#dialog').querySelectorAll('[data-remove]').forEach(b => { b.onclick = () => { capture(); draft.mediaIds.splice(Number(b.dataset.remove), 1); render(); }; });
  }
  render();
}
function liveForm(schedule = false, scheduleId = null, mode = null, selectedMediaId = null, planChannelId = null) {
  const previous = planChannelId ? {...state.channelPlans?.[planChannelId],channelIds:[planChannelId]} : state.schedules.find(s=>s.id===scheduleId); const zone=previous?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!state.media.length) { toast(tr("Importe primeiro um vídeo."),true);navigate('media');return; }
  const sourceMode=previous?.mediaId?'video':previous?.playlistId?'playlist':mode||(state.playlists.some(p=>p.mediaIds.length)?'playlist':'video');
  const soon = new Date(Date.now() + 3600000); const localDate = utcToLocal(previous?.at || soon.toISOString(),zone);
  dialog(schedule ? tr("Agendar transmissão") : planChannelId?tr("Preparar canal"):tr("Preparar transmissão"), `<div class="form-row"><label>${tr("Conteúdo")}<select id="source-mode" name="sourceMode"><option value="video" ${sourceMode==='video'?'selected':''}>${tr("Vídeo único")}</option><option value="playlist" ${sourceMode==='playlist'?'selected':''}>${tr("Playlist")}</option></select></label><label>${tr("Qualidade do vídeo")}<select name="quality"><option value="720p">720p</option><option value="1080p" ${previous?.quality==='1080p'?'selected':''}>1080p</option></select></label></div><label>${tr("Pesquisar conteúdo")}<input id="source-search" type="search" placeholder="${tr("Nome do vídeo ou playlist")}"></label><label id="source-video">${tr("Vídeo")}<select name="mediaId">${state.media.map(m=>`<option value="${m.id}" ${m.id===(previous?.mediaId||selectedMediaId)?'selected':''}>${esc(m.title)} · ${fmt(m.duration)}</option>`).join('')}</select></label><label id="source-playlist">${tr("Playlist")}<select name="playlistId">${state.playlists.filter(p => p.mediaIds.length).map(p => `<option value="${p.id}" ${p.id===(previous?.playlistId||(mode==='playlist'?selectedMediaId:null))?'selected':''}>${esc(p.name)} · ${p.mediaIds.length} ${tr("vídeos")}</option>`).join('')}</select></label><label>${tr("Destinos")}</label><div class="destination-list">${state.channels.filter(c=>!planChannelId||c.id===planChannelId).map(c => `<label class="destination"><input type="checkbox" name="channelIds" value="${c.id}" ${previous?.channelIds?.includes(c.id)?'checked':''} ${!schedule&&state.jobs.some(j=>j.channelId===c.id&&active(j))?'disabled':''}><span><strong>${esc(c.name)}</strong><small>${esc(tr(c.platform))}${!schedule&&state.jobs.some(j=>j.channelId===c.id&&active(j))?tr(" · Em utilização"):''}</small></span></label>`).join('') || `<p>${tr("Adicione pelo menos um canal antes de transmitir.")}</p>`}</div><div id="platform-notes"></div>${schedule ? `<label>${tr("Fuso horário")}<input name="timeZone" list="time-zone-list" value="${esc(zone)}" required><datalist id="time-zone-list">${[...new Set([zone,'UTC',...Intl.supportedValuesOf('timeZone')])].map(z=>`<option value="${esc(z)}"></option>`).join('')}</datalist></label><label>${tr("Data e hora no fuso escolhido")}<input type="datetime-local" name="at" value="${localDate}" required></label><label>${tr("Se a hora se repetir na mudança de horário")}<select name="disambiguation"><option value="reject">${tr("Avisar antes de guardar")}</option><option value="earlier">${tr("Primeira ocorrência")}</option><option value="later">${tr("Segunda ocorrência")}</option></select></label><label class="check"><input type="checkbox" name="armed" ${previous?.armed?'checked':''}> ${tr("Ativar este agendamento nesta sessão")}</label><p class="form-hint">${tr("O computador e o Go Streams precisam de permanecer ligados. Horários perdidos não são iniciados automaticamente.")}</p>` : `<p class="form-hint">${tr("Ao iniciar, os vídeos serão enviados para os canais selecionados. Confirme os destinos.")}</p>`}${!schedule?`<label>${tr("Contagem antes de iniciar")}<select name="countdown">${[...new Set([0,5,10,30,previous?.countdown??10])].sort((a,b)=>a-b).map(n=>`<option value="${n}" ${n===(previous?.countdown??10)?'selected':''}>${n?n+tr(" segundos"):tr("Iniciar imediatamente")}</option>`).join('')}</select></label>`:''}<label>${tr("Repetição automática")}<select name="autoRestart"><option value="default">${tr("Usar definição do canal / playlist")}</option><option value="yes" ${previous?.autoRestart===true?'selected':''}>${tr("Repetir conteúdo")}</option><option value="no" ${previous?.autoRestart===false?'selected':''}>${tr("Terminar no fim")}</option></select></label><label class="check"><input type="checkbox" name="pauseOnDisconnect" ${previous?.pauseOnDisconnect!==false?'checked':''}> ${tr("Pausar e guardar posição se a ligação cair")}</label><label class="check"><input type="checkbox" name="endOnVideoFailure" ${previous?.endOnVideoFailure!==false?'checked':''}> ${tr("Terminar se um vídeo falhar")}</label><p class="form-hint">${tr("Se desativar, vídeos indisponíveis são ignorados. Uma falha de descodificação pode interromper a ligação antes de avançar para o vídeo seguinte.")}</p><label class="check"><input type="checkbox" name="autoReconnect" ${previous?.autoReconnect?'checked':''}> ${tr("Recuperar a ligação em caso de falha (até 3 tentativas)")}</label><p class="form-hint">${tr("Ao pausar, a ligação ao canal é interrompida. A retoma volta à posição guardada na playlist.")}</p>${planChannelId&&!schedule?`<p class="form-hint">${tr("Preparação local: guardar não inicia a emissão.")}</p>`:`<label class="check consent"><input type="checkbox" name="confirmed" required> ${schedule?tr("Confirmo os canais e o horário selecionados."):tr("Confirmo o início da transmissão para estes canais.")}</label>`}`, async form => {
    const payload = { ...(form.get('sourceMode')==='video'?{mediaId:form.get('mediaId'),quality:form.get('quality')}:{playlistId:form.get('playlistId')}), countdown:schedule?0:Number(form.get('countdown')), pauseOnDisconnect:form.has('pauseOnDisconnect'), ...(form.get('autoRestart')==='default'?{}:{autoRestart:form.get('autoRestart')==='yes'}), channelIds: form.getAll('channelIds'), confirmed: form.has('confirmed'), autoReconnect: form.has('autoReconnect'), endOnVideoFailure: form.has('endOnVideoFailure') };
    if(planChannelId&&!schedule){await api(`/api/channels/${planChannelId}/plan`,payload,'PUT');toast(tr("Preparação guardada. Nenhuma emissão foi iniciada."));navigate('golive');}
    else if (schedule) { payload.timeZone = String(form.get('timeZone')); payload.at = localToUtc(form.get('at'),payload.timeZone,form.get('disambiguation')); payload.armed = form.has('armed'); await api(scheduleId ? `/api/schedules/${scheduleId}` : '/api/schedules', payload, scheduleId ? 'PUT' : 'POST'); toast(tr("Agendamento guardado.")); }
    else { await api('/api/start', payload); toast(tr("Transmissão preparada. Pode cancelar no monitor.")); navigate('live'); }
  }, { submit: schedule ? tr("Guardar agendamento") : planChannelId?tr("Guardar preparação"):tr("Iniciar transmissão") });
  const updateSource=()=>{const video=$('#source-mode').value==='video';$('#source-video').hidden=!video;$('#source-playlist').hidden=video;const media=$('select[name=mediaId]'),playlist=$('select[name=playlistId]');media.disabled=!video;media.required=video;playlist.disabled=video;playlist.required=!video;$('select[name=quality]').disabled=!video;};
  $('#source-mode').onchange=()=>{updateSource();$('#source-search').value='';filterSource();};updateSource();
  const filterSource=()=>{const needle=$('#source-search').value.toLocaleLowerCase('pt-PT');const select=$('#source-mode').value==='video'?$('select[name=mediaId]'):$('select[name=playlistId]');for(const option of select.options){option.hidden=option.disabled=!option.textContent.toLocaleLowerCase('pt-PT').includes(needle);}if(select.selectedOptions[0]?.disabled)select.value=[...select.options].find(o=>!o.disabled)?.value||'';};
  $('#source-search').oninput=filterSource;
  const updateNotes=()=>{const selected=[...document.querySelectorAll('input[name=channelIds]:checked')].map(el=>el.value);$('#platform-notes').innerHTML=platformGuidance(state.channels.filter(c=>selected.includes(c.id)));};
  document.querySelectorAll('input[name=channelIds]').forEach(el=>el.addEventListener('change',updateNotes));updateNotes();
}
function importForm() {
  const examplePath=health?.platform==='darwin'?'/Users/name/Movies/video.mp4':`D:\\${tr("Vídeos")}\\concerto.mp4`;
  dialog(tr("Importar vídeos"), `<p class="muted">${tr("Selecione os ficheiros ou introduza os caminhos completos, um por linha.")}</p><div class="actions import-options"><button type="button" class="secondary" id="pick-files">${tr("▣ Escolher ficheiros…")}</button><button type="button" class="secondary" data-action="import-link">${tr("Adicionar por ligação")}</button></div><label>${tr("Caminhos locais")}<textarea name="paths" rows="5" required placeholder="${esc(examplePath)}"></textarea></label><label class="check"><input type="checkbox" name="convert" checked> ${tr("Converter formatos incompatíveis para MP4 / H.264 / AAC")}</label><p class="form-hint">${tr("Os originais permanecem no computador. A conversão para MP4 mantém a resolução e os fotogramas; para uniformizar vídeos diferentes, utilize Normalizar em Ferramentas.")}</p>`, async form => {
    toast(tr("A analisar vídeos e criar miniaturas…")); const paths = String(form.get('paths')).split(/\r?\n/).map(s => s.trim().replace(/^"|"$/g,'')).filter(Boolean);
    const result = await api('/api/media/import', { paths, convert:form.has('convert') });
    if (result.errors.length) throw Error(`${result.imported.length} ${tr("vídeos disponíveis.")} ${result.errors.map(e => `${e.file}: ${e.message}`).join('\n')}`);
    toast(`${result.imported.length} ${tr("vídeos disponíveis na biblioteca.")}`);
  }, { submit: tr("Importar vídeos") });
  const pathsField=$('textarea[name=paths]');
  $('#pick-files').onclick = async () => { const b = $('#pick-files'); b.disabled = true; try { const { paths } = await api('/api/media/pick', {}); if (paths.length) pathsField.value = paths.join('\n'); } catch(e) { toast(e.message, true); } finally { b.disabled = false; } };
}
function importLinksForm() {
  dialog(tr("Adicionar por ligação"), `<p class="form-hint">${tr("YouTube ou ligação HTTPS direta para MP4. O vídeo é lido pela Internet, sem guardar uma cópia completa. Precisa de ligação durante toda a transmissão.")}</p><label>${tr("Ligações dos vídeos (uma por linha)")}<textarea name="urls" rows="6" required maxlength="400100" spellcheck="false" dir="ltr" placeholder="https://www.youtube.com/watch?v=...&#10;https://example.com/video.mp4"></textarea></label><p class="form-hint">${tr("Cole até 100 ligações, uma por linha. As ligações repetidas são ignoradas.")}</p><label>${tr("Título (opcional)")}<input name="title" maxlength="200"></label><p class="form-hint">${tr("O título opcional só é aplicado quando adiciona uma única ligação.")}</p><p class="form-hint">${tr("Apenas vídeos com duração definida. YouTube requer yt-dlp e um formato MP4 com áudio e vídeo juntos; a qualidade disponível pode ser inferior. Diretos, HLS e conteúdos com autenticação não são suportados nesta opção.")}</p>`, async form => {
    const urls=[...new Set(String(form.get('urls')||'').split(/\r?\n/).map(url=>url.trim()).filter(Boolean))];
    if(!urls.length||urls.length>100)throw Error(tr("Introduza entre 1 e 100 ligações, uma por linha."));
    const field=$('textarea[name=urls]'),progress=$('.form-progress',$('#modal-form')),failed=[];
    const title=urls.length===1?String(form.get('title')||'').trim():'';
    let available=0;
    for(const [index,url] of urls.entries()){
      progress.textContent=`${tr("A adicionar ligações:")} ${index+1}/${urls.length}. ${tr("A concluir a operação. Fechar esta janela não cancela a operação.")}`;
      try{await api('/api/media/link',{url,title});available++;}
      catch(error){failed.push({url,message:tr(error.message)});}
    }
    const summary=`${available} ${tr("ligações disponíveis na biblioteca.")}`;
    if(failed.length){
      field.value=failed.map(item=>item.url).join('\n');
      throw Error(`${summary}\n${tr("Corrija as ligações que falharam e tente novamente. As restantes já foram adicionadas.")}\n${failed.map(item=>`${item.url}: ${item.message}`).join('\n')}`);
    }
    toast(summary);
  }, {submit:tr("Adicionar por ligação")});
}
async function previewPlaylist(id) { if (!id) throw Error(tr("Escolha primeiro uma playlist.")); await api('/api/start', { playlistId: id, preview: true }); navigate('dashboard'); toast(tr("Teste local em execução.")); }
document.addEventListener('click', async event => {
  const b = event.target.closest('[data-action]'); if (!b || b.disabled) return;
  const action=b.dataset.action,id=b.dataset.id,key=action+':'+(id||'');if(pendingActions.has(key))return;pendingActions.add(key);b.disabled=true;
  try {
    if(action==='media-list'||action==='media-grid'){mediaLayout=action==='media-list'?'list':'grid';let persisted=true;try{localStorage.setItem('media-layout',mediaLayout);}catch{persisted=false;}draw();if(!persisted)toast(tr('Esta preferência foi aplicada apenas nesta sessão.'));}
    else if (action === 'import') importForm();
    else if(action==='import-link')importLinksForm();
    else if (action === 'channel-new' || action === 'channel-edit') channelForm(id);
    else if (action === 'playlist-new' || action === 'playlist-edit') playlistForm(id);
    else if(action==='playlist-rename'){const playlist=state.playlists.find(p=>p.id===id);if(!playlist)throw Error(tr("Playlist indisponível."));dialog(tr("Renomear playlist"),`<label>${tr("Nome")}<input name="name" value="${esc(playlist.name)}" maxlength="100" required></label><p class="form-hint">${tr("Altera o nome sem modificar a sequência nem interromper emissões em curso.")}</p>`,async form=>{await api(`/api/playlists/${id}/name`,{name:form.get('name')},'PUT');toast(tr("Nome da playlist atualizado."));});}
    else if (action === 'go-live') liveForm();
    else if(action==='plan-channel')liveForm(false,null,null,null,id);
    else if(action==='plan-schedule')liveForm(true,null,null,null,id);
    else if(action==='overlays')overlaysForm();
    else if(action==='plan-start'){const channel=state.channels.find(c=>c.id===id);if(confirm(`${tr("Iniciar a transmissão preparada para")} ${channel.name}?`)){await api(`/api/channels/${id}/start`,{confirmed:true});navigate('live');await refresh();}}
    else if(action==='job-settings')jobSettings(id);
    else if(action==='job-queue')queueForm(id);
    else if(action==='download-import'){await api(`/api/downloads/${id}/import`,{});await refresh();toast(tr("Vídeo adicionado à biblioteca."));}
    else if(action==='preview-download')dialog(tr("Vídeo descarregado"),`<video class="video-player" controls autoplay src="/api/downloads/${id}/media"></video>`);
    else if(action==='single-live')liveForm(false,null,'video',id);
    else if(action==='playlist-live')liveForm(false,null,'playlist',id);
    else if (action === 'schedule-new') liveForm(true);
    else if (action === 'schedule-edit') liveForm(true,id);
    else if (action === 'clear-schedules') { if(confirm(tr("Remover todos os agendamentos? As transmissões já em curso continuam."))) {await api('/api/schedules',{},'DELETE');await refresh();} }
    else if (action === 'go-tools') navigate('tools');
    else if(action==='reconnect'){await refresh();health=await api('/api/health');showHealth();}
    else if(action==='test-media'){await api('/api/start',{mediaId:id,preview:true});navigate('dashboard');toast(tr("Teste local em execução."));}
    else if (action === 'preview-playlist') await previewPlaylist(id);
    else if (action === 'tool-preview') await previewPlaylist($('#preview-select').value);
    else if (action === 'view-preview' || action === 'preview-media') {
      const title = action === 'view-preview' ? tr("Resultado do teste local") : state.media.find(m => m.id === id)?.title;
      dialog(title, `<video class="video-player" controls autoplay src="/api/${action === 'view-preview' ? 'preview' : 'media'}/${id}"></video><p class="form-hint">${tr("Se o navegador não reproduzir o formato original, utilize o teste local ou normalize o vídeo.")}</p>`);
    }
    else if (['delete-media','delete-channel','delete-playlist','delete-schedule'].includes(action)) {
      const collection = { media: 'media', channel: 'channels', playlist: 'playlists', schedule: 'schedules' }[action.slice(7)];
      const references=action==='delete-media'?state.playlists.filter(p=>p.mediaIds.includes(id)):[];
      if(references.length){
        dialog(tr("Remover vídeo da biblioteca"),`<p>${tr("Este vídeo faz parte de")} ${references.length} ${tr("playlist(s):")}</p><ul>${references.map(p=>`<li>${esc(p.name)}</li>`).join('')}</ul><label class="check"><input name="detachFromPlaylists" type="checkbox" required> ${tr("Retirar também todas as ocorrências destas playlists")}</label><p class="form-hint">${tr("O ficheiro original permanece no computador. Vídeos em emissão e playlists agendadas que ficariam vazias estão protegidos.")}</p>`,async form=>{await api(`/api/media/${id}`,{detachFromPlaylists:form.has('detachFromPlaylists')},'DELETE');toast(tr("Vídeo retirado da biblioteca e das playlists."));},{submit:tr("Remover referências")});
        return;
      }
      if (confirm(tr("Remover este item do Go Streams? Os vídeos originais não serão apagados."))) { await api(`/api/${collection}/${id}`, {}, 'DELETE'); await refresh(); toast(tr("Item removido.")); }
    }
    else if(action==='check-updates'){await api('/api/updates/check',{});await refresh();}
    else if(action==='download-update'){toast(tr("A descarregar e verificar o pacote."));await api('/api/updates/download',{});await refresh();toast(tr("Pacote verificado e guardado."));}
    else if(action==='backup-export')dialog(tr("Exportar cópia de segurança"),`<label>${tr("Conteúdo")}<select name="scope"><option value="all">${tr("Projeto e definições")}</option><option value="project">${tr("Apenas projeto")}</option><option value="settings">${tr("Apenas definições")}</option></select></label><label>${tr("Palavra-passe da cópia")}<input type="password" name="password" minlength="10" maxlength="1024" autocomplete="new-password" required></label><label>${tr("Repetir palavra-passe")}<input type="password" name="repeat" minlength="10" maxlength="1024" autocomplete="new-password" required></label><p class="form-hint">${tr("Guarde esta palavra-passe: é necessária para restaurar as chaves e definições, incluindo noutro computador. Os ficheiros de vídeo permanecem nas localizações originais.")}</p>`,async form=>{if(form.get('password')!==form.get('repeat'))throw Error(tr("As palavras-passe não coincidem."));const backup=await api('/api/backups/export',{scope:form.get('scope'),password:form.get('password'),interface:interfacePreferences()});downloadJson(backup,'go-streams-backup.json');toast(tr("Cópia de segurança exportada."));},{submit:tr("Exportar")});
    else if(action==='backup-restore')dialog(tr("Restaurar cópia de segurança"),`<label>${tr("Ficheiro da cópia")}<input type="file" name="backup" accept=".json,application/json" required></label><label>${tr("Palavra-passe da cópia")}<input type="password" name="password" minlength="10" maxlength="1024" autocomplete="current-password" required></label><p class="form-hint">${tr("Restaura os dados como foram exportados e substitui a categoria guardada na cópia. Inclui os automatismos configurados: agendamentos ativos, notificações e verificação de atualizações. Pare as operações em curso. As transmissões não são retomadas; os vídeos e ferramentas precisam de continuar acessíveis nos caminhos guardados.")}</p><label class="check"><input type="checkbox" name="confirmed" required> ${tr("Confirmo a substituição dos dados e o restauro dos automatismos guardados.")}</label>`,async form=>{const file=form.get('backup');if(file.size>24*1024*1024)throw Error(tr("A cópia excede o limite de 24 MB."));let backup;try{backup=JSON.parse(await file.text());}catch{throw Error(tr("O ficheiro não contém JSON válido."));}const result=await api('/api/backups/restore',{backup,password:form.get('password'),confirmed:form.has('confirmed')});settingsDrafts.clear();let preferencesFailed=false;if(result.interface){try{localStorage.setItem('media-layout',result.interface.layout);localStorage.setItem('nav-compact',result.interface.compact?'1':'0');setLanguage(result.interface.language);mediaLayout=result.interface.layout;setCompactNavigation(result.interface.compact,false);applyLocale();}catch{preferencesFailed=true;}}toast(tr(preferencesFailed?"Dados restaurados. Não foi possível guardar todas as preferências da interface.":"Cópia de segurança restaurada."));if(result.interface&&!preferencesFailed)location.reload();},{submit:tr("Restaurar")});
    else if (action === 'import-project') {
      dialog(tr("Importar projeto"), `<label>${tr("Ficheiro de configuração")}<input type="file" name="project" accept=".json,application/json" required></label><p class="form-hint">${tr("Acrescenta vídeos, playlists, canais e agendamentos. Os ficheiros de vídeo precisam de existir nos caminhos guardados. Não altera as chaves atuais nem ativa agendamentos. Se algum vídeo estiver indisponível, a importação é cancelada sem alterar o projeto.")}</p>`, async form => {
        const file = form.get('project'); if (file.size > 1024*1024) throw Error(tr("O limite do ficheiro é 1 MB."));
        let project; try { project = JSON.parse(await file.text()); } catch { throw Error(tr("O ficheiro não contém JSON válido.")); }
        const result = await api('/api/import', project);
        toast(`${tr("Importados:")} ${result.media} ${tr("vídeos,")} ${result.channels} ${tr("canais,")} ${result.playlists} ${tr("playlists e")} ${result.schedules} ${tr("agendamentos.")}`);
      }, { submit: tr("Importar projeto") });
    }
    else if (action === 'download-new') {
      dialog(tr("Descarregar vídeo"), `<label>${tr("URL do vídeo no YouTube")}<input type="url" name="url" placeholder="https://www.youtube.com/watch?v=..." required></label><label class="check"><input type="checkbox" name="addToLibrary"> ${tr("Adicionar automaticamente à biblioteca")}</label><p class="form-hint">${tr("Um vídeo por download. Os ficheiros ficam em Ferramentas. Pode vê-los e adicioná-los à biblioteca quando quiser.")}</p>`, async form => {await api('/api/downloads',{url:form.get('url'),addToLibrary:form.has('addToLibrary')});toast(tr("Download iniciado."));navigate('tools');},{submit:'Descarregar'});
    }
    else if(action==='retry-download'){
      const download=(state.downloads||[]).find(d=>d.id===id);
      if(!download||!['error','cancelled','interrupted'].includes(download.status))throw Error(tr("Este download não pode ser repetido agora."));
      await api('/api/downloads',{url:download.url,addToLibrary:download.addToLibrary!==false});await refresh();toast(tr("Download iniciado."));
    }
    else if (action === 'cancel-download') {await api(`/api/downloads/${id}/cancel`,{});await refresh();}
    else if (action === 'remove-download') {await api(`/api/downloads/${id}`,{},'DELETE');await refresh();toast(tr("Registo retirado. O ficheiro no computador foi preservado."));}
    else if (action === 'test-email') {
      if(confirm(`${tr("Enviar um email de teste para")} ${state.notifications?.to||tr("o destinatário guardado")}?`)){await api('/api/notifications/test',{confirmed:true});toast(tr("Email enviado."));await refresh();}
    }
    else if (action === 'restart-job') {
      if(confirm(tr("Terminar esta ligação e recomeçar o conteúdo desde o início? A plataforma pode criar um novo direto."))){await api(`/api/jobs/${id}/restart`,{confirmed:true});await refresh();}
    }
    else if (action === 'rename-media') {
      const media = state.media.find(m => m.id === id);
      dialog(tr("Renomear vídeo"), `<label>${tr("Título")}<input name="title" value="${esc(media.title)}" maxlength="200" required></label>`, async form => { await api(`/api/media/${id}`, { title: form.get('title') }, 'PUT'); toast(tr("Título atualizado.")); });
    }
    else if (action === 'pause-job') { await api(`/api/jobs/${id}/pause`, {}); await refresh(); }
    else if (action === 'resume-job') {
      if (confirm(tr("Retomar o envio para este canal a partir da posição guardada?"))) { await api(`/api/jobs/${id}/resume`, { confirmed: true }); await refresh(); }
    }
    else if (action === 'clear-history') {
      if (confirm(tr("Limpar os registos de atividade? Os vídeos e as configurações serão preservados."))) { await api('/api/history', {}, 'DELETE'); await refresh(); }
    }
    else if (action === 'stop-job') { await api(`/api/jobs/${id}/stop`, {}); await refresh(); }
    else if (action === 'stop-all') { if (confirm(tr("Parar todas as transmissões e testes em curso?"))) { await api('/api/stop-all', {}); await refresh(); } }
    else if (action === 'arm') {
      const schedule = state.schedules.find(s => s.id === id);
      if (schedule.armed || confirm(tr("Ativar a transmissão automática para este horário e estes canais?"))) { await api(`/api/schedules/${id}/arm`, { armed: !schedule.armed, confirmed: true }); await refresh(); }
    }
    else if(action==='cancel-conversion'){await api(`/api/media-operations/${id}/cancel`,{});await refresh();toast(tr("Cancelamento da conversão pedido. O original será preservado."));}
    else if (action === 'normalize') {
      const mediaId = $('#normalize-select').value; if (!mediaId) throw Error(tr("Importe primeiro um vídeo."));
      b.textContent = tr("A normalizar…"); toast(tr("Conversão em curso. Pode continuar a usar o estúdio.")); await api('/api/normalize', { mediaId }); await refresh(); toast(tr("Cópia normalizada adicionada à biblioteca."));
    }
    else throw Error(tr("Ação indisponível. Atualize a janela e tente novamente."));
  } catch(e){toast(e.message,!(action==='normalize'&&e.message==='Operação cancelada.'));if(['check-updates','download-update','test-email'].includes(action))await refresh().catch(()=>{});}
  finally{pendingActions.delete(key);b.disabled=false;document.querySelectorAll('[data-action]').forEach(el=>{if(el.dataset.action===action&&(el.dataset.id||'')===(id||''))el.disabled=el.dataset.unavailable==='true'||(settingsSaving&&page==='settings');});if(action==='normalize')b.textContent=tr("Criar cópia normalizada");}

});
document.addEventListener('input', event => { if (event.target.id === 'search') { query = event.target.value; if(paging[page])paging[page].page=1; const position = event.target.selectionStart; draw(); $('#search').focus(); $('#search').setSelectionRange(position, position); } });
document.addEventListener('input',rememberSettings);
document.addEventListener('change',rememberSettings);
document.addEventListener('submit',async event=>{
 const form=event.target;
 if(!['settings-form','encoding-form','notification-form','operation-form','update-form'].includes(form.id))return;
 event.preventDefault();if(settingsSaving)return;
 const data=new FormData(form), controls=[...form.elements].map(el=>[el,el.disabled]);
 const encoding=form.id==='encoding-form'?Object.fromEntries(['videoBitrate','audioBitrate','fps','aspect'].map(name=>[name,form.elements.namedItem(name).value])):null;
 settingsSaving=true;
 for(const [el] of controls)el.disabled=true;
 try{
  if(form.id==='settings-form')await api('/api/settings',Object.fromEntries(data),'PUT');
  else if(form.id==='encoding-form')await api('/api/settings',{encoding:{copy:data.has('copy'),videoBitrate:Number(encoding.videoBitrate),audioBitrate:Number(encoding.audioBitrate),fps:Number(encoding.fps),aspect:encoding.aspect}},'PUT');
  else if(form.id==='operation-form')await api('/api/settings',{operations:{maxConcurrent:Number(data.get('maxConcurrent')),historyLimit:Number(data.get('historyLimit')),persistSchedules:data.has('persistSchedules')},confirmed:data.has('persistSchedules')},'PUT');
  else if(form.id==='notification-form')await api('/api/notifications',{...Object.fromEntries(data),enabled:data.has('enabled'),port:Number(data.get('port'))},'PUT');
  else await api('/api/updates',{...Object.fromEntries(data),autoCheck:data.has('autoCheck')},'PUT');
  settingsDrafts.delete(form.id);
  if(form.id==='settings-form'){health=await api('/api/health');showHealth();}
  await refresh(false);toast(tr("Definições guardadas."));
 }catch(error){toast(error.message,true);}
 finally{settingsSaving=false;for(const [el,disabled]of controls)el.disabled=disabled;draw();}
});
$('#dialog').addEventListener('close', () => { if(!$('#dialog').open){dialogGeneration++;$('#dialog-content').innerHTML='';} });
$('#exit').onclick = async () => { if(exitPending||interfaceClosing)return; if (!confirm(tr("Encerrar o Go Streams? As transmissões ativas serão paradas."))) return; exitPending=true;$('#exit').disabled=true;try { await api('/api/shutdown', {});interfaceClosing=true; $('#content').innerHTML = empty('✓', tr("A encerrar o estúdio"), tr("As operações estão a terminar. Pode fechar esta janela; volte a abrir pelo iniciador Go Streams.")); clearInterval(poll); } catch(e) {exitPending=false;$('#exit').disabled=false; toast(e.message, true); } };
window.addEventListener('hashchange', () => { page = location.hash.slice(1) || 'dashboard'; query = ''; draw(); });
function showHealth() { const ok = health?.tools.ffmpeg.available && health?.tools.ffprobe.available; $('#engine-status').textContent = ok ? tr("● Motor disponível") : tr("● Configurar motor"); $('#engine-status').className = `badge ${ok ? 'ready' : 'error'}`; }
applyLocale();
$('#language-select').onchange=event=>{const select=event.target;if($('#dialog').open||settingsDrafts.size||settingsSaving){select.value=language();toast(tr('Guarde as alterações e feche a janela antes de mudar o idioma.'),true);return;}try{setLanguage(select.value);location.reload();}catch(error){select.value=language();toast(error.message,true);}};
try { await refresh(); health = await api('/api/health'); showHealth(); if (page === 'settings') draw(); } catch(e) { $('#content').innerHTML = empty('!', tr("Não foi possível abrir o estúdio"), e.message,btn('reconnect',tr("Tentar novamente")));connectionFailed(); }
const poll = setInterval(async () => { if (loading) return; loading = true; try { await refresh(()=>!$('#dialog').open && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName) && ['dashboard','golive','live','schedules','history','tools'].includes(page)); } catch {connectionFailed();} finally { loading = false; } $('#clock').textContent = new Date().toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' }); }, 2000);

document.addEventListener('change',event=>{const target=event.target;if(target.dataset.filter){filters[target.dataset.filter][target.dataset.key]=target.value;if(paging[target.dataset.filter])paging[target.dataset.filter].page=1;draw();}});
setInterval(()=>{document.querySelectorAll('[data-countdown]').forEach(el=>{el.textContent=Math.max(0,Math.ceil((Date.parse(el.dataset.countdown)-Date.now())/1000));});},250);

document.addEventListener('click',event=>{const b=event.target.closest('[data-page-key]');if(!b||b.disabled)return;paging[b.dataset.pageKey]={...(paging[b.dataset.pageKey]||{}),page:Number(b.dataset.page)};draw();});
document.addEventListener('change',event=>{if(!event.target.dataset.pageSize)return;paging[event.target.dataset.pageSize]={page:1,size:Number(event.target.value)};draw();});

document.addEventListener('input',event=>{if(event.target.id!=='downloads-search')return;downloadsQuery=event.target.value;paging.downloads={...(paging.downloads||{}),page:1};const position=event.target.selectionStart;draw();$('#downloads-search').focus();$('#downloads-search').setSelectionRange(position,position);});

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-secret]');if(!button||button.disabled)return;
 const input=button.closest('form')?.elements.namedItem(button.dataset.secret);if(!input)return;
 const visible=input.type==='password';input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.textContent=visible?tr("Ocultar valor introduzido"):button.dataset.secret==='key'?tr("Mostrar chave introduzida"):tr("Mostrar palavra-passe introduzida");
});

function setCompactNavigation(compact,persist=true){
 $('html').dataset.compactNav=String(compact);
 const toggle=$('#sidebar-toggle'),label=compact?tr("Expandir menu"):tr("Recolher menu");
 toggle.setAttribute('aria-expanded',String(!compact));toggle.setAttribute('aria-label',label);toggle.setAttribute('title',label);
 if(persist){try{localStorage.setItem('nav-compact',compact?'1':'0');}catch{}}
}
let initialCompact=false;try{initialCompact=localStorage.getItem('nav-compact')==='1';}catch{}
setCompactNavigation(initialCompact,false);
$('#sidebar-toggle').onclick=()=>setCompactNavigation($('html').dataset.compactNav!=='true');

document.addEventListener('change',event=>{if(event.target.name==='copy'&&event.target.closest('form')?.id==='encoding-form')syncEncodingControls();});


