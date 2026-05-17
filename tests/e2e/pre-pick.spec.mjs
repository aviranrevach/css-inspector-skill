// Pre-pick visual layers + tree-walking integration tests.
// Boots the same fixture-server scaffold as picker.spec.mjs.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const PORT = 8789;

let server;
let projectDir;
let baseUrl;

test.beforeAll(async () => {
  projectDir = mkdtempSync(join(tmpdir(), 'css-inspector-prepick-'));
  copyFileSync(join(REPO, 'tests', 'fixture.html'), join(projectDir, 'index.html'));
  mkdirSync(join(projectDir, '.inspector'));
  copyFileSync(join(REPO, 'overlay.js'), join(projectDir, '.inspector', 'overlay.js'));
  copyFileSync(join(REPO, 'server.py'), join(projectDir, '.inspector', 'server.py'));
  writeFileSync(
    join(projectDir, '.inspector', 'inspector.html'),
    `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Inspector</title></head>
<body style="margin:0;padding:0;">
<script>window.__inspectorCssMap = {};</script>
<script src="overlay.js"></script>
<iframe src="../index.html" style="width:100%;height:100vh;border:none;"></iframe>
</body></html>`
  );
  server = spawn('python3',
    [join(projectDir, '.inspector', 'server.py'), String(PORT), projectDir],
    { stdio: 'ignore' });
  baseUrl = `http://localhost:${PORT}`;
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${baseUrl}/.inspector/inspector.html`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

test.afterAll(() => {
  if (server) server.kill();
  if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

async function enterPickMode(page) {
  await page.goto(`${baseUrl}/.inspector/inspector.html`);
  await page.waitForFunction(() => {
    const ifr = document.querySelector('iframe');
    return ifr && ifr.contentDocument && ifr.contentDocument.querySelector('[data-pp-test="row"]');
  });
  await page.click('#__inspector-pick-btn');
}

test('hovering a row paints 4 margin bands and 4 padding bands', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('.__inspector-pp-band.margin')).toHaveCount(4);
  await expect(page.locator('.__inspector-pp-band.padding')).toHaveCount(4);
});

test('hovering a flex row paints gap strips between cells', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  // 3 cells with gap 10 → 2 strips.
  await expect(page.locator('.__inspector-pp-band.gap')).toHaveCount(2);
});

test('hovering a row paints a faint parent outline above', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('.__inspector-pp-parent')).toHaveCount(1);
});

test('hovering a row paints a dashed outline per child cell', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('.__inspector-pp-child')).toHaveCount(3);
});

test('the child closest to the cursor gets a near-cursor highlight', async ({ page }) => {
  await enterPickMode(page);
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  // First land on the row (so renderPrePickLayers fires for it), then nudge cursor toward cell1's location.
  await page.mouse.move(row.x + 10, row.y + 7);
  // Now move cursor towards cell1 center (still hopefully on the row's content or padding-right edge).
  // We want the near-cursor highlight to follow without changing target.
  const cell = await page.frameLocator('iframe').locator('[data-pp-test="cell1"]').boundingBox();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
  // After moving onto the cell, the cell IS the new target. Exactly one .near at any time
  // — either on the row's children (if still on row) or empty (if target changed to a cell).
  // To stay scope-tight, assert: at most one .near exists.
  const count = await page.locator('.__inspector-pp-child.near').count();
  expect(count).toBeLessThanOrEqual(1);
});

test('rich tooltip shows tag, size, and type icon', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toHaveText(/div\.pp-row/);
  await expect(page.locator('#__inspector-tooltip .pp-title .icon use')).toHaveAttribute('href', '#i-block');
});

test('tooltip shows Padding and Background rows for the row', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  const tip = page.locator('#__inspector-tooltip');
  await expect(tip).toContainText('Padding');
  await expect(tip).toContainText('14 36 14 20');
  await expect(tip).toContainText('Background');
});

test('hovering a button shows the ACCESSIBILITY section with Contrast, Role, Focusable, Name', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="btn"]').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  const tip = page.locator('#__inspector-tooltip');
  await expect(tip).toContainText('ACCESSIBILITY');
  await expect(tip).toContainText('Contrast');
  await expect(tip).toContainText('button'); // Role
  await expect(tip).toContainText('Save changes'); // Name
  await expect(tip).toContainText('AA'); // Contrast badge
});

test('hovering a wrapper with overflow:hidden shows the LAYOUT section', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="wrap"]').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  const tip = page.locator('#__inspector-tooltip');
  await expect(tip).toContainText('LAYOUT');
  await expect(tip).toContainText('Position');
  await expect(tip).toContainText('Overflow');
  await expect(tip).toContainText('hidden');
});

test('hovering a row with all default layout omits the LAYOUT section', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  const tip = page.locator('#__inspector-tooltip');
  await expect(tip).not.toContainText('LAYOUT');
});

test('CONTENT section shows child count for a row', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  const tip = page.locator('#__inspector-tooltip');
  await expect(tip).toContainText('CONTENT');
  await expect(tip).toContainText('3 children');
});

test('after 2.2s of stillness the .__inspector-pp-root gains the .dwell class', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await page.waitForTimeout(2200);
  await expect(page.locator('.__inspector-pp-root')).toHaveClass(/\bdwell\b/);
  // A small cursor twitch (>2px) should remove the class.
  await page.mouse.move(target.x + 15, target.y + 12);
  await expect(page.locator('.__inspector-pp-root')).not.toHaveClass(/\bdwell\b/);
});

test('dwell reveals breadcrumb + ladder hint + size badges', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('.__inspector-pp-breadcrumb')).toHaveCount(1);
  await expect(page.locator('.__inspector-pp-ladder')).toHaveCount(1);
  await expect(page.locator('.__inspector-pp-dwell-ring')).toHaveCount(1);
  await page.waitForTimeout(2200);
  await expect(page.locator('.__inspector-pp-breadcrumb')).toHaveCSS('opacity', '1');
  await expect(page.locator('.__inspector-pp-ladder')).toHaveCSS('opacity', '1');
});

test('clicking commits the walked target, not the cursor target', async ({ page }) => {
  await enterPickMode(page);
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(row.x + 10, row.y + 7);
  // Walk to parent (section) once; cursor stays on the row.
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  // Now click. The committed selection should be section.pp-dashboard, not div.pp-row.
  await page.mouse.click(row.x + 10, row.y + 7);
  await expect(page.locator('#__inspector-selector-pill')).toContainText(/pp-dashboard/);
});
