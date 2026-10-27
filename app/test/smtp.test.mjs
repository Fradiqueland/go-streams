import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {sendSmtp,mailData} from '../src/smtp.mjs';
import {validateNotifications} from '../src/notifications.mjs';
const config={host:'smtp.example.test',port:587,username:'user@example.test',password:'SECRET-PASSWORD',from:'sender@example.test',to:'recipient@example.test'};
const message={subject:'Transmissão: música 🎶',body:'Olá António\nPrimeira linha\n.\nÚltima linha'};
function transport(options={}){
 const sockets=[],writes=[],tlsOptions=[];let raw;
 class Socket extends EventEmitter{
  constructor(secure){super();this.secure=secure;this.authorized=options.authorized!==false;this.destroyed=false;this.login=0;}
  getPeerCertificate(){return{subjectaltname:'DNS:'+(options.wrongHost?'foreign.example.test':config.host)};}
  reply(text){if(options.hang)return;const chunks=options.fragment?[text.slice(0,2),text.slice(2,7),text.slice(7)]:[text];for(const c of chunks)this.emit('data',Buffer.from(c));}
  write(data){
   writes.push({secure:this.secure,data});const line=data.replace(/\r\n$/,'');
   if(line.startsWith('EHLO')){
    if(!this.secure)this.reply(options.noStarttls?'250 smtp.example.test\r\n':'250-smtp.example.test\r\n250 STARTTLS\r\n');
    else this.reply('250-smtp.example.test\r\n250-AUTH '+(options.login?'LOGIN':options.noAuth?'XOAUTH2':'PLAIN LOGIN')+'\r\n250 SIZE 100000\r\n');
   }else if(line==='STARTTLS')this.reply(options.inject?'220 ready\r\n250 forged\r\n':'220 ready\r\n');
   else if(line.startsWith('AUTH PLAIN'))this.reply(options.badAuth?'535 SECRET-PASSWORD rejected\r\n':options.challenge?'334 continue\r\n':'235 accepted\r\n');
   else if(line==='AUTH LOGIN'){this.login=1;this.reply('334 username\r\n');}
   else if(this.login===1){this.login=2;this.reply('334 password\r\n');}
   else if(this.login===2){this.login=0;this.reply('235 accepted\r\n');}
   else if(options.challenge&&line===Buffer.from('\0'+config.username+'\0'+config.password).toString('base64'))this.reply('235 accepted\r\n');
   else if(line.startsWith('MAIL FROM'))this.reply('250 sender\r\n');
   else if(line.startsWith('RCPT TO'))this.reply(options.badRecipient?'550 recipient rejected\r\n':'250 recipient\r\n');
   else if(line==='DATA')this.reply('354 data\r\n');
   else if(line.startsWith('From:'))this.reply(options.badData?'552 too large\r\n':'250 queued\r\n');
   return true;
  }
  end(data){writes.push({secure:this.secure,data});this.emit('close');}
  destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close');}}
 }
 const connectors={
  connect(){raw=new Socket(false);sockets.push(raw);queueMicrotask(()=>{raw.emit('connect');raw.reply('220 smtp.example.test\r\n');});return raw;},
  secureConnect(o){tlsOptions.push(o);const socket=new Socket(true);sockets.push(socket);queueMicrotask(()=>{if(options.certificateError){socket.emit('error',Error('SECRET-PASSWORD certificate'));return;}socket.emit('secureConnect');if(!o.socket)socket.reply('220 smtp.example.test\r\n');});return socket;}
 };
 return{connectors,sockets,writes,tlsOptions,get raw(){return raw;}};
}
for(const options of [{},{fragment:true},{login:true},{challenge:true}])test('SMTP upgrades before authentication and sends UTF-8 MIME '+JSON.stringify(options),async()=>{
 const f=transport(options);assert.deepEqual(await sendSmtp(config,message,undefined,f.connectors),{accepted:true});
 assert.deepEqual(f.writes.filter(w=>!w.secure).map(w=>w.data),['EHLO go-streams.local\r\n','STARTTLS\r\n']);
 assert.equal(f.tlsOptions[0].socket,f.raw);assert.equal(f.tlsOptions[0].rejectUnauthorized,true);assert.equal(f.tlsOptions[0].servername,config.host);assert.equal(f.tlsOptions[0].minVersion,'TLSv1.2');
 const data=f.writes.find(w=>w.data.startsWith('From:')).data;
 assert.ok(data.includes('Content-Transfer-Encoding: base64'));const body=data.split('\r\n\r\n')[1].replace(/\r\n\.\r\n$/,'');assert.equal(Buffer.from(body,'base64').toString(),message.body);
 assert.ok(f.sockets.every(s=>s.destroyed));
});
test('implicit TLS opens no cleartext socket and validates certificates',async()=>{
 const f=transport();await sendSmtp({...config,port:465,security:'tls'},message,undefined,f.connectors);
 assert.equal(f.raw,undefined);assert.ok(f.writes.every(w=>w.secure));assert.equal(f.tlsOptions[0].port,465);
 assert.equal(validateNotifications({...config,enabled:true,port:465}).security,'tls');
});
for(const options of [{noStarttls:true},{inject:true},{authorized:false},{wrongHost:true},{certificateError:true},{noAuth:true}])test('SMTP refuses insecure or unsupported session '+JSON.stringify(options),async()=>{
 const f=transport(options);await assert.rejects(sendSmtp(config,message,undefined,f.connectors),error=>!error.message.includes(config.password));
 assert.ok(!f.writes.some(w=>w.data.startsWith('AUTH')||w.data.startsWith('MAIL FROM')));assert.ok(f.sockets.every(s=>s.destroyed));
});
for(const options of [{badAuth:true},{badRecipient:true},{badData:true}])test('SMTP reports rejection without remote text or credentials '+JSON.stringify(options),async()=>{
 const f=transport(options);await assert.rejects(sendSmtp(config,message,undefined,f.connectors),error=>!error.message.includes(config.password));assert.ok(f.sockets.every(s=>s.destroyed));
});
test('deadline closes a nonresponsive connection',async()=>{
 const f=transport({hang:true});await assert.rejects(sendSmtp(config,message,undefined,{...f.connectors,timeoutMs:20}));assert.ok(f.sockets.every(s=>s.destroyed));
});
test('abort before connection creates no sockets, and abort during response closes owned sockets',async()=>{
 const f=transport({hang:true}),controller=new AbortController();controller.abort();await assert.rejects(sendSmtp(config,message,controller.signal,f.connectors));assert.equal(f.sockets.length,0);
 const other=new AbortController();const pending=sendSmtp(config,message,other.signal,f.connectors);queueMicrotask(()=>other.abort());await assert.rejects(pending);assert.ok(f.sockets.every(s=>s.destroyed));
});
test('SMTP message rejects envelope injection, bounds size and folds Unicode subjects safely',()=>{
 assert.throws(()=>mailData({...config,to:'ok@example.test\r\nBcc: bad@example.test'},message));
 assert.throws(()=>mailData(config,{...message,body:'x'.repeat(65537)}));
 const data=mailData(config,{subject:'🎶'.repeat(100)+'\r\nBcc: attacker',body:'.\r\nQUIT\r\n'});
 assert.ok(!data.includes('\r\nBcc:'));const header=data.split('Subject: ')[1].split('\r\nDate:')[0];
 for(const word of header.split(/\s+/)){assert.ok(word.length<=75);assert.ok(!Buffer.from(word.slice(10,-2),'base64').toString().includes('\uFFFD'));}
});
test('SMTP parser rejects malformed multiline replies without authentication',async()=>{
 const f=transport();const connect=f.connectors.connect;
 f.connectors.connect=()=>{const s=connect();s.reply=()=>s.emit('data',Buffer.from('220-first\r\n250 mismatched\r\n'));return s;};
 await assert.rejects(sendSmtp(config,message,undefined,f.connectors));assert.ok(!f.writes.some(w=>w.data.startsWith('AUTH')));
});
