import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

const chromiumCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/repl/tools/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((path): path is string => Boolean(path));

async function findChromium() {
  for (const path of chromiumCandidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next known system location, then Playwright's managed browser.
    }
  }
  return undefined;
}

describe('paint booth browser flows', { concurrency: false }, () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let pageErrors: string[];
  let baseUrl: string;

  before(async () => {
    server = await createServer({
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
    await server.listen();
    baseUrl = server.resolvedUrls!.local[0];

    const executablePath = await findChromium();
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    });
  });

  after(async () => {
    await browser?.close();
    await server?.close();
  });

  beforeEach(async () => {
    pageErrors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.querySelector('#swHex')?.textContent !== '#000000');
  });

  afterEach(async () => {
    assert.deepEqual(pageErrors, [], 'the app should not throw browser errors');
    await page.close();
  });

  it('renders the initial 3D preview and changes shape, lighting, and coat controls', async () => {
    const initial = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#cv')!;
      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        webgl: Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')),
        previewFailureVisible: getComputedStyle(document.querySelector('#fail')!).display !== 'none',
      };
    });
    assert.ok(initial.canvasWidth > 0 && initial.canvasHeight > 0);
    assert.ok(initial.webgl, 'Three.js should have initialized a WebGL context');
    assert.equal(initial.previewFailureVisible, false);

    await page.getByRole('button', { name: 'Sphere', exact: true }).click();
    await page.getByRole('button', { name: 'Street lamps', exact: true }).click();
    assert.equal(await page.locator('#shapeSeg button[aria-pressed="true"]').textContent(), 'Sphere');
    assert.equal(await page.locator('#lightSeg button[aria-pressed="true"]').textContent(), 'Street lamps');

    await page.locator('#groundSeg').getByRole('button', { name: 'White sealer' }).click();
    assert.equal(await page.locator('#groundSeg button[aria-pressed="true"]').textContent(), 'White sealer');

    await page.locator('input[data-k="bc"]').evaluate((el: HTMLInputElement) => {
      el.value = '4';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#o_bc').textContent(), '4');
    assert.match(await page.locator('#layers').innerText(), /4/);
  });

  it('loads a preset, saves the mix, and restores it after a page reload', async () => {
    await page.getByRole('button', { name: 'Teal metallic', exact: true }).click();
    assert.equal(await page.locator('#rTitle').textContent(), 'Teal metallic');
    assert.equal(await page.locator('#o_fl').textContent(), '65%');

    await page.getByLabel('Mix name').fill('Browser saved teal');
    await page.getByRole('button', { name: 'Save mix' }).click();

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pbs-mixes') || '[]'));
    assert.equal(saved[0].n, 'Browser saved teal');
    assert.equal(saved[0].fl, 65);

    await page.reload();
    const savedButton = page.getByRole('button', { name: /Browser saved teal/ });
    await savedButton.waitFor();
    await savedButton.click();
    assert.equal(await page.locator('#rTitle').textContent(), 'Browser saved teal');
    assert.equal(await page.locator('#o_fl').textContent(), '65%');
    assert.match(await page.locator('#rBody').innerText(), /Phthalo green/);
  });

  it('restores calibration data from the backup panel and persists it', async () => {
    await page.getByText('Back up or restore calibration').click();
    const calibration = {
      t: { red: { hex: '#123456', str: 1.4 } },
      checks: [{ n: 'Browser calibration', p: '#000000', m: '#111111', de: 5.1 }],
    };
    await page.locator('#calJson').fill(JSON.stringify(calibration));
    await page.getByRole('button', { name: 'Restore from text' }).click();

    assert.equal(await page.locator('#calMsg').textContent(), 'Calibration restored.');
    assert.match(await page.locator('#checks').innerText(), /Browser calibration/);
    assert.match(await page.locator('#calStatus').innerText(), /Measured #123456/);
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem('pbs-cal') || '{}')),
      calibration,
    );

    await page.reload();
    await page.getByText('Back up or restore calibration').click();
    const restored = JSON.parse(await page.locator('#calJson').inputValue());
    assert.deepEqual(restored, calibration);
    assert.match(await page.locator('#checks').innerText(), /Browser calibration/);
  });
});
