import {language} from './i18n.js';
const t=(en,pt)=>language()==='pt-PT'?pt:en;

export class RecordingUpload {
 constructor(send,onError,limit=8*1024*1024){Object.assign(this,{send,onError,limit});this.pending=Promise.resolve();this.bytes=0;this.sequence=0;this.error=null;}
 push(blob){
  if(!blob.size||this.error)return;
  if(this.bytes+blob.size>this.limit){this.fail(Error(t('The disk cannot keep up. Recording stopped; received data stays available for recovery.','O disco não acompanha a gravação. A gravação parou; os dados recebidos ficam disponíveis para recuperação.')));return;}
  this.bytes+=blob.size;
  this.pending=this.pending.then(async()=>{if(!this.error)await this.send(blob,this.sequence++);}).catch(error=>this.fail(error)).finally(()=>{this.bytes-=blob.size;});
 }
 fail(error){if(this.error)return;this.error=error;this.onError(error);}
 async finish(){await this.pending;if(this.error)throw this.error;}
}
