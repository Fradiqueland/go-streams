import {tr,language,localeTag,setLanguage,applyLocale} from './i18n.js';
// Shared rendering and date filtering for the desktop studio.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
golive:'m9 5 11 7-11 7z M4 5v14',live:'M9 9a4 4 0 0 1 6 0 M6 6a8 8 0 0 1 12 0 M3 3a12 12 0 0 1 18 0 M12 12v9 M8 21h8',
media:'M3 4h18v16H3z m7 4 6 4-6 4z',channels:'M3 5h18v12H3z M8 21h8 M12 17v4',
playlists:'M4 5h13 M4 10h13 M4 15h7 m5-2 6 4-6 4z',
schedules:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M8 17h6',
tools:'M14 4a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l7-7a5 5 0 0 0 6-6l-4 3-3-3z',
history:'M4 4h16v17H4z M8 8h8 M8 12h8 M8 16h5',
settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4 M12 17v1 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
arrow:'M5 12h14 m-5-5 5 5-5 5',play:'m8 4 12 8-12 8z',check:'m5 12 4 4L19 6',upload:'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6'};
export function icon(name){return '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[name]||paths.media)+'"/></svg>';}
export function inPeriod(value,period,now=new Date()){
  const date=new Date(value); if(!Number.isFinite(date.getTime()))return false;
  if(period==='all')return true;
  const begin=new Date(now);begin.setHours(0,0,0,0);
  if(period==='week')begin.setDate(begin.getDate()-((begin.getDay()+6)%7));
  if(period==='month')begin.setDate(1);
  return date>=begin && date<=now;
}
export function filterHistory(rows,{period='all',kind='all',search='',sort='newest'}={},now=new Date()){
  const needle=search.trim().toLocaleLowerCase('pt-PT');
  return rows.filter(row=>inPeriod(row.time,period,now)&&(kind==='all'||row.kind===kind||(kind==='session'&&!row.kind&&row.result))&&(!needle||[row.channel,row.video,row.playlist,row.message,row.platform].some(v=>String(v||'').toLocaleLowerCase('pt-PT').includes(needle))))
    .toSorted((a,b)=>sort==='oldest'?a.time.localeCompare(b.time):sort==='channel'?String(a.channel||'').localeCompare(String(b.channel||''),'pt-PT'):b.time.localeCompare(a.time));
}
export function filterToolbar(filters,{prefix='history',kinds=true,search=true}={}){
 const options=(values,selected)=>values.map(([v,label])=>'<option value="'+v+'" '+(v===selected?'selected':'')+'>'+label+'</option>').join('');
 return `<div class="filter-bar"><label>${tr("Período")}<select data-filter="`+prefix+'" data-key="period">'+options([['all',tr("Todo o período")],['today',tr("Hoje")],['week',tr("Esta semana")],['month',tr("Este mês")]],filters.period)+'</select></label>'+
 (kinds?`<label>${tr("Registos")}<select data-filter="`+prefix+'" data-key="kind">'+options([['all',tr("Toda a atividade")],['session',tr("Transmissões")],['video',tr("Vídeos")],['schedule',tr("Agendamentos")]],filters.kind)+'</select></label>':'')+
 `<label>${tr("Ordenar")}<select data-filter="`+prefix+'" data-key="sort">'+options([['newest',tr("Mais recentes")],['oldest',tr("Mais antigos")],['channel',tr("Canal A–Z")]],filters.sort)+'</select></label>'+
 (search?`<label class="filter-search">${tr("Pesquisar")}<input data-filter="`+prefix+'" data-key="search" placeholder="'+escapeHtml(tr('Canal, vídeo ou programa…'))+'" value="'+escapeHtml(filters.search)+'"></label>':'')+'</div>';
}
export function platformGuidance(channels){
 const notes={TikTok:tr("Obtenha o servidor e a chave na sua conta, caso estejam disponíveis. Confirme a receção no painel antes de considerar o direto publicado."),YouTube:tr("Abra o YouTube Studio e confirme a receção do sinal. A publicação pode exigir iniciar também o evento no Studio."),Facebook:tr("Confirme o evento e a chave no Live Producer. Ao retomar ou recomeçar, verifique se o mesmo evento aceita uma nova ligação."),Instagram:tr("Mantenha o painel Live Producer disponível. Confirme a orientação vertical, a validade da chave e os limites apresentados na sua conta."),Restream:tr("Confirme os destinos ativos no painel Restream. Uma interrupção na origem pode afetar todos os destinos."),Twitch:tr("Confirme a chave e a categoria no painel do criador."),LinkedIn:tr("Prepare o evento e obtenha os dados RTMP da sua conta antes de iniciar."),'Amazon Live':tr("Prepare o evento e confirme os dados de ligação no painel da plataforma.")};
 const platforms=[...new Set(channels.map(c=>c.platform))];
 return platforms.length?'<div class="platform-guidance">'+platforms.map(p=>'<p><strong>'+escapeHtml(p)+'</strong> — '+escapeHtml(notes[p]||tr("Confirme o servidor, a chave e a receção do sinal no destino."))+'</p>').join('')+'</div>':'';
}
export function helpPanel(version){
 const guides=[
 [tr("Preparar e transmitir"),tr("Importe um vídeo e adicione um canal. Em Entrar em direto, escolha Vídeo único ou Playlist, selecione os destinos e inicie a contagem. Pode cancelar antes de o sinal sair.")],
 [tr("Sequências e repetição"),tr("Crie uma playlist e ordene os vídeos por arrasto ou pelas setas. A repetição pode ser definida no canal ou substituída para uma emissão. Mantém a ligação aberta enquanto o conteúdo repete.")],
 [tr("Pausa e perda de ligação"),tr("O modo Pausar em caso de perda de ligação mantém a posição e reserva o canal. Retomar abre uma nova ligação; confirme a receção no painel da plataforma. A recuperação automática tenta novamente três vezes antes de pausar, se ambas as opções estiverem ativas.")],
 [tr("Formatos diferentes"),tr("Na importação, ative a conversão de formatos incompatíveis para MP4/H.264/AAC. Para misturar resoluções ou taxas de fotogramas numa playlist, normalize todos os vídeos em Ferramentas. Os originais são preservados. Em Ferramentas pode acompanhar e cancelar as conversões enquanto a incorporação na biblioteca ainda não começou.")],
 [tr("Agendar"),tr("Escolha o vídeo ou playlist, os canais, a data e o fuso horário. Ative o agendamento e mantenha a aplicação e o computador ligados. Pode autorizar em Definições a manutenção dos agendamentos já ativos ao reabrir.")],
 [tr("Registos e diagnóstico"),tr("O Histórico distingue transmissões e vídeos, incluindo cada repetição. Filtre por período e canal, consulte o resultado e exporte CSV. Os tempos refletem o progresso do codificador local.")],
 [tr("Downloads e email"),tr("Os downloads usam o yt-dlp incluído na aplicação. Para email, configure o seu servidor SMTP com STARTTLS ou TLS direto e use o teste para verificar a entrega.")],
 [tr("Atualizar e recuperar"),tr("Em Definições, exporte uma cópia de segurança completa protegida por palavra-passe para restaurar projetos, chaves e definições sem duplicar conteúdos. Os vídeos não são incluídos. Antes de atualizar, encerre o Go Streams e preserve a pasta data. As atualizações assinadas exigem um canal de distribuição e a chave pública do editor.")]
 ];
 return '<div class="help-grid">'+guides.map(([title,body],i)=>'<article class="panel help-card"><span class="guide-number">'+String(i+1).padStart(2,'0')+'</span><h2>'+title+'</h2><p>'+body+'</p></article>').join('')+'</div><div class="info-banner">Go Streams '+escapeHtml(version)+` · ${tr("Guia local disponível sem internet. As opções e os limites de cada plataforma devem ser confirmados no respetivo painel.")}</div>`;
}

export function updatePanel(state,esc){
 const config=state.updates||{},status=state.updateStatus||{};
 const labels={idle:tr("Verificação ainda não efetuada"),checking:tr("A verificar…"),available:tr("Nova versão disponível"),current:tr("Versão atualizada"),downloading:tr("A descarregar…"),downloaded:tr("Pacote verificado e pronto"),error:tr("Verificação indisponível")};
 return `<section class="panel update-panel"><div class="panel-title"><h2>${tr("Atualizações do Go Streams")}</h2><span class="badge">${esc(labels[status.state]||labels.idle)}</span></div><div class="update-content"><p>${status.configured?tr("As atualizações são verificadas com a chave pública do editor antes de descarregar o pacote."):tr("Ainda não existe um canal de distribuição configurado para este projeto. Pode instalar os pacotes de versão fornecidos ou configurar um canal assinado.")}</p>${status.error?`<p class="form-error">${esc(status.error)}</p>`:''}${status.release?`<p><strong>${tr("Versão")} ${esc(status.release.version)}</strong> · ${(status.release.bytes/1048576).toFixed(1)} MB</p><p>${esc(status.release.notes)}</p>`:''}${status.state==='downloaded'?`<div class="info-banner">${tr("Pacote guardado em")} <span class="mono">${esc(status.package)}</span>${tr(". Encerre a aplicação, extraia o pacote e preserve a pasta data. A instalação não é substituída durante uma emissão.")}</div>`:''}<div class="actions"><button class="secondary" data-action="check-updates" ${status.configured?'':'disabled'}>${tr("Verificar agora")}</button>${status.release?.available?`<button class="primary" data-action="download-update">${tr("Descarregar pacote verificado")}</button>`:''}</div><details><summary>${tr("Configurar canal de atualizações")}</summary><form id="update-form"><label>${tr("Manifesto assinado (HTTPS)")}<input name="feed" type="url" value="${esc(config.feed||'')}" placeholder="https://seu-servidor/releases/latest.json"></label><label>${tr("Chave pública Ed25519 do editor")}<textarea name="publicKey" rows="4" placeholder="-----BEGIN PUBLIC KEY-----">${esc(config.publicKey||'')}</textarea></label><label class="check"><input type="checkbox" name="autoCheck" ${config.autoCheck?'checked':''}> ${tr("Verificar ao abrir e a cada 24 horas")}</label><button class="primary">${tr("Guardar canal")}</button></form></details></div></section>`;
}
export function paginate(rows,{page=1,size=10}={}) {
 size=[10,25,50,100].includes(Number(size))?Number(size):10;
 const pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(pages,Math.max(1,Math.floor(Number(page)||1)));
 return {rows:rows.slice((page-1)*size,page*size),page,size,pages,total:rows.length,start:rows.length?(page-1)*size+1:0,end:Math.min(page*size,rows.length)};
}
export function paginationBar(info,key){return `<div class="pagination"><span>${tr("A mostrar")} ${info.start}–${info.end} ${tr("de")} ${info.total}</span><label>${tr("Por página")}<select data-page-size="${escapeHtml(key)}" aria-label="${tr("Resultados por página")}">${[10,25,50,100].map(n=>`<option ${n===info.size?'selected':''}>${n}</option>`).join('')}</select></label><div class="actions"><button class="secondary small" data-page="${info.page-1}" data-page-key="${escapeHtml(key)}" ${info.page===1?'disabled':''}>${tr("Anterior")}</button><span>${info.page} / ${info.pages}</span><button class="secondary small" data-page="${info.page+1}" data-page-key="${escapeHtml(key)}" ${info.page===info.pages?'disabled':''}>${tr("Seguinte")}</button></div></div>`;}
