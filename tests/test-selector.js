const { test } = require('node:test');
const assert = require('node:assert/strict');

function computeSelector(el) {
  if (el.id) return `#${el.id}`;
  const classes = Array.from(el.classList || [])
    .filter(c => c && !c.startsWith('__inspector'))
    .slice(0, 2);
  if (classes.length) return '.' + classes.join('.');
  const parts = [];
  let current = el;
  while (current && current.tagName && parts.length < 3) {
    let part = current.tagName.toLowerCase();
    if (current.id) { parts.unshift(`#${current.id}`); break; }
    const cls = Array.from(current.classList || []).filter(c => !c.startsWith('__inspector'))[0];
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

test('prefers id when present', () => {
  const el = { id: 'main-heading', classList: ['hero-title'], tagName: 'H1', parentElement: null };
  assert.equal(computeSelector(el), '#main-heading');
});

test('falls back to first two classes when no id', () => {
  const el = { id: '', classList: ['card', 'featured', 'large'], tagName: 'DIV', parentElement: null };
  assert.equal(computeSelector(el), '.card.featured');
});

test('uses tag path when no id or class', () => {
  const parent = { id: '', classList: [], tagName: 'SECTION', parentElement: null };
  const el = { id: '', classList: [], tagName: 'P', parentElement: parent };
  assert.equal(computeSelector(el), 'section > p');
});

test('stops tag path at named ancestor', () => {
  const root = { id: 'app', classList: [], tagName: 'DIV', parentElement: null };
  const mid = { id: '', classList: [], tagName: 'SECTION', parentElement: root };
  const el = { id: '', classList: [], tagName: 'P', parentElement: mid };
  assert.equal(computeSelector(el), '#app > section > p');
});

test('filters out __inspector classes', () => {
  const el = { id: '', classList: ['__inspector-highlight', 'card'], tagName: 'DIV', parentElement: null };
  assert.equal(computeSelector(el), '.card');
});
