// Real TLS handshakes over in-memory duplex streams: no ports and no external email.
import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import fs from 'node:fs';
import {Duplex} from 'node:stream';
import {sendSmtp} from '../src/smtp.mjs';
const key=fs.readFileSync(new URL('./fixtures/smtp-test-key.pem',import.meta.url));
const cert=fs.readFileSync(new URL('./fixtures/smtp-test-cert.pem',import.meta.url));
function pair(){
 let a,b;const chunks=[];
 a=new Duplex({read(){},write(chunk,encoding,done){chunks.push(Buffer.from(chunk));queueMicrotask(()=>b.push(Buffer.from(chunk)));done();},final(done){b.push(null);done();}});
 b=new Duplex({read(){},write(chunk,encoding,done){queueMicrotask(()=>a.push(Buffer.from(chunk)));done();},final(done){a.push(null);done();}});
 a.on('error',()=>{});b.on('error',()=>{});return{client:a,server:b,chunks};
}
for(const security of ['starttls','tls'])test('actual '+security+' handshake, authentication and SMTP acceptance over memory streams',{timeout:5000},async()=>{
 const sockets=[],p=pair();let received='',tlsVersion='',auth='';sockets.push(p.client,p.server);
 const secureContext=tls.createSecureContext({key,cert});
 function commands(socket,plain=false){
  let buffer='',inData=false;
  const read=chunk=>{
   buffer+=chunk.toString();
   if(inData){const end=buffer.indexOf('\r\n.\r\n');if(end>=0){received=buffer.slice(0,end);buffer=buffer.slice(end+5);inData=false;socket.write('250 accepted\r\n');}return;}
   let at;
   while((at=buffer.indexOf('\r\n'))>=0){
    const line=buffer.slice(0,at);buffer=buffer.slice(at+2);
    if(line.startsWith('EHLO'))socket.write(plain?'250-smtp.example.test\r\n250 STARTTLS\r\n':'250-smtp.example.test\r\n250 AUTH PLAIN\r\n');
    else if(line==='STARTTLS'){socket.off('data',read);socket.write('220 ready\r\n');upgrade(socket,false);return;}
    else if(line.startsWith('AUTH PLAIN ')){auth=Buffer.from(line.slice(11),'base64').toString();socket.write('235 accepted\r\n');}
    else if(line.startsWith('MAIL FROM')||line.startsWith('RCPT TO'))socket.write('250 ok\r\n');
    else if(line==='DATA'){inData=true;socket.write('354 send\r\n');}
    else if(line==='QUIT')socket.end('221 bye\r\n');
    else throw Error('Unexpected command');
   }
  };socket.on('data',read);
 }
 function upgrade(socket,greet){
  const secure=new tls.TLSSocket(socket,{isServer:true,secureContext});sockets.push(secure);secure.on('error',()=>{});commands(secure);
  secure.on('secure',()=>{tlsVersion=secure.getProtocol();if(greet)secure.write('220 smtp.example.test\r\n');});
 }
 const options={connect(){queueMicrotask(()=>{commands(p.server,true);p.client.emit('connect');p.server.write('220 smtp.example.test\r\n');});return p.client;},secureConnect(o){if(!o.socket)upgrade(p.server,true);const client=tls.connect({...o,socket:o.socket||p.client,ca:cert});return client;}};
 try{
  const result=await sendSmtp({host:'smtp.example.test',port:security==='tls'?465:587,security,username:'local',password:'ONLY-TEST-SECRET',from:'sender@example.test',to:'recipient@example.test'},{subject:'Teste português',body:'Olá, ligação TLS validada.'},undefined,{...options,timeoutMs:2000});
  assert.equal(result.accepted,true);assert.equal(auth,'\0local\0ONLY-TEST-SECRET');assert.match(tlsVersion,/TLSv1\.[23]/);
  assert.equal(Buffer.from(received.split('\r\n\r\n')[1],'base64').toString(),'Olá, ligação TLS validada.');
  const wire=Buffer.concat(p.chunks);assert.ok(!wire.includes(Buffer.from('AUTH PLAIN')));assert.ok(!wire.includes(Buffer.from('ONLY-TEST-SECRET')));
 }finally{for(const socket of sockets)socket.destroy();}
});
