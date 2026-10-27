import {hasOverlays,overlayArguments,overlayDefaults} from './overlays.mjs';
import {sameLocalFile,refreshManagedPaths} from './media-paths.mjs';
import {StringDecoder} from 'node:string_decoder';
import {windowsTool} from './system-tools.mjs';
import {ytdlpPath,mediaToolPath} from './tool-paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { AppError } from './errors.mjs';
import { encodingArgs } from './encoding.mjs';
import { operationSettings } from './operations.mjs';

export { AppError } from './errors.mjs';
const fail = (message, status) => { throw new AppError(message, status); };
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clone = x => structuredClone(x);
const occupied = j => ['countdown', 'starting', 'running', 'pausing', 'paused', 'retrying', 'reconfiguring', 'stopping'].includes(j.status);
// Definitive configuration/content failures must not be retried as connection loss.
function permanentMediaFailure(message) {
  return /authentication failed|unauthori[sz]ed|forbidden|server returned (?:400|401|403|404)|invalid (?:stream )?key|certificate verify failed|certificate has expired|hostname mismatch|unknown encoder|encoder .* not found|error while decoding|invalid data found|error opening input|no such file|permission denied|no space left|unsupported codec|error initializing output stream/i.test(message);
}
export function playbackPosition(media, elapsed, loop) {
  const duration = media.reduce((sum, m) => sum + m.duration, 0);
  let offset = Math.max(0, elapsed);
  if (loop && duration) offset %= duration;
  else offset = Math.min(offset, duration);
  for (let index = 0; index < media.length; index++) {
    if (offset < media[index].duration || index === media.length - 1) return { index, mediaId: media[index].id, title: media[index].title, offset, duration: media[index].duration };
    offset -= media[index].duration;
  }
  return null;
}
function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) fail(`${label}: valor inválido.`);
  return value.trim();
}
export function atomicWrite(file, value) {
  const tmp = `${file}.${id()}.tmp`;
  try {
    fs.writeFileSync(tmp, value, { mode: 0o600 });
    const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['thumbs', 'runs', 'previews']) fs.mkdirSync(path.join(directory, name), { recursive: true });
    this.file = path.join(directory, 'project.json');
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (this.data.version !== 1 || !['media', 'channels', 'playlists', 'schedules', 'history'].every(k => Array.isArray(this.data[k]))) throw Error('schema');
      } catch { fail('Os dados locais não puderam ser lidos. O ficheiro foi preservado; restaure uma cópia de segurança.', 500); }
    } else this.data = { version: 1, media: [], channels: [], playlists: [], schedules: [], history: [], settings: { ffmpeg: '', ffprobe: '' } };
    const restored=clone(this.data);refreshManagedPaths(restored,this.directory);
    if(JSON.stringify(restored)!==JSON.stringify(this.data))this.update(s=>Object.assign(s,restored));
  }
  update(fn) {
    const next = clone(this.data); const result = fn(next);
    refreshManagedPaths(next,this.directory,this.data);
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    atomicWrite(this.file, JSON.stringify(next, null, 2)); this.data = next; return result;
  }
  log(level, message, details = {}) {
    this.update(s => { s.history.unshift({ id: id(), time: now(), level, message, ...details }); s.history = s.history.slice(0, operationSettings(s.settings).historyLimit); });
  }
}

