import {prepareOverlays,assetFile} from './overlays.mjs';
import {exportBackup,decryptBackup,prepareBackupRestore} from './backups.mjs';
import {RemoteSources} from './remote-sources.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {APP_VERSION} from './version.mjs';
import {nativePicker,openBrowser,defaultDataDirectory,showStartupError} from './desktop.mjs';
import { AppError, Store, Vault, Studio, toolsFor, runProcess, atomicWrite } from './core.mjs';
import { validateEncoding } from './encoding.mjs';
import {operationSettings, validateOperations} from './operations.mjs';
import { Downloads } from './downloads.mjs';
import { Notifications } from './notifications.mjs';
import {Updates} from './updates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/vnd.microsoft.icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png':'image/png', '.gif':'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
function csvCell(value) {
  let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}
function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function readJson(req,limit=1024*1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('É necessário enviar JSON.', 415);
  const chunks=[];let size=0;for await(const chunk of req){const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=data.length;if(size>limit)throw new AppError('Pedido demasiado grande.',413);chunks.push(data);}
  const body=Buffer.concat(chunks).toString('utf8');
  try { const value = JSON.parse(body || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw new AppError('JSON inválido.'); }
}
function serveFile(req, res, file, contentType) {
  let stat; try { stat = fs.statSync(file); } catch { throw new AppError('Ficheiro não encontrado.', 404); }
  if (!stat.isFile()) throw new AppError('Ficheiro não encontrado.', 404);
  const headers = { 'Content-Type': contentType || mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  let start = 0, end = stat.size - 1, status = 200;
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    if (!m[1]) { start = Math.max(0, stat.size - Number(m[2])); } else { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`; status = 206;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1); res.writeHead(status, headers);
  if (req.method === 'HEAD' || !stat.size) return res.end();
  const stream = fs.createReadStream(file, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
export async function createApplication({ directory = process.env.GO_STREAMS_DATA || defaultDataDirectory(root), port = 4317, portableVault, picker = nativePicker, clock = true, listen = true, downloadOptions, notificationOptions, updateOptions, remoteOptions } = {}) {
  let store, vault, studio, downloads, notifications, updates, remoteSources;
  const token = crypto.randomBytes(32).toString('hex'); let base = '', shuttingDown = false, restoring = false, healthCache;
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(base).host) throw new AppError('Host recusado.', 403);
      if (req.headers.origin && req.headers.origin !== base) throw new AppError('Origem recusada.', 403);
      const url = new URL(req.url, base); const pathname = url.pathname;
      if(pathname.startsWith('/source/'))return await remoteSources.handle(req,res);
      if (req.method === 'GET' && pathname === '/' && url.searchParams.get('launch') === token) {
        res.setHeader('Set-Cookie', `go_streams=${token}; HttpOnly; SameSite=Strict; Path=/`); res.writeHead(303, { Location: '/' }); return res.end();
      }
      const cookie = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('go_streams='))?.slice(11);
      if (cookie !== token) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Abra o Go Streams pelo seu iniciador para entrar nesta sessão local.'); }
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-go-streams'] !== '1') throw new AppError('Pedido recusado.', 403);
      if (shuttingDown) throw new AppError('A aplicação está a encerrar.', 503);
      if(restoring&&!['GET','HEAD'].includes(req.method)&&pathname!=='/api/shutdown')throw new AppError('Aguarde o restauro da cópia de segurança.',409);
      const body = !['GET', 'HEAD'].includes(req.method) ? await readJson(req,pathname==='/api/backups/restore'?24*1024*1024:pathname==='/api/settings'?6*1024*1024:1024*1024) : {};
      if (shuttingDown) throw new AppError('A aplicação está a encerrar.', 503);
      if(restoring&&!['GET','HEAD'].includes(req.method)&&pathname!=='/api/shutdown')throw new AppError('Aguarde o restauro da cópia de segurança.',409);
      if (pathname === '/api/ready' && req.method === 'GET') { res.setHeader('X-Go-Streams-Ready', '1'); return json(res, { ready: true }); }
      if (pathname === '/api/state' && req.method === 'GET') return json(res, {...studio.state(),updateStatus:updates.state()});
      if (pathname === '/api/health' && req.method === 'GET') {
        if (!healthCache) healthCache = Promise.all(['ffmpeg', 'ffprobe','ytdlp'].map(async key => { try { const command = toolsFor(store.data.settings)[key]; const r = await runProcess(command, [key==='ytdlp'?'--version':'-version'], { timeout: 10000 }); return [key, { available: true, version: r.stdout.split(/\r?\n/)[0] }]; } catch (e) { return [key, { available: false, error: e.message }]; } })).then(results => ({ tools: Object.fromEntries(results), version: APP_VERSION, platform: os.platform(), secureStorage: process.platform === 'win32' && !portableVault ? 'Windows DPAPI' : 'Chave local privada', dataDirectory: directory }));
        return json(res, await healthCache);
      }
      if(pathname==='/api/updates'&&req.method==='PUT')return json(res,updates.save(body));
      if(pathname==='/api/updates/check'&&req.method==='POST')return json(res,await updates.check());
      if(pathname==='/api/updates/download'&&req.method==='POST')return json(res,await updates.download());
      if(pathname==='/api/media/link'&&req.method==='POST')return json(res,await studio.importRemote(body),201);
      if (pathname === '/api/media/import' && req.method === 'POST') return json(res, await studio.importMedia(body.paths,{convert:body.convert===true}));
      if (pathname === '/api/import' && req.method === 'POST') return json(res, await studio.importProject(body));
      if (pathname === '/api/downloads' && req.method === 'POST') return json(res,downloads.start(body),202);
      const downloadAction=/^\/api\/downloads\/([\w-]+)\/(import|media|thumb)$/.exec(pathname);
      if(downloadAction&&req.method==='POST'&&downloadAction[2]==='import')return json(res,await downloads.addToLibrary(downloadAction[1]));
      if(downloadAction&&['GET','HEAD'].includes(req.method)&&downloadAction[2]!=='import')return serveFile(req,res,downloads.file(downloadAction[1],downloadAction[2]==='thumb'),downloadAction[2]==='thumb'?'image/jpeg':'video/mp4');
      const cancelDownload = /^\/api\/downloads\/([\w-]+)\/cancel$/.exec(pathname);
      if (cancelDownload && req.method==='POST') { downloads.cancel(cancelDownload[1]); return json(res,{ok:true}); }
      const removeDownload = /^\/api\/downloads\/([\w-]+)$/.exec(pathname);
      if(removeDownload && req.method==='DELETE'){downloads.remove(removeDownload[1]);return json(res,{ok:true});}
      if (pathname === '/api/notifications' && req.method==='PUT') return json(res,notifications.save(body));
      if (pathname === '/api/notifications/test' && req.method==='POST') {const result=await notifications.test(body.confirmed);return json(res,result,result.ok?200:400);}
      if (pathname === '/api/media/pick' && req.method === 'POST') return json(res, { paths: await picker() });
      if (pathname === '/api/channels' && req.method === 'POST') return json(res, { id: studio.saveChannel(body) }, 201);
      const plan=/^\/api\/channels\/([\w-]+)\/(plan|start)$/.exec(pathname);
      if(plan&&req.method==='PUT'&&plan[2]==='plan')return json(res,studio.saveChannelPlan(plan[1],body));
      if(plan&&req.method==='POST'&&plan[2]==='start')return json(res,{jobs:await studio.startChannelPlan(plan[1],body)});
      const reconfigure=/^\/api\/jobs\/([\w-]+)\/configuration$/.exec(pathname);
      if(reconfigure&&req.method==='PUT')return json(res,await studio.reconfigure(reconfigure[1],body));
      const playlistName=/^\/api\/playlists\/([\w-]+)\/name$/.exec(pathname);
      if(playlistName&&req.method==='PUT')return json(res,studio.renamePlaylist(playlistName[1],body.name));
      if (pathname === '/api/playlists' && req.method === 'POST') return json(res, { id: studio.savePlaylist(body) }, 201);
      const entity = /^\/api\/(channels|playlists|media|schedules)\/([\w-]+)$/.exec(pathname);
      if (entity && req.method === 'DELETE') { studio.remove(entity[1], entity[2],{detachFromPlaylists:body.detachFromPlaylists===true}); return json(res, { ok: true }); }
      if (entity && req.method === 'PUT' && entity[1] === 'channels') return json(res, { id: studio.saveChannel(body, entity[2]) });
      if (entity && req.method === 'PUT' && entity[1] === 'playlists') return json(res, { id: studio.savePlaylist(body, entity[2]) });
      if (entity && req.method === 'PUT' && entity[1] === 'media') { studio.renameMedia(entity[2], body.title); return json(res, { ok: true }); }
      if (entity && req.method === 'PUT' && entity[1] === 'schedules') return json(res,studio.schedule(body,entity[2]));
      if (pathname === '/api/start' && req.method === 'POST') return json(res, { jobs: await studio.start(body) });
      const stop = /^\/api\/jobs\/([\w-]+)\/stop$/.exec(pathname);
      if (stop && req.method === 'POST') { studio.stop(stop[1]); return json(res, { ok: true }); }
      const control = /^\/api\/jobs\/([\w-]+)\/(pause|resume|restart)$/.exec(pathname);
      if (control && req.method === 'POST') {
        if (control[2] === 'pause') { studio.pause(control[1]); return json(res, { ok: true }); }
        if (control[2] === 'restart') return json(res,{jobs:await studio.restart(control[1],body.confirmed)});
        return json(res, studio.resume(control[1], body.confirmed));
      }
      if (pathname === '/api/history' && req.method === 'DELETE') { store.update(s => { s.history = []; }); return json(res, { ok: true }); }
      if (pathname === '/api/history.csv' && req.method === 'GET') {
        const columns = ['kind','platform','video','sequence','cycle','time', 'level', 'channel', 'playlist', 'started', 'ended', 'elapsed', 'result', 'retries', 'message', 'detail'];
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="go-streams-history.csv"' });
        return res.end('\uFEFF' + [columns, ...store.data.history.map(row => columns.map(key => row[key]))].map(row => row.map(csvCell).join(';')).join('\r\n'));
      }
      if (pathname === '/api/stop-all' && req.method === 'POST') { for (const job of studio.jobs.values()) studio.stop(job.id); return json(res, { ok: true }); }
      if (pathname === '/api/schedules' && req.method === 'POST') return json(res, studio.schedule(body), 201);
      if (pathname === '/api/schedules' && req.method === 'DELETE') { if(store.data.schedules.some(s=>s.status==='starting'))throw new AppError('Aguarde o agendamento que está a iniciar.',409);store.update(s=>{s.schedules=[];});return json(res,{ok:true}); }
      const arm = /^\/api\/schedules\/([\w-]+)\/arm$/.exec(pathname);
      if (arm && req.method === 'POST') { studio.arm(arm[1], body.armed, body.confirmed); return json(res, { ok: true }); }
      const cancelConversion=/^\/api\/media-operations\/([\w-]+)\/cancel$/.exec(pathname);
      if(cancelConversion&&req.method==='POST'){studio.cancelMediaOperation(cancelConversion[1]);return json(res,{ok:true},202);}
      if (pathname === '/api/normalize' && req.method === 'POST') return json(res, await studio.normalize(body.mediaId));
      if (pathname === '/api/settings' && req.method === 'PUT') {
        const values = {};
        for (const key of ['ffmpeg', 'ffprobe','ytdlp']) {
          if(body[key]===undefined)continue;
          const v = body[key]; if (typeof v !== 'string' || v.length > 3000 || /[\x00-\x1f]/.test(v)) throw new AppError('Caminho inválido.');
          if (v && (!path.isAbsolute(v) || !fs.existsSync(v) || !fs.statSync(v).isFile())) throw new AppError('Indique um caminho absoluto para uma ferramenta existente.');
          values[key] = v;
        }
        if (body.encoding !== undefined) values.encoding = validateEncoding(body.encoding);
        if (body.operations !== undefined) {
          values.operations = validateOperations(body.operations);
          if (values.operations.persistSchedules && !operationSettings(store.data.settings).persistSchedules && body.confirmed !== true) throw new AppError('Confirme a manutenção dos agendamentos ativos ao reabrir.');
        }
        if(body.overlays!==undefined){
          let finish;const pending=new Promise(resolve=>{finish=resolve;});studio.pendingImports.add(pending);
          try{values.overlays=await prepareOverlays(body.overlays,directory,runProcess,()=>toolsFor(store.data.settings).ffprobe,()=>shuttingDown);}finally{studio.pendingImports.delete(pending);finish();}
        }
        store.update(s => { s.settings = {...s.settings,...values}; }); healthCache = null; return json(res, { ok: true });
      }
      if(pathname==='/api/backups/export'&&req.method==='POST')return json(res,await exportBackup(store,vault,body));
      if(pathname==='/api/backups/restore'&&req.method==='POST'){
        if(body.confirmed!==true)throw new AppError('Confirme o restauro e a substituição dos dados.');
        const idle=(own)=>!studio.closing&&!studio.importingProject&&![...studio.pendingImports].some(item=>item!==own)&&!studio.pendingPreparations.size&&!studio.pendingOperations.size&&!studio.tickTask&&![...studio.jobs.values()].some(j=>!j.ended)&&!downloads.active.size&&!downloads.manualImports.size&&!notifications.processing&&!notifications.testing&&!updates.operation;
        if(!idle())throw new AppError('Pare as transmissões e aguarde as operações em curso antes de restaurar.',409);
        const payload=await decryptBackup(body.backup,body.password);
        if(!idle())throw new AppError('Uma operação começou durante a leitura. Tente novamente.',409);
        const restored=prepareBackupRestore(payload,store.data,vault,directory,{persistAssets:false});
        let finish;const pending=new Promise(resolve=>{finish=resolve;});restoring=true;studio.pendingImports.add(pending);
        try{
          if(restored.scope!=='project'&&restored.data.settings.overlays){
            const input=structuredClone(restored.data.settings.overlays);
            for(const key of ['top','bottom','image']){const data=payload.overlayAssets?.[input[key].asset];if(data)input[key].data=data;}
            // Use the portable probe even when restoring unavailable custom tool paths.
            restored.data.settings.overlays=await prepareOverlays(input,directory,runProcess,()=>toolsFor({}).ffprobe,()=>shuttingDown);
          }
          if(shuttingDown)throw new AppError('A aplicação está a encerrar.',503);
          if(!idle(pending))throw new AppError('Uma operação começou durante a leitura. Tente novamente.',409);
          store.update(s=>{for(const key of Object.keys(s))delete s[key];Object.assign(s,restored.data);});
          if(restored.scope!=='settings'){studio.jobs.clear();studio.contexts.clear();}
          notifications.pending=[];if(restored.scope!=='project'){updates.release=null;updates.status={state:'idle'};updates.startTimer();}healthCache=null;
          return json(res,{ok:true,scope:restored.scope,interface:restored.interface});
        }finally{restoring=false;studio.pendingImports.delete(pending);finish();}
      }
      const overlayAsset=/^\/api\/overlays\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))$/.exec(pathname);
      if(overlayAsset&&['GET','HEAD'].includes(req.method))return serveFile(req,res,assetFile(directory,overlayAsset[1]));
      if (pathname === '/api/export' && req.method === 'GET') {
        const state = studio.state(); const backup = { version: 1, exported: new Date().toISOString(), channelPlans:state.channelPlans||{}, media: state.media, playlists: state.playlists, channels: state.channels.map(({ hasKey, ...c }) => c), schedules: state.schedules.filter(s => (s.mediaId ? state.media.some(m => m.id===s.mediaId) : state.playlists.some(p => p.id === s.playlistId)) && s.channelIds.every(cid => state.channels.some(c => c.id === cid))).map(s => ({ ...s, armed: false })) };
        res.setHeader('Content-Disposition', 'attachment; filename="go-streams-project.json"'); return json(res, backup);
      }
      const asset = /^\/api\/(media|thumb|preview)\/([\w-]+)$/.exec(pathname);
      if (asset && ['GET', 'HEAD'].includes(req.method)) {
        if (asset[1] === 'preview') {
          const job = studio.jobs.get(asset[2]); if (!job?.preview || !job.output || job.status !== 'completed') throw new AppError('Pré-visualização indisponível.', 404);
          return serveFile(req, res, path.join(directory, 'previews', job.output), 'video/mp4');
        }
        const media = store.data.media.find(m => m.id === asset[2]); if (!media) throw new AppError('Vídeo não encontrado.', 404);
        if(media.source&&asset[1]==='media')return await remoteSources.serve(req,res,remoteSources.entry(media));
        return serveFile(req, res, asset[1] === 'thumb' ? path.join(directory, 'thumbs', `${media.id}.jpg`) : media.path);
      }
      if (pathname === '/api/shutdown' && req.method === 'POST') { json(res, { ok: true }); setImmediate(() => close().catch(()=>{console.error('O encerramento terminou com falhas.');process.exitCode=1;})); return; }
      if (['GET', 'HEAD'].includes(req.method) && ['/', '/boot.js', '/app.js', '/extras.js', '/studio-ui.js', '/overlays-ui.js', '/timezones.js', '/i18n.js', '/i18n-data.js', '/style.css', '/icon.svg', '/icon.ico', '/icon.webp', '/icon.png', '/antonio-fradique.webp'].includes(pathname)) return serveFile(req, res, path.join(root, 'public', pathname === '/' ? 'index.html' : pathname.slice(1)));
      throw new AppError('Não encontrado.', 404);
    } catch (e) { if (!res.headersSent) json(res, { error: e instanceof AppError ? e.message : 'Ocorreu um erro interno. Os dados existentes foram preservados.' }, e.status || 500); else res.destroy(); }
  };
  const server = http.createServer(handler);
  server.requestTimeout = 0; server.headersTimeout = 15000;
  if (listen) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${listen ? server.address().port : port || 4317}`;
  const sessionFile = path.join(directory, 'session.url');
  try {
    store = new Store(directory); vault = new Vault(directory, { portable: portableVault }); remoteSources=new RemoteSources({base,settings:()=>store.data.settings,execute:runProcess,...remoteOptions});studio = new Studio(store, vault,{remoteSources});
    downloads = new Downloads(studio,downloadOptions); notifications = new Notifications(studio,notificationOptions); updates=new Updates(store,updateOptions);updates.startTimer();
    studio.onStatus = (job,status) => notifications.enqueue(job,status);
    studio.onScheduleStatus = details => notifications.enqueueSchedule(details);
    if (listen) atomicWrite(sessionFile, `${base}/?launch=${token}`);
  } catch (error) { if (server.listening) server.close(); throw error; }
  const timer = clock ? setInterval(() => {if(!restoring)studio.tick().catch(() => {});}, 1000) : null;
  let closeTask;
  function close() {
    if(closeTask)return closeTask;
    shuttingDown=true;if(timer)clearInterval(timer);
    closeTask=Promise.resolve().then(async()=>{
      // Each service must get its shutdown request, including after a synchronous failure.
      const results=await Promise.allSettled([updates,notifications,downloads,studio].map(service=>Promise.resolve().then(()=>service.shutdown())));
      if(listen){try{if(fs.readFileSync(sessionFile,'utf8')===`${base}/?launch=${token}`)fs.unlinkSync(sessionFile);}catch{}}
      if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
      const failures=results.filter(r=>r.status==='rejected');
      if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'O encerramento terminou com falhas. Verifique os processos desta sessão.');
    });
    return closeTask;
  }
  return { server, handler, studio, store, downloads, notifications, updates, base, token, url: `${base}/?launch=${token}`, close };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApplication({ port: Number(process.env.GO_STREAMS_PORT || 4317) }).then(app => {
    console.log(`Go Streams: ${app.url}`);
    if (process.argv.includes('--open')) openBrowser(app.url,{directory:app.store.directory});
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)).catch(()=>{console.error('O encerramento terminou com falhas.');process.exitCode=1;}));
  }).catch(async error => {
    if(error.code==='EADDRINUSE'&&process.argv.includes('--open')){
      try{
        const directory=process.env.GO_STREAMS_DATA||defaultDataDirectory(root),url=fs.readFileSync(path.join(directory,'session.url'),'utf8').trim();
        const parsed=new URL(url),expected=Number(process.env.GO_STREAMS_PORT||4317);
        if(!parsed.username&&!parsed.password&&!parsed.hash&&parsed.searchParams.size===1&&parsed.origin===`http://127.0.0.1:${expected}`&&parsed.pathname==='/'&&/^[a-f0-9]{64}$/.test(parsed.searchParams.get('launch'))){openBrowser(url,{directory});return;}
      }catch{}
    }
    const message=error.code === 'EADDRINUSE' ? 'O Go Streams já está aberto ou a porta 4317 está ocupada.' : error.message;
    console.error(message);if(process.argv.includes('--open'))await showStartupError(message).catch(()=>{});process.exitCode = 1; });
}
