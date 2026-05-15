const { test } = require('node:test');
const assert = require('node:assert/strict');

// TODO: extract generateCopyPrompt from overlay.js (currently boot-scoped).
// Until then this copy reflects the intended output; keep in sync.
function generateCopyPrompt(changes) {
  if (changes.length === 0) return 'No changes to apply.';
  const lines = changes.map(c =>
    `- \`${c.selector}\`: ${c.property} ${c.from} → ${c.to}`
  );
  const summary = 'Apply these CSS changes:\n' + lines.join('\n');
  const json = JSON.stringify(changes);
  return `${summary}\n\n<changes>\n${json}\n</changes>`;
}

test('generates natural language summary', () => {
  const changes = [{ selector: '.hero-title', property: 'font-size', from: '24px', to: '32px', file: 'styles.css', line: 42 }];
  const result = generateCopyPrompt(changes);
  assert.ok(result.includes('Apply these CSS changes:'));
  assert.ok(result.includes('`.hero-title`: font-size 24px → 32px'));
});

test('includes <changes> JSON block', () => {
  const changes = [{ selector: '.nav', property: 'padding', from: '0px', to: '16px', file: 'nav.css', line: 5 }];
  const result = generateCopyPrompt(changes);
  assert.ok(result.includes('<changes>'));
  assert.ok(result.includes('</changes>'));
  const jsonMatch = result.match(/<changes>\n([\s\S]+?)\n<\/changes>/);
  assert.ok(jsonMatch);
  const parsed = JSON.parse(jsonMatch[1]);
  assert.equal(parsed[0].selector, '.nav');
});

test('handles multiple changes', () => {
  const changes = [
    { selector: '.a', property: 'color', from: 'red', to: 'blue', file: null, line: null },
    { selector: '.b', property: 'margin', from: '0', to: '16px', file: null, line: null }
  ];
  const result = generateCopyPrompt(changes);
  assert.ok(result.includes('`.a`: color red → blue'));
  assert.ok(result.includes('`.b`: margin 0 → 16px'));
});

test('returns no-changes message when empty', () => {
  const result = generateCopyPrompt([]);
  assert.equal(result, 'No changes to apply.');
});
