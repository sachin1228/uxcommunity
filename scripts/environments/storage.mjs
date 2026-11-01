import { createServer } from 'node:http';
import { signedRequest } from '../../packages/shared/src/storage-signature.mjs';
export { signedRequest } from '../../packages/shared/src/storage-signature.mjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const xml = value => String(value).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const unxml = value => value.replace(/&(lt|gt|amp|quot|apos);/g, (_, c) => ({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[c]));
/** Loopback-only S3 protocol adapter over real Miniflare R2 storage. */
export async function startStorage({ secret, apiSecret, persist, port = 8788, allowedOrigins = ['http://localhost:3000','http://127.0.0.1:3000'] }) {
  if (allowedOrigins.some(origin => !['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))) throw new Error('Local CORS must use loopback');
  if (!secret || secret.length < 32) throw new Error('Local storage secret is required');
  const mf = new Miniflare({ ...convertV4MiniflareOptions({ name: 'uxcommunity-local-storage', compatibilityDate: '2026-08-01', modules: true, script: 'export default { fetch() { return new Response("local"); } }',
    r2Buckets: ['MEDIA', 'PRIVATE'] }), ...(persist ? { resourcePersistencePath: persist } : {}), host: '127.0.0.1', telemetry: { enabled: false } });
  const buckets = {
    'uxcommunity-development-media': await mf.getR2Bucket('MEDIA'),
    'uxcommunity-development-private': await mf.getR2Bucket('PRIVATE'),
  };
  const mail = [];
  const server = createServer(async (req, res) => {
    if (res.writableEnded) return;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/__mail') {
        if (!apiSecret || req.headers.authorization !== `Bearer ${apiSecret}`) { res.writeHead(403).end(); return; }
        if (req.method === 'POST') {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 1024*1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
          mail.push(JSON.parse(Buffer.concat(chunks).toString()));
          if (mail.length > 100) mail.shift();
          res.writeHead(201).end();
        } else if (req.method === 'GET') {
          res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(mail));
        } else res.writeHead(405).end();
        return;
      }
      const [name, ...segments] = url.pathname.slice(1).split('/');
      const bucket = Object.hasOwn(buckets, name) ? buckets[name] : null;
      if (!bucket) { res.writeHead(404).end(); return; }
      const key = segments.map(decodeURIComponent).join('/');
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 55 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const signed = signedRequest(req, url, body, secret);
      const publicRead = name === 'uxcommunity-development-media' && key && ['GET','HEAD'].includes(req.method);
      if (!signed && !publicRead) { res.writeHead(403).end(); return; }
      // Anonymous CORS reads are public media only; signed uploads are exact local origins.
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,DELETE');
        res.setHeader('Access-Control-Expose-Headers', 'ETag');
      }
      if (req.method === 'PUT') {
        const source = req.headers['x-amz-copy-source'];
        let data = body;
        if (source) {
          const [sourceBucket, ...sourceKey] = decodeURIComponent(source.replace(/^\//,'')).split('/');
          if (sourceBucket !== name) { res.writeHead(403).end(); return; }
          const object = await bucket.get(sourceKey.join('/'));
          if (!object) { res.writeHead(404).end(); return; }
          data = Buffer.from(await object.arrayBuffer());
        }
        const object = await bucket.put(key, data, { httpMetadata: {
          contentType: req.headers['content-type'] ?? 'application/octet-stream',
          cacheControl: name.endsWith('-private') ? 'private, no-store' : 'public, max-age=3600',
        }});
        res.setHeader('ETag', object.httpEtag);
        if (source) res.setHeader('Content-Type','application/xml');
        res.end(source ? `<CopyObjectResult><ETag>${xml(object.httpEtag)}</ETag><LastModified>${object.uploaded.toISOString()}</LastModified></CopyObjectResult>` : '');
      } else if (req.method === 'POST' && url.searchParams.has('delete')) {
        const keys = [...body.toString().matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(m => unxml(m[1]));
        if (keys.length > 1000) { res.writeHead(400).end(); return; }
        await bucket.delete(keys);
        res.setHeader('Content-Type','application/xml');
        res.end('<DeleteResult/>');
      } else if (req.method === 'DELETE') {
        await bucket.delete(key); res.writeHead(204).end();
      } else if (req.method === 'GET' && !key) {
        const result = await bucket.list({ prefix: url.searchParams.get('prefix') ?? '',
          cursor: url.searchParams.get('continuation-token') ?? undefined,
          startAfter: url.searchParams.get('start-after') ?? undefined, limit: 1000 });
        res.setHeader('Content-Type','application/xml');
        res.end(`<ListBucketResult><Name>${xml(name)}</Name><IsTruncated>${result.truncated}</IsTruncated>${result.truncated ? `<NextContinuationToken>${xml(result.cursor)}</NextContinuationToken>` : ''}${result.objects.map(o => `<Contents><Key>${xml(o.key)}</Key><Size>${o.size}</Size><LastModified>${o.uploaded.toISOString()}</LastModified><ETag>${xml(o.httpEtag)}</ETag></Contents>`).join('')}</ListBucketResult>`);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        let options;
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!match || (!match[1] && !match[2])) { res.writeHead(416).end(); return; }
          options = { range: match[1] ? { offset: Number(match[1]), ...(match[2] ? { length: Number(match[2])-Number(match[1])+1 } : {}) } : { suffix: Number(match[2]) } };
        }
        const object = await bucket.get(key, options);
        if (!object) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream');
        res.setHeader('Cache-Control', object.httpMetadata?.cacheControl ?? 'private, no-store');
        res.setHeader('ETag', object.httpEtag);
        if (req.headers.range && object.range) {
          const offset = object.range.offset ?? 0; const length = object.range.length ?? object.size - offset;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${offset}-${offset+length-1}/${object.size}`);
          res.setHeader('Content-Length', length);
        } else res.setHeader('Content-Length', object.size);
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(await object.arrayBuffer()));
      } else { res.writeHead(405).end(); }
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  // CORS preflight doesn't carry an S3 signature and performs no storage operation.
  server.prependListener('request', (req, res) => {
    if (req.method !== 'OPTIONS') return;
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,DELETE');
    }
    res.writeHead(204).end();
  });
  await new Promise((resolve, reject) => { server.once('error',reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port, close: async () => { await new Promise(resolve => server.close(resolve)); await mf.dispose(); } };
}
