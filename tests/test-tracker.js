const { test } = require('node:test');
const assert = require('node:assert/strict');

// TODO: extract the real tracker from overlay.js (currently lives inside boot()
// with DOM side-effects baked in). Until then this copy reflects the intended
// behaviour; keep in sync with overlay.js trackChange/undoChange when those change.
function createTracker() {
  const changes = [];

  function trackChange(selector, property, from, to, file = null, line = null) {
    const existing = changes.findIndex(c => c.selector === selector && c.property === property);
    if (existing >= 0) {
      changes[existing].to = to;
    } else {
      changes.push({ selector, property, from, to, file, line });
    }
  }

  function undoChange(index) {
    changes.splice(index, 1);
  }

  function generateChangesJson() {
    return JSON.stringify(changes, null, 2);
  }

  function getChanges() { return changes; }

  return { trackChange, undoChange, generateChangesJson, getChanges };
}

test('trackChange adds a new entry', () => {
  const t = createTracker();
  t.trackChange('.hero-title', 'font-size', '24px', '32px', 'styles.css', 42);
  assert.equal(t.getChanges().length, 1);
  assert.deepEqual(t.getChanges()[0], {
    selector: '.hero-title', property: 'font-size',
    from: '24px', to: '32px', file: 'styles.css', line: 42
  });
});

test('trackChange updates existing selector+property in place', () => {
  const t = createTracker();
  t.trackChange('.hero-title', 'font-size', '24px', '32px');
  t.trackChange('.hero-title', 'font-size', '24px', '40px');
  assert.equal(t.getChanges().length, 1);
  assert.equal(t.getChanges()[0].to, '40px');
  assert.equal(t.getChanges()[0].from, '24px');
});

test('trackChange with null file/line', () => {
  const t = createTracker();
  t.trackChange('.btn', 'color', 'red', 'blue');
  assert.equal(t.getChanges()[0].file, null);
  assert.equal(t.getChanges()[0].line, null);
});

test('undoChange removes entry at index', () => {
  const t = createTracker();
  t.trackChange('.a', 'color', 'red', 'blue');
  t.trackChange('.b', 'font-size', '12px', '16px');
  t.undoChange(0);
  assert.equal(t.getChanges().length, 1);
  assert.equal(t.getChanges()[0].selector, '.b');
});

test('generateChangesJson produces valid JSON array', () => {
  const t = createTracker();
  t.trackChange('.hero-title', 'font-size', '24px', '32px', 'styles.css', 42);
  const json = JSON.parse(t.generateChangesJson());
  assert.equal(Array.isArray(json), true);
  assert.equal(json[0].selector, '.hero-title');
});
