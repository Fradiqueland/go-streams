import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import {AppError} from './errors.mjs';
export const isMailbox = value => typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value);
const failure = () => new AppError('Não foi possível enviar o email. Verifique o servidor SMTP, o modo TLS, as credenciais e a ligação.');

// Bounded SMTP reply parser. It never puts a server response or a credential into an error.
class Replies {
  constructor(socket,signal){
    this.socket=socket;this.buffer='';this.lines=[];this.ready=[];this.pending=null;this.failed=null;
    this.onData=chunk=>{try{
      this.buffer+=chunk.toString('utf8');
      if(this.buffer.length>65536)throw failure();
      let at;
      while((at=this.buffer.indexOf('\r\n'))>=0){
        const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+2);
        const match=/^(\d{3})([ -])(.*)$/.exec(line);
        if(!match||line.length>4096||this.lines.length>=100)throw failure();
        const code=Number(match[1]);if(this.lines.length&&this.lines[0].code!==code)throw failure();
        this.lines.push({code,text:match[3]});
        if(match[2]===' '){
          const reply={code,text:this.lines.map(l=>l.text).join('\n')};this.lines=[];
          if(this.pending){const waiter=this.pending;this.pending=null;waiter.resolve(reply);}
          else {if(this.ready.length>=4)throw failure();this.ready.push(reply);}
        }
      }
    }catch{this.fail();}};
    this.onError=()=>this.fail();this.onClose=()=>this.fail();this.onAbort=()=>this.fail();this.signal=signal;
    socket.on('data',this.onData);socket.on('error',this.onError);socket.on('close',this.onClose);socket.on('end',this.onClose);
    signal.addEventListener('abort',this.onAbort,{once:true});if(signal.aborted)this.fail();
  }
  fail(){this.failed=failure();if(this.pending){this.pending.reject(this.failed);this.pending=null;}}
  async take(codes){
    if(this.failed)throw this.failed;
    const reply=this.ready.length?this.ready.shift():await new Promise((resolve,reject)=>{if(this.pending)return reject(failure());this.pending={resolve,reject};});
    if(!codes.includes(reply.code))throw failure();return reply;
  }
  empty(){return !this.buffer&&!this.lines.length&&!this.ready.length&&!this.pending&&!this.failed;}
  detach(){for(const [event,fn] of [['data',this.onData],['error',this.onError],['close',this.onClose],['end',this.onClose]])this.socket.off(event,fn);this.signal.removeEventListener('abort',this.onAbort);}
}
function connected(socket,event,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{socket.off(event,ok);socket.off('error',bad);socket.off('close',bad);signal.removeEventListener('abort',bad);};
    const ok=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(failure());};
    socket.once(event,ok);socket.once('error',bad);socket.once('close',bad);signal.addEventListener('abort',bad,{once:true});if(signal.aborted)bad();
  });
}
function encodedSubject(subject){
  const chunks=[];let chunk='';
  for(const character of String(subject).replace(/[\r\n\x00-\x1f\x7f]/g,' ').slice(0,200)){
    if(Buffer.byteLength(chunk+character)>42){chunks.push(chunk);chunk='';}chunk+=character;
  }
  if(chunk||!chunks.length)chunks.push(chunk);
  return chunks.map(s=>'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?=').join('\r\n ');
}
export function mailData(config,message){
  if(!isMailbox(config.from)||!isMailbox(config.to)||typeof message.body!=='string'||Buffer.byteLength(message.body)>65536)throw failure();
  const body=Buffer.from(message.body).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
  return [`From: <${config.from}>`,`To: <${config.to}>`,`Subject: ${encodedSubject(message.subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${crypto.randomUUID()}@go-streams.local>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',body,''].join('\r\n')+'.\r\n';
}
export async function sendSmtp(config,message,signal,{connect=net.connect,secureConnect=tls.connect,timeoutMs=25000}={}){
  const security=config.security||(Number(config.port)===465?'tls':'starttls');
  if(!['tls','starttls'].includes(security)||typeof config.host!=='string'||!config.host||!/^[a-zA-Z0-9.-]+$/.test(config.host)||!Number.isInteger(Number(config.port))||Number(config.port)<1||Number(config.port)>65535||[config.username||'',config.password||''].some(v=>typeof v!=='string'||/[\r\n\x00]/.test(v)))throw failure();
  const data=mailData(config,message),controller=new AbortController(),sockets=new Set();let socket,replies;
  const abort=()=>controller.abort(),destroy=()=>{for(const s of sockets)s.destroy();};
  const timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',destroy,{once:true});
  const tlsOptions={host:config.host,port:Number(config.port),servername:net.isIP(config.host)?undefined:config.host,rejectUnauthorized:true,minVersion:'TLSv1.2'};
  const guard=()=>{};
  const track=s=>{sockets.add(s);s.on('error',guard);return s;};
  const secure=async raw=>{
    socket=track(secureConnect({...tlsOptions,...(raw?{socket:raw}:{})}));
    replies=new Replies(socket,controller.signal);await connected(socket,'secureConnect',controller.signal);
    if(socket.authorized!==true||tls.checkServerIdentity(config.host,socket.getPeerCertificate()))throw failure();
  };
  const command=async(line,codes)=>{if(controller.signal.aborted)throw failure();socket.write(line+'\r\n');return replies.take(codes);};
  try{
    if(signal?.aborted)controller.abort();if(controller.signal.aborted)throw failure();
    if(security==='tls')await secure();
    else {socket=track(connect({host:config.host,port:Number(config.port)}));replies=new Replies(socket,controller.signal);await connected(socket,'connect',controller.signal);}
    await replies.take([220]);let hello=await command('EHLO go-streams.local',[250]);
    if(security==='starttls'){
      if(!/^STARTTLS\s*$/im.test(hello.text))throw failure();
      await command('STARTTLS',[220]);if(!replies.empty())throw failure();
      replies.detach();await secure(socket);hello=await command('EHLO go-streams.local',[250]);
    }
    if(config.username){
      const auth=/^AUTH[ =]([^\n]*)/im.exec(hello.text)?.[1].toUpperCase().split(/\s+/)||[];
      if(auth.includes('PLAIN')){
        const credentials=Buffer.from('\0'+config.username+'\0'+(config.password||'')).toString('base64');
        const response=await command('AUTH PLAIN '+credentials,[235,334]);if(response.code===334)await command(credentials,[235]);
      }else if(auth.includes('LOGIN')){
        await command('AUTH LOGIN',[334]);await command(Buffer.from(config.username).toString('base64'),[334]);await command(Buffer.from(config.password||'').toString('base64'),[235]);
      }else throw failure();
    }
    await command(`MAIL FROM:<${config.from}>`,[250]);await command(`RCPT TO:<${config.to}>`,[250,251]);await command('DATA',[354]);
    socket.write(data);await replies.take([250]);
    // The server has accepted the message. A failed QUIT must not turn it into a retryable failure.
    try{socket.end('QUIT\r\n');}catch{}
    return {accepted:true};
  }catch{throw failure();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);replies?.detach();destroy();}
}
