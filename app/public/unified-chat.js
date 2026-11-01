import {language} from './i18n.js';
const text=(en,pt)=>language()==='pt-PT'?pt:en;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class ChatPanel {
 constructor({api,toast,onFeature}){Object.assign(this,{api,toast,onFeature});this.replyTo=null;this.selected=null;this.pendingOperations=0;this.snapshot={accounts:{},connections:[],messages:[]};}
 get busy(){return this.pendingOperations>0;}
 changedSetup(form){return [...form.querySelectorAll('input')].some(input=>input.value!==input.defaultValue);}
 get hasUnsavedChanges(){
  if(!this.element)return false;
  const resource=this.element.querySelector('.chat-connect [name="resource"]')?.value?.trim(),channelId=this.element.querySelector('.chat-connect select')?.value;
  return Boolean(this.element.querySelector('.chat-compose textarea')?.value?.trim()||[...(this.element.querySelectorAll?.('.chat-provider-setup')||[])].some(form=>this.changedSetup(form))||resource&&(resource!==this.connectedDraft?.resource||channelId!==this.connectedDraft?.channelId));
 }
 mount(container,state,channels){
  if(!this.element){
   this.element=document.createElement('section');this.element.className='panel unified-chat';
   this.element.innerHTML=`<h2>${text('Unified live chat','Chat unificado ao vivo')}</h2><p>${text('Read connected platform chats here and reply to the selected destination. Chat works with live capture and prerecorded broadcasts.','Leia os chats ligados e responda ao destino selecionado. Funciona com captação ao vivo e vídeos gravados.')}</p><details class="chat-account-setup"><summary>${text('Accounts and chat connections','Contas e ligações de chat')}</summary><div class="chat-accounts"></div><form class="chat-connect"><label>${text('Broadcast destination','Destino')}<select name="channelId" required></select></label><label>${text('YouTube live video URL / Twitch channel','URL do vídeo ao vivo no YouTube / canal Twitch')}<input name="resource" maxlength="500" required></label><label class="check"><input name="confirmed" type="checkbox" required> ${text('I authorize reading this chat and replying as my connected account.','Autorizo a leitura deste chat e as respostas com a conta ligada.')}</label><button class="secondary">${text('Connect chat','Ligar chat')}</button></form><div class="chat-connection-status"></div></details><div class="chat-toolbar"><label>${text('Show','Mostrar')}<select data-chat="filter"><option value="">${text('All connected chats','Todos os chats ligados')}</option></select></label><button type="button" class="secondary small" data-chat="hide-featured">${text('Hide featured comment','Ocultar comentário no vídeo')}</button></div><div class="chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div><form class="chat-compose"><label>${text('Send to','Enviar para')}<select name="connectionId" required></select></label><p class="chat-reply-target"></p><label>${text('Your message','A sua mensagem')}<textarea name="text" maxlength="200" rows="3" required></textarea></label><p class="form-hint">${text('Replies target the selected platform. YouTube uses a viewer mention; Twitch supports threaded replies and may forward messages to linked channels in Shared Chat. Delivery depends on permissions, moderation and rate limits.','As respostas dirigem-se à plataforma selecionada. O YouTube usa uma menção; a Twitch permite respostas encadeadas e pode partilhá-las pelos canais ligados em Shared Chat. A entrega depende de permissões, moderação e limites.')}</p><button class="primary" disabled>${text('Send reply','Enviar resposta')}</button><button type="button" class="secondary" data-chat="cancel-reply">${text('Cancel reply selection','Cancelar seleção da resposta')}</button></form>`;
   this.element.addEventListener('submit',event=>{event.preventDefault();void this.submit(event.target);});
   this.element.addEventListener('click',event=>{const b=event.target.closest('button[data-chat]');if(b&&!b.disabled)void this.action(b);});
   this.element.addEventListener('change',event=>{
    if(event.target.dataset.chat==='filter')this.renderMessages();
    if(event.target.name==='connectionId'){this.replyTo=null;if(event.target.value)this.destinationLost=false;this.updateComposer();}
   });
  }
  if(this.element.parentNode!==container)container.appendChild(this.element);
  this.update(state,channels);
 }
 update(state,channels=this.channels||[]){
  if(!this.element)return;this.channels=channels;this.snapshot=state||{accounts:{},connections:[],messages:[]};
  const accountSignature=JSON.stringify(this.snapshot.accounts);
  // Keep application credential forms intact while the operator edits them.
  if(this.accountSignature!==accountSignature&&!this.element.querySelector('.chat-accounts')?.contains(document.activeElement)){
   const retained=[...(this.element.querySelectorAll?.('.chat-provider-setup')||[])].filter(form=>this.busyForms?.has(form)||this.changedSetup(form)).map(form=>({form,open:form.closest('details').open}));
   this.accountSignature=accountSignature;
   this.element.querySelector('.chat-accounts').innerHTML=['YouTube','Twitch'].map(provider=>{
    const a=this.snapshot.accounts[provider]||{};
    return `<section class="chat-account"><h3>${provider}</h3><p>${a.authorized?esc(a.name)+' — '+text('Authorized','Autorizado'):text('Account not connected','Conta por ligar')}</p>${a.pending?`<p>${a.pending.code?'<strong>'+esc(a.pending.code)+'</strong> ':''}<a href="${esc(a.pending.url)}" target="_blank" rel="noopener noreferrer">${text('Complete authorization','Concluir autorização')}</a></p>`:''}<div class="actions"><button type="button" class="secondary small" data-chat="authorize" data-provider="${provider}" ${a.configured?'':'disabled'}>${text('Sign in','Iniciar sessão')}</button>${a.authorized?`<button type="button" class="secondary small" data-chat="disconnect-account" data-provider="${provider}">${text('Disconnect account','Desligar conta')}</button>`:''}</div><details><summary>${text('OAuth application setup','Configuração da aplicação OAuth')}</summary><form class="chat-provider-setup" data-provider="${provider}"><label>Client ID<input name="clientId" value="${esc(a.clientId||'')}" autocomplete="off" required></label>${provider==='YouTube'?`<label>Client secret<input name="clientSecret" type="password" autocomplete="new-password" placeholder="${a.hasClientSecret?text('Saved — leave blank to retain','Guardado — deixe vazio para manter'):''}"></label>`:''}<p class="form-hint">${provider==='YouTube'?text('Requires a registered Google Desktop OAuth application with the YouTube Data API enabled.','Requer uma aplicação OAuth Google para computador, com a YouTube Data API ativa.'):text('Requires a registered Twitch public OAuth application. No client secret is needed.','Requer uma aplicação OAuth pública registada na Twitch. Não necessita de client secret.')} ${text('Stream keys do not grant chat access.','As chaves de transmissão não dão acesso ao chat.')}</p><button class="secondary small">${text('Save application settings','Guardar configuração')}</button></form></details></section>`;
   }).join('');
   for(const {form,open} of retained){const replacement=this.element.querySelector(`.chat-provider-setup[data-provider="${form.dataset.provider}"]`);if(replacement){replacement.closest('details').open=open;replacement.replaceWith(form);}}
  }
  const options=channels.filter(c=>['YouTube','Twitch'].includes(c.platform)),destination=this.element.querySelector('.chat-connect select');
  const key=JSON.stringify(options.map(c=>[c.id,c.name,c.platform]));if(key!==this.channelSignature){this.channelSignature=key;const selected=destination.value;destination.innerHTML=options.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.platform)}</option>`).join('');destination.value=options.some(c=>c.id===selected)?selected:options[0]?.id||'';}
  const connectionKey=JSON.stringify([this.snapshot.connections.map(c=>[c.id,c.status,c.name,c.platform,c.error]),channels.map(c=>[c.id,c.name,c.platform,c.producerUrl])]);
  if(connectionKey!==this.connectionSignature){
   this.connectionSignature=connectionKey;const selector=this.element.querySelector('.chat-compose select'),selected=selector.value,filter=this.element.querySelector('[data-chat="filter"]'),oldFilter=filter.value;
   const ready=this.snapshot.connections.filter(c=>c.status==='connected'),retained=ready.some(c=>c.id===selected);
   if(selected&&!retained)this.destinationLost=true;
   selector.innerHTML=`<option value="">${text('Choose a connected chat','Escolha um chat ligado')}</option>`+ready.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.platform)}</option>`).join('');selector.value=retained?selected:this.destinationLost?'':ready[0]?.id||'';
   filter.innerHTML=`<option value="">${text('All connected chats','Todos os chats ligados')}</option>`+this.snapshot.connections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');filter.value=this.snapshot.connections.some(c=>c.id===oldFilter)?oldFilter:'';
   this.element.querySelector('.chat-connection-status').innerHTML=this.snapshot.connections.map(c=>`<p><strong>${esc(c.name)}</strong> — ${esc(c.status)} ${esc(c.error)} <button type="button" class="secondary small" data-chat="disconnect-chat" data-id="${esc(c.id)}">${text('Disconnect','Desligar')}</button></p>`).join('')+channels.filter(c=>!['YouTube','Twitch'].includes(c.platform)).map(c=>`<p>${esc(c.name)} — ${text('Integrated chat unavailable for this platform in this release.','Chat integrado indisponível nesta plataforma nesta versão.')} ${c.producerUrl?`<a href="${esc(c.producerUrl)}" target="_blank" rel="noopener noreferrer">${text('Open producer panel','Abrir painel do produtor')}</a>`:''}</p>`).join('');
  }
  this.renderMessages();this.updateComposer();
 }
 updateComposer(){
  const selector=this.element.querySelector('.chat-compose select'),target=this.snapshot.connections.find(c=>c.id===selector.value);
  this.element.querySelector('.chat-compose button').disabled=this.sending||!target||target.status!=='connected';
  selector.disabled=Boolean(this.sending);const textarea=this.element.querySelector('.chat-compose textarea');textarea.disabled=Boolean(this.sending);textarea.maxLength=target?.platform==='Twitch'?500:200;
  this.element.querySelector('[data-chat="cancel-reply"]').disabled=Boolean(this.sending);
  const ready=new Set(this.snapshot.connections.filter(c=>c.status==='connected').map(c=>c.id)),messages=new Map(this.snapshot.messages.map(m=>[m.id,m]));
  for(const button of this.element.querySelectorAll('[data-chat="reply"]'))button.disabled=Boolean(this.sending)||!ready.has(messages.get(button.dataset?.id)?.connectionId);
  const parent=this.snapshot.messages.find(m=>m.id===this.replyTo&&m.connectionId===selector.value);if(!parent)this.replyTo=null;this.element.querySelector('.chat-reply-target').textContent=parent?text('Replying to ','A responder a ')+parent.author+': '+parent.text:'';
 }
 renderMessages(){
  const filter=this.element.querySelector('[data-chat="filter"]').value,items=this.snapshot.messages.filter(m=>!filter||m.connectionId===filter),signature=JSON.stringify(items.map(m=>[m.id,m.platform,m.channelName,m.author,m.text,m.own]))+filter;
  if(this.messageSignature===signature)return;this.messageSignature=signature;
  const log=this.element.querySelector('.chat-messages'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<80;
  const ready=new Set((this.snapshot.connections||[]).filter(c=>c.status==='connected').map(c=>c.id));
  log.innerHTML=items.map(m=>`<article class="chat-message ${m.own?'chat-own':''}"><small>${esc(m.platform)} · ${esc(m.channelName)}</small><p><strong>${esc(m.author)}</strong>: ${esc(m.text)}</p><div class="actions"><button type="button" class="secondary small" data-chat="reply" data-id="${esc(m.id)}" ${this.sending||!ready.has(m.connectionId)?'disabled':''}>${text('Reply','Responder')}</button><button type="button" class="secondary small" data-chat="feature" data-id="${esc(m.id)}">${text('Show on stream','Mostrar no vídeo')}</button></div></article>`).join('')||`<p>${text('Connect an account and an active platform chat to receive messages.','Ligue uma conta e um chat ativo para receber mensagens.')}</p>`;
  if(atBottom)log.scrollTop=log.scrollHeight;
 }
 async submit(form){
  this.busyForms ||= new WeakSet();if(this.sending||this.busyForms.has(form))return;this.busyForms.add(form);const data=new FormData(form),button=form.querySelector('button'),controls=[...(form.elements||[])].map(el=>[el,el.disabled]);button.disabled=true;for(const [el]of controls)el.disabled=true;this.pendingOperations++;
  try{
   if(form.classList.contains('chat-provider-setup')){const accounts=await this.api('/api/chat/settings',{provider:form.dataset.provider,...Object.fromEntries(data)},'PUT');for(const input of form.querySelectorAll?.('input')||[]){if(input.type==='password'){input.value='';input.placeholder=accounts?.[form.dataset.provider]?.hasClientSecret?text('Saved — leave blank to retain','Guardado — deixe vazio para manter'):'';}else input.defaultValue=input.value;}this.toast(text('Application settings saved. You can sign in now.','Configuração guardada. Já pode iniciar sessão.'));}
   else if(form.classList.contains('chat-connect')){
    const channelId=data.get('channelId'),result=await this.api('/api/chat/connect',{channelId,resource:data.get('resource'),confirmed:data.has('confirmed')});
    this.update(result);const connection=result.connections?.find(c=>c.channelId===channelId||c.id===channelId);
    if(connection?.status==='connected')this.toast(text('Chat connected.','Chat ligado.'));
    else if(connection?.status==='connecting')this.toast(text('Chat connection requested. Waiting for the platform to confirm.','Ligação do chat pedida. A aguardar confirmação da plataforma.'));
    else throw Error(connection?.error||text('The chat connection was not confirmed. Reconnect the chat.','A ligação do chat não foi confirmada. Volte a ligar o chat.'));
    this.connectedDraft={channelId,resource:String(data.get('resource')||'').trim()};
   }
   else{
    this.sending=true;this.updateComposer();
    await this.api('/api/chat/send',{connectionId:data.get('connectionId'),text:data.get('text'),replyTo:this.replyTo,confirmed:true,requestId:crypto.randomUUID()});form.querySelector('textarea').value='';this.replyTo=null;this.toast(text('Reply confirmed by the platform.','Resposta confirmada pela plataforma.'));
   }
   this.update(await this.api('/api/chat'));
  }catch(error){this.toast(error.message,true);}
  finally{this.busyForms.delete(form);this.pendingOperations--;if(form.classList.contains('chat-compose'))this.sending=false;for(const [el,disabled]of controls)el.disabled=disabled;button.disabled=false;this.updateComposer();}
 }
 async action(button){
  const action=button.dataset.chat;if(this.sending&&['reply','cancel-reply'].includes(action))return;button.disabled=true;this.pendingOperations++;
  try{
   if(action==='authorize'){await this.api('/api/chat/authorize',{provider:button.dataset.provider});this.toast(text('Open the authorization link in Accounts to finish signing in.','Abra a ligação de autorização em Contas para concluir a sessão.'));}
   if(action==='disconnect-account')await this.api('/api/chat/account/disconnect',{provider:button.dataset.provider});
   if(action==='disconnect-chat')await this.api('/api/chat/disconnect',{connectionId:button.dataset.id});
   if(action==='reply'){const message=this.snapshot.messages.find(m=>m.id===button.dataset.id);if(message){if(!this.snapshot.connections.some(c=>c.id===message.connectionId&&c.status==='connected'))throw Error(text('Connect this chat before replying.','Ligue este chat antes de responder.'));this.replyTo=message.id;this.element.querySelector('.chat-compose select').value=message.connectionId;this.updateComposer();this.element.querySelector('.chat-compose textarea').focus();}}
   if(action==='cancel-reply'){this.replyTo=null;this.updateComposer();}
   if(action==='feature')this.onFeature(this.snapshot.messages.find(m=>m.id===button.dataset.id));
   if(action==='hide-featured')this.onFeature(null);
   if(['authorize','disconnect-account','disconnect-chat'].includes(action))this.update(await this.api('/api/chat'));
  }catch(error){this.toast(error.message,true);}finally{this.pendingOperations--;button.disabled=false;if(['reply','cancel-reply'].includes(action))this.updateComposer();}
 }
}
