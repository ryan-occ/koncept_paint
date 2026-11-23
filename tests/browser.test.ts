import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
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

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export saved mixes' }).click(),
    ]);
    const downloadPath = await download.path();
    assert.ok(downloadPath);
    const backup = JSON.parse(await readFile(downloadPath, 'utf8'));
    assert.equal(backup.format, 'koncept-paint-mixes');
    assert.equal(backup.version, 1);
    assert.equal(backup.mixes[0].n, 'Browser saved teal');

    const invalidBackup = { ...backup, mixes: [{ ...backup.mixes[0], fl: -1 }] };
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Import backup' }).click(),
    ]);
    await chooser.setFiles({
      name: 'invalid-mixes.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(invalidBackup)),
    });
    await page.waitForFunction(() => document.querySelector('#mixBackupMsg')?.textContent?.includes('invalid mix'));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pbs-mixes') || '[]')), saved);

    const validBackup = {
      ...backup,
      mixes: [
        { ...backup.mixes[0], fl: 72 },
        { ...backup.mixes[0], n: 'Imported teal copy' },
      ],
    };
    await page.locator('#mixImportFile').setInputFiles({
      name: 'paint-mixes.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(validBackup)),
    });
    await page.waitForFunction(() => document.querySelector('#mixBackupMsg')?.textContent?.includes('Imported 2 mixes'));
    const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('pbs-mixes') || '[]'));
    assert.equal(imported.length, 2);
    assert.equal(imported.find((mix: { n: string }) => mix.n === 'Browser saved teal').fl, 72);

    await page.reload();
    const savedButton = page.getByRole('button', { name: /Browser saved teal/ });
    await savedButton.waitFor();
    await savedButton.click();
    assert.equal(await page.locator('#rTitle').textContent(), 'Browser saved teal');
    assert.equal(await page.locator('#o_fl').textContent(), '72%');
    assert.match(await page.locator('#rBody').innerText(), /Phthalo green/);
    await page.getByRole('button', { name: /Imported teal copy/ }).click();
    assert.equal(await page.locator('#rTitle').textContent(), 'Imported teal copy');
    assert.equal(await page.locator('#o_fl').textContent(), '65%');
  });

  it('searches for black cherry, shows the match, and loads its formula into the bench', async () => {
    await page.getByRole('searchbox', { name: 'Search colours' }).fill('black cherry');
    const result = page.locator('#colorResults').getByRole('button', { name: /Black cherry/ });
    await result.waitFor();
    await result.click();
    await page.getByRole('button', { name: 'Load into bench' }).waitFor();

    const match = page.locator('#matchOut');
    assert.match(await match.innerText(), /Black cherry/);
    assert.match(await match.innerText(), /ΔE \d+\.\d/);
    assert.deepEqual(
      await match.locator('.pair > div').allTextContents(),
      ['Target', 'Predicted'],
    );
    const swatches = await match.locator('.pair i').evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).backgroundColor),
    );
    assert.equal(swatches.length, 2);
    assert.ok(swatches.every((color) => color !== 'rgba(0, 0, 0, 0)'));

    await page.getByRole('button', { name: 'Load into bench' }).click();
    assert.equal(await page.locator('#mixName').inputValue(), 'Black cherry');
    assert.equal(await page.locator('#rTitle').textContent(), 'Black cherry');
    assert.equal(await page.locator('#groundSeg button[aria-pressed="true"]').textContent(), 'Black sealer');
    assert.equal(await page.locator('select#m1').inputValue(), 'int_red');
  });

  it('matches a car colour from multiple angle photos and loads the closest mix', async () => {
    const svg = (colour: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="${colour}"/></svg>`;
    await page.locator('#photoMatchFiles').setInputFiles([
      { name: 'front.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg('#8c8d8a')) },
      { name: 'side.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg('#8c8d8a')) },
      { name: 'glare.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg('#ffffff')) },
    ]);
    await page.locator('#photoAngles canvas').nth(0).waitFor();
    assert.equal(await page.locator('#photoAngles canvas').count(), 3);

    for (const canvas of await page.locator('#photoAngles canvas').all()) await canvas.click();
    await page.getByLabel('Viewing angle for photo 3').selectOption('grazing');
    await page.locator('#finishSel').selectOption('pearl');
    await page.getByRole('button', { name: 'Find closest available mix' }).click();
    await page.getByRole('button', { name: 'Load into bench' }).waitFor();

    const match = page.locator('#matchOut');
    const matchText = await match.innerText();
    assert.match(matchText, /Photo estimate · 3 views/);
    assert.match(matchText, /Mean ΔE \d+\.\d/);
    assert.match(matchText, /Angle effect check/);
    assert.match(matchText, /Observed shift .* modelled shift/);
    assert.equal(await match.locator('.angle-reading').count(), 3);
    assert.ok([
      'No meaningful angle shift',
      'explain this angle shift',
      'explain part of this angle shift',
      'do not explain this angle shift',
    ].some((phrase) => matchText.includes(phrase)));
    assert.match(await page.locator('#photoMatchStatus').textContent() ?? '', /Matching 3 sampled views/);
    await page.getByRole('button', { name: 'Load into bench' }).click();
    assert.equal(await page.locator('#mixName').inputValue(), 'Photo estimate · 3 views');
  });

  it('corrects a known colour cast with a neutral reference in each photo', async () => {
    const srgb = (linear: number) =>
      Math.round((linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055) * 255)
        .toString(16).padStart(2, '0');
    const cast = (hex: string, gains: number[]) => {
      const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
      const linear = values.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return `#${linear.map((value, index) => srgb(value * gains[index])).join('')}`;
    };
    const svg = (paint: string, reference: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="90" height="120" fill="${paint}"/><rect x="90" width="90" height="120" fill="${reference}"/></svg>`;
    const actualPaint = '#788ca0';
    const actualReference = '#808080';
    assert.equal(await page.locator('#photoReferenceColorRow').isVisible(), false);
    await page.locator('#photoReferenceTarget').selectOption('custom');
    assert.equal(await page.locator('#photoReferenceColorRow').isVisible(), true);
    await page.locator('#photoReferenceTarget').selectOption('gray');
    await page.locator('#photoMatchFiles').setInputFiles([
      { name: 'warm.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg(cast(actualPaint, [0.75, 1.1, 1.2]), cast(actualReference, [0.75, 1.1, 1.2]))) },
      { name: 'cool.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg(cast(actualPaint, [1.15, 0.8, 0.9]), cast(actualReference, [1.15, 0.8, 0.9]))) },
    ]);
    await page.locator('#photoAngles canvas').nth(0).waitFor();
    assert.equal(await page.locator('#photoSampleReference').getAttribute('aria-pressed'), 'true');
    for (const canvas of await page.locator('#photoAngles canvas').all()) {
      const box = await canvas.boundingBox();
      assert.ok(box);
      await canvas.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
    }
    assert.equal(await page.locator('#photoSamplePaint').getAttribute('aria-pressed'), 'true', await page.locator('#photoMatchStatus').textContent() ?? '');
    for (const canvas of await page.locator('#photoAngles canvas').all()) {
      const box = await canvas.boundingBox();
      assert.ok(box);
      await canvas.click({ position: { x: box.width * 0.25, y: box.height / 2 } });
    }
    assert.equal(await page.locator('#photoMatchBtn').isEnabled(), true);
    await page.getByRole('button', { name: 'Find closest available mix' }).click();
    await page.getByRole('button', { name: 'Load into bench' }).waitFor();
    assert.match(await page.locator('#photoMatchStatus').textContent() ?? '', /Matching 2 sampled views/);
    assert.match(await page.locator('#matchOut').innerText(), /Photo estimate · 2 views/);
  });

  it('prints the same mixing sheet on A4 or Letter paper', async () => {
    await page.evaluate(() => {
      window.print = () => {
        const root = document.documentElement;
        root.dataset.printCount = String(Number(root.dataset.printCount || 0) + 1);
      };
    });
    const paperSize = page.getByRole('combobox', { name: 'Page size' });
    assert.equal(await paperSize.inputValue(), 'A4');

    await page.getByRole('button', { name: 'Print mixing sheet' }).click();
    assert.equal(await page.locator('html').getAttribute('data-print-count'), '1');
    assert.match(await page.locator('#printPageStyle').textContent() ?? '', /size:\s*A4 portrait/);
    assert.deepEqual(
      await page.locator('#printSheet .ps-job td:nth-child(2), #printSheet .ps-job td:nth-child(4)').allTextContents(),
      ['', '', '', ''],
    );
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#printSheet').evaluate((el) => getComputedStyle(el).display), 'block');
    assert.equal(await page.locator('.wrap').evaluate((el) => getComputedStyle(el).display), 'none');
    await page.emulateMedia({ media: 'screen' });

    await page.locator('.sheet-details summary').click();
    await page.getByLabel('Job number').fill('JOB-204');
    await page.getByLabel('Vehicle / panels').fill('Van & trailer');
    await page.getByLabel('Paint system').fill('Brand <A> "Series"');
    await page.getByLabel('Technician / mixed by').fill('<img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Print mixing sheet' }).click();

    assert.equal(await page.locator('html').getAttribute('data-print-count'), '2');
    const fields = await page.locator('#printSheet .ps-job tr').evaluateAll((rows) =>
      rows.map((row) => [...row.querySelectorAll('td:nth-child(2), td:nth-child(4)')].map((cell) => cell.textContent)),
    );
    assert.deepEqual(fields, [
      ['JOB-204', 'Van & trailer'],
      ['Brand <A> "Series"', '<img src=x onerror=alert(1)>'],
    ]);
    assert.equal(await page.locator('#printSheet img').count(), 0);

    const sheetText = await page.locator('#printSheet').innerText();
    for (const stage of ['Ground coat / primer', 'Base coat', 'Candy coat', 'Clear coat']) {
      assert.ok(sheetText.includes(stage), `print sheet should include ${stage}`);
    }
    assert.match(sheetText, /JOB-204/);
    assert.match(sheetText, /Brand <A> "Series"/);

    await page.emulateMedia({ media: 'screen' });
    await paperSize.selectOption('Letter');
    await page.getByRole('button', { name: 'Print mixing sheet' }).click();
    assert.equal(await page.locator('html').getAttribute('data-print-count'), '3');
    assert.match(await page.locator('#printPageStyle').textContent() ?? '', /size:\s*Letter portrait/);
    assert.equal(await page.locator('#printSheet').innerText(), sheetText, 'paper size should not change sheet content');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#printSheet').evaluate((el) => getComputedStyle(el).display), 'block');
    assert.equal(await page.locator('.wrap').evaluate((el) => getComputedStyle(el).display), 'none');
  });

  it('restores calibration data from the backup panel and persists it', async () => {
    await page.getByText('Back up or restore calibration').click();
    const calibration = {
      t: { red: { hex: '#123456', str: [1.4, 1.4, 1.4] } },
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

    await page.locator('#calJson').fill(JSON.stringify({
      t: { red: { hex: 'not-a-colour' } },
      checks: [{ n: 'Broken check', p: '#000000', m: '#111111', de: 1 }],
    }));
    await page.getByRole('button', { name: 'Restore from text' }).click();
    assert.equal(await page.locator('#calMsg').textContent(), 'Invalid calibration backup. Existing calibration was kept.');
    assert.match(await page.locator('#checks').innerText(), /Browser calibration/);
    assert.doesNotMatch(await page.locator('#checks').innerText(), /Broken check/);
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem('pbs-cal') || '{}')),
      calibration,
    );
  });
});