// Windows seals the master key with DPAPI for the current Windows account.
// Other platforms use a private mode-0600 key, without claiming OS-backed encryption.
export class Vault {
  constructor(directory, { portable = process.platform !== 'win32' } = {}) {
    this.file = path.join(directory, portable ? 'vault.key' : 'vault.dpapi');
    const exists = fs.existsSync(this.file);
    if (!exists && fs.existsSync(path.join(directory, 'project.json'))) {
      const saved = JSON.parse(fs.readFileSync(path.join(directory, 'project.json'), 'utf8'));
      if (saved.channels?.some(c => c.secret) || saved.notifications?.secret) fail('A chave de proteção local está em falta. Preserve os dados e restaure a cópia de segurança.', 500);
    }
    if (portable) {
      if (!exists) fs.writeFileSync(this.file, crypto.randomBytes(32), { mode: 0o600 });
      this.key = fs.readFileSync(this.file);
    } else {
      const operation = exists ? 'Unprotect' : 'Protect';
      const input = exists ? fs.readFileSync(this.file, 'utf8').trim() : crypto.randomBytes(32).toString('base64');
      const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
      const r = spawnSync(windowsTool('powershell'), ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, timeout: 20000 });
      if (r.status !== 0 || !r.stdout?.trim()) fail('Não foi possível proteger as chaves com a conta Windows. Nenhuma chave será guardada em texto simples.', 500);
      if (!exists) atomicWrite(this.file, r.stdout.trim());
      this.key = Buffer.from(exists ? r.stdout.trim() : input, 'base64');
    }
    if (this.key.length !== 32) fail('Chave local inválida.', 500);
  }
  encrypt(value) {
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    return Buffer.concat([iv, c.update(value, 'utf8'), c.final(), c.getAuthTag()]).toString('base64');
  }
  decrypt(value) {
    try { const b = Buffer.from(value, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12)); d.setAuthTag(b.subarray(-16)); return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString('utf8'); }
    catch { fail('Não foi possível ler a chave do canal nesta conta.', 500); }
  }
}
export function runProcess(command, args, { timeout = 30000, maxBytes = 4 * 1024 * 1024, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('Operação cancelada.'));
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', issue, outputBytes=0;
    const outDecoder=new StringDecoder('utf8'),errDecoder=new StringDecoder('utf8');
    const abort = () => { issue = new AppError('Operação cancelada.'); child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { issue = new AppError('A operação excedeu o tempo disponível.'); child.kill(); }, timeout);
    child.stdout.on('data', chunk => { outputBytes+=chunk.length;if(outputBytes>maxBytes){issue=new AppError('Resultado demasiado grande.');child.kill();return;}stdout+=outDecoder.write(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + errDecoder.write(chunk)).slice(-12000); });
    child.on('error', () => { issue = new AppError(`Não foi possível executar ${path.basename(command)}. Verifique as ferramentas nas definições.`); });
    child.on('close', code => { stdout+=outDecoder.end();stderr=(stderr+errDecoder.end()).slice(-12000);clearTimeout(timer); signal?.removeEventListener('abort', abort); if (issue) reject(issue); else if (code !== 0) reject(new AppError('A ferramenta não conseguiu processar este ficheiro. Verifique o formato e a integridade.')); else resolve({ stdout, stderr }); });
  });
}
export function toolsFor(settings,options) {
  // Resolve only the requested tool: a missing downloader must not disable local video playback.
  return {get ffmpeg(){return mediaToolPath('ffmpeg',settings,options);},get ffprobe(){return mediaToolPath('ffprobe',settings,options);},get ytdlp(){return ytdlpPath(settings,options);}};
}
export async function probe(file, ffprobe) {
  if (!path.isAbsolute(file) || /[\x00-\x1f]/.test(file)) fail('Escolha um caminho local absoluto válido.');
  if (!/\.(mp4|mkv|mov|webm|avi|m4v|ts)$/i.test(file)) fail('Formato não suportado. Utilize MP4, MKV, MOV, WebM, AVI, M4V ou TS.');
  let stat; try { stat = fs.statSync(file); } catch { fail('O vídeo não existe ou não está acessível.'); }
  if (!stat.isFile()) fail('O caminho não corresponde a um ficheiro.');
  const { stdout } = await runProcess(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', file]);
  let info; try { info = JSON.parse(stdout); } catch { fail('Metadados do vídeo inválidos.'); }
  const video = info.streams?.find(s => s.codec_type === 'video');
  const audio = info.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(info.format?.duration || video?.duration);
  if (!video || !(duration > 0) || !Number.isFinite(duration)) fail('É necessário um ficheiro de vídeo com duração válida.');
  const [num, den] = (video.avg_frame_rate || '0/1').split('/').map(Number);
  return { path: fs.realpathSync(file), size: stat.size, modified: stat.mtimeMs, duration, width: video.width, height: video.height, fps: den ? num / den : 0, codec: video.codec_name, pixelFormat: video.pix_fmt, timeBase: video.time_base, audio: audio ? { codec: audio.codec_name, rate: audio.sample_rate, channels: audio.channels, layout: audio.channel_layout } : null };
}
export function compatibility(media) {
  if (media.length < 2) return true;
  const signature = m => JSON.stringify([m.codec, m.width, m.height, m.fps, m.pixelFormat, m.timeBase, m.audio]);
  return media.every(m => signature(m) === signature(media[0]));
}
export function validateChannel(input, existing) {
  const name = text(input.name, 'Nome', 100); const url = text(input.url, 'Servidor RTMP', 1000);
  let parsed; try { parsed = new URL(url); } catch { fail('URL RTMP inválido.'); }
  if (!['rtmp:', 'rtmps:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash || parsed.search) fail('Indique um servidor rtmp:// ou rtmps:// sem credenciais nem parâmetros no URL.');
  const key = input.key === '' && existing ? null : text(input.key, 'Chave de transmissão', 1000);
  const links = {};
  for (const field of ['channelUrl', 'producerUrl']) {
    const value = input[field] ?? existing?.[field] ?? '';
    if (value === '') { links[field] = ''; continue; }
    let link; try { link = new URL(text(value, 'Ligação do canal', 2000)); } catch { fail('Ligação do canal inválida.'); }
    if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password) fail('Utilize uma ligação HTTP ou HTTPS sem credenciais.');
    links[field] = link.href;
  }
  return { name, url: url.replace(/\/+$/, ''), platform: ['YouTube', 'Facebook', 'Twitch', 'Instagram', 'TikTok', 'LinkedIn', 'Restream', 'Amazon Live', 'Personalizado'].includes(input.platform) ? input.platform : 'Personalizado', key, ...links };
}
export class Studio {
  constructor(store, vault, { spawnProcess = spawn, retryDelays = [3000, 10000, 30000], runMediaProcess = runProcess, runTransformProcess = runProcess, remoteSources = null } = {}) {
    this.store = store; this.vault = vault; this.jobs = new Map(); this.closing = false; this.pendingOperations = new Map();
    this.pendingImports=new Set();this.pendingPreparations=new Set();this.restartRequests=new Map();this.tickTask=null;
    this.remoteSources=remoteSources;this.runMediaProcess=runMediaProcess;this.runTransformProcess=runTransformProcess;
    this.contexts = new Map(); this.spawnProcess = spawnProcess; this.retryDelays = retryDelays;
    this.store.update(s => {
      for (const schedule of s.schedules) if (schedule.status === 'starting') schedule.status = 'interrupted';
      // Only explicitly enabled persistence keeps already-authorized pending schedules armed.
      for (const schedule of s.schedules) if (!operationSettings(s.settings).persistSchedules || schedule.status !== 'pending') schedule.armed = false;
      s.channelPlans ||= {};
    });
  }
  state() {
    const s = clone(this.store.data);
    s.channels = s.channels.map(({ secret, ...c }) => ({ ...c, hasKey: Boolean(secret) }));
    if (s.notifications) { const { secret, ...config } = s.notifications; s.notifications = { ...config, hasPassword: Boolean(secret) }; }
    return { ...s, mediaOperations:[...this.pendingOperations].map(([mediaId,op])=>({mediaId,title:op.title,kind:op.kind,phase:op.phase,started:op.started,canCancel:['probing','converting'].includes(op.phase)})), jobs: [...this.jobs.values()].map(j => this.publicJob(j)) };
  }
  publicJob(j) { const { child, secrets, timer, retryTimer, countdownTimer, manifest, completion, resolve, ...publicData } = j; const ctx = this.contexts.get(j.id); return clone({ ...publicData, queue:ctx?ctx.media.map(m=>({id:m.id,title:m.title,duration:m.duration})):[], current: ctx ? playbackPosition(ctx.media, this.playbackElapsed(j), ctx.playlist.loop) : j.current || null }); }
  playbackElapsed(job) { return Math.max(0,job.elapsed-(this.contexts.get(job.id)?.timelineBase||0)); }
  notify(job, status) { try { this.onStatus?.(this.publicJob(job),status); } catch {} }
  async probeMedia(media) {
    if(media.source) {
      if(!this.remoteSources)fail('Remote sources are not available.',503);
      const metadata=await this.remoteSources.probe(media);return {...metadata,...(media.title?{title:media.title}:{})};
    }
    return probe(media.path,toolsFor(this.store.data.settings).ffprobe);
  }
  async importRemote(input) {
    if(this.closing)fail('Remote sources are shutting down.',503);
    let resolve;const done=new Promise(r=>{resolve=r;});this.pendingImports.add(done);
    try {
      const metadata=await this.probeMedia({source:true,path:input.url});
      if(this.closing)fail('Remote sources are shutting down.',503);
      const existing=this.store.data.media.find(m=>m.source&&m.path===metadata.path);
      if(existing)return {id:existing.id};
      const media={...metadata,id:id(),title:input.title?text(input.title,'Title',200):metadata.title,added:now()};
      this.store.update(s=>s.media.push(media));return {id:media.id};
    }finally{this.pendingImports.delete(done);resolve();}
  }
  async importMedia(paths, options = {}) {
    if(this.closing)fail('A aplicação está a encerrar.',409);
    let resolve;const done=new Promise(r=>{resolve=r;});this.pendingImports.add(done);
    try{return await this.importMediaBatch(paths,options);}finally{this.pendingImports.delete(done);resolve();}
  }
  async importMediaBatch(paths, { convert = false } = {}) {
    if (this.closing) fail('A aplicação está a encerrar.', 409);
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100) fail('Selecione entre 1 e 100 vídeos.');
    const result = { imported: [], errors: [], conversionSuggested: [] }; const tools = toolsFor(this.store.data.settings);
    for (const file of paths) {
      if (this.closing) break;
      try {
        const meta = await probe(text(file, 'Caminho', 3000), tools.ffprobe);
        if (this.closing) break;
        const existing = this.store.data.media.find(m => !m.source && sameLocalFile(m.path,meta.path));
        if (existing) {
          const needs = existing.codec !== 'h264' || (existing.audio && existing.audio.codec !== 'aac') || path.extname(existing.path).toLowerCase() !== '.mp4';
          if(convert && needs) result.imported.push((await this.convertMedia(existing.id)).id);
          else {result.imported.push(existing.id);if(needs)result.conversionSuggested.push(existing.id);}
          continue;
        }
        let media = { ...meta, id: id(), title: path.basename(meta.path, path.extname(meta.path)), added: now(), thumbnail: false };
        const thumb = path.join(this.store.directory, 'thumbs', `${media.id}.jpg`);
        try { await this.runMediaProcess(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(Math.min(1, meta.duration / 2)), '-i', meta.path, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', thumb]); media.thumbnail = true; } catch { /* Metadata is still useful when thumbnail decoding fails. */ }
        // Thumbnail creation yields: another import may have committed this path meanwhile.
        const committed=this.store.data.media.find(m=>!m.source&&sameLocalFile(m.path,meta.path));
        if(this.closing||committed){try{fs.unlinkSync(thumb);}catch{}}
        if(this.closing)break;
        if(committed)media=committed;else this.store.update(s => s.media.push(media));
        const needsConversion = media.codec !== 'h264' || (media.audio && media.audio.codec !== 'aac') || path.extname(media.path).toLowerCase() !== '.mp4';
        if (convert && needsConversion) { const converted = await this.convertMedia(media.id); result.imported.push(converted.id); }
        else { result.imported.push(media.id); if (needsConversion) result.conversionSuggested.push(media.id); }
      } catch (e) { result.errors.push({ file, message: e.message }); }
    }
    return result;
  }
  saveChannel(input, channelId) {
    const existing = channelId ? this.store.data.channels.find(c => c.id === channelId) : null;
    if (channelId && !existing) fail('Canal não encontrado.', 404);
    if (this.busyChannel(channelId)) fail('Pare a transmissão antes de editar o canal.', 409);
    const valid = validateChannel(input, existing);
    if (this.store.data.channels.some(c => c.id !== channelId && c.name.toLowerCase() === valid.name.toLowerCase())) fail('Já existe um canal com esse nome.');
    if (valid.key === null && !existing.secret) fail('Configure a chave de transmissão deste canal.');
    const secretValue = valid.key === null ? this.vault.decrypt(existing.secret) : valid.key;
    if (this.store.data.channels.some(c => c.id !== channelId && c.url === valid.url && c.secret && this.vault.decrypt(c.secret) === secretValue)) fail('Este destino e chave já estão configurados noutro canal.');
    const channel = { id: existing?.id || id(), name: valid.name, url: valid.url, platform: valid.platform, channelUrl: valid.channelUrl, producerUrl: valid.producerUrl, secret: valid.key === null ? existing.secret : this.vault.encrypt(valid.key), autoRestart: input.autoRestart === undefined ? existing?.autoRestart === true : input.autoRestart === true };
    this.store.update(s => { if (existing) s.channels[s.channels.findIndex(c => c.id === channel.id)] = channel; else s.channels.push(channel); });
    return channel.id;
  }
  saveChannelPlan(channelId,input) {
    if(!this.store.data.channels.some(c=>c.id===channelId))fail('Canal não encontrado.',404);
    if(this.busyChannel(channelId))fail('Termine a emissão antes de trocar o conteúdo do canal.',409);
    const playlistId=input.playlistId||null,mediaId=input.mediaId||null;
    if(Boolean(playlistId)===Boolean(mediaId))fail('Escolha um vídeo ou uma playlist.');
    if(playlistId&&!this.store.data.playlists.some(p=>p.id===playlistId&&p.mediaIds.length))fail('Escolha uma playlist com vídeos.');
    if(mediaId&&!this.store.data.media.some(m=>m.id===mediaId))fail('Vídeo não encontrado.');
    const countdown=input.countdown??10;if(!Number.isInteger(countdown)||countdown<0||countdown>120)fail('Contagem inválida.');
    const plan={playlistId,mediaId,quality:input.quality==='1080p'?'1080p':'720p',countdown,endOnVideoFailure:input.endOnVideoFailure!==false,pauseOnDisconnect:input.pauseOnDisconnect!==false,autoReconnect:input.autoReconnect===true,autoRestart:input.autoRestart===undefined?undefined:input.autoRestart===true};
    this.store.update(s=>{s.channelPlans||={};s.channelPlans[channelId]=plan;});return plan;
  }
  async startChannelPlan(channelId,{confirmed=false}={}) {
    const plan=this.store.data.channelPlans?.[channelId];if(!plan)fail('Prepare primeiro o conteúdo deste canal.');
    return this.start({...plan,channelIds:[channelId],confirmed});
  }
  renamePlaylist(playlistId,name) {
    const value=text(name,'Nome',100);
    if(!this.store.data.playlists.some(p=>p.id===playlistId))fail('Playlist não encontrada.',404);
    this.store.update(s=>{s.playlists.find(p=>p.id===playlistId).name=value;});
    for(const job of this.jobs.values())if(job.playlistId===playlistId&&occupied(job)){
      job.playlistName=value;const ctx=this.contexts.get(job.id);if(ctx)ctx.playlist.name=value;
    }
    return {id:playlistId};
  }
  savePlaylist(input, playlistId) {
    if (playlistId && !this.store.data.playlists.some(p => p.id === playlistId)) fail('Playlist não encontrada.', 404);
    if ([...this.jobs.values()].some(j => j.playlistId === playlistId && occupied(j))) fail('Pare a transmissão antes de editar a playlist.', 409);
    const name = text(input.name, 'Nome', 100);
    if (!Array.isArray(input.mediaIds) || input.mediaIds.length > 500 || input.mediaIds.some(i => !this.store.data.media.some(m => m.id === i))) fail('Lista de vídeos inválida.');
    if (playlistId && !input.mediaIds.length && this.store.data.schedules.some(s => s.playlistId === playlistId && ['pending','starting'].includes(s.status))) fail('A playlist agendada precisa de pelo menos um vídeo. Altere primeiro o agendamento.', 409);
    const item = { id: playlistId || id(), name, mediaIds: input.mediaIds, loop: input.loop === true, quality: input.quality === '1080p' ? '1080p' : '720p' };
    this.store.update(s => { const index = s.playlists.findIndex(p => p.id === item.id); if (index < 0) s.playlists.push(item); else s.playlists[index] = item; if(!item.mediaIds.length)for(const [cid,plan] of Object.entries(s.channelPlans||{}))if(plan.playlistId===item.id)delete s.channelPlans[cid]; }); return item.id;
  }
  remove(collection, itemId, {detachFromPlaylists=false}={}) {
    if (!['media', 'channels', 'playlists', 'schedules'].includes(collection)) fail('Coleção inválida.');
    if (!this.store.data[collection].some(x => x.id === itemId)) fail('Item não encontrado.', 404);
    if (collection === 'media' && (this.pendingOperations.has(itemId)||[...this.jobs.values()].some(j => occupied(j) && (j.mediaId === itemId || (j.playlistId&&this.store.data.playlists.find(p=>p.id===j.playlistId)?.mediaIds.includes(itemId)) || this.contexts.get(j.id)?.media.some(m=>m.id===itemId)||this.contexts.get(j.id)?.reconfiguration?.reservedIds?.includes(itemId))))) fail('O vídeo está em utilização.',409);
    if (collection === 'media' && this.store.data.schedules.some(s => s.mediaId === itemId && ['pending','starting'].includes(s.status))) fail('Remova primeiro os agendamentos deste vídeo.',409);
    if (collection === 'media' && !detachFromPlaylists && this.store.data.playlists.some(p => p.mediaIds.includes(itemId))) fail('Retire o vídeo das playlists antes de o remover.', 409);
    if (collection === 'channels' && this.busyChannel(itemId)) fail('O canal tem uma transmissão ativa.', 409);
    if (collection === 'playlists' && [...this.jobs.values()].some(j => j.playlistId === itemId && occupied(j))) fail('A playlist está em utilização.', 409);
    if (['playlists', 'channels'].includes(collection) && this.store.data.schedules.some(s => ['pending', 'starting'].includes(s.status) && (s.playlistId === itemId || s.channelIds.includes(itemId)))) fail('Remova primeiro os agendamentos associados.', 409);
    if (collection === 'schedules' && this.store.data.schedules.find(s => s.id === itemId)?.status === 'starting') fail('O agendamento está a iniciar.', 409);
    if(collection==='media'&&detachFromPlaylists){
      const emptyIds=this.store.data.playlists.filter(p=>p.mediaIds.includes(itemId)&&p.mediaIds.every(mid=>mid===itemId)).map(p=>p.id);
      if(this.store.data.schedules.some(s=>['pending','starting'].includes(s.status)&&emptyIds.includes(s.playlistId)))fail('A remoção deixaria uma playlist agendada sem vídeos. Altere primeiro o agendamento.',409);
    }
    this.store.update(s => { if(collection==='media'&&detachFromPlaylists){for(const p of s.playlists)p.mediaIds=p.mediaIds.filter(mid=>mid!==itemId);} s[collection] = s[collection].filter(x => x.id !== itemId); for(const [cid,plan] of Object.entries(s.channelPlans||{}))if((collection==='channels'&&cid===itemId)||(collection==='media'&&plan.mediaId===itemId)||(collection==='playlists'&&plan.playlistId===itemId)||(collection==='media'&&detachFromPlaylists&&plan.playlistId&&!s.playlists.find(p=>p.id===plan.playlistId)?.mediaIds.length))delete s.channelPlans[cid]; });
    // Removing a library entry never deletes the user's original media.
  }
  renameMedia(mediaId, title) {
    const value = text(title, 'Título', 200);
    if (!this.store.data.media.some(m => m.id === mediaId)) fail('Vídeo não encontrado.', 404);
    this.store.update(s => { s.media.find(m => m.id === mediaId).title = value; });
  }
  async importProject(input) {
    if (this.closing) fail('A aplicação está a encerrar.', 409);
    if (this.importingProject) fail('Já existe uma importação de projeto em curso.', 409);
    if (input?.version !== 1) fail('Formato de projeto não suportado.');
    for (const key of ['media', 'channels', 'playlists', 'schedules']) {
      if (!Array.isArray(input[key]) || input[key].length > 1000) fail(`Lista ${key} inválida ou demasiado grande.`);
      const ids = input[key].map(x => x?.id);
      if (ids.some(x => typeof x !== 'string' || !/^[\w-]{1,100}$/.test(x)) || new Set(ids).size !== ids.length) fail(`Identificadores inválidos em ${key}.`);
    }
    this.importingProject = true;
    let finishImport;const done=new Promise(resolve=>{finishImport=resolve;});this.pendingImports.add(done);
    try {
      // Validate everything before touching the store. Source paths are probed again;
      // exported metadata, schedules, secrets and executable paths are not trusted.
      const media = [];
      for (const item of input.media) {
        const title = text(item.title, 'Título', 200);
        const metadata = await this.probeMedia({path:text(item.path, 'Caminho', 4000),source:item.source});
        if (this.closing) fail('Importação cancelada.');
        media.push({ ...metadata, id: item.id, title, thumbnail: false, added: now() });
      }
      const channels = input.channels.map(c => {
        if (c.secret || c.key) fail('Importe apenas projetos exportados sem chaves de transmissão.');
        const { key, ...valid } = validateChannel({ ...c, key: 'validation-only' });
        return { ...valid, id: c.id, secret: '', autoRestart:c.autoRestart===true };
      });
      const mediaIds = new Set(media.map(m => m.id)), channelIds = new Set(channels.map(c => c.id));
      const playlists = input.playlists.map(p => {
        if (!Array.isArray(p.mediaIds) || p.mediaIds.length > 500 || p.mediaIds.some(mid => !mediaIds.has(mid))) fail('O projeto contém uma playlist com referências inválidas.');
        return { id: p.id, name: text(p.name, 'Nome da playlist', 100), mediaIds: p.mediaIds, loop: p.loop === true, quality: p.quality === '1080p' ? '1080p' : '720p' };
      });
      const playlistIds = new Set(playlists.map(p => p.id));
      const schedules = input.schedules.map(s => {
        if (!(s.mediaId ? mediaIds.has(s.mediaId) && !s.playlistId : playlistIds.has(s.playlistId)) || !Array.isArray(s.channelIds) || !s.channelIds.length || new Set(s.channelIds).size !== s.channelIds.length || s.channelIds.some(cid => !channelIds.has(cid))) fail('O projeto contém um agendamento com referências inválidas.');
        const date = new Date(s.at); if (!Number.isFinite(date.getTime())) fail('Data de agendamento inválida.');
        const timeZone = s.timeZone || 'UTC';
        try { if (typeof timeZone !== 'string') throw Error(); new Intl.DateTimeFormat('pt-PT', { timeZone }); } catch { fail('Fuso horário inválido.'); }
        return { id: s.id, playlistId: s.playlistId || null, mediaId:s.mediaId || null, quality:s.quality==='1080p'?'1080p':'720p', autoRestart:s.autoRestart===undefined?undefined:s.autoRestart===true,pauseOnDisconnect:s.pauseOnDisconnect===true, channelIds: s.channelIds, at: date.toISOString(), timeZone, autoReconnect: s.autoReconnect === true, endOnVideoFailure: s.endOnVideoFailure !== false, status: date.getTime() > Date.now() ? 'pending' : 'missed', armed: false, created: now(), error: '' };
      });
      const plans=Object.entries(input.channelPlans||{}).map(([cid,p])=>{
        if(!p||typeof p!=='object'||!channelIds.has(cid)||Boolean(p.playlistId)===Boolean(p.mediaId)||(p.mediaId&&!mediaIds.has(p.mediaId))||(p.playlistId&&!playlistIds.has(p.playlistId)))fail('Preparação de canal inválida no projeto.');
        const countdown=p.countdown??10;if(!Number.isInteger(countdown)||countdown<0||countdown>120)fail('Contagem inválida no projeto.');
        return[cid,{playlistId:p.playlistId||null,mediaId:p.mediaId||null,quality:p.quality==='1080p'?'1080p':'720p',countdown,endOnVideoFailure:p.endOnVideoFailure!==false,autoRestart:p.autoRestart===undefined?undefined:p.autoRestart===true,autoReconnect:p.autoReconnect===true,pauseOnDisconnect:p.pauseOnDisconnect!==false}];
      });
      if (this.closing) fail('Importação cancelada.');
      return this.store.update(state => {
        const result = { media: 0, channels: 0, playlists: playlists.length, schedules: schedules.length };
        const maps = { media: new Map(), channels: new Map(), playlists: new Map() };
        const unique = (name, collection) => {
          let candidate = name, suffix = 1;
          while (collection.some(x => x.name.toLowerCase() === candidate.toLowerCase())) candidate = `${name.slice(0,80)} (importado ${suffix++})`;
          return candidate;
        };
        for (const m of media) {
          const existing = state.media.find(x => (m.source ? x.source && x.path === m.path : !x.source && sameLocalFile(x.path,m.path)));
          const newId = existing?.id || id(); maps.media.set(m.id, newId);
          if (!existing) { state.media.push({ ...m, id: newId }); result.media++; }
        }
        for (const c of channels) {
          const existing = state.channels.find(x => x.name.toLowerCase() === c.name.toLowerCase() && x.url === c.url);
          const newId = existing?.id || id(); maps.channels.set(c.id, newId);
          if (!existing) { state.channels.push({ ...c, id: newId, name: unique(c.name, state.channels) }); result.channels++; }
        }
        for (const p of playlists) {
          const newId = id(); maps.playlists.set(p.id, newId);
          state.playlists.push({ ...p, id: newId, name: unique(p.name, state.playlists), mediaIds: p.mediaIds.map(mid => maps.media.get(mid)) });
        }
        for (const s of schedules) state.schedules.push({ ...s, id: id(), playlistId: maps.playlists.get(s.playlistId) || null, mediaId:maps.media.get(s.mediaId) || null, channelIds: s.channelIds.map(cid => maps.channels.get(cid)) });
        state.channelPlans||={};for(const [cid,p] of plans){const target=maps.channels.get(cid);if(!state.channelPlans[target])state.channelPlans[target]={...p,playlistId:maps.playlists.get(p.playlistId)||null,mediaId:maps.media.get(p.mediaId)||null};}
        return result;
      });
    } finally { this.importingProject = false;this.pendingImports.delete(done);finishImport(); }
  }
  busyChannel(channelId) { return channelId && [...this.jobs.values()].some(j => j.channelId === channelId && occupied(j)); }
  selection(playlistId, channelIds, preview, { allowBusy = false, mediaId, quality } = {}) {
    if (this.closing) fail('A aplicação está a encerrar.', 409);
    if (playlistId && mediaId) fail('Escolha uma playlist ou um vídeo, não ambos.');
    const direct = mediaId && this.store.data.media.find(m => m.id === mediaId);
    const playlist = mediaId ? (direct && {id:null,name:direct.title,mediaIds:[mediaId],loop:false,quality:quality==='1080p'?'1080p':'720p'}) : this.store.data.playlists.find(p => p.id === playlistId);
    if (!playlist?.mediaIds.length) fail('Escolha uma playlist com vídeos.');
    const media = playlist.mediaIds.map(mid => this.store.data.media.find(m => m.id === mid));
    if (media.some(m => !m)) fail('A playlist contém vídeos indisponíveis.');
    if (!preview && (!Array.isArray(channelIds) || channelIds.length < 1 || new Set(channelIds).size !== channelIds.length)) fail('Escolha pelo menos um canal, sem repetir destinos.');
    const channels = preview ? [{ id: null, name: 'Teste local', url: '', secret: '' }] : channelIds.map(cid => this.store.data.channels.find(c => c.id === cid));
    if (channels.some(c => !c)) fail('Canal não encontrado.');
    if (!preview && channels.some(c => !c.secret)) fail('Configure as chaves dos canais antes de transmitir.');
    if (!allowBusy && channels.some(c => this.busyChannel(c.id))) fail('Um dos canais já está a transmitir.', 409);
    return { playlist: clone(playlist), media: clone(media), channels: clone(channels) };
  }
  async start({ playlistId, mediaId, quality, channelIds = [], preview = false, confirmed = false, autoReconnect = false, endOnVideoFailure = true, autoRestart, countdown = 0, pauseOnDisconnect = false, scheduleId = null }) {
    if (!preview && confirmed !== true) fail('Confirme explicitamente o início da transmissão.');
    if (!Number.isInteger(countdown) || countdown < 0 || countdown > 120) fail('A contagem deve estar entre 0 e 120 segundos.');
    const selected = this.selection(playlistId, channelIds, preview, {mediaId,quality});
    const limit = operationSettings(this.store.data.settings).maxConcurrent;
    if (limit && [...this.jobs.values()].filter(occupied).length + selected.channels.length > limit) fail(`O limite configurado é de ${limit} transmissões ou testes simultâneos. Altere-o em Definições.`, 409);
    const jobs = selected.channels.map(c => {
      const job = { id: id(), scheduleId, playlistId: playlistId || null, mediaId: mediaId || null, quality: selected.playlist.quality, playlistName: selected.playlist.name, channelId: c.id, channelName: c.name, preview, status: 'starting', started: now(), ended: null, elapsed: 0, frame: 0, fps: 0, bitrate: '', error: '', output: null, child: null, secrets: [] };
      job.completion = new Promise(resolve => { job.resolve = resolve; });
      job.autoReconnect = !preview && autoReconnect === true; job.retries = 0; job.nextRetry = null;
      job.endOnVideoFailure = endOnVideoFailure !== false; job.skippedVideos = [];
      job.platform = c.platform || 'Local'; job.autoRestart = !preview && (autoRestart === undefined ? c.autoRestart === true || selected.playlist.loop : autoRestart === true);
      job.pauseOnDisconnect = !preview && pauseOnDisconnect === true; job.countdownUntil = null;
      this.jobs.set(job.id, job); return job;
    });
    // Reserve all destinations before asynchronous probing to prevent duplicate starts.
    let finishPreparation;const prepared=new Promise(resolve=>{finishPreparation=resolve;});this.pendingPreparations.add(prepared);
    try {
      const current = [];
      const tools = toolsFor(this.store.data.settings);
      const available = [];
      for (const m of selected.media) {
        if(this.closing||jobs.every(j=>j.ended))return jobs.map(j=>this.publicJob(j));
        try { const meta = await this.probeMedia(m); current.push(meta); available.push(m); }
        catch (error) { if(this.closing||jobs.every(j=>j.ended))return jobs.map(j=>this.publicJob(j));if (endOnVideoFailure !== false || preview) throw error; for (const j of jobs) j.skippedVideos.push({ id: m.id, title: m.title }); }
        if(this.closing||jobs.every(j=>j.ended))return jobs.map(j=>this.publicJob(j));
      }
      if (!available.length) fail('Nenhum vídeo da playlist está disponível para transmitir.');
      selected.media = available; selected.playlist.mediaIds = available.map(m => m.id);
      if (!compatibility(current) && selected.media.some(m=>m.source)) fail('Remote playlist videos must have matching formats. Use matching MP4 sources or a single video.');
      if (!compatibility(current)) fail('Os vídeos desta playlist têm formatos diferentes. Normalize-os em Ferramentas antes de transmitir.');
      if (!preview) for (const channel of selected.channels) this.vault.decrypt(channel.secret);
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (this.closing || job.ended || job.status === 'stopping') { this.finish(job, 'stopped'); continue; }
        const ctx = { playlist: {...selected.playlist,name:job.playlistName,loop:job.autoRestart}, media: selected.media.map((m, index) => ({ ...m, ...current[index] })), channel: selected.channels[i], command: tools.ffmpeg, encoding: clone(this.store.data.settings.encoding || null),overlays:clone(this.store.data.settings.overlays||overlayDefaults) };
        this.contexts.set(job.id, ctx);
        if (!preview && countdown > 0) {
          job.status='countdown'; job.countdownUntil=new Date(Date.now()+countdown*1000).toISOString();
          job.countdownTimer=setTimeout(()=>{
            job.countdownTimer=null; job.countdownUntil=null;
            if(this.closing || job.ended || job.status!=='countdown') return;
            try { this.launch(job,ctx.playlist,ctx.media,ctx.channel,ctx.command); }
            catch { this.finish(job,'error','Não foi possível iniciar o motor.'); }
          },countdown*1000);
        } else this.launch(job, ctx.playlist, ctx.media, ctx.channel, ctx.command);
      }
      return jobs.map(j => this.publicJob(j));
    } catch (e) {
      for (const job of jobs) { if (job.child) this.stop(job.id); else this.finish(job, 'error', e.message); }
      await Promise.all(jobs.map(job => job.completion)); throw e;
    } finally {this.pendingPreparations.delete(prepared);finishPreparation();}
  }
  launch(job, playlist, media, channel, command) {
    const baseElapsed = job.elapsed;
    const totalDuration = media.reduce((sum, m) => sum + m.duration, 0);
    const logicalElapsed=this.playbackElapsed(job);
    const seek = playlist.loop ? logicalElapsed % totalDuration : logicalElapsed;
    if (!playlist.loop && seek >= totalDuration) { this.finish(job, 'completed'); return; }
    if(!job.broadcastStarted) job.broadcastStarted=now();
    job.status = 'starting'; job.nextRetry = null; job.error = ''; job.frame = 0; job.fps = 0;
    const manifest = path.join(this.store.directory, 'runs', `${job.id}.txt`); job.manifest = manifest;
    const remote=media.some(m=>m.source);
    const contents = media.map(m => {
      const input=m.source?this.remoteSources.input(m):m.path.replaceAll('\\','/');
      const options=m.source?'\noption protocol_whitelist http,tcp\noption format_whitelist mov\noption rw_timeout 15000000\noption reconnect 1\noption reconnect_streamed 1\noption reconnect_delay_max 3\noption reconnect_max_retries 3\noption reconnect_delay_total_max 15':'\noption protocol_whitelist file,pipe';
      return `file '${input.replaceAll("'", "'\\''")}'`+(remote?`\nduration ${m.duration}${options}`:'');
    }).join('\n');
    fs.writeFileSync(manifest, contents, { mode: 0o600 });
    const context=this.contexts.get(job.id),overlays=context?.overlays||overlayDefaults,overlayEnabled=hasOverlays(overlays);
    const encoding=overlayEnabled&&context?.encoding?{...context.encoding,copy:false}:context?.encoding;
    const encoded = encodingArgs(encoding, playlist.quality, media, { preview: job.preview });
    job.encoding = encoded.profile;
    const args = ['-hide_banner', '-loglevel', 'warning', '-progress', 'pipe:1', '-stats_period', '1', '-re'];
    if (!encoded.profile.copy) args.push('-xerror');
    if (playlist.loop && !job.preview) args.push('-stream_loop', '-1');
    if (seek > 0) args.push('-ss', seek.toFixed(6));
    args.push('-protocol_whitelist', remote?'file,http,tcp':'file,pipe', '-f', 'concat', '-safe', '0', '-i', manifest);
    if (encoded.needsSilence) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    if(overlayEnabled){
      const vf=encoded.args.indexOf('-vf'),filter=encoded.args[vf+1];
      const plan=overlayArguments(overlays,this.store.directory,playlist.quality,encoded.profile.aspect,filter,encoded.needsSilence?2:1);
      const outputArgs=[...encoded.args];outputArgs.splice(vf,2);outputArgs[outputArgs.indexOf('0:v:0')]='['+plan.output+']';
      args.push(...plan.inputs,'-filter_complex_threads','1','-filter_complex',plan.filter,...outputArgs);
    }else args.push(...encoded.args);
    if (job.preview) {
      job.output = `${job.id}.mp4`;
      args.push('-t', '8', '-movflags', '+faststart', '-y', path.join(this.store.directory, 'previews', job.output));
    } else {
      const secret = this.vault.decrypt(channel.secret); const target = `${channel.url}/${secret}`;
      job.secrets = [secret, target, channel.url];
      args.push('-rw_timeout', '15000000', '-f', 'flv', target);
    }
    const child = this.spawnProcess(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); job.child = child;
    let buffer = '', stderr = '', failure = '';
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop().slice(-4000);
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'frame') { job.frame = Number(value) || 0; if (job.frame > 0 && job.status === 'starting') { job.status = 'running'; this.notify(job,'running'); } }
        if (key === 'fps') job.fps = Number(value) || 0;
        if (key === 'bitrate') job.bitrate = value?.trim() || '';
        if (key === 'out_time_us' && Number.isFinite(Number(value))) { const previous=job.elapsed; job.elapsed=Math.max(job.elapsed,baseElapsed+Math.max(0,Number(value)||0)/1000000); this.recordProgress(job,previous,job.elapsed); }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16000); });
    child.on('error', () => { failure = 'Não foi possível iniciar o FFmpeg. Verifique as definições.'; });
    child.on('close', code => {
      if (job.child !== child || job.ended) return;
      if (job.timer) { clearTimeout(job.timer); job.timer = null; }
      job.child = null; job.fps=0; job.bitrate='';
      const permanent=Boolean(failure)||permanentMediaFailure(stderr);
      const stopped = job.status === 'stopping';
      let message = failure || (code !== 0 ? stderr.slice(-3000) || 'O FFmpeg terminou com erro.' : '');
      for (const secret of job.secrets.sort((a, b) => b.length - a.length)) message = message.split(secret).join('[oculto]');
      message = message.replace(/https?:\/\/[^\s'"]+/gi, '[source hidden]');
      message = message.replace(/rtmps?:\/\/\S+/gi, '[destino oculto]');
      if(job.status==='reconfiguring') { this.applyReconfiguration(job); return; }
      if (job.status === 'pausing') { job.status = 'paused'; job.secrets = []; this.notify(job,'paused'); return; }
      if (!stopped && code !== 0 && !job.preview && !job.endOnVideoFailure && !this.closing && /Error while decoding|Error opening input|Invalid data found when processing input/i.test(stderr)) {
        const failed = playbackPosition(media,this.playbackElapsed(job),playlist.loop);
        const remaining = playlist.loop ? media.filter((_,index)=>index!==failed.index) : media.slice(failed.index+1);
        if (remaining.length) {
          job.skippedVideos.push({id:media[failed.index].id,title:media[failed.index].title});
          this.flushVideo(job,'error',message); this.contexts.get(job.id).timelineBase=job.elapsed; job.secrets=[];
          const updated = {...playlist,mediaIds:remaining.map(m=>m.id)};
          Object.assign(this.contexts.get(job.id),{playlist:updated,media:remaining});
          try { this.launch(job,updated,remaining,channel,command); } catch { this.finish(job,'error','Não foi possível avançar para o vídeo seguinte.'); }
          return;
        }
      }
      if (!stopped && (code !== 0 || failure) && !permanent && job.autoReconnect && !this.closing && job.retries < this.retryDelays.length) {
        const delay = this.retryDelays[job.retries++];
        job.status = 'retrying'; job.error = message; job.secrets = []; job.nextRetry = new Date(Date.now() + delay).toISOString();
        this.notify(job,'retrying');
        try { this.store.log('warning', `A recuperar ligação: ${job.channelName}`, { jobId: job.id, playlist: job.playlistName, detail: `Tentativa ${job.retries}/${this.retryDelays.length}. ${message}` }); } catch {}
        job.retryTimer = setTimeout(() => {
          job.retryTimer = null;
          if (job.status !== 'retrying' || this.closing) return;
          try { this.launch(job, playlist, media, channel, command); } catch { this.finish(job, 'error', 'Não foi possível reiniciar o motor.'); }
        }, delay);
        return;
      }
      if (!stopped && code !== 0 && !permanent && job.pauseOnDisconnect && !this.closing && /connection|network|broken pipe|timed? out|i.o error|end of file/i.test(stderr)) {
        job.status='paused'; job.pauseReason='network'; job.error=message; job.secrets=[]; job.nextRetry=null; this.notify(job,'paused'); return;
      }
      this.finish(job, stopped ? 'stopped'  : code === 0 && !failure ? 'completed' : 'error', stopped ? '' : message);
    });
  }
  recordProgress(job, from, to) {
    const ctx=this.contexts.get(job.id); if(!ctx || to<=from) return;
    const total=ctx.media.reduce((sum,m)=>sum+m.duration,0); if(!total) return;
    from-=ctx.timelineBase||0;to-=ctx.timelineBase||0;
    let cursor=Math.max(0,from); const limit=ctx.playlist.loop?to:Math.min(to,total);
    while(cursor<limit-0.000001) {
      const position=playbackPosition(ctx.media,cursor,ctx.playlist.loop);
      const cycle=(ctx.cycleOffset||0)+(ctx.playlist.loop?Math.floor(cursor/total):0), token=cycle+':'+position.index;
      if(ctx.videoRecord && ctx.videoRecord.token!==token) this.flushVideo(job,'completed');
      if(!ctx.videoRecord) ctx.videoRecord={token,videoId:position.mediaId,video:position.title,sequence:position.index+1,cycle:cycle+1,started:now(),elapsed:0};
      const amount=Math.min(limit-cursor,position.duration-position.offset);
      if(amount<=0.000001) break;
      ctx.videoRecord.elapsed+=amount; cursor+=amount;
      if(position.offset+amount>=position.duration-0.000001) this.flushVideo(job,'completed');
    }
  }
  flushVideo(job,result,detail='') {
    const ctx=this.contexts.get(job.id), record=ctx?.videoRecord;
    if(!record) return; ctx.videoRecord=null;
    const {token,...fields}=record;
    try { this.store.log(result==='error'?'error':'info','Vídeo: '+record.video,{kind:'video',jobId:job.id,channel:job.channelName,platform:job.platform,playlist:job.playlistName,...fields,ended:now(),result,detail}); } catch { job.logError=true; }
  }
  finish(job, status, error = '') {
    if (job.ended) return;
    if (job.countdownTimer) clearTimeout(job.countdownTimer);
    job.countdownTimer=null; job.countdownUntil=null;
    this.flushVideo(job,status,error);
    if (job.timer) clearTimeout(job.timer);
    if (job.retryTimer) clearTimeout(job.retryTimer);
    job.current = this.publicJob(job).current;
    this.contexts.get(job.id)?.reconfiguration?.resolve(false);
    this.contexts.delete(job.id);
    job.status = status; job.ended = now(); job.error = error; job.nextRetry = null;
    if (job.manifest) { try { fs.unlinkSync(job.manifest); } catch {} }
    job.child = null; job.secrets = [];
    this.notify(job,status);
    try { this.store.log(status === 'error' ? 'error' : 'info', `${job.preview ? 'Teste local' : 'Transmissão'}: ${job.channelName} - ${status}`, { kind:'session', preview:job.preview, platform:job.platform, autoRestart:job.autoRestart, channelId:job.channelId, jobId: job.id, playlist: job.playlistName, channel: job.channelName, started: job.broadcastStarted || job.started, ended: job.ended, elapsed: job.elapsed, result: status, retries: job.retries, detail: error }); }
    catch { job.error += ' Não foi possível guardar o histórico.'; }
    job.resolve();
    const completed = [...this.jobs.values()].filter(j => j.ended);
    for (const old of completed.slice(0, Math.max(0, completed.length - 50))) {
      if (old.preview && old.output) { try { fs.unlinkSync(path.join(this.store.directory, 'previews', old.output)); } catch {} }
      this.jobs.delete(old.id);
    }
  }
  stop(jobId, {preserveRestart=false}={}) {
    if(!preserveRestart&&this.restartRequests.has(jobId))this.restartRequests.get(jobId).cancelled=true;
    const job = this.jobs.get(jobId); if (!job) fail('Sessão não encontrada.', 404);
    if (!occupied(job)) return;
    if (job.status === 'stopping') return;
    job.status = 'stopping';
    if (job.child) this.interrupt(job);
    else this.finish(job, 'stopped');
  }
  interrupt(job) {
    if (job.timer) clearTimeout(job.timer);
    const child=job.child;if(!child)return;
    const terminate=()=>{if(job.child===child&&!job.ended){try{child.kill();}catch{}}};
    // Install the timer before writing: close may be emitted synchronously.
    job.timer=setTimeout(terminate,5000);
    try{if(child.stdin.destroyed||child.stdin.writableEnded)terminate();else child.stdin.write('q\n');}catch{terminate();}
  }
  pause(jobId) {
    const job = this.jobs.get(jobId); if (!job) fail('Sessão não encontrada.', 404);
    if (job.preview || !['starting', 'running', 'retrying'].includes(job.status) || !this.contexts.has(job.id)) fail('Esta sessão não pode ser pausada.', 409);
    if (job.retryTimer) { clearTimeout(job.retryTimer); job.retryTimer = null; }
    job.nextRetry = null;
    if (job.child) { job.status = 'pausing'; this.interrupt(job); }
    else job.status = 'paused';
  }
  resume(jobId, confirmed) {
    if (this.closing) fail('A aplicação está a encerrar.', 409);
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'paused') fail('A sessão não está pausada.', 409);
    if (confirmed !== true) fail('Confirme a retoma da transmissão.');
    const ctx = this.contexts.get(job.id); job.pauseReason=null; job.retries=0;
    try { this.launch(job, ctx.playlist, ctx.media, ctx.channel, ctx.command); }
    catch { this.finish(job, 'error', 'Não foi possível retomar o motor.'); }
    return this.publicJob(job);
  }
  async reconfigure(jobId,input) {
    const job=this.jobs.get(jobId),ctx=this.contexts.get(jobId);
    if(!job||job.preview||!ctx||!['running','starting','paused','retrying'].includes(job.status))fail('Esta sessão não pode ser alterada agora.',409);
    if(ctx.reconfiguration)fail('Já existe uma alteração em curso.',409);
    const queue=input.mediaIds;
    if(queue!==undefined && (!job.playlistId||!Array.isArray(queue)||!queue.length||queue.length>500))fail('Fila inválida. Escolha entre 1 e 500 vídeos.');
    if(queue!==undefined && ['Facebook','Restream'].includes(job.platform))fail('A atualização de fila durante a emissão não está disponível neste perfil. Termine a emissão para trocar a sequência.',409);
    const needsReconnect=queue!==undefined||(input.autoRestart!==undefined&&input.autoRestart!==job.autoRestart);
    if(needsReconnect&&input.confirmed!==true)fail('Confirme a atualização: será aberta uma nova ligação preservando a posição.');
    for(const key of ['autoRestart','endOnVideoFailure','autoReconnect','pauseOnDisconnect'])if(input[key]!==undefined&&typeof input[key]!=='boolean')fail('Política inválida.');
    if(!needsReconnect){
      for(const key of ['endOnVideoFailure','autoReconnect','pauseOnDisconnect'])if(input[key]!==undefined)job[key]=input[key];
      if(input.autoReconnect===false&&job.status==='retrying'){if(job.retryTimer)clearTimeout(job.retryTimer);job.retryTimer=null;job.nextRetry=null;job.status='paused';this.notify(job,'paused');}
      return this.publicJob(job);
    }
    let resolve;const done=new Promise(r=>{resolve=r;});const op={resolve,done,input,reservedIds:queue?[...queue]:ctx.media.map(m=>m.id),wasPaused:job.status==='paused'};ctx.reconfiguration=op;
    let finishValidation;const validating=new Promise(resolve=>{finishValidation=resolve;});this.pendingPreparations.add(validating);
    try {
      const candidate=queue?queue.map(mid=>this.store.data.media.find(m=>m.id===mid)):ctx.media;
      if(candidate.some(m=>!m))fail('A fila contém vídeos indisponíveis.');
      const fresh=[];for(const m of candidate){fresh.push({...m,...await this.probeMedia(m)});if(job.ended||this.closing||!['running','starting','paused','retrying'].includes(job.status))fail('A sessão mudou durante a validação. Tente novamente.',409);}
      if(!compatibility(fresh))fail('Normalize os vídeos da fila para o mesmo formato antes de aplicar.');
      if(job.ended||this.closing||!['running','starting','paused','retrying'].includes(job.status))fail('A sessão mudou durante a validação. Tente novamente.',409);
      const position=playbackPosition(ctx.media,this.playbackElapsed(job),ctx.playlist.loop);
      for(let i=0;i<=position.index;i++)if(fresh[i]?.id!==ctx.media[i].id||Math.abs(fresh[i].duration-ctx.media[i].duration)>0.01)fail('Preserve os vídeos anteriores e o vídeo atual; altere apenas os seguintes.',409);
      op.media=fresh;op.needsReconnect=needsReconnect;op.wasPaused=job.status==='paused';
      if(job.retryTimer){clearTimeout(job.retryTimer);job.retryTimer=null;}job.nextRetry=null;
      if(job.child){job.status='reconfiguring';this.interrupt(job);}else this.applyReconfiguration(job);
      const applied=await done;if(!applied)fail('A atualização foi cancelada porque a sessão terminou.',409);
      return this.publicJob(job);
    }catch(e){if(ctx.reconfiguration===op)ctx.reconfiguration=null;resolve(false);throw e;}finally{this.pendingPreparations.delete(validating);finishValidation();}
  }
  applyReconfiguration(job) {
    const ctx=this.contexts.get(job.id),op=ctx?.reconfiguration;if(!op)return;
    if(job.ended||this.closing||job.status==='stopping'){op.resolve(false);return;}
    const oldTotal=ctx.media.reduce((sum,m)=>sum+m.duration,0),local=this.playbackElapsed(job);
    const cycles=ctx.playlist.loop?Math.floor(local/oldTotal):0,offset=ctx.playlist.loop?local%oldTotal:local;
    // Recheck after FFmpeg stops: the current video may have advanced while draining.
    const current=playbackPosition(ctx.media,local,ctx.playlist.loop);
    if(ctx.media.slice(0,current.index+1).some((m,i)=>op.media[i]?.id!==m.id)){
      ctx.reconfiguration=null;job.status='paused';job.secrets=[];op.resolve(false);return;
    }
    for(const key of ['autoRestart','endOnVideoFailure','autoReconnect','pauseOnDisconnect'])if(op.input[key]!==undefined)job[key]=op.input[key];
    ctx.timelineBase=job.elapsed-offset;ctx.cycleOffset=(ctx.cycleOffset||0)+cycles;
    ctx.media=op.media;ctx.playlist={...ctx.playlist,mediaIds:op.media.map(m=>m.id),loop:job.autoRestart};ctx.reconfiguration=null;
    job.queueRevision=(job.queueRevision||0)+1;job.secrets=[];
    try { if(op.wasPaused)job.status='paused';else this.launch(job,ctx.playlist,ctx.media,ctx.channel,ctx.command);op.resolve(true); }
    catch{this.finish(job,'error','Não foi possível aplicar a alteração ao motor.');op.resolve(false);}
  }
  async restart(jobId,confirmed) {
    const job=this.jobs.get(jobId);
    if(!job||job.preview||job.status==='stopping'||this.restartRequests.has(jobId))fail('Esta sessão não pode ser reiniciada.',409);
    if(confirmed!==true)fail('Confirme o reinício da transmissão.');
    const request={cancelled:false};this.restartRequests.set(jobId,request);
    try{
      this.stop(job.id,{preserveRestart:true});await job.completion;
      if(request.cancelled||this.closing)fail('Reinício cancelado. A transmissão permanece parada.',409);
      return await this.start({playlistId:job.playlistId,mediaId:job.mediaId,quality:job.quality,autoRestart:job.autoRestart,pauseOnDisconnect:job.pauseOnDisconnect,channelIds:[job.channelId],confirmed:true,autoReconnect:job.autoReconnect,endOnVideoFailure:job.endOnVideoFailure});
    }finally{this.restartRequests.delete(jobId);}
  }
  schedule(input,scheduleId) {
    const existing = scheduleId ? this.store.data.schedules.find(s=>s.id===scheduleId) : null;
    if(scheduleId && (!existing || !['pending','missed','error'].includes(existing.status)))fail('Este agendamento já não pode ser editado.',409);
    this.selection(input.playlistId, input.channelIds, false, {allowBusy:true,mediaId:input.mediaId,quality:input.quality});
    const date = new Date(input.at);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) fail('Escolha uma data futura.');
    const timeZone = input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { if (typeof timeZone !== 'string' || timeZone.length > 100) throw Error(); new Intl.DateTimeFormat('pt-PT', { timeZone }); } catch { fail('Fuso horário inválido.'); }
    const schedule = { id: existing?.id||id(), playlistId: input.playlistId || null, mediaId:input.mediaId || null, quality:input.quality==='1080p'?'1080p':'720p', autoRestart:input.autoRestart, pauseOnDisconnect:input.pauseOnDisconnect===true, channelIds: input.channelIds, at: date.toISOString(), timeZone, autoReconnect: input.autoReconnect === true, endOnVideoFailure: input.endOnVideoFailure !== false, status: 'pending', armed: input.armed === true, created: existing?.created||now(), error: '' };
    if (schedule.armed && input.confirmed !== true) fail('Confirme o agendamento automático.');
    this.store.update(s => { if(existing)s.schedules[s.schedules.findIndex(x=>x.id===existing.id)]=schedule;else s.schedules.push(schedule); }); return schedule;
  }
  arm(scheduleId, armed, confirmed) {
    const item = this.store.data.schedules.find(s => s.id === scheduleId);
    if (!item || item.status !== 'pending') fail('Agendamento indisponível.');
    if (armed && confirmed !== true) fail('Confirme a ativação do agendamento.');
    if (armed && new Date(item.at).getTime() <= Date.now()) fail('O horário já passou. Crie um novo agendamento.');
    this.store.update(s => { s.schedules.find(x => x.id === scheduleId).armed = armed === true; });
  }
  tick(time = Date.now()) {
    if(this.closing)return Promise.resolve();
    if(this.tickTask)return this.tickTask;
    this.tickTask=this.tickSchedules(time).finally(()=>{this.tickTask=null;});return this.tickTask;
  }
  reportSchedule(scheduleId, status, error = '') {
    const schedule = this.store.data.schedules.find(s => s.id === scheduleId);
    if (!schedule) return;
    const source = schedule.mediaId ? this.store.data.media.find(m => m.id === schedule.mediaId) : this.store.data.playlists.find(p => p.id === schedule.playlistId);
    const details = { scheduleId, result: status, playlist: source?.title || source?.name || 'Conteúdo indisponível', channel: (schedule.channelIds || []).map(id => this.store.data.channels.find(c => c.id === id)?.name || 'Canal indisponível').join(', '), at: schedule.at, timeZone: schedule.timeZone || 'UTC', detail: error };
    this.store.log('error', 'Agendamento: ' + status, {kind:'schedule', ...details});
    try { this.onScheduleStatus?.(details); } catch {}
  }
  async tickSchedules(time) {
    const began=Date.now();
    const due=this.store.data.schedules.filter(s=>s.status==='pending'&&s.armed&&Date.parse(s.at)<=time).toSorted((a,b)=>a.at.localeCompare(b.at)).map(s=>s.id);
    for(const scheduleId of due){
      if(this.closing)break;
      // Each previous start awaits file validation. Re-read user edits, deletion and disarming.
      const schedule=this.store.data.schedules.find(s=>s.id===scheduleId),currentTime=time+Date.now()-began;
      if(!schedule||schedule.status!=='pending'||!schedule.armed||Date.parse(schedule.at)>currentTime)continue;
      if(currentTime-Date.parse(schedule.at)>60000){this.store.update(s=>{const item=s.schedules.find(x=>x.id===scheduleId);item.status='missed';item.armed=false;item.error='O horário foi ultrapassado em mais de 60 segundos.';});this.reportSchedule(scheduleId,'missed','O horário foi ultrapassado em mais de 60 segundos.');continue;}
      this.store.update(s=>{s.schedules.find(x=>x.id===scheduleId).status='starting';});
      const previousJobs=new Set(this.jobs.keys());
      try{
        const jobs=await this.start({...schedule,scheduleId,confirmed:true});
        this.store.update(s=>{const item=s.schedules.find(x=>x.id===scheduleId);if(item){item.status=jobs.length&&jobs.every(j=>j.status==='stopped')?'cancelled':'triggered';item.armed=false;}});
      }catch(error){this.store.update(s=>{const item=s.schedules.find(x=>x.id===scheduleId);if(item){item.status='error';item.error=error.message;item.armed=false;}});
        if(![...this.jobs.values()].some(j=>!previousJobs.has(j.id)&&j.scheduleId===scheduleId&&j.status==='error')) this.reportSchedule(scheduleId,'error',error.message);
      }
    }
  }
  normalize(mediaId){return this.transformMedia(mediaId,true);}
  convertMedia(mediaId){return this.transformMedia(mediaId,false);}
  cancelMediaOperation(mediaId) {
    const op=this.pendingOperations.get(mediaId);if(!op)fail('A conversão já terminou ou não existe.',404);
    if(op.controller.signal.aborted)return;
    if(op.phase==='importing')fail('A conversão terminou. Aguarde a incorporação na biblioteca.',409);
    op.phase='cancelling';op.controller.abort();
  }
  async transformMedia(mediaId,normalize) {
    const media = this.store.data.media.find(m => m.id === mediaId); if (!media) fail('Vídeo não encontrado.', 404);
    if(media.source)fail('Remote videos are read online. Conversion and normalization require a local file.');
    if (this.pendingOperations.has(mediaId)) fail('Este vídeo já está a ser normalizado.', 409);
    if (this.pendingOperations.size >= 2) fail('Aguarde uma das duas conversões em curso terminar.', 409);
    if (this.closing) fail('A aplicação está a encerrar.', 409);
    const operation = { controller: new AbortController(),title:media.title,kind:normalize?'normalize':'convert',phase:'probing',started:now() };
    operation.done = new Promise(resolve => { operation.resolve = resolve; });
    this.pendingOperations.set(mediaId, operation);
    const folder = path.join(this.store.directory, normalize?'normalized':'converted');
    const output = path.join(folder, `${mediaId}-${id()}.mp4`); const tools = toolsFor(this.store.data.settings);
    try {
      fs.mkdirSync(folder, { recursive: true });
      const meta = await probe(media.path, tools.ffprobe);
      if(operation.controller.signal.aborted||this.closing)fail('Operação cancelada.');
      operation.phase='converting';
      const args = ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', media.path];
      if(normalize){
        if (!meta.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        args.push('-map', '0:v:0', '-map', meta.audio ? '0:a:0' : '1:a:0', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-shortest');
      }else{
        args.push('-map','0:v:0','-map','0:a:0?');
        if(meta.codec==='h264')args.push('-c:v','copy');
        else args.push('-vf','scale=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p');
        args.push('-c:a',meta.audio?.codec==='aac'?'copy':'aac');
      }
      args.push('-movflags','+faststart','-y',output);
      await this.runTransformProcess(tools.ffmpeg, args, { timeout: 6 * 60 * 60 * 1000, signal: operation.controller.signal });
      if (this.closing||operation.controller.signal.aborted) fail('Operação cancelada.');
      operation.phase='importing';
      const result = await this.importMedia([output]);
      const addedId = result.imported[0]; if (!addedId) fail(result.errors[0]?.message || 'Falha ao importar vídeo normalizado.');
      this.store.update(s => { s.media.find(m => m.id === addedId).title = `${media.title} · ${normalize?'720p':'MP4'}`; });
      return { id: addedId };
    } catch (e) { try { fs.unlinkSync(output); } catch {} throw e; }
    finally { this.pendingOperations.delete(mediaId); operation.resolve(); }
  }
  async shutdown() {
    this.closing = true;
    const remoteShutdown=this.remoteSources?.shutdown();
    const operations = [...this.pendingOperations.values()];
    for (const op of operations) op.controller.abort();
    for (const job of this.jobs.values()) this.stop(job.id);
    await remoteShutdown;
    await Promise.all([...this.jobs.values()].filter(j => !j.ended).map(j => j.completion).concat(operations.map(op => op.done),[...this.pendingImports],[...this.pendingPreparations],this.tickTask?[this.tickTask]:[]));
  }
}
