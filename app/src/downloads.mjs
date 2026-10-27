import {sameLocalFile} from './media-paths.mjs';
import {StringDecoder} from 'node:string_decoder';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { AppError } from './errors.mjs';
import { stopProcessTree, spawnOwnedTool } from './processes.mjs';
import {probe,toolsFor,runProcess} from './core.mjs';

export function videoUrl(value) {
  let url; try { url = new URL(value); } catch { throw new AppError('Introduza um URL de vídeo válido.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtu.be'].includes(url.hostname)) throw new AppError('Utilize uma ligação HTTPS de um vídeo do YouTube.');
  const id = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(shorts|live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[2];
  if (!/^[\w-]{11}$/.test(id || '')) throw new AppError('Escolha um vídeo individual, não uma playlist ou canal.');
  return `https://www.youtube.com/watch?v=${id}`;
}
export class Downloads {
  constructor(studio, { spawnProcess = spawn } = {}) {
    this.studio = studio; this.store = studio.store; this.spawn = spawnProcess; this.active = new Map(); this.closing = false; this.manualImports=new Map();
    this.store.update(s => {
      s.downloads ||= [];
      for(const d of s.downloads)if(d.status==='completed'&&!d.path&&/^[\w-]+$/.test(d.id)){
        const previous=s.media.find(m=>m.id===d.mediaId),file=path.join(this.store.directory,'downloads',d.id,'video.mp4');
        if(fs.existsSync(file)){d.path=file;if(previous){d.duration=previous.duration;d.width=previous.width;d.height=previous.height;d.size=previous.size;}d.thumbnail=false;}
      }
      for(const d of s.downloads){
        if(d.status!=='completed'||!d.path)continue;
        const media=s.media.find(m=>m.id===d.mediaId&&!m.source);
        if(media&&!media.downloadUrl&&sameLocalFile(media.path,d.path)){
          try{media.downloadUrl=videoUrl(d.url);}catch{}
        }
      }
      for (const d of s.downloads) if (['running','validating','importing','cancelling'].includes(d.status)) { d.status = 'interrupted'; d.error = 'O download foi interrompido ao fechar a aplicação.'; }
    });
  }
  update(id, values) { this.store.update(s => { const item = s.downloads.find(d => d.id === id); if (item) Object.assign(item, values); }); }
  markImported(id,mediaId) {
    this.store.update(s=>{
      const download=s.downloads.find(d=>d.id===id),media=s.media.find(m=>m.id===mediaId);
      if(download&&media&&!media.source){download.mediaId=mediaId;media.downloadUrl=download.url;}
    });
  }
  start(input) {
    if (this.closing) throw new AppError('A aplicação está a encerrar.', 409);
    const url = videoUrl(input.url);
    if (this.active.size >= 2) throw new AppError('Aguarde um dos dois downloads em curso.', 409);
    const duplicate = this.store.data.downloads.find(d => d.url === url && (this.active.has(d.id) || (d.status === 'completed' && ((d.path&&fs.existsSync(d.path))||this.store.data.media.some(m => m.id === d.mediaId && fs.existsSync(m.path))))));
    if (duplicate || this.store.data.media.some(m=>!m.source&&m.downloadUrl===url&&fs.existsSync(m.path))) throw new AppError('Este vídeo já foi descarregado ou está em curso.', 409);
    const id = crypto.randomUUID(); const directory = path.join(this.store.directory, 'downloads', id); fs.mkdirSync(directory, { recursive: true });
    const entry = { id, url, status: 'running', progress: 0, created: new Date().toISOString(), ended: null, mediaId: null, addToLibrary:input.addToLibrary!==false, error: '' };
    this.store.update(s => { s.downloads.push(entry); });
    const op = { directory, cancelled: false, child: null }; op.done = new Promise(resolve => { op.resolve = resolve; }); this.active.set(id,op);
    const settings = this.store.data.settings;
    const args = ['--ignore-config','--no-playlist','--no-cache-dir','--no-warnings','--newline','--no-simulate','--progress','--progress-template','download:PROGRESS:%(progress._percent_str)s','--print','after_move:TITLE:%(title)s','--max-filesize','5G','--restrict-filenames','-f','bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b','--merge-output-format','mp4','--recode-video','mp4','--paths',directory,'-o','video.%(ext)s'];
    let child;
    try {
      const ffmpeg=toolsFor(settings).ffmpeg;
      if(path.isAbsolute(ffmpeg))args.push('--ffmpeg-location',path.dirname(ffmpeg));
      args.push('--no-plugin-dirs','--js-runtimes',`node:${process.execPath}`,'--no-remote-components','--',url);
      child = spawnOwnedTool(toolsFor(settings).ytdlp, args, { windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] },{spawnProcess:this.spawn}); op.child = child;
    }
    catch { this.complete(id,op,'error','Não foi possível iniciar as ferramentas de download. Extraia a aplicação completa ou reveja os caminhos nas Definições.'); return this.store.data.downloads.find(d=>d.id===id); }
    let lastProgress = -1, buffer = '', processError = false;
    op.timer = setTimeout(() => { op.timeout = true; op.killing = stopProcessTree(child); }, 6*60*60*1000);
    const decoder=new StringDecoder('utf8');
    const consume=chunk=>{
      buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop().slice(-2000);
      for (const line of lines) {
        if (line.startsWith('TITLE:')) { op.title = line.slice(6).replace(/[\x00-\x1f]/g,' ').trim().slice(0,200); this.update(id,{title:op.title}); }
        const match = /PROGRESS:\s*(\d+(?:\.\d+)?)%/.exec(line);
        if (match) { const progress = Math.max(0,Math.min(99,Math.floor(Number(match[1])))); if (progress !== lastProgress) { lastProgress = progress; this.update(id,{progress}); } }
      }
    };
    child.stdout.on('data',chunk=>consume(decoder.write(chunk)));
    child.stderr.on('data', () => {}); // Remote messages can contain signed URLs; never persist them.
    child.on('error', () => { processError = true; });
    child.on('close', code => { consume(decoder.end());if(buffer)consume('\n');this.finalize(id,op,code,processError).catch(() => this.complete(id,op,'error','Não foi possível concluir a importação do vídeo.')); });
    return entry;
  }
  async finalize(id,op,code,processError) {
    if(op.killing)op.treeStopped=await op.killing;
    op.child = null;
    if (op.cancelled || this.closing) return this.complete(id,op,'cancelled','');
    if (code !== 0 || processError || op.timeout) return this.complete(id,op,'error',processError ? 'yt-dlp indisponível. Extraia a aplicação completa ou reveja o caminho nas Definições.' : op.timeout ? 'O download excedeu seis horas.' : 'O download falhou. Verifique a ligação, a disponibilidade do vídeo e a versão do yt-dlp.');
    clearTimeout(op.timer);this.update(id,{status:'validating'});
    const output = path.join(op.directory,'video.mp4');
    if (!fs.existsSync(output)) return this.complete(id,op,'error','O download não produziu um vídeo MP4.');
    const tools=toolsFor(this.store.data.settings);let metadata;
    try{metadata=await probe(output,tools.ffprobe);}catch{return this.complete(id,op,'error','O ficheiro descarregado não contém um vídeo válido.');}
    if(op.cancelled||this.closing)return this.complete(id,op,'cancelled','');
    this.update(id,{...metadata,title:op.title||'Vídeo descarregado',thumbnail:false});
    try{await runProcess(tools.ffmpeg,['-v','error','-protocol_whitelist','file,pipe','-ss','0','-i',output,'-frames:v','1','-vf','scale=480:-2','-y',path.join(op.directory,'thumb.jpg')]);this.update(id,{thumbnail:true});}catch{}
    if(op.cancelled||this.closing)return this.complete(id,op,'cancelled','');
    if(!this.store.data.downloads.find(d=>d.id===id)?.addToLibrary)return this.complete(id,op,'completed','');
    this.update(id,{status:'importing'});
    const result = await this.studio.importMedia([output]);
    if (!result.imported.length) return this.complete(id,op,'error','O vídeo foi descarregado, mas não foi possível validá-lo.');
    if (op.title) this.studio.renameMedia(result.imported[0],op.title);
    this.markImported(id,result.imported[0]);
    return this.complete(id,op,'completed','');
  }
  complete(id,op,status,error) {
    if (!this.active.has(id)) return;
    clearTimeout(op.timer);
    this.update(id,{status,error,ended:new Date().toISOString(),...(status==='completed'?{progress:100}:{})});
    if (status !== 'completed' && op.treeStopped !== false && !this.store.data.media.some(m => path.dirname(m.path) === op.directory)) {
      const base = path.resolve(this.store.directory,'downloads') + path.sep;
      const target = path.resolve(op.directory);
      if (target.startsWith(base) && path.basename(target) === id) { try { fs.rmSync(target,{recursive:true,force:true}); } catch {} }
    }
    this.active.delete(id); op.resolve();
  }
  cancel(id) { const op = this.active.get(id); if (!op) throw new AppError('O download já terminou.',409); if(!op.child)throw new AppError('O vídeo já foi descarregado e está a terminar a importação.',409); if(op.cancelled)return; op.cancelled = true; this.update(id,{status:'cancelling'}); op.killing = stopProcessTree(op.child); }
  async addToLibrary(id) {
    if(this.closing)throw new AppError('A aplicação está a encerrar.',409);
    const d=this.store.data.downloads.find(d=>d.id===id);if(!d||d.status!=='completed'||!d.path)throw new AppError('Download indisponível.',404);
    const existing=this.store.data.media.find(m=>m.id===d.mediaId);if(existing)return {id:existing.id};
    this.importing ||= new Set();if(this.importing.has(id))throw new AppError('Aguarde a importação em curso.',409);this.importing.add(id);let resolve;const done=new Promise(r=>{resolve=r;});this.manualImports.set(id,done);
    try{const result=await this.studio.importMedia([d.path]);if(!result.imported[0])throw new AppError(result.errors[0]?.message||'Não foi possível importar o vídeo.');this.studio.renameMedia(result.imported[0],d.title||'Vídeo descarregado');this.markImported(id,result.imported[0]);return{id:result.imported[0]};}finally{this.importing.delete(id);this.manualImports.delete(id);resolve();}
  }
  file(id,thumbnail=false){
    const d=this.store.data.downloads.find(d=>d.id===id);if(!d||d.status!=='completed'||!d.path)throw new AppError('Download indisponível.',404);
    const directory=path.resolve(this.store.directory,'downloads',id),base=path.resolve(this.store.directory,'downloads')+path.sep;
    if(!directory.startsWith(base)||path.resolve(d.path)!==path.join(directory,'video.mp4'))throw new AppError('Ficheiro de download inválido.',400);
    return thumbnail?path.join(directory,'thumb.jpg'):d.path;
  }
  remove(id) { if(this.importing?.has(id))throw new AppError('Aguarde a importação terminar.',409);if(this.active.has(id))throw new AppError('Cancele o download antes de o retirar da lista.',409);if(!this.store.data.downloads.some(d=>d.id===id))throw new AppError('Download não encontrado.',404);this.store.update(s=>{s.downloads=s.downloads.filter(d=>d.id!==id);}); }
  async shutdown() { this.closing = true; const operations = [...this.active.values()]; for (const [id,op] of this.active) if(op.child)this.cancel(id); await Promise.all([...operations.map(op => op.done),...this.manualImports.values()]); }
}
