import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(ROOT, 'dist');
const COOKIE_NAME = 'paint_session';
const SESSION_SECONDS = 8 * 60 * 60;
const RATE_WINDOW_MS = Number(process.env.AUTH_RATE_WINDOW_MS ?? 15 * 60 * 1000);
const ADDRESS_LIMIT = 8;
const GLOBAL_LIMIT = 80;
const RATE_LIMIT_LOCK_ID = 1_209_941_643;
const { Pool } = pg;
const databasePool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
  : null;

if (!Number.isSafeInteger(RATE_WINDOW_MS) || RATE_WINDOW_MS < 1000) {
  throw new Error('AUTH_RATE_WINDOW_MS must be an integer of at least 1000 milliseconds.');
}

const configured = () =>
  /^\d{6}$/.test(process.env.PASSCODE ?? '') && Boolean(process.env.SESSION_SECRET);

const sign = (expiresAt) =>
  createHmac('sha256', process.env.SESSION_SECRET)
    .update(`${expiresAt}:${process.env.PASSCODE}`)
    .digest('base64url');

function hasSession(request) {
  if (!configured()) return false;
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return false;

  const token = cookie.slice(COOKIE_NAME.length + 1);
  const [expiryText, supplied, extra] = token.split('.');
  const expiry = Number(expiryText);
  if (extra !== undefined || !Number.isSafeInteger(expiry) ||
      expiry <= Date.now() || expiry > Date.now() + SESSION_SECONDS * 1000 + 60_000) {
    return false;
  }

  const expectedBuffer = Buffer.from(sign(expiry), 'base64url');
  const suppliedBuffer = Buffer.from(supplied ?? '', 'base64url');
  return suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function clientKey(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const addresses = typeof forwarded === 'string' ? forwarded.split(',').map((value) => value.trim()) : [];
  const address = addresses.at(-1) || request.socket.remoteAddress || 'unknown';
  return `address:${createHmac('sha256', process.env.SESSION_SECRET).update(address).digest('hex')}`;
}

async function finishLoginAttempt(key, succeeded) {
  if (!databasePool) throw new Error('Shared login protection is unavailable.');

  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [RATE_LIMIT_LOCK_ID]);

    const { rows: [{ now: databaseNow }] } = await client.query('SELECT clock_timestamp() AS now');
    const nowDate = new Date(databaseNow);
    const now = nowDate.getTime();
    await client.query('DELETE FROM paint_login_attempts WHERE reset_at <= $1', [nowDate]);
    const result = await client.query(
      'SELECT bucket_key, failure_count, reset_at FROM paint_login_attempts WHERE bucket_key = ANY($1::text[])',
      [[key, 'global']],
    );
    const buckets = new Map(result.rows.map((row) => [
      row.bucket_key,
      { count: row.failure_count, resetAt: new Date(row.reset_at).getTime() },
    ]));
    const address = buckets.get(key);
    const global = buckets.get('global');
    const blockedUntil = address?.count >= ADDRESS_LIMIT
      ? address.resetAt
      : global?.count >= GLOBAL_LIMIT ? global.resetAt : 0;

    if (blockedUntil) {
      await client.query('COMMIT');
      return { blockedUntil };
    }

    if (succeeded) {
      await client.query('DELETE FROM paint_login_attempts WHERE bucket_key = $1', [key]);
    } else {
      const resetAt = new Date(now + RATE_WINDOW_MS);
      for (const bucketKey of [key, 'global']) {
        await client.query(
          `INSERT INTO paint_login_attempts (bucket_key, failure_count, reset_at)
           VALUES ($1, 1, $2)
           ON CONFLICT (bucket_key) DO UPDATE SET
             failure_count = CASE
               WHEN paint_login_attempts.reset_at <= $3 THEN 1
               ELSE paint_login_attempts.failure_count + 1
             END,
             reset_at = CASE
               WHEN paint_login_attempts.reset_at <= $3 THEN $2
               ELSE paint_login_attempts.reset_at
             END`,
          [bucketKey, resetAt, nowDate],
        );
      }
    }

    await client.query('COMMIT');
    return { blockedUntil: 0 };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

function secureHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, value, headers = {}) {
  secureHeaders(response);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

const LOGIN_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Enter passcode · Koncept Paint Booth</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#f1f2f4;color:#202124;font:16px/1.5 system-ui,sans-serif}
    main{width:min(100%,390px);padding:28px;background:#fff;border:1px solid #d9dce0;border-radius:16px;box-shadow:0 12px 36px #17203312}
    h1{margin:0 0 8px;font-size:25px;line-height:1.15}
    p{margin:0 0 20px;color:#5f6368}
    label{display:block;margin-bottom:7px;font-weight:600}
    input{width:100%;height:52px;padding:0 14px;border:1px solid #b7bbc1;border-radius:9px;font:600 24px/1 system-ui,sans-serif;letter-spacing:.35em;text-align:center}
    input:focus{outline:2px solid #f5b900;outline-offset:2px}
    button{width:100%;min-height:46px;margin-top:14px;border:0;border-radius:9px;background:#f5b900;color:#231c00;font:600 15px system-ui,sans-serif;cursor:pointer}
    button:disabled{opacity:.6;cursor:wait}
    #message{min-height:24px;margin:12px 0 0;color:#a32020}
    .setup{padding:12px;border-radius:8px;background:#fff6d7;color:#514000}
  </style>
</head>
<body>
  <main>
    <h1>Paint booth simulator</h1>
    ${configured()
      ? `<p>Enter the six-digit passcode to continue. Your session lasts up to eight hours.</p>
         <form id="unlock">
           <label for="passcode">Passcode</label>
           <input id="passcode" name="passcode" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="current-password" required autofocus>
           <button id="submit" type="submit">Enter app</button>
           <p id="message" role="status" aria-live="polite"></p>
         </form>`
      : `<p class="setup">Access is not configured. Add a six-digit <strong>PASSCODE</strong> and a <strong>SESSION_SECRET</strong> in Replit Secrets, then restart the app.</p>`}
  </main>
  ${configured() ? `<script>
    const form = document.querySelector('#unlock');
    const input = document.querySelector('#passcode');
    const button = document.querySelector('#submit');
    const message = document.querySelector('#message');
    input.addEventListener('input', () => { input.value = input.value.replace(/[^0-9]/g, '').slice(0, 6); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      message.textContent = '';
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: input.value })
        });
        const result = await response.json();
        if (response.ok) {
          location.replace('/');
          return;
        }
        message.textContent = result.error || 'Unable to enter the app.';
      } catch {
        message.textContent = 'Could not reach the app. Try again.';
      } finally {
        button.disabled = false;
      }
    });
  </script>` : ''}
</body>
</html>`;

function sendLoginPage(request, response) {
  secureHeaders(response);
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(request.method === 'HEAD' ? undefined : LOGIN_PAGE);
}

async function readJson(request) {
  const length = Number(request.headers['content-length'] ?? 0);
  if (length > 1024) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid request.'), { status: 400 });
  }
}

function setSessionCookie(request, response) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const secure = process.env.NODE_ENV === 'production' ||
    request.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
  response.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${expiresAt}.${sign(expiresAt)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`);
}

async function handleRequest(request, response, { dev, vite }) {
  secureHeaders(response);
  let url;
  try {
    url = new URL(request.url ?? '/', 'http://app.local');
  } catch {
    response.writeHead(400).end('Invalid URL');
    return;
  }

  if (url.pathname === '/api/auth/status' && request.method === 'GET') {
    if (!configured()) return sendJson(response, 503, { configured: false, authenticated: false });
    return sendJson(response, 200, { configured: true, authenticated: hasSession(request) });
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (!configured()) return sendJson(response, 503, { error: 'Passcode access is not configured.' });
    const key = clientKey(request);
    let failure;
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      failure = { status: 415, error: 'Use the passcode form to continue.' };
    } else {
      try {
        const body = await readJson(request);
        if (typeof body?.passcode !== 'string' || !/^\d{6}$/.test(body.passcode)) {
          failure = { status: 400, error: 'Enter a six-digit passcode.' };
        } else {
          const submitted = Buffer.from(body.passcode);
          const expected = Buffer.from(process.env.PASSCODE);
          if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
            failure = { status: 401, error: 'That passcode did not match. Try again.' };
          }
        }
      } catch (error) {
        failure = { status: error.status ?? 400, error: error.message };
      }
    }

    let rateLimit;
    try {
      rateLimit = await finishLoginAttempt(key, !failure);
    } catch {
      return sendJson(response, 503, { error: 'Login protection is temporarily unavailable. Try again later.' });
    }
    if (rateLimit.blockedUntil) {
      const now = Date.now();
      return sendJson(response, 429, { error: 'Too many attempts. Wait before trying again.' }, {
        'Retry-After': String(Math.max(1, Math.ceil((rateLimit.blockedUntil - now) / 1000))),
      });
    }
    if (failure) return sendJson(response, failure.status, { error: failure.error });
    setSessionCookie(request, response);
    return sendJson(response, 200, { authenticated: true });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const secure = process.env.NODE_ENV === 'production' ||
      request.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
    response.setHeader('Set-Cookie',
      `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`);
    return sendJson(response, 200, { authenticated: false });
  }

  if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Not found.' });
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
  }
  if (!hasSession(request)) return sendLoginPage(request, response);

  if (dev) {
    vite.middlewares(request, response, (error) => {
      if (error) {
        console.error('Development server request failed.');
        if (!response.headersSent) {
          response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Development server error.');
        } else if (!response.writableEnded) {
          response.end();
        }
      } else if (!response.writableEnded && !response.headersSent) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found.');
      }
    });
    return;
  }

  let filePath;
  try {
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    filePath = resolve(DIST, relativePath);
  } catch {
    response.writeHead(400).end('Invalid path');
    return;
  }
  if (filePath !== DIST && !filePath.startsWith(`${DIST}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
    };
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found.');
  }
}

export async function startServer({ dev = process.argv.includes('--dev') } = {}) {
  let vite;
  const server = createServer((request, response) => {
    void handleRequest(request, response, { dev, vite }).catch((error) => {
      console.error('Request failed.');
      if (!response.headersSent) {
        secureHeaders(response);
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Internal server error.');
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });

  if (dev) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
    });
  }

  const port = Number(process.env.PORT ?? 5000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolveListen);
  });
  const actualPort = server.address()?.port;
  console.log(`Paint booth server listening on http://0.0.0.0:${actualPort}`);
  if (!configured()) {
    console.error('Configure PASSCODE (six digits) and SESSION_SECRET in Replit Secrets.');
  }

  const close = async () => {
    await vite?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await databasePool?.end();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return { server, vite, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
