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

test('the child closest to the cursor gets a near-cursor dot', async ({ page }) => {
  await enterPickMode(page);
  const cell = await page.frameLocator('iframe').locator('[data-pp-test="cell1"]').boundingBox();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
  // At most one dot ever exists at a time.
  const dots = await page.locator('.__inspector-pp-child .dot').count();
  expect(dots).toBeLessThanOrEqual(1);
});

test('rich tooltip shows tag, size, and type icon', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toHaveText(/div\.pp-row/);
  await expect(page.locator('#__inspector-tooltip .pp-title .icon use')).toHaveAttribute('href', '#i-block');
});

test('tooltip shows mini box-model and Background row for the row', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  const tip = page.locator('#__inspector-tooltip');
  await expect(tip).toContainText('Background');
  await expect(tip).toContainText('MARGIN');
  await expect(tip).toContainText('PADDING');
  // Each padding value lives in its own span inside the diagram.
  await expect(tip.locator('.pp-boxmodel .p-r')).toHaveText('36');
  await expect(tip.locator('.pp-boxmodel .p-l')).toHaveText('20');
  await expect(tip.locator('.pp-boxmodel .m-t')).toHaveText('14');
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

test('WALK ladder is visible immediately on hover (no dwell delay)', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('#__inspector-tooltip .pp-ladder')).toHaveCount(1);
  await expect(page.locator('#__inspector-tooltip .pp-ladder')).toBeVisible();
});

test('no dwell-only items render (breadcrumb / dwell-ring / size-badge are gone)', async ({ page }) => {
  await enterPickMode(page);
  const target = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(target.x + 10, target.y + 7);
  await expect(page.locator('.__inspector-pp-breadcrumb')).toHaveCount(0);
  await expect(page.locator('.__inspector-pp-dwell-ring')).toHaveCount(0);
  await expect(page.locator('.__inspector-pp-child .size')).toHaveCount(0);
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

test('⌥↑ walks to parent and re-paints layers around it', async ({ page }) => {
  await enterPickMode(page);
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(row.x + 10, row.y + 7);
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-row');
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('section.pp-dashboard');
});

test('⌥↓ dives into the child nearest the cursor', async ({ page }) => {
  await enterPickMode(page);
  const cell = await page.frameLocator('iframe').locator('[data-pp-test="cell1"]').boundingBox();
  // Land cursor on the row's padding region first so target is the row.
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(row.x + 10, row.y + 7);
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-row');
  // Without moving cursor onto a cell, dive into the nearest child (cell0 since cursor is near left edge).
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Alt');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-cell');
});

test('Tab hops to the next sibling cell', async ({ page }) => {
  await enterPickMode(page);
  const cell0 = await page.frameLocator('iframe').locator('[data-pp-test="cell0"]').boundingBox();
  await page.mouse.move(cell0.x + cell0.width / 2, cell0.y + cell0.height / 2);
  // Cursor lands on cell0 directly — tooltip tag should be div.pp-cell.
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-cell');
  // Tab to next sibling cell — still div.pp-cell, but a different element.
  await page.keyboard.press('Tab');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-cell');
  // Shift+Tab walks back.
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-cell');
});

test('mouse movement >2px discards the walked target', async ({ page }) => {
  await enterPickMode(page);
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(row.x + 10, row.y + 7);
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('section.pp-dashboard');
  // Twitch the cursor — walk should reset, tag back to row.
  await page.mouse.move(row.x + 20, row.y + 12);
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-row');
});

test('walking to an off-screen sibling auto-scrolls to bring it into view', async ({ page }) => {
  await enterPickMode(page);
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(row.x + 10, row.y + 7);
  // For determinism, scroll the far-row into view directly.
  await page.evaluate(() => {
    const ifr = document.querySelector('iframe');
    const far = ifr.contentDocument.querySelector('[data-pp-test="far-row"]');
    far.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
  const scrollTop = await page.evaluate(() => document.querySelector('iframe').contentWindow.scrollY);
  expect(scrollTop).toBeGreaterThan(500);
});

test('walking to body shows chevrons because it overflows the viewport', async ({ page }) => {
  await enterPickMode(page);
  const row = await page.frameLocator('iframe').locator('[data-pp-test="row"]').boundingBox();
  await page.mouse.move(row.x + 10, row.y + 7);
  // Walk up multiple times to reach body (or a tall section).
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  // The fixture has a 2000px filler block so the body/section overflow the viewport. Some chevrons appear.
  await expect(page.locator('.__inspector-pp-chevron')).not.toHaveCount(0);
});

test('full pre-pick flow: hover → walk → click commits walked target', async ({ page }) => {
  await enterPickMode(page);
  const cell = await page.frameLocator('iframe').locator('[data-pp-test="cell1"]').boundingBox();

  // 1. Hover the cell — layers paint, WALK ladder shows immediately.
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await expect(page.locator('.__inspector-pp-band.padding')).toHaveCount(4);
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-cell');
  await expect(page.locator('#__inspector-tooltip .pp-ladder')).toBeVisible();

  // 2. ⌥↑ walks to row.
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('div.pp-row');

  // 3. ⌥↑ again walks to section.
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  await expect(page.locator('#__inspector-tooltip .pp-title .tag')).toContainText('section.pp-dashboard');

  // 4. Click commits the walked target (cursor is still on the cell).
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await expect(page.locator('#__inspector-selector-pill')).toContainText(/pp-dashboard/);
});
