import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = resolve(root, '.local/development/environment.json');

const fail = message => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  fail('Local environment manifest not found. Run `npm run env:setup` first.');
}
if (manifest.APP_ENV !== 'development') fail(`Refusing a non-development manifest (APP_ENV=${manifest.APP_ENV || 'unset'}).`);

let endpoint;
try {
  endpoint = new URL(manifest.R2_ENDPOINT);
} catch {
  fail('R2_ENDPOINT is missing from the local manifest. Re-run `npm run env:setup`.');
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) fail('Refusing a non-loopback mailbox endpoint.');

let response;
try {
  response = await fetch(`${endpoint.origin}/__mail`, {
    headers: { authorization: `Bearer ${manifest.API_SECRET}` },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
} catch {
  fail(`The local mailbox is not running at ${endpoint.origin}.
Start the full local stack with \`npm run dev\` in another terminal, then run \`npm run mail:local\` again.
The launcher owns web (3000), realtime (8787) and the mailbox/R2 service (8788) together; stop any of those started separately first.`);
}
if (response.status === 403) fail('The mailbox rejected the local API_SECRET. Restart the dev stack with `npm run dev` so it reloads the manifest.');
if (!response.ok) fail(`The mailbox returned HTTP ${response.status} from ${endpoint.origin}/__mail.`);

const messages = await response.json();
if (!Array.isArray(messages)) fail('The mailbox returned an unexpected response.');

const recipient = message => (Array.isArray(message.to) ? message.to.join(', ') : String(message.to ?? '(no recipient)'));
const codes = message => [...new Set(String(`${message.subject ?? ''}\n${message.text ?? ''}`).match(/\b\d{6}\b/g) ?? [])];
const links = message => [...new Set((String(message.text ?? '').match(/https?:\/\/[^\s<>"')]+/g) ?? [])
  .map(link => link.replace(/[.,;:!?]+$/, '')))];

console.log(`Local mailbox: ${messages.length} message${messages.length === 1 ? '' : 's'} at ${endpoint.origin}`);
console.log('Newest first. The mailbox lives in memory and resets when the dev stack stops.\n');
if (!messages.length) {
  console.log('No messages captured yet. Request a verification code, then run this again.');
  process.exit(0);
}
for (let index = messages.length - 1; index >= 0; index -= 1) {
  const message = messages[index];
  console.log(`[${index + 1}] ${recipient(message)}`);
  console.log(`    ${String(message.subject ?? '(no subject)')}`);
  const foundCodes = codes(message);
  if (foundCodes.length) console.log(`    code: ${foundCodes.join('  ')}`);
  for (const link of links(message).slice(0, 3)) console.log(`    link: ${link}`);
  console.log('');
}
