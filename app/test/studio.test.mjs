import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, Vault, Studio, runProcess, probe, compatibility, validateChannel } from '../src/core.mjs';
import { createApplication } from '../src/server.mjs';
import { dispatch } from './transport.mjs';

const tempParent = path.resolve('.tmp'); fs.mkdirSync(tempParent, { recursive: true });
const root = fs.mkdtempSync(path.join(tempParent, 'go-streams-test-'));
const video = path.join(root, "vídeo d'ensaio.mp4");
let app, mediaId, playlistId;
const fetch = (url, init) => dispatch(app, url, init);
function makeStudio(name) { const store = new Store(path.join(root, name)); return new Studio(store, new Vault(store.directory, { portable: true })); }
async function request(url, body, method = 'POST', headers = {}) {
  const res = await fetch(`${app.base}${url}`, { method: body === undefined ? 'GET' : method, headers: { Cookie: `go_streams=${app.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Go-Streams': '1' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { res, data: await res.json() };
}
before(async () => {
  await runProcess('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-y',video]);
  app = await createApplication({ directory: path.join(root, 'app'), port: 0, portableVault: true, clock: false, listen: false });
  const imported = await request('/api/media/import', { paths: [video] }); assert.equal(imported.res.status, 200); assert.equal(imported.data.errors.length, 0);
  mediaId = imported.data.imported[0];
  playlistId = (await request('/api/playlists', { name: 'Ensaio', mediaIds: [mediaId, mediaId], loop: false })).data.id;
});
after(async () => {
  await app?.close();
  const resolved = path.resolve(root); const expected = tempParent + path.sep;
  if (!resolved.startsWith(expected) || !path.basename(resolved).startsWith('go-streams-test-')) throw Error('Unsafe cleanup target');
  fs.rmSync(resolved, { recursive: true, force: true });
});
test('probe reads real video dimensions, audio and duration', async () => {
  const media = await probe(video, 'ffprobe'); assert.equal(media.width, 320); assert.equal(media.height, 180); assert.ok(media.duration >= 1); assert.equal(media.audio.channels, 2);
});
test('import is idempotent and produces a thumbnail without touching originals', async () => {
  const original = fs.readFileSync(video); const { data } = await request('/api/media/import', { paths: [video] });
  assert.deepEqual(data.imported, [mediaId]); assert.equal(app.store.data.media.length, 1); assert.ok(app.store.data.media[0].thumbnail); assert.deepEqual(fs.readFileSync(video), original);
});
test('API rejects unauthenticated, foreign-origin, foreign-host and missing CSRF requests', async () => {
  assert.equal((await fetch(app.base + '/api/state')).status, 401);
  const headers = { Cookie: `go_streams=${app.token}` };
  assert.equal((await fetch(app.base + '/api/state', { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(app.base + '/api/state', { headers: { ...headers, Host: 'evil.test' } })).status, 403);
  assert.equal((await fetch(app.base + '/api/channels', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});
test('launch establishes an HttpOnly SameSite session and CSP excludes framing', async () => {
  const res = await fetch(app.url, { redirect: 'manual' }); assert.equal(res.status, 303); assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('channel validation rejects arbitrary protocols and URL credentials', () => {
  for (const url of ['file:///etc/passwd', 'https://example.com', 'rtmp://user:pass@localhost/live', 'rtmp://localhost/live?key=hidden']) assert.throws(() => validateChannel({ name: 'x', url, key: 'x' }));
});
test('keys are encrypted on disk and excluded from API and export', async () => {
  const key = 'SECRET-TEST-KEY-4830'; const result = await request('/api/channels', { name: 'Canal local', url: 'rtmp://127.0.0.1:9/live', key, platform: 'Personalizado' }); assert.equal(result.res.status, 201);
  assert.ok(!fs.readFileSync(app.store.file, 'utf8').includes(key));
  const publicState = await request('/api/state'); assert.ok(!JSON.stringify(publicState.data).includes(key)); assert.ok(!JSON.stringify(publicState.data).includes('secret'));
  assert.equal(publicState.data.channels[0].hasKey, true);
  const backup = await request('/api/export'); assert.ok(!JSON.stringify(backup.data).includes(key));
  assert.equal(app.studio.vault.decrypt(app.store.data.channels[0].secret), key);
});
test('editing with an empty key retains the encrypted existing secret', async () => {
  const existing = app.store.data.channels[0], secret = existing.secret;
  const { res } = await request(`/api/channels/${existing.id}`, { name: 'Canal local editado', url: existing.url, key: '', platform: 'Personalizado' }, 'PUT'); assert.equal(res.status, 200); assert.equal(app.store.data.channels[0].secret, secret);
});
test('playlist order and duplicate clips survive persistence', () => {
  const store = new Store(app.store.directory); assert.deepEqual(store.data.playlists[0].mediaIds, [mediaId, mediaId]);
});
test('referenced media cannot be deleted and originals are preserved', async () => {
  const { res } = await request(`/api/media/${mediaId}`, {}, 'DELETE'); assert.equal(res.status, 409); assert.ok(fs.existsSync(video));
});
test('video range requests support seeking and reject invalid ranges', async () => {
  const headers = { Cookie: `go_streams=${app.token}`, Range: 'bytes=0-99' };
  const partial = await fetch(app.base + `/api/media/${mediaId}`, { headers }); assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 100);
  const invalid = await fetch(app.base + `/api/media/${mediaId}`, { headers: { ...headers, Range: 'bytes=999999999999-' } }); assert.equal(invalid.status, 416);
});
test('actual FFmpeg test handles spaces and apostrophes and emits a playable MP4', { timeout: 30000 }, async () => {
  const { data, res } = await request('/api/start', { playlistId, preview: true }); assert.equal(res.status, 200, JSON.stringify(data));
  const job = app.studio.jobs.get(data.jobs[0].id); await job.completion;
  assert.equal(job.status, 'completed', job.error); assert.ok(job.frame > 0);
  const result = await probe(path.join(app.store.directory, 'previews', job.output), 'ffprobe'); assert.equal(result.width, 1280); assert.equal(result.height, 720); assert.ok(result.duration > 2); assert.equal(result.audio.rate, '48000');
  assert.ok(!fs.existsSync(path.join(app.store.directory, 'runs', `${job.id}.txt`)));
});
test('live transmission requires explicit confirmation', async () => {
  const { res } = await request('/api/start', { playlistId, channelIds: [app.store.data.channels[0].id] }); assert.equal(res.status, 400);
});
test('duplicate destination reservations are rejected before launching and keys are redacted on local failure', { timeout: 30000 }, async () => {
  const request = { playlistId, channelIds: [app.store.data.channels[0].id], confirmed: true };
  const first = app.studio.start(request);
  await assert.rejects(app.studio.start(request), /já está a transmitir/);
  const [result] = await first; const job = app.studio.jobs.get(result.id); await job.completion;
  assert.equal(job.status, 'error'); assert.ok(!job.error.includes('SECRET-TEST-KEY-4830')); assert.ok(!JSON.stringify(app.store.data.history).includes('SECRET-TEST-KEY-4830'));
});
test('stop terminates only an owned FFmpeg and reaches a final state', { timeout: 30000 }, async () => {
  const [result] = await app.studio.start({ playlistId, preview: true }); const job = app.studio.jobs.get(result.id); app.studio.stop(job.id); await job.completion; assert.equal(job.status, 'stopped'); assert.equal(job.child, null);
});
test('schedule times are UTC, require consent and disarm on restart', () => {
  const input = { playlistId, channelIds: [app.store.data.channels[0].id], at: new Date(Date.now() + 3600000).toISOString(), armed: true };
  assert.throws(() => app.studio.schedule(input), /Confirme/);
  const schedule = app.studio.schedule({ ...input, confirmed: true }); assert.equal(schedule.armed, true);
  const restored = new Studio(new Store(app.store.directory), app.studio.vault); assert.equal(restored.store.data.schedules.find(s => s.id === schedule.id).armed, false);
});
test('missed schedules do not start late', async () => {
  const studio = makeStudio('missed'); studio.store.update(s => s.schedules.push({ id: 'missed', status: 'pending', armed: true, at: new Date(Date.now() - 120000).toISOString() }));
  await studio.tick(); assert.equal(studio.store.data.schedules[0].status, 'missed'); assert.equal(studio.jobs.size, 0); await studio.shutdown();
});
test('format compatibility detects mixed resolutions and missing audio', () => {
  const a = app.store.data.media[0]; assert.equal(compatibility([a, a]), true); assert.equal(compatibility([a, { ...a, width: 1920 }]), false); assert.equal(compatibility([a, { ...a, audio: null }]), false);
});
test('normalization creates independent consistent media and preserves originals', { timeout: 30000 }, async () => {
  const original = fs.readFileSync(video); const { id } = await app.studio.normalize(mediaId); const normalized = app.store.data.media.find(m => m.id === id); assert.equal(normalized.width, 1280); assert.equal(normalized.fps, 30); assert.notEqual(normalized.path, video); assert.deepEqual(fs.readFileSync(video), original);
});
test('corrupted data fails closed instead of resetting the project', () => {
  const directory = path.join(root, 'corrupt'); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'project.json'), '{invalid'); assert.throws(() => new Store(directory), /preservado/); assert.equal(fs.readFileSync(path.join(directory, 'project.json'), 'utf8'), '{invalid');
});
test('a missing encryption key is never silently replaced for a configured project', () => {
  const directory = path.join(root, 'lost-key'); const studio = makeStudio('lost-key'); studio.saveChannel({ name: 'Local', url: 'rtmp://127.0.0.1/live', key: 'sensitive' }); fs.unlinkSync(path.join(directory, 'vault.key')); assert.throws(() => new Vault(directory, { portable: true }), /em falta/);
});
test('Windows DPAPI vault reopens under the same Windows account', { skip: process.platform !== 'win32' }, () => {
  const directory = path.join(root, 'dpapi'); fs.mkdirSync(directory);
  const first = new Vault(directory); const encrypted = first.encrypt('local-test-secret');
  const second = new Vault(directory); assert.equal(second.decrypt(encrypted), 'local-test-secret');
  assert.ok(!fs.readFileSync(path.join(directory, 'vault.dpapi'), 'utf8').includes(first.key.toString('base64')));
});
