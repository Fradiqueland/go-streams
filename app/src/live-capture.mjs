import {appendProgramOutput} from './program-output.mjs';
import crypto from 'node:crypto';
import {AppError} from './errors.mjs';
import {toolsFor} from './core.mjs';
import {encodingArgs} from './encoding.mjs';
import {operationSettings} from './operations.mjs';

const MAX_CHUNK = 8 * 1024 * 1024;
const fail = (message, status = 400) => { throw new AppError(message, status); };

// Captured WebM stays in memory and is fed to independent destination workers.
// No recording, device permission or network broadcast starts on application launch.
export class LiveCapture {
  constructor(studio, {idleTimeout = 20000, writeTimeout = 7000, clock = true} = {}) {
    this.studio = studio;
    this.sessions = new Map();
    this.subscriptions = new Map();
    this.idleTimeout = idleTimeout;
    this.writeTimeout = writeTimeout;
    studio.liveCapture = this;
    if (clock) this.timer = setInterval(() => this.expire(), 2000).unref();
  }
  start(input) {
    const studio = this.studio;
    const feed = input.feedId ? studio.feeds?.get(input.feedId) : null;
    if(input.feedId&&!feed)fail('Shared capture is unavailable.',410);
    if(feed&&(feed.quality!==input.quality||feed.aspect!==input.aspect||feed.source!==input.source))fail('The live destination format must match the shared capture.');
    if (studio.closing || studio.importingProject) fail('The studio is busy or closing.', 409);
    if (input.confirmed !== true) fail('Confirm the live broadcast destinations before starting.');
    if (!['camera', 'screen', 'screen-camera'].includes(input.source)) fail('Choose a live capture source.');
    if (!['720p', '1080p'].includes(input.quality) || !['16:9', '9:16'].includes(input.aspect)) fail('Choose a supported live video format.');
    if (!['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].includes(input.mimeType)) fail('This browser does not support live WebM capture. Use Chrome or Edge.');
    if (!Array.isArray(input.channelIds) || !input.channelIds.length || input.channelIds.length > 64 || new Set(input.channelIds).size !== input.channelIds.length) fail('Select destinations without duplicates.');
    const channels = input.channelIds.map(id => studio.store.data.channels.find(c => c.id === id));
    if (channels.some(c => !c || !c.secret)) fail('Configure every destination and stream key first.');
    if (channels.some(c => studio.busyChannel(c.id))) fail('A selected destination is already in use.', 409);
    const limit = operationSettings(studio.store.data.settings).maxConcurrent;
    if (limit && [...studio.jobs.values()].filter(j => !j.ended).length + channels.length > limit) fail(`The configured simultaneous stream limit is ${limit}.`, 409);
    // Validate all credentials and tools before reserving or starting any worker.
    const command = toolsFor(studio.store.data.settings).ffmpeg;
    const keys = channels.map(c => studio.vault.decrypt(c.secret));
    const encoded = encodingArgs({...studio.store.data.settings.encoding, copy:false, aspect:input.aspect, fps:30, videoBitrate:input.quality === '1080p' ? 4500 : 2500}, input.quality, [{audio:{}}]);
    const session = {id:crypto.randomUUID(), feedId:input.feedId||null, jobs:[], sequence:0, receiving:false, lastInput:Date.now(), stopped:false};
    this.sessions.set(session.id, session);
    for (const channel of channels) {
      const job = {id:crypto.randomUUID(), liveSessionId:session.id, sourceType:'live', source:input.source, channelId:channel.id, channelName:channel.name, platform:channel.platform, playlistId:null, mediaId:null, playlistName:'Live camera / screen', preview:false, quality:input.quality, status:'starting', started:new Date().toISOString(), ended:null, elapsed:0, frame:0, fps:0, bitrate:'', error:'', output:null, child:null, secrets:[], retries:0, autoRestart:false};
      job.completion = new Promise(resolve => { job.resolve = resolve; });
      session.jobs.push(job);
      studio.jobs.set(job.id, job);
    }
    try {
      session.jobs.forEach((job, index) => this.launch(session, job, channels[index], keys[index], command, encoded));
    } catch {
      this.stop(session.id, 'The live encoder could not be started.');
      fail('The live encoder could not be started. Check the bundled media tools.', 500);
    }
    return {id:session.id, jobs:session.jobs.map(j => studio.publicJob(j))};
  }
  launch(session, job, channel, key, command, encoded) {
    const target = `${channel.url}/${key}`;
    job.secrets = [key, channel.url, target];
    const args = session.feedId ? ['-hide_banner','-loglevel','warning','-nostdin','-progress','pipe:1','-stats_period','1','-probesize','1048576','-analyzeduration','1000000','-f','mpegts','-i','pipe:0','-map','0:v:0','-map','0:a:0?','-c','copy','-rw_timeout','10000000','-flvflags','no_duration_filesize','-f','flv',target] : ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-progress', 'pipe:1', '-stats_period', '1', '-fflags', '+genpts', '-probesize', '1048576', '-analyzeduration', '1000000', '-f', 'webm', '-i', 'pipe:0'];
    if(!session.feedId){appendProgramOutput(args,encoded.args,job.quality,encoded.profile.aspect);args.push('-rw_timeout','10000000','-flvflags','no_duration_filesize','-f','flv',target);}
    const child = this.studio.spawnProcess(command, args, {shell:false, windowsHide:true, stdio:['pipe','pipe','pipe']});
    job.child = child;
    let progress = '', stderr = '';
    child.stdin.on('error', () => {});
    child.stdout.on('data', data => {
      progress += data.toString();
      const lines = progress.split(/\r?\n/); progress = lines.pop().slice(-4000);
      for (const line of lines) {
        const [name, value] = line.split('=');
        if (name === 'frame') {
          job.frame = Number(value) || 0;
          if (job.frame > 0 && job.status === 'starting') { job.status = 'running'; job.broadcastStarted = new Date().toISOString(); this.studio.notify(job, 'running'); }
        }
        if (name === 'fps') job.fps = Number(value) || 0;
        if (name === 'bitrate') job.bitrate = value?.trim() || '';
        if (name === 'out_time_us') {
          job.elapsed = Math.max(job.elapsed, (Number(value) || 0) / 1000000);
          // FFmpeg 6 stream-copy workers report output time without frame counts.
          if(job.elapsed>0&&job.status==='starting'){job.status='running';job.broadcastStarted=new Date().toISOString();this.studio.notify(job,'running');}
        }
      }
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-12000); });
    child.on('error', () => { job.captureError = 'The live encoder could not be started.'; });
    child.on('close', code => {
      this.subscriptions.get(job.id)?.();this.subscriptions.delete(job.id);
      if (job.ended) return;
      const stopped = job.status === 'stopping';
      let error = job.captureError || (!stopped ? stderr.slice(-2500) || 'The live destination disconnected.' : '');
      for (const secret of [...job.secrets].sort((a,b) => b.length-a.length)) if (secret) error = error.split(secret).join('[hidden]');
      error = error.replace(/rtmps?:\/\/\S+/gi, '[destination hidden]');
      this.studio.finish(job, error ? 'error' : stopped ? 'stopped' : 'completed', error);
      if (session.jobs.every(j => j.ended)) this.sessions.delete(session.id);
    });
    if(session.feedId)this.subscriptions.set(job.id,this.studio.feeds.attach(session.feedId,child.stdin,error=>this.stopJob(job,error)));
  }
  async ingest(id, sequence, req) {
    const session = this.sessions.get(id);
    if (!session || session.stopped) fail('This live session has ended.', 410);
    if(session.feedId)fail('Send video to the shared capture input.',409);
    if (session.receiving || sequence !== String(session.sequence)) fail('Live video chunks must arrive in order.', 409);
    if (req.headers['content-type']?.split(';')[0] !== 'video/webm') fail('Expected a WebM video chunk.', 415);
    const declared = req.headers['content-length'];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_CHUNK)) fail('Live video chunk is too large.', 413);
    session.receiving = true;
    const deadline = setTimeout(() => { this.stop(id, 'Live capture upload timed out.'); req.destroy(); }, this.idleTimeout).unref();
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_CHUNK) fail('Live video chunk is too large.', 413);
        chunks.push(Buffer.from(chunk));
      }
      if (!bytes || session.stopped) fail('Live capture ended or supplied an empty chunk.', 409);
      session.lastInput = Date.now();
      const data = Buffer.concat(chunks);
      await Promise.all(session.jobs.filter(j => !j.ended && j.status !== 'stopping').map(job => this.write(job, data)));
      if (session.stopped || !session.jobs.some(j => !j.ended && j.status !== 'stopping')) fail('All live destinations have stopped.', 410);
      session.sequence++;
      session.lastInput = Date.now();
      return {ok:true, sequence:session.sequence};
    } catch (error) {
      this.stop(id, 'Live capture was interrupted. Start a new live broadcast.');
      throw error;
    } finally { clearTimeout(deadline); session.receiving = false; }
  }
  write(job, data) {
    return new Promise(resolve => {
      if (!job.child || job.ended) return resolve();
      let done = false;
      const finish = error => {
        if (done) return; done = true; clearTimeout(timer);
        if (error && !job.ended && job.status !== 'stopping') this.stopJob(job, 'This destination stopped accepting live video.');
        resolve();
      };
      const timer = setTimeout(() => finish(true), this.writeTimeout).unref();
      try { job.child.stdin.write(data, finish); } catch { finish(true); }
    });
  }
  stopJob(job, error = '') {
    if (job.ended || job.status === 'stopping') return;
    job.status = 'stopping';
    this.subscriptions.get(job.id)?.();this.subscriptions.delete(job.id);
    if (error) job.captureError = error;
    if (!job.child) return this.studio.finish(job, error ? 'error' : 'stopped', error);
    const child = job.child;
    job.timer = setTimeout(() => { if (!job.ended) { try { child.kill(); } catch {} } }, 5000).unref();
    // stdin carries binary WebM, so the prerecorded encoder's "q" command is invalid here.
    child.stdin.end();
  }
  stop(id, error = '') {
    const session = this.sessions.get(id);
    if (!session) return;
    session.stopped = true;
    for (const job of session.jobs) this.stopJob(job, error);
    if (session.jobs.every(job => job.ended)) this.sessions.delete(id);
  }
  expire(time = Date.now()) {
    for (const session of this.sessions.values()) if (!session.feedId && !session.stopped && time-session.lastInput > this.idleTimeout) this.stop(session.id, 'Live capture disconnected or the capture window was closed.');
  }
  async shutdown() {
    clearInterval(this.timer);
    for (const session of this.sessions.values()) this.stop(session.id);
    await Promise.all([...this.sessions.values()].flatMap(s => s.jobs.map(j => j.completion)));
    this.sessions.clear();
  }
}
