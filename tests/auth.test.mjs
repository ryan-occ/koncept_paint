import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_PASSCODE = '731024';
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
let child;
let origin;
let output = '';

before(async () => {
  child = spawn(process.execPath, [serverPath, '--dev'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PASSCODE: TEST_PASSCODE,
      SESSION_SECRET: 'test-session-secret-that-is-not-a-real-credential',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Auth test server timed out.\n${output}`)), 15_000);
    const ready = (chunk) => {
      output += chunk.toString();
      const match = output.match(/Paint booth server listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        origin = `http://127.0.0.1:${match[1]}`;
        resolve();
      }
    };
    child.stdout.on('data', ready);
    child.stderr.on('data', ready);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!origin) {
        clearTimeout(timeout);
        reject(new Error(`Auth test server exited with code ${code}.\n${output}`));
      }
    });
  });
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
});

function login(passcode, ip = '198.51.100.12') {
  return fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify({ passcode }),
  });
}

test('app pages and source requests show only the passcode screen before login', async () => {
  const home = await fetch(origin);
  const loginHtml = await home.text();
  assert.equal(home.status, 200);
  assert.match(loginHtml, /Enter the six-digit passcode/);
  assert.doesNotMatch(loginHtml, /id="lockApp"/);

  const source = await fetch(`${origin}/src/main.ts`);
  assert.match(source.headers.get('content-type'), /text\/html/);
  assert.doesNotMatch(await source.text(), /initBench/);

  const status = await fetch(`${origin}/api/auth/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { configured: true, authenticated: false });
});

test('correct passcode grants an HTTP-only session that can be locked again', async () => {
  const wrong = await login('000000');
  assert.equal(wrong.status, 401);

  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.13',
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({ passcode: TEST_PASSCODE }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  const cookie = setCookie.split(';')[0];

  const status = await fetch(`${origin}/api/auth/status`, { headers: { Cookie: cookie } });
  assert.deepEqual(await status.json(), { configured: true, authenticated: true });

  const home = await fetch(origin, { headers: { Cookie: cookie } });
  assert.match(await home.text(), /id="lockApp"/);

  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  const locked = await fetch(`${origin}/api/auth/status`, {
    headers: { Cookie: logout.headers.get('set-cookie').split(';')[0] },
  });
  assert.deepEqual(await locked.json(), { configured: true, authenticated: false });
});

test('repeated incorrect passcodes are rate-limited', async () => {
  const ip = '198.51.100.99';
  for (let i = 0; i < 8; i += 1) {
    const response = await login('000000', ip);
    assert.equal(response.status, 401);
  }
  const blocked = await login('000000', ip);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});
