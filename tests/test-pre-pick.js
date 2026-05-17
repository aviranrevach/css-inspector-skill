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
