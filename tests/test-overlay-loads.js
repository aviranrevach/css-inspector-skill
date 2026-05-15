const { test } = require('node:test');
const assert = require('node:assert/strict');

// Smoke test: if overlay.js has a syntax error or its node-side exports
// break, this test fails the moment we require() it. The duplicate-logic
// pattern in the older tests (test-tracker.js, test-prompt.js) didn't
// have this property — they passed even when overlay.js was broken.

test('overlay.js loads in node without throwing', () => {
  let mod;
  assert.doesNotThrow(() => {
    delete require.cache[require.resolve('../overlay.js')];
    mod = require('../overlay.js');
  });
  assert.ok(mod, 'expected exports object');
});

test('overlay.js exposes the pure helpers tests rely on', () => {
  delete require.cache[require.resolve('../overlay.js')];
  const mod = require('../overlay.js');
  assert.equal(typeof mod.computeSelector, 'function');
});
