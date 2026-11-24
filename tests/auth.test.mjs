import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const TEST_PASSCODE = '731024';
const TEST_SESSION_SECRET = 'test-session-secret-that-is-not-a-real-credential';
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
const servers = [];
let origin;
let output = '';
const { Pool } = pg;

async function loginAttemptTableAvailable() {
  if (!process.env.DATABASE_URL) return false;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, max: 1 });
  try {
    const { rows: [{ table_name: tableName }] } = await pool.query(
      "SELECT to_regclass('paint_login_attempts') AS table_name",
    );
    return Boolean(tableName);
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const databaseAvailable = await loginAttemptTableAvailable();

async function startServer({ useDatabase = true, idleTimeoutMs = 30 * 60 * 1000 } = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PASSCODE: TEST_PASSCODE,
    SESSION_SECRET: TEST_SESSION_SECRET,
    AUTH_RATE_WINDOW_MS: '2500',
    AUTH_IDLE_TIMEOUT_MS: String(idleTimeoutMs),
    PORT: '0',
  };
  if (!useDatabase) delete env.DATABASE_URL;

  const child = spawn(process.execPath, [serverPath, '--dev'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const server = { child, origin: undefined };
  servers.push(server);
  await new Promise((resolve, reject) => {
    let serverOutput = '';
    const timeout = setTimeout(() => reject(new Error(`Auth test server timed out.\n${serverOutput}`)), 15_000);
    const ready = (chunk) => {
      const text = chunk.toString();
      serverOutput += text;
      output += text;
      const match = serverOutput.match(/Paint booth server listening on http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        server.origin = `http://127.0.0.1:${match[1]}`;
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
      if (!server.origin) {
        clearTimeout(timeout);
        reject(new Error(`Auth test server exited with code ${code}.\n${serverOutput}`));
      }
    });
  });
  return server;
}

before(async () => {
  const primary = await startServer();
  origin = primary.origin;
});

after(async () => {
  await Promise.all(servers.map(async ({ child }) => {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }));
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
  assert.match(loginHtml, /src="\/koncept-mark\.png"/);
  assert.doesNotMatch(loginHtml, /id="lockApp"/);

  const brand = await fetch(`${origin}/koncept-mark.png`);
  assert.equal(brand.status, 200);
  assert.equal(brand.headers.get('content-type'), 'image/png');
  assert.match(brand.headers.get('cache-control') ?? '', /public/);
  assert.deepEqual(Buffer.from(await brand.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const source = await fetch(`${origin}/src/main.ts`);
  assert.match(source.headers.get('content-type'), /text\/html/);
  assert.doesNotMatch(await source.text(), /initBench/);

  const status = await fetch(`${origin}/api/auth/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    configured: true,
    authenticated: false,
    idleTimeoutMs: 30 * 60 * 1000,
  });
});

test('correct passcode grants an HTTP-only session that can be locked again', {
  skip: !databaseAvailable,
}, async () => {
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
  assert.deepEqual(await status.json(), {
    configured: true,
    authenticated: true,
    idleTimeoutMs: 30 * 60 * 1000,
  });

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
  assert.deepEqual(await locked.json(), {
    configured: true,
    authenticated: false,
    idleTimeoutMs: 30 * 60 * 1000,
  });
});

test('idle sessions expire, while activity renews the deadline without extending the eight-hour limit', async () => {
  const idleTimeoutMs = 1600;
  const idleServer = await startServer({ useDatabase: false, idleTimeoutMs });
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  const idleExpiresAt = Date.now() + idleTimeoutMs;
  const signature = createHmac('sha256', TEST_SESSION_SECRET)
    .update(`${expiresAt}:${idleExpiresAt}:${TEST_PASSCODE}`)
    .digest('base64url');
  let cookie = `paint_session=${expiresAt}.${idleExpiresAt}.${signature}`;
  const initialStatus = await fetch(`${idleServer.origin}/api/auth/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal((await initialStatus.json()).authenticated, true);
  assert.equal(initialStatus.headers.get('set-cookie'), null);

  const initialCookieResponse = await fetch(`${idleServer.origin}/api/auth/activity`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(initialCookieResponse.status, 200);
  cookie = initialCookieResponse.headers.get('set-cookie').split(';')[0];
  assert.match(initialCookieResponse.headers.get('set-cookie'), /Max-Age=2/);
  assert.equal(cookie.split('=')[1].split('.')[0], String(expiresAt));

  await new Promise((resolve) => setTimeout(resolve, 950));
  const activity = await fetch(`${idleServer.origin}/api/auth/activity`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(activity.status, 200);
  cookie = activity.headers.get('set-cookie').split(';')[0];
  assert.equal(cookie.split('=')[1].split('.')[0], String(expiresAt));

  await new Promise((resolve) => setTimeout(resolve, 950));
  const activeStatus = await fetch(`${idleServer.origin}/api/auth/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal((await activeStatus.json()).authenticated, true);

  await new Promise((resolve) => setTimeout(resolve, 1750));
  const expiredStatus = await fetch(`${idleServer.origin}/api/auth/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal((await expiredStatus.json()).authenticated, false);
  assert.match(expiredStatus.headers.get('set-cookie'), /Max-Age=0/);

  const expiredPage = await fetch(idleServer.origin, { headers: { Cookie: cookie } });
  assert.match(await expiredPage.text(), /Enter the six-digit passcode/);
  assert.match(expiredPage.headers.get('set-cookie'), /Max-Age=0/);
});

test('repeated incorrect passcodes are rate-limited', { skip: !databaseAvailable }, async () => {
  const ip = '198.51.100.99';
  for (let i = 0; i < 8; i += 1) {
    const response = await login('000000', ip);
    assert.equal(response.status, 401);
  }
  const blocked = await login('000000', ip);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('failed-login limits are shared across server instances', { skip: !databaseAvailable }, async () => {
  const secondServer = await startServer();
  const ip = '198.51.100.101';

  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => {
    const serverOrigin = i % 2 === 0 ? origin : secondServer.origin;
    return fetch(`${serverOrigin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ passcode: '000000' }),
    });
  }));
  const statuses = await Promise.all(responses.map((response) => response.status));
  assert.equal(statuses.filter((status) => status === 401).length, 8);
  assert.equal(statuses.filter((status) => status === 429).length, 4);
  const blocked = await login('000000', ip);
  assert.equal(blocked.status, 429);
});

test('expired limits allow another attempt after the window', { skip: !databaseAvailable }, async () => {
  const ip = '198.51.100.102';
  for (let i = 0; i < 8; i += 1) {
    assert.equal((await login('000000', ip)).status, 401);
  }
  assert.equal((await login('000000', ip)).status, 429);
  await new Promise((resolve) => setTimeout(resolve, 2600));
  assert.equal((await login('000000', ip)).status, 401);
});

test('a successful login clears that address’s failure limit', { skip: !databaseAvailable }, async () => {
  const ip = '198.51.100.103';
  for (let i = 0; i < 7; i += 1) {
    assert.equal((await login('000000', ip)).status, 401);
  }
  assert.equal((await login(TEST_PASSCODE, ip)).status, 200);
  for (let i = 0; i < 8; i += 1) {
    assert.equal((await login('000000', ip)).status, 401);
  }
  assert.equal((await login('000000', ip)).status, 429);
});

test('login fails closed when the shared database is not configured', async () => {
  const server = await startServer({ useDatabase: false });
  const response = await fetch(`${server.origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: TEST_PASSCODE }),
  });
  assert.equal(response.status, 503);
});

test('login failures and server errors never log passcodes or session secrets', () => {
  assert.doesNotMatch(output, new RegExp(TEST_PASSCODE));
  assert.doesNotMatch(output, new RegExp(TEST_SESSION_SECRET));
});
