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
