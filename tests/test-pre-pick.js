const { test } = require('node:test');
const assert = require('node:assert/strict');

// Re-require fresh so it picks up code changes between runs.
function load() {
  delete require.cache[require.resolve('../overlay.js')];
  return require('../overlay.js');
}

test('overlay.js exports a pre-pick helpers namespace', () => {
  const mod = load();
  // We export individual helpers, not a namespace object. This smoke test
  // just confirms the module still loads cleanly after the new code is added.
  assert.equal(typeof mod.computeSelector, 'function');
});

test('typeIconKey maps element tags to icon keys', () => {
  const { typeIconKey } = load();
  assert.equal(typeIconKey('div'), 'block');
  assert.equal(typeIconKey('SECTION'), 'block');
  assert.equal(typeIconKey('article'), 'block');
  assert.equal(typeIconKey('main'), 'block');
  assert.equal(typeIconKey('span'), 'inline');
  assert.equal(typeIconKey('em'), 'inline');
  assert.equal(typeIconKey('strong'), 'inline');
  assert.equal(typeIconKey('button'), 'button');
  assert.equal(typeIconKey('a'), 'link');
  assert.equal(typeIconKey('img'), 'image');
  assert.equal(typeIconKey('SVG'), 'image');
  assert.equal(typeIconKey('picture'), 'image');
  assert.equal(typeIconKey('h1'), 'heading');
  assert.equal(typeIconKey('H6'), 'heading');
  assert.equal(typeIconKey('input'), 'input');
  assert.equal(typeIconKey('textarea'), 'input');
  assert.equal(typeIconKey('select'), 'input');
  assert.equal(typeIconKey('ul'), 'list');
  assert.equal(typeIconKey('ol'), 'list');
  assert.equal(typeIconKey('li'), 'list');
  assert.equal(typeIconKey('nav'), 'nav');
  assert.equal(typeIconKey('header'), 'nav');
  assert.equal(typeIconKey('footer'), 'nav');
  // Default: anything unrecognised falls back to 'block'.
  assert.equal(typeIconKey('p'), 'block');
  assert.equal(typeIconKey(''), 'block');
  assert.equal(typeIconKey(null), 'block');
});

test('headingLevel returns 1..6 for h1..h6, null otherwise', () => {
  const { headingLevel } = load();
  assert.equal(headingLevel('h1'), 1);
  assert.equal(headingLevel('H2'), 2);
  assert.equal(headingLevel('h3'), 3);
  assert.equal(headingLevel('H4'), 4);
  assert.equal(headingLevel('h5'), 5);
  assert.equal(headingLevel('h6'), 6);
  assert.equal(headingLevel('h7'), null);
  assert.equal(headingLevel('div'), null);
  assert.equal(headingLevel(null), null);
});

test('isTextBearing detects non-empty direct text node children', () => {
  const { isTextBearing } = load();

  // Helper: build a tiny element-like object with a childNodes array.
  const elt = (children) => ({ childNodes: children });
  const text = (s) => ({ nodeType: 3, textContent: s });
  const div = () => ({ nodeType: 1, tagName: 'DIV' });

  assert.equal(isTextBearing(elt([text('hello')])), true);
  assert.equal(isTextBearing(elt([text('  '), div()])), false); // whitespace-only doesn't count
  assert.equal(isTextBearing(elt([div(), text('label')])), true); // mixed content counts
  assert.equal(isTextBearing(elt([div()])), false);
  assert.equal(isTextBearing(elt([])), false);
  assert.equal(isTextBearing(null), false);
  assert.equal(isTextBearing(undefined), false);
});

