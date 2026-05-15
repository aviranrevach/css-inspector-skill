// Picker integration test.
//
// Guards against the iframe-picker bug: static mode wraps the page in an iframe
// inside inspector.html, so the overlay must bind picker listeners to the
// iframe's contentDocument (not the parent document) and must wait past the
// initial about:blank doc before doing so. A regression here means clicking
// "Select" toggles the button but no click ever lands.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const PORT = 8788; // distinct from manual dev port 8787

let server;
let projectDir;
let baseUrl;

test.beforeAll(async () => {
  projectDir = mkdtempSync(join(tmpdir(), 'css-inspector-e2e-'));
  copyFileSync(join(REPO, 'tests', 'fixture.html'), join(projectDir, 'index.html'));
  mkdirSync(join(projectDir, '.inspector'));
  copyFileSync(join(REPO, 'overlay.js'), join(projectDir, '.inspector', 'overlay.js'));
  copyFileSync(join(REPO, 'server.py'), join(projectDir, '.inspector', 'server.py'));

  const cssMap = {
    '.hero-title': { 'font-size': { file: 'index.html', line: 9 } },
    '.card': { padding: { file: 'index.html', line: 13 } },
  };
  writeFileSync(
    join(projectDir, '.inspector', 'inspector.html'),
    `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Inspector</title></head>
<body style="margin:0;padding:0;">
<script>window.__inspectorCssMap = ${JSON.stringify(cssMap)};</script>
<script src="overlay.js"></script>
<iframe src="../index.html" style="width:100%;height:100vh;border:none;"></iframe>
</body></html>`
  );

  server = spawn(
    'python3',
    [join(projectDir, '.inspector', 'server.py'), String(PORT), projectDir],
    { stdio: 'ignore' }
  );

  baseUrl = `http://localhost:${PORT}`;
  // Wait for the server to accept connections (up to ~3s).
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${baseUrl}/.inspector/inspector.html`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('inspector server did not start on port ' + PORT);
});

test.afterAll(() => {
  if (server) server.kill();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

test('picker binds to iframe doc and selects elements', async ({ page }) => {
  await page.goto(`${baseUrl}/.inspector/inspector.html`);

  // Wait for the iframe's real document to be ready (past initial about:blank).
  await page.waitForFunction(() => {
    const ifr = document.querySelector('iframe');
    return (
      ifr &&
      ifr.contentDocument &&
      ifr.contentDocument.querySelector('.hero-title')
    );
  });

  // Empty state: selector pill shows the em-dash placeholder.
  await expect(page.locator('#__inspector-selector-pill')).toHaveText('—');

  // Enter pick mode.
  await page.locator('#__inspector-pick-btn').click();
  await expect(page.locator('#__inspector-pick-btn')).toHaveClass(/active/);

  // Click an element inside the iframe (the bug we're guarding against:
  // before the fix, this click reached the iframe doc but listeners were
  // attached to the parent doc, so the pill never updated).
  await page.frameLocator('iframe').locator('.hero-title').click();

  // Selector logic prefers id over class — fixture has id="main-heading".
  await expect(page.locator('#__inspector-selector-pill')).toHaveText('#main-heading');

  // The picker exits after a successful click.
  await expect(page.locator('#__inspector-pick-btn')).not.toHaveClass(/active/);
});

test('design panel reads computed styles from the iframe window', async ({ page }) => {
  await page.goto(`${baseUrl}/.inspector/inspector.html`);
  await page.waitForFunction(() => {
    const ifr = document.querySelector('iframe');
    return ifr && ifr.contentDocument && ifr.contentDocument.querySelector('.hero-title');
  });

  await page.locator('#__inspector-pick-btn').click();
  await page.frameLocator('iframe').locator('.hero-title').click();

  // After selection the Design tab renders inputs populated with values that
  // can only come from targetWin.getComputedStyle on the iframe element. If
  // the bug regresses and getComputedStyle reads the parent (empty) doc, the
  // inputs come back blank / "auto" for everything.
  const fontSize = await page
    .locator('input[data-prop="font-size"]')
    .first()
    .inputValue();
  expect(fontSize).toMatch(/^\d+(\.\d+)?px$/);
});

test('⇧-click in pick mode builds a selected area orthogonal to single-pick', async ({ page }) => {
  await page.goto(`${baseUrl}/.inspector/inspector.html`);
  await page.waitForFunction(() => {
    const ifr = document.querySelector('iframe');
    return (
      ifr &&
      ifr.contentDocument &&
      ifr.contentDocument.querySelector('.hero-title') &&
      ifr.contentDocument.querySelector('.hero-subtitle')
    );
  });

  // Area bar hidden at start.
  await expect(page.locator('#__inspector-area-bar')).toBeHidden();

  // Single-pick .hero-title to set the selected element + Design context.
  await page.locator('#__inspector-pick-btn').click();
  await page.frameLocator('iframe').locator('.hero-title').click();
  await expect(page.locator('#__inspector-selector-pill')).toHaveText('#main-heading');

  // Re-enter pick mode and ⇧-click .hero-subtitle to extend into area mode.
  await page.locator('#__inspector-pick-btn').click();
  await page
    .frameLocator('iframe')
    .locator('.hero-subtitle')
    .click({ modifiers: ['Shift'] });

  // Area bar visible with 2-element count.
  await expect(page.locator('#__inspector-area-bar')).toBeVisible();
  await expect(page.locator('#__inspector-area-count')).toHaveText('area · 2 els');

  // The persistent dashed outline is on exactly those two iframe elements.
  const areaInIframe = await page.evaluate(() =>
    document
      .querySelector('iframe')
      .contentDocument.querySelectorAll('.__inspector-area').length
  );
  expect(areaInIframe).toBe(2);

  // Single-element pill is unchanged — orthogonal selections.
  await expect(page.locator('#__inspector-selector-pill')).toHaveText('#main-heading');

  // Clear button empties the area and hides the bar.
  await page.locator('#__inspector-area-clear').click();
  await expect(page.locator('#__inspector-area-bar')).toBeHidden();
  const afterClear = await page.evaluate(() =>
    document
      .querySelector('iframe')
      .contentDocument.querySelectorAll('.__inspector-area').length
  );
  expect(afterClear).toBe(0);
});

test('area Copy button writes structured context to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${baseUrl}/.inspector/inspector.html`);
  await page.waitForFunction(() => {
    const ifr = document.querySelector('iframe');
    return (
      ifr &&
      ifr.contentDocument &&
      ifr.contentDocument.querySelector('.hero-title') &&
      ifr.contentDocument.querySelector('.hero-subtitle')
    );
  });

  await page.locator('#__inspector-pick-btn').click();
  await page.frameLocator('iframe').locator('.hero-title').click();
  await page.locator('#__inspector-pick-btn').click();
  await page
    .frameLocator('iframe')
    .locator('.hero-subtitle')
    .click({ modifiers: ['Shift'] });

  await page.locator('#__inspector-area-copy').click();

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toMatch(/Selected area \(2 elements\)/);
  expect(clipboard).toMatch(/#main-heading \(h1\)/);
  expect(clipboard).toMatch(/\.hero-subtitle \(p\)/);
  expect(clipboard).toMatch(/Common parent:/);
  expect(clipboard).toMatch(/Bounding box:/);
});
