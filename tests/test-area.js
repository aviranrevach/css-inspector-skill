const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  computeSelector,
  findCommonAncestor,
  unionBoundingRect,
  buildAreaContext,
} = require('../overlay.js');

// Tiny DOM-element factory. Mirrors only what the helpers actually touch:
// tagName, id, classList, parentElement, contains, getBoundingClientRect.
function el({ tag = 'div', id = '', classes = [], rect = null }) {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    classList: classes,
    parentElement: null,
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    getBoundingClientRect: rect ? () => rect : undefined,
  };
  return node;
}
function tree(...nodes) {
  // [parent, child, child, child] — first becomes parent of the rest
  const [parent, ...children] = nodes;
  children.forEach((c) => (c.parentElement = parent));
  return parent;
}

test('findCommonAncestor returns null for empty input', () => {
  assert.equal(findCommonAncestor([]), null);
  assert.equal(findCommonAncestor(null), null);
});

test('findCommonAncestor returns parent for a single element', () => {
  const parent = el({ tag: 'section' });
  const child = el({ tag: 'h1' });
  tree(parent, child);
  assert.equal(findCommonAncestor([child]), parent);
});

test('findCommonAncestor walks up to the nearest shared ancestor', () => {
  const root = el({ tag: 'main', id: 'app' });
  const section = el({ tag: 'section', classes: ['hero'] });
  const title = el({ tag: 'h1', classes: ['hero-title'] });
  const sub = el({ tag: 'p', classes: ['hero-subtitle'] });
  tree(root, section);
  tree(section, title, sub);
  assert.equal(findCommonAncestor([title, sub]), section);
});

test('findCommonAncestor climbs further when elements live in different subtrees', () => {
  const root = el({ tag: 'main', id: 'app' });
  const heroSec = el({ tag: 'section', classes: ['hero'] });
  const cardSec = el({ tag: 'section', classes: ['card'] });
  const heroTitle = el({ tag: 'h1' });
  const cardBody = el({ tag: 'p' });
  tree(root, heroSec, cardSec);
  tree(heroSec, heroTitle);
  tree(cardSec, cardBody);
  assert.equal(findCommonAncestor([heroTitle, cardBody]), root);
});

test('unionBoundingRect computes the enclosing rect across elements', () => {
  const a = el({ rect: { left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50 } });
  const b = el({ rect: { left: 80, top: 100, right: 200, bottom: 160, width: 120, height: 60 } });
  const rect = unionBoundingRect([a, b]);
  assert.equal(rect.x, 10);
  assert.equal(rect.y, 20);
  assert.equal(rect.right, 200);
  assert.equal(rect.bottom, 160);
  assert.equal(rect.width, 190);
  assert.equal(rect.height, 140);
});

test('unionBoundingRect returns null for empty input', () => {
  assert.equal(unionBoundingRect([]), null);
  assert.equal(unionBoundingRect(null), null);
});

test('buildAreaContext returns empty string for empty input', () => {
  assert.equal(buildAreaContext([]), '');
  assert.equal(buildAreaContext(null), '');
});

test('buildAreaContext formats elements, common parent, and bounding box', () => {
  const root = el({ tag: 'section', id: 'hero' });
  const title = el({ tag: 'h1', id: 'main-heading', rect: { left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 } });
  const sub = el({ tag: 'p', classes: ['hero-subtitle'], rect: { left: 0, top: 60, right: 200, bottom: 100, width: 200, height: 40 } });
  tree(root, title, sub);

  const ctx = buildAreaContext([title, sub], computeSelector);
  assert.match(ctx, /Selected area \(2 elements\)/);
  assert.match(ctx, /- #main-heading \(h1\)/);
  assert.match(ctx, /- \.hero-subtitle \(p\)/);
  assert.match(ctx, /Common parent: #hero/);
  assert.match(ctx, /Bounding box: 200×100 at \(0, 0\)/);
});
