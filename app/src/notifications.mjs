import { AppError } from './errors.mjs';
import {sendSmtp, isMailbox} from './smtp.mjs';
export {sendSmtp} from './smtp.mjs';

const email = isMailbox;
export function validateNotifications(input, previous = {}) {
  if (!input || typeof input.enabled !== 'boolean') throw new AppError('Configuração de notificações inválida.');
  if (input.enabled && (!email(input.from) || !email(input.to))) throw new AppError('Introduza endereços válidos para o remetente e o destinatário.');
  const port = Number(input.port === undefined || input.port === '' ? 587 : input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('Indique uma porta SMTP válida.');
  const security=input.security || (port===465?'tls':'starttls');
  if(!['tls','starttls'].includes(security) || (port===465&&security==='starttls'))throw new AppError('Escolha TLS direto para a porta 465, ou STARTTLS para a porta 587.');
  for (const field of ['host','username','from','to']) if (typeof input[field] !== 'string' || input[field].length > 254 || /[\r\n\x00]/.test(input[field])) throw new AppError('Campo de email inválido.');
  if (input.host && !/^[a-zA-Z0-9.-]+$/.test(input.host)) throw new AppError('Indique apenas o nome do servidor SMTP.');
  if (input.enabled && !input.host) throw new AppError('Configure o servidor SMTP.');
  if (typeof input.password !== 'string' || input.password.length > 1000 || /[\r\n\x00]/.test(input.password)) throw new AppError('Palavra-passe SMTP inválida.');
  if (input.enabled && input.username && !input.password && !previous.secret) throw new AppError('Introduza a palavra-passe SMTP ou palavra-passe de aplicação.');
  return { enabled: input.enabled, security, host: input.host.trim(), port, username: input.username.trim(), from: input.from.trim(), to: input.to.trim(), password: input.password };
}
export class Notifications {
  constructor(studio,{send=sendSmtp}={}) { this.studio=studio;this.store=studio.store;this.send=send;this.pending=[];this.processing=null;this.closing=false;this.controller=new AbortController(); }
  publicSettings() { const {secret,...config}=this.store.data.notifications||{enabled:false,host:'',port:587,username:'',from:'',to:''};return {...config,hasPassword:Boolean(secret)}; }
  save(input) {
    const old=this.store.data.notifications||{};const {password,...valid}=validateNotifications(input,old);
    this.store.update(s=>{s.notifications={...valid,secret:password?this.studio.vault.encrypt(password):old.secret||''};});
    if(!valid.enabled)this.pending=[];
    return this.publicSettings();
  }
  enqueue(job,status) {
    if(this.closing||job.preview||!this.store.data.notifications?.enabled||this.pending.length>=50)return;
    const labels={running:'Em direto',paused:'Pausada',stopped:'Parada',completed:'Concluída',error:'Erro',retrying:'A recuperar a ligação'};
    this.pending.push({subject:`Go Streams: ${labels[status]||status} — ${job.channelName}`.slice(0,200),body:`Canal: ${job.channelName}\nColeção: ${job.playlistName}\nEstado: ${labels[status]||status}\nInstante UTC: ${new Date().toISOString()}\nTempo reproduzido: ${Math.floor(job.elapsed)} segundos\n${job.error||''}`});
    this.drain();
  }
  enqueueSchedule(details) {
    if(this.closing || !this.store.data.notifications?.enabled || this.pending.length >= 50) return;
    const label=details.result==='missed'?'Horário perdido':'Falha de agendamento';
    this.pending.push({subject:`Go Streams: ${label} - ${details.playlist}`.slice(0,200),body:`${label}\nConteúdo: ${details.playlist}\nCanais: ${details.channel}\nHorário UTC: ${details.at}\nFuso: ${details.timeZone}\n${details.detail || ''}`});
    this.drain();
  }
  drain() {
    if(this.processing||this.closing)return;
    this.processing=(async()=>{while(this.pending.length&&!this.closing){const message=this.pending.shift();if(!this.store.data.notifications?.enabled)continue;await this.deliver(message);}})().catch(()=>{}).finally(()=>{this.processing=null;if(this.pending.length&&!this.closing)this.drain();});
  }
  async deliver(message) {
    const saved=this.store.data.notifications;
    if(!saved?.enabled)throw new AppError('Ative e guarde as notificações antes de enviar.');
    try {
      const password=saved.secret?this.studio.vault.decrypt(saved.secret):'';
      await this.send({...saved,secret:undefined,password},message,this.controller.signal);
      this.store.update(s=>{s.notificationStatus={status:'sent',at:new Date().toISOString(),error:''};});
      return {ok:true};
    } catch {
      this.store.update(s=>{s.notificationStatus={status:'error',at:new Date().toISOString(),error:'Falha no envio. Verifique o servidor SMTP, o modo TLS, as credenciais e a ligação.'};});
      return {ok:false,error:'Não foi possível enviar o email.'};
    }
  }
  async test(confirmed) {
    if(confirmed!==true)throw new AppError('Confirme o envio do email de teste.');
    if(this.closing||this.testing)throw new AppError('Aguarde o envio em curso.',409);
    this.testing=this.deliver({subject:'Go Streams — teste de notificações',body:'As notificações do Go Streams estão configuradas.'});
    try{return await this.testing;}finally{this.testing=null;}
  }
  async shutdown(){this.closing=true;this.pending=[];this.controller.abort();await Promise.all([this.processing,this.testing]);}
}
