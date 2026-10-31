import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store,Vault} from '../src/core.mjs';

function fixture(t){
 const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'vault-recovery-'));
 t.after(()=>{assert.ok(directory.startsWith(parent+path.sep));assert.ok(path.basename(directory).startsWith('vault-recovery-'));fs.rmSync(directory,{recursive:true,force:true});});
 return directory;
}

test('missing vault key never creates a replacement for chat-only credentials, even without a project file',t=>{
 for(const withProject of [true,false]){
  const directory=fixture(t);if(withProject)new Store(directory);
  const vault=new Vault(directory,{portable:true}),file=path.join(directory,'chat-accounts.json');
  const original=JSON.stringify({version:1,secret:vault.encrypt(JSON.stringify({settings:{},accounts:{Twitch:{refreshToken:'PRIVATE-CHAT-REFRESH'}}}))});
  fs.writeFileSync(file,original);fs.unlinkSync(vault.file);
  for(const portable of [true,false]){
   assert.throws(()=>new Vault(directory,{portable}),error=>error.status===500&&/em falta/.test(error.message));
   assert.equal(fs.existsSync(path.join(directory,portable?'vault.key':'vault.dpapi')),false);
   assert.equal(fs.readFileSync(file,'utf8'),original);
  }
 }
});

test('missing vault key protects SMTP-only projects and leaves encrypted data intact',t=>{
 const directory=fixture(t),store=new Store(directory),vault=new Vault(directory,{portable:true});
 store.update(s=>s.notifications={enabled:false,secret:vault.encrypt('PRIVATE-SMTP-PASSWORD')});
 const original=fs.readFileSync(store.file,'utf8');fs.unlinkSync(vault.file);
 assert.throws(()=>new Vault(directory,{portable:true}),error=>error.status===500&&/em falta/.test(error.message));
 assert.equal(fs.existsSync(vault.file),false);assert.equal(fs.readFileSync(store.file,'utf8'),original);
});

test('a new project without protected credentials can still create and reopen a local vault',t=>{
 const directory=fixture(t);new Store(directory);
 const first=new Vault(directory,{portable:true}),value=first.encrypt('reopen-check');
 assert.equal(new Vault(directory,{portable:true}).decrypt(value),'reopen-check');
});
