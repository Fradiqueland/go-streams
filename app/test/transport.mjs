import { Readable, Writable } from 'node:stream';
// Invokes the production HTTP handler with real Node streams, without a network socket.
// Useful in restricted test environments; does not claim TCP/browser transport coverage.
export function dispatch(app, url, init = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url, app.base); const body = init.bodyChunks || (init.body ? [Buffer.from(init.body)] : []);
    const req = Readable.from(body); req.method = init.method || 'GET'; req.url = parsed.pathname + parsed.search;
    req.headers = Object.fromEntries(Object.entries({ host: parsed.host, ...init.headers }).map(([k,v]) => [k.toLowerCase(), v]));
    let chunks = []; const headers = new Map();
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.statusCode = 200; res.headersSent = false;
    res.setHeader = (name, value) => headers.set(name.toLowerCase(), String(value));
    res.writeHead = (status, values = {}) => { res.statusCode = status; for (const [k,v] of Object.entries(values)) res.setHeader(k,v); res.headersSent = true; return res; };
    res.on('error', reject);
    res.on('finish', () => {
      const buffer = Buffer.concat(chunks);
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers, body: buffer, json: async () => JSON.parse(buffer.toString()), text: async () => buffer.toString(), arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
    });
    app.handler(req, res).catch(reject);
  });
}