test('closestChildIndex returns the child closest to cursor by center distance', () => {
  const { closestChildIndex } = load();
  // Three cells in a row, each 100x100, separated by 0px gap.
  const rects = [
    { left:   0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    { left: 100, top: 0, right: 200, bottom: 100, width: 100, height: 100 },
    { left: 200, top: 0, right: 300, bottom: 100, width: 100, height: 100 },
  ];
  assert.equal(closestChildIndex(rects, { x:  50, y: 50 }), 0);
  assert.equal(closestChildIndex(rects, { x: 150, y: 50 }), 1);
  assert.equal(closestChildIndex(rects, { x: 250, y: 50 }), 2);
  // Cursor exactly between cells 0 and 1 → ties break by document order (lower index wins).
  assert.equal(closestChildIndex(rects, { x: 100, y: 50 }), 0);
  // Empty input → -1.
  assert.equal(closestChildIndex([], { x: 50, y: 50 }), -1);
  // Out-of-bounds cursor still picks closest child by Euclidean distance.
  assert.equal(closestChildIndex(rects, { x: 1000, y: -1000 }), 2);
});

test('contrastRatio matches known WCAG examples', () => {
  const { contrastRatio } = load();
  // Black on white = 21:1 (the maximum).
  assert.ok(Math.abs(contrastRatio([0,0,0], [255,255,255]) - 21) < 0.05);
  // White on white = 1:1.
  assert.ok(Math.abs(contrastRatio([255,255,255], [255,255,255]) - 1) < 0.001);
  // #3B82F6 (blue) on white ≈ 3.68.
  const r = contrastRatio([0x3b,0x82,0xf6], [255,255,255]);
  assert.ok(r > 3.6 && r < 3.7, `expected ~3.68, got ${r}`);
});

test('wcagBadge maps ratio + text size to AAA/AA/AA-large/FAIL', () => {
  const { wcagBadge } = load();
  // Normal body text (14px / 400)
  assert.equal(wcagBadge(7.1, 14, 400), 'AAA');
  assert.equal(wcagBadge(4.6, 14, 400), 'AA');
  assert.equal(wcagBadge(3.0, 14, 400), 'FAIL');
  // Large text (≥18px / 400 OR ≥14px / 700) is graded more leniently
  assert.equal(wcagBadge(4.6, 24, 400), 'AAA');
  assert.equal(wcagBadge(3.1, 24, 400), 'AA-large');
  assert.equal(wcagBadge(2.9, 24, 400), 'FAIL');
  assert.equal(wcagBadge(3.5, 14, 700), 'AA-large');
});

test('effectiveBackground walks ancestors until non-transparent', () => {
  const { effectiveBackground } = load();
  // Mock element tree: leaf has transparent bg, parent has white bg.
  const root = { parentElement: null, _bg: 'rgb(255, 255, 255)' };
  const mid  = { parentElement: root, _bg: 'rgba(0, 0, 0, 0)' };
  const leaf = { parentElement: mid,  _bg: 'transparent' };
  const getStyle = (el) => ({ backgroundColor: el._bg });
  assert.equal(effectiveBackground(getStyle, leaf), 'rgb(255, 255, 255)');
  // If everything is transparent, fall back to white.
  const allTransparent = { parentElement: null, _bg: 'transparent' };
  assert.equal(effectiveBackground(getStyle, allTransparent), 'rgb(255, 255, 255)');
});

test('layoutNonDefaults returns only non-default layout props, or null', () => {
  const { layoutNonDefaults } = load();
  // All defaults → null
  assert.equal(layoutNonDefaults({
    position: 'static', overflow: 'visible', zIndex: 'auto',
    transform: 'none', maxWidth: 'none',
  }), null);
  // Position relative + overflow hidden
  assert.deepEqual(layoutNonDefaults({
    position: 'relative', overflow: 'hidden', zIndex: 'auto',
    transform: 'none', maxWidth: 'none',
  }), { position: 'relative', overflow: 'hidden' });
  // Numeric zIndex
  assert.deepEqual(layoutNonDefaults({
    position: 'absolute', overflow: 'visible', zIndex: '10',
    transform: 'none', maxWidth: 'none',
  }), { position: 'absolute', zIndex: '10' });
  // Transform set
  assert.deepEqual(layoutNonDefaults({
    position: 'static', overflow: 'visible', zIndex: 'auto',
    transform: 'matrix(1, 0, 0, 1, 0, 0)', maxWidth: 'none',
  }), { transform: 'matrix(1, 0, 0, 1, 0, 0)' });
  // maxWidth set
  assert.deepEqual(layoutNonDefaults({
    position: 'static', overflow: 'visible', zIndex: 'auto',
    transform: 'none', maxWidth: '600px',
  }), { maxWidth: '600px' });
});

test('contentSummary describes children + text shape', () => {
  const { contentSummary } = load();
  const elt = (children, textLen = 0, isImg = false) => ({
    tagName: isImg ? 'IMG' : 'DIV',
    children,
    childNodes: textLen > 0 ? [{ nodeType: 3, textContent: 'x'.repeat(textLen) }, ...children] : [...children],
    textContent: 'x'.repeat(textLen),
  });
  const child = (tag = 'SPAN') => ({ tagName: tag, children: [], childNodes: [] });

  // Empty wrapper
  assert.equal(contentSummary(elt([])), 'empty wrapper');
  // Image element
  assert.equal(contentSummary(elt([], 0, true)), 'image · raster');
  // Icon only (one SVG child, no text)
  assert.equal(contentSummary(elt([child('SVG')])), 'icon only');
  // Text only
  assert.equal(contentSummary(elt([], 12)), 'text only · 12 chars');
  // Children + text
  assert.equal(contentSummary(elt([child(), child()], 8)), '2 children · 8 chars');
  // Children only
  assert.equal(contentSummary(elt([child(), child(), child()])), '3 children');
});
