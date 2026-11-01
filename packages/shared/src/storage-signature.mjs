import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Verify SDK headers and presigned URLs; private objects are never unsigned. */
export function signedRequest(req, url, body, secret, accessKey = 'local-development') {
  const query = url.searchParams;
  const authorization = req.headers.authorization ?? '';
  const credential = query.get('X-Amz-Credential') ?? /Credential=([^, ]+)/.exec(authorization)?.[1];
  const signedHeaders = query.get('X-Amz-SignedHeaders') ?? /SignedHeaders=([^, ]+)/.exec(authorization)?.[1];
  const signature = query.get('X-Amz-Signature') ?? /Signature=([a-f0-9]+)/.exec(authorization)?.[1];
  const date = query.get('X-Amz-Date') ?? req.headers['x-amz-date'];
  if (!credential || !signedHeaders || !signature || !date) return false;
  const [access, day, region, service, ending] = credential.split('/');
  if (access !== accessKey || service !== 's3' || ending !== 'aws4_request') return false;
  const timestamp = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  const age = (Date.now() - timestamp) / 1000;
  const expires = query.has('X-Amz-Signature') ? Number(query.get('X-Amz-Expires')) : 300;
  if (!Number.isFinite(age) || age < -300 || !Number.isFinite(expires) || expires < 1 || expires > 3600 || age > expires) return false;
  const canonicalQuery = [...query].filter(([k]) => k !== 'X-Amz-Signature')
    .map(([k,v]) => [encode(k), encode(v)]).sort(([a,av],[b,bv]) => a.localeCompare(b, 'en', { sensitivity:'variant' }) || av.localeCompare(bv))
    .map(([k,v]) => `${k}=${v}`).join('&');
  // AWS sorts encoded query bytes, not locale collation.
  const orderedQuery = canonicalQuery.split('&').sort().join('&');
  const headers = signedHeaders.split(';').map(name => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g,' ')}\n`).join('');
  const payload = query.get('X-Amz-Content-Sha256') ?? req.headers['x-amz-content-sha256'] ?? 'UNSIGNED-PAYLOAD';
  if (payload !== 'UNSIGNED-PAYLOAD' && payload !== hash(body)) return false;
  const canonical = [req.method, url.pathname, orderedQuery, headers, signedHeaders, payload].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  const expected = hmac(key, `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).toString('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

