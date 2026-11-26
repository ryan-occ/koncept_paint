import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Runs without a database: the server keeps the library in memory when DATABASE_URL is unset.
const PASSCODE = '482915';
const SESSION_SECRET = 'library-test-session-secret-not-a-real-credential';
const LIBRARY_KEY = 'library-test-key-0123456789abcdefghijklmnop';
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
let child;
let origin;

before(async () => {
  const env = {
    ...process.env, NODE_ENV: 'development', PASSCODE, SESSION_SECRET,
    PAINT_LIBRARY_KEY: LIBRARY_KEY, PORT: '0',
  };
  delete env.DATABASE_URL;
  child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  origin = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`Server timed out.\n${out}`)), 15_000);
    const onData = (chunk) => {
      out += chunk;
      const match = out.match(/listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}.\n${out}`)); });
  });
});

after(() => child?.kill());

/** A session cookie signed the same way server.mjs signs one after a correct passcode. */
function sessionCookie() {
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const idleExpiresAt = Date.now() + 10 * 60 * 1000;
  const signature = createHmac('sha256', SESSION_SECRET)
    .update(`${expiresAt}:${idleExpiresAt}:${PASSCODE}`).digest('base64url');
  return `paint_session=${expiresAt}.${idleExpiresAt}.${signature}`;
}

const paint = (name, extra = {}) => ({
  name, hex: '#1a6f7a', finish: 'gloss clear, medium metallic flake (65%)',
  recipe: { n: name, t: { green: 3 } }, source: 'custom', ...extra,
});

const json = (method, path, body, headers = {}) => fetch(`${origin}${path}`, {
  method,
  headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const signedIn = (method, path, body) => json(method, path, body, { Cookie: sessionCookie() });
const kits = (key = LIBRARY_KEY) => json('GET', '/api/library/export', undefined, { Authorization: `Bearer ${key}` });

test('the library needs a signed-in browser', async () => {
  assert.equal((await json('GET', '/api/library')).status, 401);
  assert.equal((await json('PUT', '/api/library', { paints: [paint('Nope')] })).status, 401);
  assert.equal((await json('DELETE', '/api/library/1')).status, 401);
});

test('Koncept Kits needs the right key', async () => {
  assert.equal((await json('GET', '/api/library/export')).status, 401);
  assert.equal((await kits('wrong-key-wrong-key-wrong-key-wrong-key')).status, 401);
  assert.equal((await kits()).status, 200);
});

test('saving, sharing, replacing and removing paints', async () => {
  let res = await signedIn('PUT', '/api/library', {
    paints: [paint('Teal metallic'), paint('Violet flip', { hex2: '#2f9e5b', shiftLabel: 'ghost violet / ghost green' })],
  });
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.saved, 2);
  assert.deepEqual(body.paints.map((p) => p.name), ['Teal metallic', 'Violet flip']);
  assert.deepEqual(body.paints[0].recipe, { n: 'Teal metallic', t: { green: 3 } });

  // Same name, different case: replaces instead of duplicating.
  res = await signedIn('PUT', '/api/library', { paints: [paint('TEAL METALLIC', { hex: '#225566' })] });
  body = await res.json();
  assert.equal(body.paints.length, 2);
  assert.equal(body.paints[0].hex, '#225566');

  const shared = (await (await kits()).json()).paints;
  assert.equal(shared.length, 2);
  const flip = shared.find((p) => p.name === 'Violet flip');
  assert.equal(flip.hex2, '#2f9e5b');
  assert.equal(flip.shiftLabel, 'ghost violet / ghost green');
  assert.equal('recipe' in flip, false, 'Kits does not receive recipes');
  assert.equal('hex2' in shared.find((p) => p.name === 'TEAL METALLIC'), false);

  res = await signedIn('DELETE', `/api/library/${flip.id}`);
  assert.equal(res.status, 204);
  assert.equal((await signedIn('DELETE', `/api/library/${flip.id}`)).status, 404);
  assert.equal((await (await kits()).json()).paints.length, 1);
});

test('invalid saves change nothing', async () => {
  const before = (await (await signedIn('GET', '/api/library')).json()).paints;
  const res = await signedIn('PUT', '/api/library', { paints: [paint('Fine'), paint('Bad', { hex: 'blue' })] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Bad: the main colour/);
  assert.deepEqual((await (await signedIn('GET', '/api/library')).json()).paints, before);

  const plain = await fetch(`${origin}/api/library`, {
    method: 'PUT', headers: { Cookie: sessionCookie(), 'Content-Type': 'text/plain' }, body: '{}',
  });
  assert.equal(plain.status, 415);
});
