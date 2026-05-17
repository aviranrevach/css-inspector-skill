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
