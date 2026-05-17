(function () {
  'use strict';

  // ── Pure helpers (testable from node; safe to run with no DOM) ────────────
  function computeSelector(el) {
    if (!el || !el.tagName) return '';
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

  function typeIconKey(tagName) {
    if (!tagName) return 'block';
    const t = String(tagName).toLowerCase();
    if (t === 'span' || t === 'em' || t === 'strong' || t === 'b' || t === 'i') return 'inline';
    if (t === 'button') return 'button';
    if (t === 'a') return 'link';
    if (t === 'img' || t === 'svg' || t === 'picture') return 'image';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'input' || t === 'textarea' || t === 'select') return 'input';
    if (t === 'ul' || t === 'ol' || t === 'li') return 'list';
    if (t === 'nav' || t === 'header' || t === 'footer') return 'nav';
    return 'block';
  }

  function headingLevel(tagName) {
    if (!tagName) return null;
    const m = /^h([1-6])$/i.exec(String(tagName));
    return m ? Number(m[1]) : null;
  }

  function isTextBearing(el) {
    if (!el || !el.childNodes) return false;
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n && n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  function closestChildIndex(rects, cursor) {
    if (!rects || rects.length === 0) return -1;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = cx - cursor.x;
      const dy = cy - cursor.y;
      const d2 = dx * dx + dy * dy; // squared distance is enough for ranking
      if (d2 < bestDist) { bestDist = d2; bestIdx = i; }
    }
    return bestIdx;
  }


  // sRGB → relative luminance per WCAG 2.1.
  function _relLuminance(rgb) {
    const a = rgb.map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrastRatio(fgRgb, bgRgb) {
    const l1 = _relLuminance(fgRgb);
    const l2 = _relLuminance(bgRgb);
    const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
  }

  function wcagBadge(ratio, fontPx, fontWeight) {
    const large = (fontPx >= 18) || (fontPx >= 14 && (fontWeight | 0) >= 700);
    if (large) {
      if (ratio >= 4.5) return 'AAA';
      if (ratio >= 3)   return 'AA-large';
      return 'FAIL';
    }
    if (ratio >= 7)   return 'AAA';
    if (ratio >= 4.5) return 'AA';
    return 'FAIL';
  }

  function effectiveBackground(getStyle, el) {
    let cur = el;
    while (cur) {
      const bg = getStyle(cur).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)$/.test(bg)) {
        return bg;
      }
      cur = cur.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  function layoutNonDefaults(style) {
    if (!style) return null;
    const out = {};
    if (style.position && style.position !== 'static')         out.position  = style.position;
    if (style.overflow && style.overflow !== 'visible')        out.overflow  = style.overflow;
    if (style.zIndex   && style.zIndex   !== 'auto')           out.zIndex    = style.zIndex;
    if (style.transform && style.transform !== 'none')         out.transform = style.transform;
    if (style.maxWidth && style.maxWidth !== 'none')           out.maxWidth  = style.maxWidth;
    return Object.keys(out).length === 0 ? null : out;
  }

  function contentSummary(el) {
    if (!el) return '';
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'IMG' || tag === 'SVG' || tag === 'PICTURE') return 'image · raster';
    const kids = el.children ? Array.from(el.children) : [];
    const ownText = isTextBearing(el) ? (el.textContent || '').trim().length : 0;
    if (kids.length === 0 && ownText === 0) return 'empty wrapper';
    if (kids.length === 1 && ownText === 0) {
      const childTag = (kids[0].tagName || '').toUpperCase();
      if (childTag === 'SVG' || childTag === 'IMG') return 'icon only';
    }
    if (kids.length === 0 && ownText > 0) return `text only · ${ownText} chars`;
    if (kids.length >= 1 && ownText > 0) return `${kids.length} ${kids.length === 1 ? 'child' : 'children'} · ${ownText} chars`;
    return `${kids.length} ${kids.length === 1 ? 'child' : 'children'}`;
  }

  function buildBreadcrumb(el, opts) {
    if (!el || !el.tagName) return '';
    const maxDepth = (opts && opts.maxDepth) || 4;
    const parts = [];
    let cur = el;
    let truncated = false;
    while (cur && cur.tagName) {
      let label = cur.tagName.toLowerCase();
      if (cur.id) label = `${label}#${cur.id}`;
      else {
        const cls = Array.from(cur.classList || []).filter(c => c && !c.startsWith('__inspector'))[0];
        if (cls) label = `${label}.${cls}`;
      }
      parts.unshift(label);
      if (parts.length >= maxDepth) {
        if (cur.parentElement && cur.parentElement.tagName) truncated = true;
        break;
      }
      cur = cur.parentElement;
    }
    return truncated ? `… › ${parts.join(' › ')}` : parts.join(' › ');
  }

  function bandRectsForBox(box, margin, padding) {
    const m = margin || { top:0, right:0, bottom:0, left:0 };
    const p = padding || { top:0, right:0, bottom:0, left:0 };
    return {
      marginTop:    { left: box.left - m.left,  top: box.top - m.top,  width: box.width + m.left + m.right, height: m.top },
      marginRight:  { left: box.right,          top: box.top - m.top,  width: m.right,                       height: box.height + m.top + m.bottom },
      marginBottom: { left: box.left - m.left,  top: box.bottom,       width: box.width + m.left + m.right, height: m.bottom },
      marginLeft:   { left: box.left - m.left,  top: box.top - m.top,  width: m.left,                        height: box.height + m.top + m.bottom },
      paddingTop:    { left: box.left,                top: box.top,               width: box.width,                 height: p.top },
      paddingRight:  { left: box.right - p.right,     top: box.top + p.top,       width: p.right,                   height: box.height - p.top - p.bottom },
      paddingBottom: { left: box.left,                top: box.bottom - p.bottom, width: box.width,                 height: p.bottom },
      paddingLeft:   { left: box.left,                top: box.top + p.top,       width: p.left,                    height: box.height - p.top - p.bottom },
    };
  }

  function gapStripsForFlexRow(parentRect, childRects, gap, direction) {
    if (!gap || gap <= 0) return [];
    if (!childRects || childRects.length < 2) return [];
    const strips = [];
    if (direction === 'column') {
      for (let i = 0; i < childRects.length - 1; i++) {
        const a = childRects[i], b = childRects[i + 1];
        strips.push({
          left: parentRect.left,
          top:  a.bottom,
          width: parentRect.width,
          height: b.top - a.bottom,
          value: gap,
        });
      }
    } else {
      for (let i = 0; i < childRects.length - 1; i++) {
        const a = childRects[i], b = childRects[i + 1];
        strips.push({
          left:  a.right,
          top:   parentRect.top,
          width: b.left - a.right,
          height: parentRect.height,
          value: gap,
        });
      }
    }
    return strips;
  }
  function fullyOffscreen(rect, viewport) {
    return rect.bottom < 0 || rect.top > viewport.height
        || rect.right  < 0 || rect.left > viewport.width;
  }

  function chevronEdgesForViewport(rect, viewport) {
    return {
      top:    rect.top    < 0,
      bottom: rect.bottom > viewport.height,
      left:   rect.left   < 0,
      right:  rect.right  > viewport.width,
    };
  }

  function nextWalkTarget(el, direction, cursor) {
    if (!el) return null;
    if (direction === 'parent') {
      const p = el.parentElement;
      if (!p || !p.tagName) return null;
      const t = p.tagName.toUpperCase();
      if (t === 'BODY' || t === 'HTML') return null; // don't climb past body
      return p;
    }
    if (direction === 'child') {
      const kids = el.children ? Array.from(el.children) : [];
      if (kids.length === 0) return null;
      const rects = kids.map(k => k.getBoundingClientRect());
      const idx = closestChildIndex(rects, cursor || { x: 0, y: 0 });
      return idx >= 0 ? kids[idx] : null;
    }
    const parent = el.parentElement;
    if (!parent || !parent.children) return null;
    const siblings = Array.from(parent.children);
    const i = siblings.indexOf(el);
    if (i < 0) return null;
    if (direction === 'next') return siblings[i + 1] || null;
    if (direction === 'prev') return siblings[i - 1] || null;
    return null;
  }

  if (typeof module !== 'undefined') {
    module.exports = { computeSelector, typeIconKey, headingLevel, isTextBearing, closestChildIndex, contrastRatio, wcagBadge, effectiveBackground, layoutNonDefaults, contentSummary, buildBreadcrumb, bandRectsForBox, gapStripsForFlexRow, fullyOffscreen, chevronEdgesForViewport, nextWalkTarget };
  }

  // ── Browser-only from here ────────────────────────────────────────────────
  if (typeof document === 'undefined') return;
  // Stronger double-mount guard:
  //   1. Same-document re-load: window flag + DOM check.
  //   2. Cross-frame: in static mode the inspector is hosted by the
  //      parent doc (inspector.html), and if the iframed user page
  //      ALSO references overlay.js the script would boot a second
  //      instance with its own panelTip, FAB, etc — visible as
  //      duplicate tooltips. Detect by checking the parent window's
  //      flag (wrapped in try/catch for cross-origin safety).
  if (window.__inspectorBooted) return;
  try {
    if (window !== window.top && window.top && window.top.__inspectorBooted) return;
  } catch (_) { /* cross-origin top — can't check, continue */ }
  if (document.getElementById('__inspector-root')) return;
  window.__inspectorBooted = true;

  // ── Resolve inspection target ──────────────────────────────────────────────
  // Static mode wraps the page in an iframe; live mode injects directly.
  // The picker, highlight, and getComputedStyle calls on page elements must
  // target the page document (iframe.contentDocument), not the inspector host.
  let booted = false;
  function bootWhenReady() {
    const iframe = document.querySelector('iframe');
    if (!iframe) {
      if (!booted) { booted = true; boot(document, window, () => ({ left: 0, top: 0 })); }
      return;
    }
    const doBoot = () => {
      if (booted) return;
      let d, w;
      try { d = iframe.contentDocument; w = iframe.contentWindow; }
      catch (e) { booted = true; boot(document, window, () => ({ left: 0, top: 0 })); return; }
      const isInitialBlank = !d || !w || d.readyState === 'loading'
        || (d.location && d.location.href === 'about:blank'
            && iframe.getAttribute('src') && iframe.getAttribute('src') !== 'about:blank');
      if (isInitialBlank) {
        iframe.addEventListener('load', doBoot, { once: true });
        return;
      }
      booted = true;
      boot(d, w, () => iframe.getBoundingClientRect());
    };
    iframe.addEventListener('load', doBoot);
    doBoot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWhenReady, { once: true });
  } else {
    bootWhenReady();
  }

  function boot(targetDoc, targetWin, getFrameRect) {

  // ── Embedded styles ────────────────────────────────────────────────────────
  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

    #__inspector-root * { box-sizing: border-box; font-family: Inter, system-ui, sans-serif; }

    #__inspector-root {
      position: fixed; top: 16px; right: 16px;
      width: 264px;
      /* Fixed height (capped at full viewport minus margins) so the
         window doesn't shrink when switching to a tab that has less
         content. Design / CSS Raw / About / Settings all share the
         same outer size. */
      height: calc(100vh - 32px);
      max-height: calc(100vh - 32px);
      background: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 8px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      z-index: 2147483647; display: flex; flex-direction: column;
      overflow: hidden; color: #d4d4d4; font-size: 11px;
    }

    /* Header */
    #__inspector-header {
      background: #1c1c1c; border-bottom: 1px solid #252525;
      padding: 10px 12px; display: flex; align-items: center; gap: 6px;
      flex-shrink: 0; cursor: move;
    }
    #__inspector-header button,
    #__inspector-header [contenteditable] { cursor: default; }
    #__inspector-header button { cursor: pointer; }
    /* Select group — a SINGLE flat flex row holding (left → right):
       cursor icon, then either the "Select element" CTA label OR the
       selector pill (mutually exclusive), then the copy-intro button.
       Same metrics (padding, gap, icon size, text size) in BOTH empty
       and selected states — the only thing that changes between them is
       which middle element is visible. */
    #__inspector-select-group {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 4px;
      background: none; border: 1px solid #3B82F6; border-radius: 6px;
      padding: 8px 10px;
      color: #3B82F6; font-family: Inter, system-ui, sans-serif;
    }
    #__inspector-select-group:hover { background: rgba(59,130,246,0.08); }
    /* Selected state — softly filled with 10% blue so it reads as "active". */
    #__inspector-header.has-selection #__inspector-select-group {
      background: rgba(59,130,246,0.10);
    }
    /* Pick mode active (button clicked, no selection yet) — thicker blue
       stroke so the user sees the button is armed.  Padding is dropped by
       1px on each side to keep the outer box the same size. */
    #__inspector-select-group:has(#__inspector-pick-btn.active) {
      border-width: 2px; padding: 7px 9px;
    }

    /* Pick button — cursor icon + optional "Select element" label.
       Empty state: flex:1 so the whole button (icon + label) is one big
       clickable target.  Selected state: shrinks to icon-only (label is
       hidden) and the selector pill takes the remaining width.  The gap
       between icon and label here matches the parent's 4px gap, so the
       text starts at the same offset regardless of state. */
    #__inspector-pick-btn {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 4px;
      background: none; border: none; padding: 0; margin: 0;
      cursor: pointer; color: #3B82F6;
      font: inherit; text-align: left;
    }
    #__inspector-pick-btn svg { display: block; width: 16px; height: 16px; flex-shrink: 0; }
    #__inspector-header.has-selection #__inspector-pick-btn { flex: 0 0 auto; }

    /* Multi-select toggle button — sits between pick button and the
       selector text. Gray when inactive, blue when multi-pick mode is on. */
    #__inspector-multi-btn {
      flex: 0 0 auto;
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px;
      background: none; border: 1px solid transparent; border-radius: 4px;
      padding: 0; margin: 0;
      cursor: pointer; color: #555;
    }
    #__inspector-multi-btn:hover { color: #aaa; }
    #__inspector-multi-btn svg { width: 14px; height: 14px; display: block; }
    #__inspector-multi-btn.active {
      color: #3B82F6; border-color: #3B82F6;
      background: rgba(59,130,246,0.08);
    }
    #__inspector-multi-btn .multi-count {
      position: absolute; top: -4px; right: -4px;
      min-width: 14px; height: 14px; padding: 0 3px;
      background: #3B82F6; color: #fff;
      font-size: 9px; font-weight: 700; line-height: 14px;
      text-align: center; border-radius: 7px;
    }
    #__inspector-multi-btn { position: relative; }

    .inspector-select-label {
      flex: 1; min-width: 0;
      font-size: 12px; font-weight: 500; color: #3B82F6;
    }
    #__inspector-header.has-selection .inspector-select-label { display: none; }

    /* Selector text — selected state only. Plain inline text, no box. */
    #__inspector-selector-pill {
      display: none; flex: 1; min-width: 0;
      background: transparent; border: none; padding: 0; margin: 0;
      font-size: 12px; font-weight: 500; color: #3B82F6;
      font-family: Inter, system-ui, sans-serif;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      cursor: text; outline: none;
    }
    #__inspector-header.has-selection #__inspector-selector-pill { display: block; }
    #__inspector-selector-pill:focus { color: #6ba5f8; }

    /* Clear-selection button — selected state only, rightmost child of the
       row. Used to be the clipboard icon; the chat-ready-intro copy action
       moved into the tree popup. */
    #__inspector-pill-clear {
      display: none; flex: 0 0 auto;
      background: none; border: none; color: #3B82F6; cursor: pointer;
      padding: 0 2px; align-items: center; border-radius: 4px;
    }
    #__inspector-header.has-selection #__inspector-pill-clear { display: flex; }
    #__inspector-pill-clear svg { width: 14px; height: 14px; }
    #__inspector-pill-clear:hover { color: #6ba5f8; }

    /* Removed: header-level deselect button (clearing happens via the
       on-page "Clear selection ✕" badge above the selected element). */
    #__inspector-deselect { display: none !important; }
    /* One-time pulse so first-time users notice the copy action after
       picking. Lives on the tree popup's chat-ready-intro link now. */
    @keyframes __inspector-copy-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(218,119,86,0.55); color: #DA7756; }
      70%  { box-shadow: 0 0 0 8px rgba(218,119,86,0);   color: #DA7756; }
      100% { box-shadow: 0 0 0 0 rgba(218,119,86,0);     color: #DA7756; }
    }
    .tree-copy-btn.first-hint {
      animation: __inspector-copy-pulse 1.4s ease-out 2;
    }
    #__inspector-header-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    #__inspector-close { background: none; border: none; color: #444; cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }
    #__inspector-close:hover { color: #888; }
    #__inspector-resize-handle {
      height: 6px; cursor: ns-resize; background: transparent;
      flex-shrink: 0; position: relative;
    }
    #__inspector-resize-handle::after {
      content: ''; position: absolute;
      left: 50%; transform: translateX(-50%);
      top: 2px; width: 32px; height: 3px;
      background: #333; border-radius: 2px;
    }
    #__inspector-resize-handle:hover::after { background: #555; }
    #__inspector-minimize {
      background: none; border: none; color: #444; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 0 2px;
      font-family: monospace;
    }
    #__inspector-minimize:hover { color: #888; }

    #__inspector-root.minimized #__inspector-tabs,
    #__inspector-root.minimized #__inspector-panels {
      display: none;
    }

    /* Tabs */
    #__inspector-tabs {
      display: flex; border-bottom: 1px solid #252525;
      background: #1c1c1c; padding: 0 12px; gap: 16px; flex-shrink: 0;
    }
    .inspector-tab {
      padding: 8px 0; font-size: 11px; font-weight: 500; color: #555;
      border-bottom: 1.5px solid transparent; margin-bottom: -1px; cursor: pointer; user-select: none;
    }
    .inspector-tab:hover { color: #888; }
    .inspector-tab.active { color: #fff; border-bottom-color: #fff; }
    .inspector-tab.disabled { color: #2e2e2e; cursor: not-allowed; pointer-events: none; }
    /* Right-aligned end tab (e.g. About icon) — pushed to the far right. */
    .inspector-tab-end { margin-left: auto; }
    /* Icon-only tab (About info-circle, Settings gear). Same hit-target as
       text tabs but renders an SVG instead of a label. */
    .inspector-tab.inspector-tab-icon {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 6px 4px; margin-bottom: -1px;
    }
    .inspector-tab.inspector-tab-icon svg { width: 14px; height: 14px; display: block; }
    .inspector-tab.inspector-tab-icon.active { border-bottom-color: transparent; color: #3B82F6; }
    /* Two consecutive icon-tabs (About + Settings) read as too far apart
       under the parent's 16px gap because the icons are tiny. Pull them
       closer so the visual spacing is comparable to "Design ↔ CSS Raw". */
    .inspector-tab.inspector-tab-icon + .inspector-tab.inspector-tab-icon {
      margin-left: -10px;
    }

    /* ── About panel ──────────────────────────────────────────────────────── */
    #__inspector-panel-about { padding: 16px 14px; color: #aaa; font-size: 11px; line-height: 1.55; }
    #__inspector-panel-about h3 { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 8px; }
    #__inspector-panel-about p { margin-bottom: 10px; }
    #__inspector-panel-about strong { color: #e0e0e0; font-weight: 600; }

    /* Scope row — sits between the Component section and Position.
       Hosts two toggles + a tag showing the active selector. Compact:
       small 12px checkbox + 10px label, tight padding. */
    .inspector-scope-row {
      padding: 4px 10px;
      border-bottom: 1px solid #252525;
      font-size: 10px;
      display: flex; align-items: center; gap: 10px;
      flex-wrap: wrap;
    }
    .inspector-scope-toggle {
      display: inline-flex; align-items: center; gap: 5px;
      cursor: pointer; color: #c0c0c0; user-select: none;
    }
    .inspector-scope-toggle:hover { color: #fff; }
    /* Override the default 14px .inspector-check-box for the scope-row
       only — these toggles read as secondary controls, not primary
       checkboxes, so 12px feels more proportional to the row text. */
    .inspector-scope-toggle .inspector-check-box { width: 12px; height: 12px; }
    .inspector-scope-toggle .inspector-check-box svg { width: 8px; height: 8px; }
    .inspector-scope-target {
      color: #777; font-size: 10px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      min-width: 0; flex: 1; margin-left: auto;
      text-align: right;
    }
    .inspector-scope-target code {
      color: #DA7756; font-family: monospace;
      background: rgba(218,119,86,0.08);
      padding: 1px 4px; border-radius: 3px;
    }

    /* ── Component section (Design tab) ─────────────────────────────────── */
    .component-section { padding-top: 14px; }
    .component-badge {
      font-size: 10px; font-weight: 600; color: #fff;
      background: #3B82F6; padding: 2px 7px; border-radius: 4px;
      margin-left: auto;
    }
    .component-badge-muted { background: #2e2e2e; color: #888; }
    .component-source {
      font-family: monospace; font-size: 10px; color: #777;
      margin: 2px 0 10px; word-break: break-all;
    }
    .component-row {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 6px;
    }
    .component-prop-label {
      font-size: 11px; color: #888; min-width: 56px; flex-shrink: 0;
    }
    .component-prop-select {
      flex: 1; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      height: 28px; padding: 0 8px;
      color: #ccc; font-size: 11px; font-family: Inter, system-ui, sans-serif;
      outline: none; cursor: pointer;
    }
    .component-prop-select:hover  { border-color: #3a3a3a; }
    .component-prop-select:focus  { border-color: #3B82F6; }
    .component-fallback-msg {
      font-size: 10.5px; color: #888; line-height: 1.5; margin-bottom: 10px;
    }
    .component-ask-btn {
      width: 100%; padding: 8px 10px;
      background: transparent; color: #3B82F6;
      border: 1px solid #3B82F6; border-radius: 4px;
      font-size: 11px; font-weight: 600; cursor: pointer;
      font-family: inherit;
    }
    .component-ask-btn:hover { background: rgba(59,130,246,0.08); }
    .component-empty { font-size: 10.5px; color: #666; font-style: italic; }

    /* Convert-to block — sits below the variant dropdowns. Renders one
       button per applicable conversion rule (filtered by from-name +
       pick count via applicableConversions()). */
    .component-convert-block {
      margin-top: 12px; padding-top: 10px;
      border-top: 1px solid #252525;
    }
    .component-convert-title {
      font-size: 9px; font-weight: 700; color: #555;
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-bottom: 6px;
    }
    .component-convert-btn {
      display: flex; align-items: center; gap: 8px;
      width: 100%; padding: 7px 10px; margin-bottom: 4px;
      background: #252525; color: #c0c0c0;
      border: 1px solid #2e2e2e; border-radius: 4px;
      font: 600 11px/1.2 inherit;
      cursor: pointer; text-align: left;
      transition: background 0.1s, border-color 0.1s, color 0.1s;
    }
    .component-convert-btn:hover {
      background: rgba(59,130,246,0.08);
      border-color: #3B82F6; color: #fff;
    }
    .component-convert-arrow {
      color: #3B82F6; font-weight: 700; flex-shrink: 0;
    }

    /* Intent rows in the changes drawer get a subtle blue tint so they read
       as design-system actions, not raw CSS edits. */
    .changes-row.changes-row-intent {
      background: rgba(59,130,246,0.05);
      border-left: 2px solid rgba(59,130,246,0.5);
    }
    .changes-row.changes-row-intent .changes-row-prop {
      color: #3B82F6;
    }

    /* ── Settings panel ─────────────────────────────────────────────────── */
    #__inspector-panel-settings { padding: 16px 14px; color: #aaa; font-size: 11px; line-height: 1.55; }
    .settings-section { margin-bottom: 18px; }
    .settings-section h3 { font-size: 13px; font-weight: 600; color: #fff; margin-bottom: 10px; }
    .settings-detect-row { color: #ccc; margin-bottom: 4px; }
    .settings-detect-row strong { color: #e0e0e0; }
    .settings-detect-conf { color: #888; margin-left: 4px; font-size: 10px; }
    .settings-detect-empty { color: #777; font-style: italic; }
    .settings-detect-signals {
      color: #777; font-size: 10px; margin-bottom: 10px;
      word-break: break-all; line-height: 1.7;
    }
    .settings-detect-signals code {
      background: #252525; padding: 1px 5px; border-radius: 3px;
      font-family: monospace; font-size: 9.5px; color: #aaa;
    }
    /* Design-system card grid (matches the Figma plugin reference). 2-column
       layout, each card is icon-above-label with a small radio indicator
       pinned to the top-left corner. Selected card shows a filled
       indicator with a checkmark; the card body itself stays neutral so
       the grid reads quietly until you focus a row. */
    .ds-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
      margin-top: 10px;
    }
    .ds-grid-secondary { display: none; }
    .ds-grid-secondary.open { display: grid; }
    .ds-card {
      position: relative; height: 59px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 4px;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      cursor: pointer; user-select: none;
      transition: background 0.1s, border-color 0.1s;
    }
    .ds-card:hover { background: #2a2a2a; border-color: #3a3a3a; }
    .ds-card.ds-card-checked { border-color: #3B82F6; }
    /* Locked card (Claude Design baseline): same look as checked, but no
       hover feedback and the cursor signals it's not toggleable. */
    .ds-card.ds-card-locked { cursor: default; }
    .ds-card.ds-card-locked:hover { background: #252525; border-color: #3B82F6; }
    .ds-card input { position: absolute; opacity: 0; pointer-events: none; }
    .ds-card-radio {
      position: absolute; top: 5px; left: 5px;
      width: 12px; height: 12px;
      display: flex; align-items: center; justify-content: center;
      color: #555;
    }
    .ds-card-radio svg { width: 12px; height: 12px; display: block; }
    .ds-card.ds-card-checked .ds-card-radio { color: #3B82F6; }
    .ds-card-icon {
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      color: #c0c0c0;
    }
    .ds-card-icon svg { width: 24px; height: 24px; display: block; }
    .ds-card-label {
      font-size: 11px; font-weight: 600; color: #c0c0c0;
      text-align: center; line-height: 1.1;
      max-width: calc(100% - 16px);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .ds-see-more {
      width: 100%; margin: 6px 0 10px;
      background: none; border: none; padding: 4px;
      color: #c0c0c0; font-family: inherit;
      font-size: 11px; font-weight: 600; text-align: center;
      cursor: pointer;
    }
    .ds-see-more:hover { color: #fff; }

    .ds-import {
      width: 100%; height: 62px;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 3px;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      cursor: pointer; user-select: none;
      color: #c0c0c0; font-family: inherit;
      transition: background 0.1s, border-color 0.1s;
    }
    .ds-import:hover:not(:disabled) { background: #2a2a2a; border-color: #3a3a3a; }
    .ds-import:disabled {
      cursor: not-allowed; opacity: 0.45;
      background: #202020; color: #777;
    }
    .ds-import:disabled:hover { background: #202020; border-color: #2e2e2e; }
    .ds-import-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color: #888; }
    .ds-import-icon svg { width: 18px; height: 18px; display: block; }
    .ds-import-label { font-size: 11px; font-weight: 600; }
    .ds-import-soon {
      font-size: 9px; font-weight: 600; color: #666;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    /* Loaded state: custom manifest is active. Card looks like a checked
       preset card (blue border + checkmark top-left) with a meta line
       showing how many components were detected. */
    .ds-import.ds-import-loaded {
      position: relative;
      background: #252525; border-color: #3B82F6;
      opacity: 1; color: #c0c0c0;
      cursor: default;
    }
    .ds-import.ds-import-loaded:hover { background: #252525; border-color: #3B82F6; }
    .ds-import-check {
      position: absolute; top: 5px; left: 5px;
      width: 12px; height: 12px;
      display: flex; align-items: center; justify-content: center;
    }
    .ds-import-check svg { width: 12px; height: 12px; display: block; }
    .ds-import-meta {
      font-size: 9px; font-weight: 500; color: #777;
      letter-spacing: 0.03em;
    }

    .settings-foot {
      margin-top: 14px; padding-top: 12px;
      border-top: 1px solid #252525;
      color: #777; font-size: 10.5px; line-height: 1.55;
    }
    .settings-foot strong { color: #c0c0c0; font-weight: 600; }
    /* Small pill next to section titles for features still in beta. */
    .settings-beta {
      display: inline-block; vertical-align: middle;
      margin-left: 6px; padding: 1px 6px;
      background: rgba(218,119,86,0.14); color: #DA7756;
      border: 1px solid rgba(218,119,86,0.35); border-radius: 9px;
      font: 600 9px/1.4 Inter, system-ui, sans-serif;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    /* Toggle row inside Settings (boolean preferences). */
    .settings-toggle {
      display: flex; align-items: flex-start; gap: 10px;
      cursor: pointer; padding: 6px 0;
      color: #c0c0c0;
    }
    .settings-toggle input { accent-color: #3B82F6; cursor: pointer; margin-top: 3px; }
    .settings-toggle strong { color: #e0e0e0; display: block; margin-bottom: 2px; }
    .settings-sub { color: #777; font-size: 10px; line-height: 1.5; }
    .__inspector-about-sep {
      height: 1px; background: #252525; margin: 14px 0 12px;
    }
    .__inspector-about-author {
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; color: #ccc; font-weight: 500;
    }
    .__inspector-about-links {
      display: flex; gap: 6px; margin-left: auto;
    }
    .__inspector-about-links a {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 6px;
      background: none; border: 1px solid #2e2e2e;
      color: #888; text-decoration: none; transition: color .12s, border-color .12s;
    }
    .__inspector-about-links a:hover { color: #fff; border-color: #444; }
    .__inspector-about-links a svg { width: 15px; height: 15px; }

    /* Tab panels */
    #__inspector-panels { overflow-y: auto; flex: 1; scrollbar-width: none; }
    #__inspector-panels::-webkit-scrollbar { display: none; }
    .inspector-panel { display: none; }
    .inspector-panel.active { display: block; }

    /* Sections */
    .inspector-section { padding: 10px 10px; border-bottom: 1px solid #252525; }
    .inspector-section:last-child { border-bottom: none; }
    .inspector-section.collapsed > *:not(.inspector-section-hd) { display: none; }
    .inspector-section.collapsed { padding-bottom: 4px; }
    .inspector-section-chevron {
      background: none; border: none; color: #444; cursor: pointer;
      padding: 0; display: flex; align-items: center; line-height: 1;
      transition: transform 0.15s;
    }
    .inspector-section-chevron:hover { color: #888; }
    .inspector-section-chevron svg { width: 13px; height: 13px; }
    .inspector-section.collapsed .inspector-section-chevron { transform: rotate(-90deg); }
    .inspector-section-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .inspector-section-title { font-size: 11px; font-weight: 600; color: #c0c0c0; }

    /* Fields (28px height) — internal padding kept tight so short values
       like "auto" don't get clipped when 3 fields share a row in g3. */
    .inspector-field {
      display: flex; align-items: center;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      height: 28px; padding: 0 6px; gap: 4px; flex: 1; min-width: 0;
    }
    .inspector-field:hover { border-color: #3a3a3a; }
    .inspector-field:focus-within { border-color: #DA7756; }
    .inspector-field input, .inspector-field select {
      background: none; border: none; outline: none;
      color: #ccc; font-size: 11px; font-family: Inter, system-ui, sans-serif;
      width: 100%; min-width: 0;
    }
    .inspector-fi {
      color: #555; font-size: 9px; flex-shrink: 0;
      cursor: ew-resize; user-select: none; width: 11px; text-align: center;
    }
    .inspector-fi svg { width: 11px; height: 11px; display: block; }
    .inspector-fu { font-size: 10px; color: #555; flex-shrink: 0; }
    .inspector-unit-sel {
      background: none; border: none; outline: none; color: #555;
      font-size: 10px; font-family: Inter, system-ui, sans-serif;
      cursor: pointer; padding: 0; flex-shrink: 0;
    }

    .inspector-field-sm {
      display: flex; align-items: center; gap: 3px;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      height: 28px; padding: 0 7px; width: 58px; flex-shrink: 0;
    }
    .inspector-field-sm input {
      background: none; border: none; outline: none;
      color: #ccc; font-size: 11px; font-family: Inter, system-ui, sans-serif; width: 100%;
    }
    .inspector-field-sm:hover { border-color: #3a3a3a; }
    .inspector-field-sm:focus-within { border-color: #DA7756; }

    /* Grids and rows */
    .inspector-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .inspector-g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
    .inspector-row { display: flex; gap: 4px; margin-bottom: 6px; }

    /* 50/50 split row used in the Layout section when the picked element
       is a flex/grid container — left half is the alignment pad, right
       half stacks the W and H fields vertically. Falls back to the
       single-row dimensions when the pad isn't rendered. */
    .inspector-layout-split {
      display: flex; gap: 8px;
      margin-bottom: 8px;
    }
    .inspector-layout-half { flex: 1; min-width: 0; }
    .inspector-stack-v {
      display: flex; flex-direction: column; gap: 4px;
    }
    .inspector-stack-v .inspector-field { flex: 0 0 28px; width: 100%; }

    /* 3×3 alignment pad for flex / grid containers (Figma-style). Each
       dot is a click-target that maps to a (horizontal, vertical) pair.
       Pad is only rendered when the picked element is a flex/grid
       container; see buildAlignmentPad. Sized to ~match the stacked
       W/H column on the right so the split row reads as a single block. */
    .inspector-align-pad {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 0;
      width: 100%; aspect-ratio: 1 / 1; max-height: 60px;
      background: #1f1f1f; border: 1px solid #2e2e2e; border-radius: 4px;
      padding: 6px;
    }
    .align-pad-dot {
      background: none; border: none; padding: 0; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      position: relative;
    }
    .align-pad-dot::before {
      content: ''; display: block;
      width: 4px; height: 4px; border-radius: 50%;
      background: #444; transition: background 0.1s, transform 0.1s;
    }
    .align-pad-dot:hover::before { background: #888; transform: scale(1.5); }
    .align-pad-dot.active::before {
      background: #3B82F6; transform: scale(1.8);
    }
    .inspector-row:last-child { margin-bottom: 0; }
    .inspector-sub-label {
      font-size: 10px; color: #555; margin: 8px 0 5px;
      display: flex; align-items: center; justify-content: space-between;
    }

    /* Icon button groups */
    .inspector-ig {
      display: flex; gap: 3px; background: #252525; border: 1px solid #2e2e2e;
      border-radius: 4px; padding: 3px; flex: 1;
    }
    .inspector-ig-btn {
      flex: 1; height: 22px; display: flex; align-items: center; justify-content: center;
      border-radius: 3px; cursor: pointer; color: #555; border: none; background: none;
    }
    .inspector-ig-btn:hover { color: #aaa; background: #2e2e2e; }
    .inspector-ig-btn.on { color: #e0e0e0; background: #2e2e2e; }
    .inspector-ig-btn svg { width: 13px; height: 13px; }
    .inspector-ig-sep { width: 1px; background: #333; margin: 2px 3px; }

    /* Checkboxes */
    .inspector-check-row { display: flex; align-items: center; gap: 8px; margin-top: 7px; cursor: pointer; }
    .inspector-check-box {
      width: 14px; height: 14px; border: 1px solid #3a3a3a; border-radius: 3px;
      background: #1a1a1a; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    }
    .inspector-check-box.on { background: #fff; border-color: #fff; }
    .inspector-check-box svg { width: 10px; height: 10px; stroke: transparent; }
    /* Checkmark visibility flows from the .on class, not from an inline
       SVG attr — otherwise toggling at runtime can't change the check. */
    .inspector-check-box.on svg { stroke: #1c1c1c; }
    .inspector-check-label { font-size: 11px; color: #888; }
    /* Side-by-side row holding two check controls (e.g. Clip content +
       Border box) so they read as paired toggles instead of stacked rows. */
    .inspector-check-pair {
      display: flex; gap: 18px; margin-top: 7px;
    }
    .inspector-check-pair .inspector-check-row { margin-top: 0; flex: 1; min-width: 0; }

    /* Color field */
    .inspector-color-field {
      display: flex; align-items: center; gap: 7px;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      height: 28px; padding: 0 8px; flex: 1;
    }
    .inspector-color-field:hover { border-color: #3a3a3a; }
    .inspector-color-swatch {
      width: 15px; height: 15px; border-radius: 3px; border: 1px solid #3a3a3a;
      cursor: pointer; flex-shrink: 0;
    }
    .inspector-color-field input {
      background: none; border: none; outline: none;
      color: #ccc; font-size: 11px; font-family: Inter, system-ui, sans-serif; width: 100%;
    }

    /* Expand button — chevron rotates 180° when the spacing panel is open. */
    .inspector-expand-btn {
      background: none; border: none; color: #444; cursor: pointer; padding: 0;
      display: flex; align-items: center; line-height: 1;
      transition: transform 0.15s, color 0.1s;
    }
    .inspector-expand-btn svg { width: 13px; height: 13px; }
    .inspector-expand-btn:hover { color: #888; }
    .inspector-expand-btn.open { transform: rotate(180deg); color: #888; }

    /* "Show margins box" text link in the Padding label row. Inherits
       the sub-label's 10px size; blue accent. */
    .inspector-expand-link {
      background: none; border: none; padding: 0;
      color: #3B82F6; cursor: pointer;
      font: inherit; /* picks up sub-label's 10px from parent */
      letter-spacing: 0.02em;
    }
    .inspector-expand-link:hover { color: #6ba5f8; text-decoration: underline; }

    /* Padding row: x-field | y-field | individual-sides icon. The icon
       sits flush against the y-field on the right (Figma layout). */
    .inspector-padding-row {
      display: flex; align-items: center; gap: 4px;
    }
    .inspector-padding-row .inspector-field { flex: 1; min-width: 0; }
    .inspector-padding-individual-btn {
      flex: 0 0 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: none; padding: 0;
      color: #555; cursor: pointer; border-radius: 3px;
      transition: color 0.1s, background 0.1s;
    }
    .inspector-padding-individual-btn svg { width: 13px; height: 13px; display: block; }
    .inspector-padding-individual-btn:hover { color: #ccc; background: rgba(255,255,255,0.04); }
    .inspector-padding-individual-btn.active { color: #3B82F6; background: rgba(59,130,246,0.1); }

    /* Spacing widget */
    .inspector-sp-widget { background: #111; border: 1px solid #252525; border-radius: 5px; overflow: hidden; }
    .inspector-sp-margin {
      background: #1e1508; display: grid;
      grid-template-rows: 28px 1fr 28px; grid-template-columns: 28px 1fr 28px;
      position: relative;
    }
    .inspector-sp-margin::before {
      content: ''; position: absolute; inset: 0;
      border: 1.5px dashed #3a2808; border-radius: 3px; pointer-events: none; z-index: 1;
    }
    .inspector-sp-margin-label {
      position: absolute; top: 4px; left: 6px;
      font-size: 8px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #5a3a10; user-select: none; z-index: 2;
    }
    .inspector-sp-padding {
      background: #0a1e1e; display: grid;
      grid-template-rows: 28px 1fr 28px; grid-template-columns: 28px 1fr 28px;
      position: relative;
    }
    .inspector-sp-padding::before {
      content: ''; position: absolute; inset: 0;
      border: 1px solid #0e3030; border-radius: 2px; pointer-events: none; z-index: 1;
    }
    .inspector-sp-padding-label {
      position: absolute; top: 4px; left: 6px;
      font-size: 8px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #0e3030; user-select: none; z-index: 2;
    }
    .inspector-sp-element {
      background: #061818; border: 1px solid #104040; border-radius: 2px;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; color: #207060; user-select: none;
      grid-column: 2; grid-row: 2; padding: 8px 10px;
    }
    .inspector-sv {
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: #999; font-family: Inter, system-ui, sans-serif;
      cursor: ew-resize; user-select: none; position: relative; z-index: 3;
    }
    .inspector-sv:hover { color: #DA7756; }
    .inspector-sv input {
      background: none; border: none; outline: none;
      color: inherit; font-size: 11px; font-family: Inter, system-ui, sans-serif;
      text-align: center; width: 100%; cursor: ew-resize; padding: 0;
    }
    .inspector-sv input:focus { color: #DA7756; cursor: text; }

    .inspector-sp-expanded {
      margin-top: 8px; background: #141414; border: 1px solid #252525;
      border-radius: 4px; padding: 8px 9px;
    }
    .inspector-sp-expanded-title {
      font-size: 9px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.08em; color: #3a3a3a; margin-bottom: 6px;
    }
    .inspector-sp-4 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }

    /* ── Layer sections (Fill / Stroke / Effects) ── */
    .layer-section { padding: 10px 12px; border-bottom: 1px solid #252525; }
    .layer-section:last-child { border-bottom: none; }
    .layer-section-hd { display: flex; align-items: center; gap: 6px; margin-bottom: 0; }
    .layer-section-title { font-size: 11px; font-weight: 600; color: #c0c0c0; flex: 1; }
    .layer-add-btn { background: none; border: none; color: #555; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 3px; }
    .layer-add-btn:hover { color: #aaa; background: #252525; }
    .layer-add-btn svg { width: 14px; height: 14px; }
    .layer-row { display: flex; align-items: center; gap: 5px; margin-top: 7px; }
    .layer-swatch { width: 20px; height: 20px; border-radius: 4px; flex-shrink: 0; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); background-image: repeating-conic-gradient(#444 0% 25%, #333 0% 50%); background-size: 8px 8px; position: relative; }
    .layer-swatch-color { position: absolute; inset: 0; border-radius: 3px; }
    .layer-value-field { display: flex; align-items: center; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px; height: 26px; padding: 0 8px; flex: 1; min-width: 0; }
    .layer-value-field:hover { border-color: #3a3a3a; }
    .layer-value-field input { background: none; border: none; outline: none; color: #ccc; font-size: 11px; font-family: monospace; width: 100%; min-width: 0; }
    .layer-opacity-field { display: flex; align-items: center; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px; height: 26px; padding: 0 6px; width: 52px; flex-shrink: 0; gap: 2px; }
    .layer-opacity-field input { background: none; border: none; outline: none; color: #ccc; font-size: 11px; font-family: Inter, system-ui, sans-serif; width: 100%; text-align: right; }
    .layer-opacity-field .fu { font-size: 9px; color: #666; }
    .layer-eye-btn { background: none; border: none; color: #555; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 3px; flex-shrink: 0; }
    .layer-eye-btn:hover { color: #aaa; background: #252525; }
    .layer-eye-btn svg { width: 14px; height: 14px; }
    .layer-eye-btn.hidden { color: #333; }
    .layer-minus-btn { background: none; border: none; color: #555; cursor: pointer; font-size: 14px; font-weight: 300; line-height: 1; padding: 0 2px; flex-shrink: 0; }
    .layer-minus-btn:hover { color: #aaa; }
    .layer-row.layer-hidden .layer-swatch-color { opacity: 0.3; }
    .layer-row.layer-hidden .layer-value-field { opacity: 0.35; }
    .layer-row.layer-hidden .layer-opacity-field { opacity: 0.35; }
    .layer-type-dd { flex: 1; display: flex; align-items: center; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px; height: 26px; padding: 0 8px; cursor: pointer; font-size: 11px; color: #ccc; gap: 4px; min-width: 0; }
    .layer-type-dd:hover { border-color: #3a3a3a; }
    .layer-dd-arrow { margin-left: auto; font-size: 8px; color: #555; }
    .layer-detail { margin-top: 6px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px; padding: 9px; }
    .layer-detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
    .layer-detail-row:last-child { margin-bottom: 0; }
    .layer-detail-label { font-size: 10px; color: #555; width: 48px; flex-shrink: 0; }
    .layer-detail-field { display: flex; align-items: center; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px; height: 24px; padding: 0 6px; flex: 1; gap: 4px; min-width: 0; }
    .layer-detail-field .lbl { font-size: 9px; font-weight: 600; color: #555; flex-shrink: 0; cursor: ew-resize; user-select: none; }
    .layer-detail-field input { background: none; border: none; outline: none; color: #ccc; font-size: 10px; font-family: Inter, system-ui, sans-serif; width: 0; flex: 1; min-width: 0; }
    .layer-detail-field .fu { font-size: 9px; color: #666; }
    .layer-detail-g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; flex: 1; }
    .layer-detail-color-row { display: flex; align-items: center; gap: 5px; flex: 1; }
    .layer-detail-swatch { width: 16px; height: 16px; border-radius: 3px; flex-shrink: 0; cursor: pointer; border: 1px solid rgba(255,255,255,0.12); background-image: repeating-conic-gradient(#444 0% 25%, #333 0% 50%); background-size: 6px 6px; position: relative; }
    .layer-detail-swatch-c { position: absolute; inset: 0; border-radius: 2px; }
    .layer-detail-hex { flex: 1; display: flex; align-items: center; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px; height: 24px; padding: 0 6px; }
    .layer-detail-hex input { background: none; border: none; outline: none; color: #ccc; font-size: 10px; font-family: monospace; width: 100%; }
    .layer-detail-opacity { display: flex; align-items: center; background: #252525; border: 1px solid #2e2e2e; border-radius: 4px; height: 24px; padding: 0 5px; width: 50px; gap: 2px; flex-shrink: 0; }
    .layer-detail-opacity input { background: none; border: none; outline: none; color: #ccc; font-size: 10px; font-family: Inter, system-ui, sans-serif; width: 100%; text-align: right; }

    /* Pick-mode hover: class only sets the cursor now — the visible
       blue ring is drawn by a floating overlay in the parent doc
       (.__inspector-pick-hover-overlay) so it can't be clipped by
       ancestor overflow:hidden boxes. */
    .__inspector-highlight { cursor: crosshair !important; }
    /* Floating overlay that follows the cursor-hovered element during
       pick mode. Same outline behavior as the selection overlay —
       2px ring with a 1px outer offset. */
    .__inspector-pick-hover-overlay {
      position: fixed;
      pointer-events: none;
      background: transparent;
      box-shadow: 0 0 0 2px #3B82F6;
      z-index: 2147483640;
      display: none;
    }

    /* Reorder grippers — hollow pink rings per sibling. The hit box IS
       the full visible disc (9×9 by default) so the transparent center
       still registers mousedown — clicking the "hole" picks up the
       sibling as if the circle were filled. Layering uses INSET shadows
       from the outer edge inward:
         · 1px white outer outline (0–1px from edge)
         · 1px pink ring          (1–2px from edge)
         · 1px white inner stroke (2–3px from edge)
         · transparent center
       On hover the element scales to 2× so the active grabbable pops. */
    /* The gripper element itself is a transparent 17×17 HIT PAD —
       generous enough that a slightly-off cursor still grabs the
       handle. The visible disc (small pink ring with white outer
       outline + inner stroke + transparent hole) is drawn by the
       ::before pseudo-element, centered inside the pad. The pad
       expands the proximity zone without making the visual louder. */
    .__inspector-gripper {
      position: fixed;
      width: 17px; height: 17px;
      background: transparent;
      border: none;
      z-index: 2147483643;
      cursor: grab;
      pointer-events: auto;
    }
    .__inspector-gripper::before {
      content: '';
      position: absolute;
      width: 7px; height: 7px;
      left: 50%; top: 50%;
      margin-left: -3.5px; margin-top: -3.5px;
      border-radius: 50%;
      background: transparent;
      box-shadow:
        inset 0 0 0 1px #fff,
        inset 0 0 0 2px #ff3d8b,
        inset 0 0 0 3px #fff;
      transform: scale(1);
      transform-origin: center;
      transition: transform 110ms ease-out;
    }
    /* Hover doubles the visible disc — current hover ≈ 14×14, default
       ≈ half of that. The hit pad stays 17×17 either way. */
    .__inspector-gripper:hover::before { transform: scale(2); }
    .__inspector-gripper:active { cursor: grabbing; }

    /* Decorative gap bars — 1.5px pink line with a 1px white outer
       outline, sitting in each gap between siblings. No interaction;
       future feature will repurpose them as gap-size handles. */
    .__inspector-gap-bar {
      position: fixed;
      background: #ff3d8b;
      box-shadow: 0 0 0 1px #fff;
      border-radius: 1px;
      z-index: 2147483641;
      pointer-events: none;
    }

    /* Floating action buttons near the selected element.
       FAB-A (horizontal) sits at the top-right corner: Reselect + Clear.
       FAB-B (vertical)   sits at the right edge centered: Select parent +
       Select first sibling. Both follow the selection on scroll/resize. */
    .__inspector-fab {
      position: fixed;
      display: none;
      align-items: center;
      background: #3B82F6;
      border-radius: 4px;
      padding: 2px;
      gap: 1px;
      z-index: 2147483645;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      pointer-events: auto;
      font-family: Inter, system-ui, sans-serif;
    }
    .__inspector-fab.visible { display: inline-flex; }
    .__inspector-fab.vertical { flex-direction: column; align-items: stretch; }
    .__inspector-fab button {
      width: 13px; height: 13px;
      background: transparent; border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #fff;
      border-radius: 2px; padding: 0; margin: 0;
    }
    .__inspector-fab button:hover:not(:disabled) {
      background: rgba(255,255,255,0.20);
    }
    .__inspector-fab button:disabled {
      opacity: 0.35; cursor: not-allowed;
    }
    .__inspector-fab button svg {
      width: 8px; height: 8px; display: block;
    }

    /* Element-action split button — primary action (Hide) + caret
       that reveals a small menu (Delete). Sits at the bottom of the
       Appearance section. Coral tint on the primary when active
       (element currently hidden) so the toggle state is legible. */
    .inspector-split-btn-wrap { position: relative; margin-top: 8px; }
    .inspector-split-btn {
      display: flex; align-items: stretch;
      background: #252525; border: 1px solid #2e2e2e;
      border-radius: 6px; overflow: hidden;
    }
    .inspector-split-btn-main {
      flex: 1;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 6px 10px;
      background: none; border: none; border-right: 1px solid #2e2e2e;
      color: #d4d4d4; font: 500 11px Inter, system-ui, sans-serif;
      cursor: pointer;
    }
    .inspector-split-btn-main:hover { background: #2a2a2a; color: #fff; }
    .inspector-split-btn-main.active {
      background: rgba(218,119,86,0.18); color: #DA7756;
    }
    .inspector-split-btn-main.active:hover { background: rgba(218,119,86,0.28); }
    .inspector-split-btn-main svg { width: 14px; height: 14px; flex-shrink: 0; }
    .inspector-split-btn-toggle {
      flex: 0 0 28px;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; color: #888; cursor: pointer;
    }
    .inspector-split-btn-toggle:hover { background: #2a2a2a; color: #d4d4d4; }
    .inspector-split-btn-toggle svg { width: 12px; height: 12px; }
    .inspector-split-btn-menu {
      display: none; position: absolute; right: 0; top: calc(100% + 4px);
      min-width: 160px;
      background: #1a1a1a; border: 1px solid #2e2e2e; border-radius: 6px;
      padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index: 100;
    }
    .inspector-split-btn-menu.open { display: block; }
    .inspector-split-btn-menu button {
      display: flex; align-items: center; gap: 8px;
      width: 100%;
      padding: 6px 10px;
      background: none; border: none;
      color: #d4d4d4; font: 500 11px Inter, system-ui, sans-serif;
      text-align: left; cursor: pointer; border-radius: 4px;
    }
    .inspector-split-btn-menu button:hover { background: #c44; color: #fff; }
    .inspector-split-btn-menu button svg { width: 12px; height: 12px; flex-shrink: 0; }

    /* Floating blue selection box — drawn in parent doc so it survives
       any ancestor overflow:hidden in the target. Box-shadow (not border)
       provides the outline ring without changing layout; spread doubles
       to 2px when the cursor is over the picked element. */
    .__inspector-selection-overlay {
      position: fixed;
      pointer-events: none;
      background: transparent;
      box-shadow: 0 0 0 1px #3B82F6;
      z-index: 2147483640;
      transition: box-shadow 80ms ease-out;
    }
    .__inspector-selection-overlay.hovered {
      box-shadow: 0 0 0 2px #3B82F6;
    }
    /* Marker class for the currently-selected element(s). Used for
       querying / cleanup only — the visible selection box is now
       drawn as a floating overlay in the parent doc (see the
       .__inspector-selection-overlay rules below), so it can't be
       clipped by ancestor overflow:hidden boxes. */
    /* Numbered badge floating at the top-left of each multi-picked element. */
    .__inspector-multi-badge {
      position: fixed; z-index: 1000002;
      min-width: 18px; height: 18px; padding: 0 5px;
      background: #3B82F6; color: #fff;
      font: 600 10px/18px Inter, system-ui, -apple-system, sans-serif;
      text-align: center; border-radius: 9px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      pointer-events: none; user-select: none;
    }
    #__inspector-tooltip {
      position: fixed; background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
      padding: 4px 8px; font-size: 11px; color: #888; pointer-events: none;
      z-index: 2147483647; display: none;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    /* Custom panel tooltip */
    #__inspector-panel-tip {
      position: fixed; z-index: 2147483647; pointer-events: none;
      background: #0a0a0a; color: #e0e0e0; font-size: 11px;
      padding: 5px 10px; border-radius: 6px;
      white-space: nowrap; max-width: 220px; white-space: normal; line-height: 1.4;
      opacity: 0; transition: opacity 0.12s;
      border: 1px solid #222;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      /* Tooltip element is appended to document.body, not #__inspector-root,
         so it doesn't inherit the panel's font. Set it explicitly. */
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #__inspector-panel-tip.show { opacity: 1; }

    /* ── Changes bottom bar ── */
    #__inspector-changes-bar {
      display: none; flex-direction: column;
      flex-shrink: 0; border-top: 1px solid #2a2a2a;
    }
    #__inspector-changes-bar.visible { display: flex; }

    .changes-bar-bottom-row {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px; background: #1a1a1a;
    }

    /* Undo / Redo — separate dark buttons outside the pill */
    .changes-ur-btn {
      width: 28px; height: 28px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: 6px; border: none; cursor: pointer;
      background: transparent; color: #888; padding: 0;
    }
    .changes-ur-btn:hover:not(:disabled) { background: #2a2a2a; color: #ccc; }
    .changes-ur-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .changes-ur-btn svg { width: 14px; height: 14px; }

    /* Coral changes pill — default state */
    #__inspector-changes-pill {
      flex: 1; background: #DA7756; border-radius: 8px;
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; cursor: pointer; user-select: none;
      transition: background 0.1s, border-color 0.1s;
    }
    #__inspector-changes-pill:hover { background: #c96844; }
    .changes-bar-count {
      background: rgba(255,255,255,0.25); color: #fff;
      border-radius: 4px; font-size: 10px; font-weight: 700;
      min-width: 18px; height: 18px; padding: 0 4px; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0;
    }
    .changes-bar-label {
      flex: 1; font-size: 11px; font-weight: 600; color: #fff;
      display: flex; align-items: center; gap: 3px; white-space: nowrap;
    }
    .changes-bar-arrow { color: rgba(255,255,255,0.8); flex-shrink: 0; }

    /* Pill — muted state when drawer is open (pure CSS sibling selector) */
    .changes-bar-drawer.open + .changes-bar-bottom-row #__inspector-changes-pill {
      background: #252525; border: 1px solid #333;
    }
    .changes-bar-drawer.open + .changes-bar-bottom-row #__inspector-changes-pill:hover {
      background: #2e2e2e;
    }
    .changes-bar-drawer.open + .changes-bar-bottom-row .changes-bar-count {
      background: rgba(218,119,86,0.2); color: #DA7756;
    }
    .changes-bar-drawer.open + .changes-bar-bottom-row .changes-bar-label {
      color: #888; font-weight: 500;
    }
    .changes-bar-drawer.open + .changes-bar-bottom-row .changes-bar-arrow { color: #555; }
    .changes-bar-drawer.open + .changes-bar-bottom-row .changes-bar-arrow svg { transform: rotate(180deg); }

    /* Drawer */
    .changes-bar-drawer { display: none; background: #161616; border-top: 2px solid #2a2a2a; }
    .changes-bar-drawer.open { display: block; }

    /* Drawer header */
    .changes-drawer-hd {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px 7px; border-bottom: 1px solid #1e1e1e;
    }
    .changes-drawer-hd-left { display: flex; align-items: center; gap: 7px; }
    .changes-drawer-title {
      font-size: 10px; font-weight: 600; color: #888;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .changes-drawer-pending {
      background: rgba(218,119,86,0.15); border-radius: 10px;
      padding: 1px 6px; font-size: 9px; color: #DA7756; font-weight: 600;
    }
    .changes-drawer-close {
      background: none; border: none; color: #444; cursor: pointer;
      font-size: 14px; line-height: 1; padding: 0;
    }
    .changes-drawer-close:hover { color: #888; }

    /* Change rows — two-line layout */
    .changes-row {
      padding: 7px 12px; border-bottom: 1px solid #1e1e1e;
      background: #161616;
    }
    .changes-row-top {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 3px;
    }
    .changes-row-selector {
      color: #555; font-size: 9px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
    }
    .changes-row-rm {
      background: none; border: none; color: #333; cursor: pointer;
      font-size: 12px; padding: 0; flex-shrink: 0; line-height: 1;
    }
    .changes-row-rm:hover { color: #888; }
    .changes-row-bottom {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .changes-row-prop { color: #aaa; font-size: 10px; font-weight: 500; flex-shrink: 0; }
    .changes-row-values { display: flex; align-items: center; gap: 5px; overflow: hidden; }
    .changes-row-from {
      color: #444; font-size: 10px; text-decoration: line-through;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70px;
    }
    .changes-row-arrow { color: #444; font-size: 9px; flex-shrink: 0; }
    .changes-row-to {
      color: #DA7756; font-size: 10px; font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90px;
    }

    /* Copy prompt button — coral primary CTA */
    .changes-bar-copy {
      margin: 8px 12px 10px;
      background: #DA7756; color: #fff; border: none; border-radius: 6px;
      padding: 8px 14px; font-size: 10px; font-weight: 600;
      cursor: pointer; width: calc(100% - 24px);
      font-family: Inter, system-ui, sans-serif; text-align: center; display: block;
    }
    .changes-bar-copy:hover { background: #c96844; }

    /* CSS Raw tab bottom toolbar — matches the style of the changes
       drawer's Copy Prompt button so the inspector reads as one
       consistent action surface across tabs. */
    .inspector-raw-toolbar {
      padding: 8px 10px;
      border-top: 1px solid #2a2a2a;
      background: #161616;
    }
    .inspector-raw-apply {
      width: 100%;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 8px 12px;
      background: #DA7756; color: #fff;
      border: none; border-radius: 6px;
      font: 600 12px Inter, system-ui, sans-serif;
      cursor: pointer;
      transition: background 0.12s;
    }
    .inspector-raw-apply:hover { background: #c96844; }
    .inspector-raw-apply svg { width: 14px; height: 14px; stroke: currentColor; }

    /* Prompt-preview tooltip (hover on Copy Prompt button or change rows).
       Pointer-events auto so the user can move into the tooltip and
       scroll long prompts; the show/hide logic bridges trigger→tooltip
       with a small grace timer. Thin dark scrollbar matches the CSS
       Raw textarea. */
    #__inspector-prompt-preview {
      position: fixed; display: none;
      background: #0e0e0e; color: #d4d4d4;
      border: 1px solid #2a2a2a; border-radius: 8px;
      padding: 12px 14px;
      font-family: Menlo, Monaco, Consolas, monospace;
      font-size: 11px; line-height: 1.5;
      white-space: pre-wrap; word-wrap: break-word;
      max-width: 520px; max-height: 340px; overflow: auto;
      box-shadow: 0 8px 28px rgba(0,0,0,0.6);
      z-index: 2147483647; pointer-events: auto;
      scrollbar-width: thin;
      scrollbar-color: #333 transparent;
    }
    #__inspector-prompt-preview::-webkit-scrollbar { width: 6px; }
    #__inspector-prompt-preview::-webkit-scrollbar-thumb {
      background: #333; border-radius: 3px;
    }
    #__inspector-prompt-preview::-webkit-scrollbar-thumb:hover { background: #444; }
    #__inspector-prompt-preview::-webkit-scrollbar-track { background: transparent; }

    /* ── Element tree popup ── */
    #__inspector-tree-popup {
      display: none; position: fixed;
      /* Must sit ABOVE the inspector panel (z 2147483647) — the
         popup anchors to the panel's selector pill and reads as
         a child of it. */
      z-index: 2147483647;
      width: 272px; background: #1e1e1e; border: 1px solid #2e2e2e;
      border-radius: 10px; overflow: hidden;
      max-height: calc(100vh - 24px); overflow-y: auto; scrollbar-width: none;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04);
      font-family: Inter, system-ui, sans-serif; font-size: 11px; color: #d4d4d4;
    }
    #__inspector-tree-popup::-webkit-scrollbar { display: none; }
    #__inspector-tree-popup.visible { display: block; }
    /* Chat-ready-intro CTA — pinned to the top of the tree popup. Blue
       text link with a small clipboard icon on its left. Used to be a
       header-only icon; now lives here so the header can carry the X. */
    .tree-copy-btn {
      display: flex; align-items: center; justify-content: flex-end;
      gap: 6px; width: 100%;
      margin: 0; padding: 8px 12px;
      background: none; border: none;
      color: #3B82F6; font-family: inherit;
      font-size: 11px; font-weight: 600;
      cursor: pointer; user-select: none;
    }
    .tree-copy-btn:hover { color: #6ba5f8; }
    .tree-copy-btn.just-copied { color: #3d9e6d; }
    .tree-copy-icon { width: 13px; height: 13px; display: block; flex-shrink: 0; }
    .tree-section-label {
      padding: 5px 12px 3px; font-size: 8px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.1em; color: #3a3a3a; background: #1a1a1a;
    }
    .tree-row {
      display: flex; align-items: center; gap: 7px; padding: 6px 12px;
      cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.03);
      transition: background 0.08s;
    }
    .tree-row:last-child { border-bottom: none; }
    .tree-row:hover { background: rgba(59,130,246,0.12) !important; opacity: 1 !important; }
    .tree-row.tree-selected { background: rgba(218,119,86,0.12); outline: 1.5px solid rgba(218,119,86,0.5); outline-offset: -1px; border-radius: 4px; margin: 2px 6px; padding: 6px 8px; border-bottom: 1px solid transparent; }
    .tree-row.tree-selected:hover { background: rgba(218,119,86,0.18) !important; }
    .tree-row.tree-selected .tree-tag-el { color: #9dc4e8; }
    .tree-row.tree-selected .tree-tag-cls { color: #bbb; }
    .tree-row.tree-dim { opacity: 0.55; }
    .tree-conn { flex-shrink: 0; display: flex; }
    .tree-conn-pipe { width: 12px; height: 20px; position: relative; flex-shrink: 0; }
    .tree-conn-pipe::before { content: ''; position: absolute; left: 0; top: 0; bottom: 50%; width: 1px; background: #333; }
    .tree-conn-pipe::after { content: ''; position: absolute; left: 0; top: 50%; width: 8px; height: 1px; background: #333; }
    .tree-conn-spacer { width: 12px; height: 20px; position: relative; flex-shrink: 0; }
    .tree-conn-spacer::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 1px; background: #333; }
    .tree-tag { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 10.5px; }
    .tree-tag-el { color: #7aa2cc; }
    .tree-tag-id { color: #DA7756; }
    .tree-tag-cls { color: #888; }
    .tree-tag-anon { color: #555; font-style: italic; }
    .tree-props { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
    .tree-swatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.25); flex-shrink: 0; }
    .tree-stroke { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
    .tree-text-badge { font-size: 9px; font-weight: 800; line-height: 1; padding: 1px 4px; border-radius: 3px; background: #333; color: #ccc; border: 1px solid #444; }
    .tree-sep { width: 1px; height: 10px; background: #2e2e2e; }
    .tree-layout-icon { width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tree-layout-icon svg { width: 12px; height: 12px; }
    .tree-layout-icon.flex { color: #f59e0b; }
    .tree-layout-icon.grid { color: #818cf8; }
    .tree-fx { font-size: 8px; font-weight: 700; letter-spacing: 0.04em; padding: 1px 4px; border-radius: 3px; line-height: 1.4; background: rgba(168,85,247,0.12); color: #a855f7; border: 1px solid rgba(168,85,247,0.2); }
    .tree-hint { padding: 8px 12px; border-top: 1px solid #252525; font-size: 9px; color: #666; line-height: 1.5; background: #191919; }
    .tree-hint-key { color: #DA7756; font-weight: 600; }
    .tree-hint-sel { color: #DA7756; }

    /* Empty state */
    .inspector-empty { padding: 24px 14px; text-align: center; color: #333; font-size: 11px; line-height: 1.6; }

    /* ── Color picker popup ── */
    #__inspector-color-popup {
      display: none; position: fixed; z-index: 2147483647;
      width: 220px; background: #1c1c1c; border: 1px solid #2a2a2a;
      border-radius: 8px; overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: Inter, system-ui, sans-serif;
    }
    #__inspector-color-popup.visible { display: block; }

    #__inspector-cp-canvas {
      width: 100%; height: 140px; position: relative; cursor: crosshair;
    }
    #__inspector-cp-cursor {
      position: absolute; width: 10px; height: 10px;
      border: 2px solid #fff; border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
      pointer-events: none;
    }
    .cp-sliders-row {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 10px 8px;
    }
    #__inspector-cp-preview {
      width: 22px; height: 22px; border-radius: 4px;
      border: 1px solid #333; flex-shrink: 0;
      background-image: repeating-conic-gradient(#555 0% 25%, #333 0% 50%);
      background-size: 8px 8px; position: relative;
    }
    #__inspector-cp-preview-color {
      position: absolute; inset: 0; border-radius: 3px;
    }
    .cp-sliders-stack { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .cp-slider-track {
      height: 8px; border-radius: 4px; position: relative; cursor: pointer;
    }
    #__inspector-cp-hue-track {
      background: linear-gradient(to right, #f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);
    }
    .cp-slider-thumb {
      position: absolute; width: 12px; height: 12px;
      border: 2px solid #fff; border-radius: 50%;
      top: 50%; transform: translate(-50%, -50%);
      box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
      pointer-events: none;
    }
    .cp-format-bar {
      display: flex; margin: 0 10px 8px;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      overflow: hidden;
    }
    .cp-fmt-btn {
      flex: 1; padding: 4px 0; text-align: center;
      font-size: 9px; font-weight: 600; color: #555;
      cursor: pointer; letter-spacing: 0.04em;
      background: none; border: none;
      font-family: Inter, system-ui, sans-serif;
    }
    .cp-fmt-btn.on { background: #3a3a3a; color: #DA7756; }
    .cp-input-row {
      display: flex; align-items: center; gap: 6px;
      margin: 0 10px 10px;
    }
    #__inspector-cp-value-input {
      flex: 1; height: 26px; background: #252525;
      border: 1px solid #2e2e2e; border-radius: 4px;
      padding: 0 8px; font-size: 11px; color: #ccc;
      font-family: monospace; outline: none;
    }
    #__inspector-cp-value-input:focus { border-color: #DA7756; }
    #__inspector-cp-alpha-input {
      width: 44px; height: 26px; background: #252525;
      border: 1px solid #2e2e2e; border-radius: 4px;
      padding: 0 6px; font-size: 11px; color: #ccc;
      font-family: Inter, system-ui, sans-serif; outline: none; text-align: center;
    }
    #__inspector-cp-alpha-input:focus { border-color: #DA7756; }
    .cp-alpha-bg {
      position: absolute; inset: 0; border-radius: 4px;
      background-image: repeating-conic-gradient(#555 0% 25%, #333 0% 50%);
      background-size: 8px 8px;
    }
    .cp-alpha-gradient { position: absolute; inset: 0; border-radius: 4px; }

    /* Disabled preview — shown when no element is selected */
    .inspector-panel-disabled {
      pointer-events: none;
      opacity: 0.28;
      user-select: none;
    }
    .inspector-disabled-hint {
      position: sticky;
      top: 0;
      background: rgba(28,28,28,0.92);
      padding: 8px 12px;
      font-size: 10px;
      color: #666;
      text-align: center;
      z-index: 1;
      border-bottom: 1px solid #252525;
      backdrop-filter: blur(4px);
    }

    /* CSS Raw — panel uses flex column so the textarea grows to fill
       the available space and the Apply toolbar sticks to the bottom. */
    #__inspector-panel-raw.active {
      display: flex; flex-direction: column; height: 100%;
    }
    #__inspector-css-raw {
      flex: 1; width: 100%; min-height: 160px;
      background: #1a1a1a; border: none; border-top: 1px solid #252525;
      color: #888; font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
      padding: 12px; resize: none; outline: none; line-height: 1.6;
      scrollbar-width: thin;
      scrollbar-color: #333 transparent;
    }
    #__inspector-css-raw:focus { color: #ccc; }
    #__inspector-css-raw::-webkit-scrollbar { width: 6px; }
    #__inspector-css-raw::-webkit-scrollbar-thumb {
      background: #333; border-radius: 3px;
    }
    #__inspector-css-raw::-webkit-scrollbar-thumb:hover { background: #444; }
    #__inspector-css-raw::-webkit-scrollbar-track { background: transparent; }

    /* Override indicator — modified fields */
    .inspector-field.modified .inspector-fi,
    .inspector-field-sm.modified .inspector-fi {
      color: #DA7756;
    }

    /* Reset button — hidden by default, shown on hover of modified field */
    .inspector-reset-btn {
      display: none;
      background: none; border: none; color: #DA7756;
      font-size: 11px; cursor: pointer; flex-shrink: 0;
      padding: 0 2px; line-height: 1;
      font-family: Inter, system-ui, sans-serif;
    }
    .inspector-field.modified:hover .inspector-reset-btn,
    .inspector-field-sm.modified:hover .inspector-reset-btn {
      display: block;
    }

    /* Modified spacing widget value */
    .inspector-sv.modified {
      color: #DA7756;
    }
    .inspector-sv.modified input {
      color: #DA7756;
    }

/* ────── Pre-pick layers ────── */
.__inspector-pp-band {
  position: fixed; pointer-events: none;
  z-index: 2147483640;
  display: flex; align-items: center; justify-content: center;
  font: 600 9px Inter, system-ui, sans-serif;
}
.__inspector-pp-band.margin    { background: rgba(249,115,22,0.22); color: #c2410c; }
.__inspector-pp-band.padding   { background: rgba(34,197,94,0.20);  color: #15803d; }
.__inspector-pp-band.gap       {
  background:
    repeating-linear-gradient(135deg,
      rgba(168,85,247,0.22) 0 4px,
      rgba(168,85,247,0.10) 4px 8px);
  color: #6d28d9;
}
.__inspector-pp-band .lbl {
  padding: 1px 5px; border-radius: 3px; background: rgba(255,255,255,0.95);
}
.__inspector-pp-parent {
  position: fixed; pointer-events: none;
  border: 1px dotted #cbd5e1;
  border-radius: 6px;
  z-index: 2147483639;
}
.__inspector-pp-parent::before {
  content: attr(data-label);
  position: absolute; top: -10px; left: 8px;
  background: #ffffff;
  padding: 0 6px;
  font: 600 9px Inter, system-ui, sans-serif;
  color: #94a3b8;
}
.__inspector-pp-child {
  position: fixed; pointer-events: none;
  border: 1px dashed rgba(59,130,246,0.55);
  border-radius: 4px;
  z-index: 2147483641;
}
.__inspector-pp-child .tag {
  position: absolute; top: -10px; left: 4px;
  background: #eff6ff;
  border: 1px solid rgba(59,130,246,0.25);
  color: #1d4ed8;
  font: 600 9px Inter, system-ui, sans-serif;
  padding: 1px 5px; border-radius: 3px;
}
.__inspector-pp-child .size {
  position: absolute; bottom: -10px; right: 4px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #475569;
  font: 400 9px Inter, system-ui, sans-serif;
  padding: 1px 5px; border-radius: 3px;
  opacity: 0; transition: opacity 0.4s ease-out;
}
.__inspector-pp-root.dwell .__inspector-pp-child .size { opacity: 1; }
.__inspector-pp-child.near {
  border-style: solid;
  border-color: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}
.__inspector-pp-chevron {
  position: fixed; pointer-events: none;
  color: #3b82f6;
  font: 700 14px Inter, system-ui, sans-serif;
  z-index: 2147483642;
}
.__inspector-pp-breadcrumb {
  position: fixed; pointer-events: none;
  font: 400 9px Inter, system-ui, sans-serif;
  color: #94a3b8;
  z-index: 2147483643;
  opacity: 0; transition: opacity 0.4s ease-out;
}
.__inspector-pp-breadcrumb b { color: #64748b; }
.__inspector-pp-root.dwell .__inspector-pp-breadcrumb { opacity: 1; }
.__inspector-pp-ladder {
  position: fixed; bottom: 14px; right: 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(15,23,42,0.08);
  padding: 6px 8px;
  font: 400 10px Inter, system-ui, sans-serif;
  color: #475569;
  display: flex; align-items: center; gap: 6px;
  z-index: 2147483644;
  opacity: 0; transition: opacity 0.4s ease-out;
  pointer-events: none;
}
.__inspector-pp-root.dwell .__inspector-pp-ladder { opacity: 1; }
.__inspector-pp-ladder kbd {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 1px 4px;
  font: 600 9px ui-monospace, Menlo, monospace;
  color: #0f172a;
}
.__inspector-pp-dwell-ring {
  position: fixed;
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 1.5px solid #cbd5e1;
  border-top-color: #3b82f6;
  border-right-color: #3b82f6;
  animation: __inspector-pp-spin 2s linear infinite;
  opacity: .65;
  z-index: 2147483643;
  pointer-events: none;
}
@keyframes __inspector-pp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

/* ────── Rich tooltip — replaces the simple text tooltip ────── */
#__inspector-tooltip.rich {
  background: #ffffff;
  border: 1px solid #e6e8eb;
  border-radius: 7px;
  box-shadow: 0 8px 22px rgba(15,23,42,0.10);
  padding: 8px 10px;
  font: 400 11px Inter, system-ui, sans-serif;
  color: #1f2937;
  max-width: 280px;
  line-height: 1.45;
}
#__inspector-tooltip.rich .pp-title {
  display: grid; grid-template-columns: 18px auto 1fr;
  align-items: center; gap: 6px;
  margin-bottom: 4px;
}
#__inspector-tooltip.rich .pp-title .icon { width: 14px; height: 14px; color: #3b82f6; }
#__inspector-tooltip.rich .pp-title .tag  { color: #7c3aed; font-weight: 700; font-size: 12px; }
#__inspector-tooltip.rich .pp-title .size { color: #0f172a; text-align: right; font-weight: 500; }
#__inspector-tooltip.rich .pp-title .glyph-text {
  font: 700 10px ui-monospace, "SF Mono", Menlo, monospace;
  background: #eff6ff;
  border: 1px solid rgba(59,130,246,0.30);
  border-radius: 3px;
  color: #1d4ed8;
  padding: 0 3px;
  display: inline-flex; align-items: center; justify-content: center;
  height: 16px;
}
#__inspector-tooltip.rich .pp-kv {
  display: grid; grid-template-columns: 86px 1fr;
  column-gap: 8px; padding: 1px 0;
}
#__inspector-tooltip.rich .pp-kv .k { color: #64748b; }
#__inspector-tooltip.rich .pp-kv .v { color: #0f172a; text-align: right; }
#__inspector-tooltip.rich .pp-kv .v.muted { color: #94a3b8; }
#__inspector-tooltip.rich .pp-section {
  display: grid; grid-template-columns: 11px auto 1fr;
  align-items: center; gap: 5px;
  margin-top: 8px; margin-bottom: 2px;
}
#__inspector-tooltip.rich .pp-section svg { width: 10px; height: 10px; color: #94a3b8; }
#__inspector-tooltip.rich .pp-section .label {
  font: 700 9px Inter, system-ui, sans-serif;
  color: #94a3b8;
  letter-spacing: .1em;
}
#__inspector-tooltip.rich .pp-section .rule { height: 1px; background: #e6e8eb; }
#__inspector-tooltip.rich .pp-swatch {
  display: inline-block; width: 9px; height: 9px;
  border-radius: 2px; margin-right: 5px;
  border: 1px solid rgba(15,23,42,0.08);
  vertical-align: -1px;
}
#__inspector-tooltip.rich .pp-aa {
  display: inline-block;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 0 4px;
  font: 500 10px Inter, system-ui, sans-serif;
  color: #0f172a;
  margin-right: 5px;
  background: #ffffff;
}
#__inspector-tooltip.rich .pp-ok   { color: #16a34a; font-weight: 700; }
#__inspector-tooltip.rich .pp-warn { color: #f97316; font-weight: 700; margin-left: 4px; }
#__inspector-tooltip.rich .pp-no   { color: #94a3b8; font-size: 13px; vertical-align: -1px; }
  `;

  // ── Inject styles ──────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.id = '__inspector-styles';
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // Highlight classes need to apply to elements inside the target document.
  // In live mode targetDoc === document and this is a no-op; in static mode
  // it's required for both the pick-mode hover AND the persistent post-pick
  // blue outline to render inside the iframe.
  let targetStyleEl = null;
  if (targetDoc !== document) {
    targetStyleEl = targetDoc.createElement('style');
    targetStyleEl.id = '__inspector-target-styles';
    targetStyleEl.textContent = `
      .__inspector-highlight {
        cursor: crosshair !important;
      }
      /* .__inspector-selected-highlight: marker class only — the
         visible blue selection box is now a floating overlay in the
         parent doc so it survives any ancestor overflow:hidden. */
    `;
    targetDoc.head.appendChild(targetStyleEl);
  }

  // Live class-scope stylesheet — when settings.classScope is on, every
  // tracked change is mirrored here as a `selector { prop: value !important }`
  // rule so all matching elements update in the live preview (matching what
  // the eventual source edit will do). Rebuilt from scratch on each change.
  let liveChangesStyleEl = null;
  function ensureLiveChangesStyleEl() {
    if (liveChangesStyleEl) return;
    liveChangesStyleEl = targetDoc.createElement('style');
    liveChangesStyleEl.id = '__inspector-live-changes';
    targetDoc.head.appendChild(liveChangesStyleEl);
  }
  function rebuildLiveChangesStyles() {
    if (!settings.classScope) {
      if (liveChangesStyleEl) liveChangesStyleEl.textContent = '';
      return;
    }
    ensureLiveChangesStyleEl();
    const grouped = {};
    changes.forEach(c => {
      if (!c.selector || !c.property) return;
      if (!grouped[c.selector]) grouped[c.selector] = [];
      grouped[c.selector].push(`${c.property}: ${c.to} !important`);
    });
    liveChangesStyleEl.textContent = Object.entries(grouped)
      .map(([sel, decls]) => `${sel} { ${decls.join('; ')} }`)
      .join('\n');
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedElement = null;
  let pickMode = false;
  // Multi-select state. When `multiPickMode` is true, picks accumulate
  // into `selectedElements` instead of replacing the primary. The primary
  // (`selectedElement`) tracks the most-recently-picked element so single-
  // element panels (Position, Layout, etc.) keep something to show.
  let multiPickMode = false;
  let selectedElements = [];   // additional picks beyond the primary
  let multiBadges = [];        // floating numbered badges, one per pick
  const changes = [];
  // Unified chronological log of every mutation across both lanes
  // (CSS edits + component intents, plus future reorders). Source of
  // truth for undo ordering. `changes[]` and `componentIntents[]`
  // remain the live state — renderer and wire format read from them
  // unchanged. Each history entry has a `kind` discriminator.
  const history = [];
  const redoStack = [];
  const cssMap = window.__inspectorCssMap || {};

  // ── Color math utilities ──────────────────────────────────────────────────
  function hsvToRgb(h, s, v) {
    h = h % 360;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToHex(h, s, v) {
    const { r, g, b } = hsvToRgb(h, s, v);
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function hexToHsv(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return rgbToHsv(r, g, b);
  }
  function hsvToHsl(h, s, v) {
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    return { h: Math.round(h), s: Math.round(sl * 100), l: Math.round(l * 100) };
  }
  function hslToHsv(h, s, l) {
    s /= 100; l /= 100;
    const v = l + s * Math.min(l, 1 - l);
    const sv = v === 0 ? 0 : 2 * (1 - l / v);
    return { h, s: sv, v };
  }
  function parseColor(value) {
    if (!value || value === 'transparent') return { h: 0, s: 0, v: 0, a: 0 };
    value = value.trim();
    if (value.startsWith('#')) return { ...hexToHsv(value), a: 1 };
    const rgbMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbMatch) {
      return { ...rgbToHsv(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]),
               a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1 };
    }
    const hslMatch = value.match(/hsla?\((\d+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*([\d.]+))?\)/);
    if (hslMatch) {
      return { ...hslToHsv(+hslMatch[1], +hslMatch[2], +hslMatch[3]),
               a: hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) : 1 };
    }
    return { h: 0, s: 0, v: 0, a: 1 };
  }
  function formatColor(h, s, v, a, mode) {
    if (mode === 'HEX') {
      const hex = hsvToHex(h, s, v);
      return a < 1 ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex;
    }
    if (mode === 'RGB') {
      const { r, g, b } = hsvToRgb(h, s, v);
      return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`;
    }
    if (mode === 'HSL') {
      const { h: hh, s: ss, l } = hsvToHsl(h, s, v);
      return a < 1 ? `hsla(${hh}, ${ss}%, ${l}%, ${a.toFixed(2)})` : `hsl(${hh}, ${ss}%, ${l}%)`;
    }
    return formatColor(h, s, v, a, 'HEX');
  }

  // ── Build panel HTML ───────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = '__inspector-root';
  root.innerHTML = `
    <div id="__inspector-header">
      <div id="__inspector-select-group">
        <button id="__inspector-pick-btn" data-inspector-tip="Select — click any element on the page to inspect it" aria-label="Pick element">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l7 18 3-7 7-3z"/></svg>
          <span class="inspector-select-label">Select element</span>
        </button>
        <button id="__inspector-multi-btn" data-inspector-tip="Multi-select — accumulate picks, apply variant changes to all at once" aria-label="Multi-select" aria-pressed="false">
          <!-- Two-square stack glyph -->
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="4" y="4" width="12" height="12" rx="2"/>
            <path d="M8 20h10a2 2 0 0 0 2-2V8"/>
          </svg>
        </button>
        <span id="__inspector-selector-pill" contenteditable="true" spellcheck="false">—</span>
        <button id="__inspector-pill-clear" data-inspector-tip='Clear selection' aria-label="Clear selection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="__inspector-header-controls">
        <button id="__inspector-deselect" data-inspector-tip="Clear selection">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
          </svg>
        </button>
        <button id="__inspector-minimize" data-inspector-tip="Minimize — collapse panel to header bar">—</button>
        <button id="__inspector-close" data-inspector-tip="Close inspector">✕</button>
      </div>
    </div>
    <div id="__inspector-tabs">
      <span class="inspector-tab active" data-tab="design">Design</span>
      <span class="inspector-tab" data-tab="raw">CSS Raw</span>
      <span class="inspector-tab inspector-tab-icon inspector-tab-end" data-tab="about" data-inspector-tip="About">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none"/>
        </svg>
      </span>
      <span class="inspector-tab inspector-tab-icon" data-tab="settings" data-inspector-tip="Settings — design system preset, Claude design">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
        </svg>
      </span>
    </div>
    <div id="__inspector-panels">
      <div class="inspector-panel active" id="__inspector-panel-design"></div>
      <div class="inspector-panel" id="__inspector-panel-raw"></div>
      <div class="inspector-panel" id="__inspector-panel-about"></div>
      <div class="inspector-panel" id="__inspector-panel-settings"></div>
    </div>
    <div id="__inspector-changes-bar">
      <div class="changes-bar-drawer" id="__inspector-bar-drawer"></div>
      <div class="changes-bar-bottom-row">
        <button class="changes-ur-btn" id="__inspector-undo" disabled title="Undo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>
          </svg>
        </button>
        <button class="changes-ur-btn" id="__inspector-redo" disabled title="Redo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>
          </svg>
        </button>
        <div id="__inspector-changes-pill">
          <span class="changes-bar-count" id="__inspector-bar-count">0</span>
          <span class="changes-bar-label">
            Changes to execute
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;">
              <path d="M8 0 L9.5 6.5 L16 8 L9.5 9.5 L8 16 L6.5 9.5 L0 8 L6.5 6.5 Z"/>
            </svg>
          </span>
          <span class="changes-bar-arrow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>
      </div>
    </div>
    <div id="__inspector-resize-handle"></div>
  `;
  document.body.appendChild(root);

  // ── Color picker popup (singleton) ───────────────────────────────────────
  const colorPopup = document.createElement('div');
  colorPopup.id = '__inspector-color-popup';
  colorPopup.innerHTML = `
    <div id="__inspector-cp-canvas">
      <div id="__inspector-cp-cursor"></div>
    </div>
    <div class="cp-sliders-row">
      <div id="__inspector-cp-preview">
        <div id="__inspector-cp-preview-color"></div>
      </div>
      <div class="cp-sliders-stack">
        <div class="cp-slider-track" id="__inspector-cp-hue-track">
          <div class="cp-slider-thumb" id="__inspector-cp-hue-thumb"></div>
        </div>
        <div class="cp-slider-track" id="__inspector-cp-alpha-track">
          <div class="cp-alpha-bg"></div>
          <div class="cp-alpha-gradient" id="__inspector-cp-alpha-gradient"></div>
          <div class="cp-slider-thumb" id="__inspector-cp-alpha-thumb"></div>
        </div>
      </div>
    </div>
    <div class="cp-format-bar">
      <button class="cp-fmt-btn on" data-fmt="HEX">HEX</button>
      <button class="cp-fmt-btn" data-fmt="RGB">RGB</button>
      <button class="cp-fmt-btn" data-fmt="HSL">HSL</button>
    </div>
    <div class="cp-input-row">
      <input id="__inspector-cp-value-input" spellcheck="false">
      <input id="__inspector-cp-alpha-input" value="100%">
    </div>
  `;
  document.body.appendChild(colorPopup);

  // ── Element tree popup (singleton) ──────────────────────────────────────
  const treePopup = document.createElement('div');
  treePopup.id = '__inspector-tree-popup';
  document.body.appendChild(treePopup);

  // ── Custom panel tooltip ──────────────────────────────────────────────────
  // Idempotent: if a previous boot left a tooltip element behind (e.g.
  // script loaded twice in live mode), reuse it instead of stacking
  // multiple copies in the body — that's what caused the "two tooltips
  // showing the same text" bug.
  let panelTip = document.getElementById('__inspector-panel-tip');
  if (!panelTip) {
    panelTip = document.createElement('div');
    panelTip.id = '__inspector-panel-tip';
    document.body.appendChild(panelTip);
  }
  let panelTipTimer = null;

  function showPanelTip(text, targetEl) {
    clearTimeout(panelTipTimer);
    panelTip.textContent = text;
    panelTip.classList.add('show');
    const rect = targetEl.getBoundingClientRect();
    // Measure actual tooltip height after content is set rather than
    // assuming 40px — long tooltips were silently overflowing the
    // viewport when flipped above the trigger.
    const tipW = panelTip.offsetWidth  || Math.min(220, text.length * 7 + 20);
    const tipH = panelTip.offsetHeight || 40;
    let left = rect.left + rect.width / 2 - tipW / 2;
    // Default: BELOW the trigger. Flip above only if both: (a) doesn't
    // fit below and (b) does fit above. Otherwise clamp to bottom-8.
    let top = rect.bottom + 6;
    const fitsBelow = top + tipH <= window.innerHeight - 8;
    const aboveTop  = rect.top - tipH - 6;
    const fitsAbove = aboveTop >= 8;
    if (!fitsBelow && fitsAbove) top = aboveTop;
    else if (!fitsBelow)         top = window.innerHeight - tipH - 8;
    left = Math.max(8, Math.min(window.innerWidth - tipW - 8, left));
    panelTip.style.left = left + 'px';
    panelTip.style.top = top + 'px';
  }

  function hidePanelTip() {
    panelTip.classList.remove('show');
  }

  const TIPS = {
    // CSS properties
    'left':           'X position — horizontal offset from pinned edge',
    'top':            'Y position — vertical offset from pinned edge',
    'z-index':        'Z-index — stacking order (higher = on top)',
    'rotate':         'Rotation — rotates element clockwise in degrees',
    'width':          'Width — element width (drag to scrub)',
    'height':         'Height — element height (drag to scrub)',
    'opacity':        'Opacity — 0% = invisible, 100% = fully visible',
    'border-radius':  'Border radius — rounds the corners',
    'font-family':    'Font family — typeface used for text',
    'font-size':      'Font size — text size in pixels (drag to scrub)',
    'font-weight':    'Font weight — text thickness (400 = normal, 700 = bold)',
    'line-height':    'Line height — vertical space between lines of text',
    'letter-spacing': 'Letter spacing — horizontal space between characters',
    'color':          'Text color — click swatch to open color picker',
    'background-color': 'Background color — click swatch to open color picker',
    'border-color':   'Border color — click swatch to open color picker',
    'border-width':   'Border width — thickness of the border',
    'border-style':   'Border style — solid, dashed, dotted, etc.',
    'box-shadow':     'Box shadow — drop shadow or inner glow',
    'margin-top':     'Margin top — space outside the element above',
    'margin-right':   'Margin right — space outside the element to the right',
    'margin-bottom':  'Margin bottom — space outside the element below',
    'margin-left':    'Margin left — space outside the element to the left',
    'padding-top':    'Padding top — space inside the element above content',
    'padding-right':  'Padding right — space inside the element to the right',
    'padding-bottom': 'Padding bottom — space inside the element below content',
    'padding-left':   'Padding left — space inside the element to the left',
    // Buttons
    'reset':          'Reset transform — removes rotation and flip',
    'flipH':          'Flip horizontal — mirrors element left to right',
    'flipV':          'Flip vertical — mirrors element top to bottom',
    'row':            'Flex row — children laid out side by side',
    'column':         'Flex column — children stacked vertically',
    'wrap':           'Flex wrap — children wrap onto new rows',
    'grid':           'CSS Grid — children arranged in a grid',
  };

  // Tooltip element
  const tooltip = document.createElement('div');
  tooltip.id = '__inspector-tooltip';
  document.body.appendChild(tooltip);

  // SVG icon sprite for pre-pick tooltips. One <svg> with hidden <symbol>s
  // is appended to the document so any element can `<use href="#i-...">` it.
  const sprite = document.createElement('div');
  sprite.id = '__inspector-pp-sprite';
  sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  sprite.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <symbol id="i-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </symbol>
        <symbol id="i-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>
        </symbol>
        <symbol id="i-button" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="8" width="18" height="9" rx="3"/><circle cx="9" cy="12.5" r="1"/>
        </symbol>
        <symbol id="i-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 1 0-7.07-7.07L11 5"/>
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 1 0 7.07 7.07L13 19"/>
        </symbol>
        <symbol id="i-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>
          <path d="m21 15-5-5L5 21"/>
        </symbol>
        <symbol id="i-input" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="6" width="18" height="12" rx="2"/><line x1="7" y1="10" x2="7" y2="14"/>
        </symbol>
        <symbol id="i-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
          <circle cx="4.5" cy="6" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="4.5" cy="18" r="1.5"/>
        </symbol>
        <symbol id="i-nav" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
        </symbol>
        <symbol id="s-a11y" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="1.5"/><path d="M8 9h8"/><path d="M12 9v6"/><path d="M9 21l3-6 3 6"/>
        </symbol>
        <symbol id="s-layout" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>
        </symbol>
        <symbol id="s-content" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/>
        </symbol>
      </defs>
    </svg>
  `;
  document.body.appendChild(sprite);

  // Pre-pick layer container — every new layer (bands, child outlines,
  // parent outline, chevrons, breadcrumb, ladder, dwell ring) mounts here.
  const ppRoot = document.createElement('div');
  ppRoot.className = '__inspector-pp-root';
  ppRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none;z-index:2147483640;';
  document.body.appendChild(ppRoot);

  // Promote the existing tooltip to "rich" style; we'll fill it via
  // renderRichTooltip() instead of the old textContent assignment.
  tooltip.classList.add('rich');

  function clearPrePickLayers() {
    while (ppRoot.firstChild) ppRoot.removeChild(ppRoot.firstChild);
    ppRoot.classList.remove('dwell');
    ppRoot.style.display = 'none';
  }

  function renderPrePickLayers(target) {
    if (!target) { clearPrePickLayers(); return; }
    clearPrePickLayers();
    ppRoot.style.display = 'block';
    // Subsequent tasks fill ppRoot with bands, children, parent, etc.
  }

  // HTML-escape helper, reused across renderers.
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // ── Tab switching ──────────────────────────────────────────────────────────
  function switchTab(tabName) {
    const tabEl = root.querySelector(`.inspector-tab[data-tab="${tabName}"]`);
    if (tabEl && tabEl.classList.contains('disabled')) return;
    root.querySelectorAll('.inspector-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    root.querySelectorAll('.inspector-panel').forEach(p => {
      p.classList.toggle('active', p.id === `__inspector-panel-${tabName}`);
    });
    if (tabName === 'design')   renderDesignPanel();
    if (tabName === 'raw')      renderCssRaw();
    if (tabName === 'about')    renderAbout();
    if (tabName === 'settings') renderSettings();
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  // The host page injects `window.__inspectorSettings` (written by the
  // skill's setup step into `.inspector/settings.json` and inlined into
  // inspector.html). That file is the durable source of truth. Runtime
  // changes from the Settings panel mutate this in-memory object only; we
  // intentionally do NOT persist them to localStorage, because cross-
  // project localStorage bleed-through used to silently overwrite a fresh
  // project's manifest with stale settings from a previous one.
  const DEFAULT_SETTINGS = {
    detection: { detected: [], recommended: null },
    preset: 'claude',
    manifest: { components: [] },
    // Picker features that are off by default to keep the surface area
    // small for first-time users. Users opt in via the Settings panel.
    multiSelect: false,
    // When on, the Component section shows an "Ask Claude what this could
    // be" button whenever the picked element doesn't match any manifest
    // entry. Off by default — keeps the panel quiet when detection misses.
    askClaudeFallback: false,
    // When on (default), CSS property changes apply to every element that
    // matches the tracked selector — same scope the source edit will have
    // when the user pastes the prompt to Claude. The picked element still
    // gets an inline style for instant feedback; siblings update via an
    // injected <style> rule. When off, only the picked element changes.
    classScope: true,
    // When on (default), the picked element shows a persistent 2px blue
    // outline so users can see what's selected. Off = no outline.
    showSelectedOutline: true,
  };
  function loadSettings() {
    const fromHost = (typeof window !== 'undefined' && window.__inspectorSettings) || null;
    return { ...DEFAULT_SETTINGS, ...(fromHost || {}) };
  }
  function saveSettings(partial) {
    settings = { ...settings, ...partial };
  }
  let settings = loadSettings();

  // ── Design-system component matching ──────────────────────────────────────
  // Tracks user-issued component intents (variant swaps, conversions) so the
  // Copy Prompt can emit a <components> block alongside <changes>.
  const componentIntents = [];

  function activeManifest() {
    // Settings can disable the manifest entirely by selecting "none".
    if (!settings || settings.preset === 'none') return { components: [] };
    return (settings.manifest && Array.isArray(settings.manifest.components))
      ? settings.manifest
      : { components: [] };
  }

  function classListOf(el) {
    return el && el.classList ? Array.from(el.classList) : [];
  }

  function hasClassContains(el, fragment) {
    return classListOf(el).some(c => c.indexOf(fragment) !== -1);
  }

  // Walk the manifest and return the first component whose match rules
  // are satisfied by the given element. Returns null if no match.
  //
  // Accepts EITHER shape per entry:
  //   { name, match: { tag, anyClassContains, allClassContains }, props }
  //   { name, tag, anyClassContains, allClassContains, props }         // shorthand
  // The shorthand makes hand-authored manifests less error-prone.
  // A component with no match rules at all is intentionally treated as
  // "match nothing" (rather than matching everything by accident).
  function matchComponent(el) {
    if (!el) return null;
    const manifest = activeManifest();
    const classes = classListOf(el);
    for (const comp of manifest.components) {
      const m = comp.match || comp;
      const hasAnyRule = m.tag
        || (Array.isArray(m.anyClass) && m.anyClass.length)
        || (Array.isArray(m.allClass) && m.allClass.length)
        || (Array.isArray(m.anyClassContains) && m.anyClassContains.length)
        || (Array.isArray(m.allClassContains) && m.allClassContains.length);
      if (!hasAnyRule) continue;
      if (m.tag && el.tagName && el.tagName.toLowerCase() !== String(m.tag).toLowerCase()) continue;
      // Exact-class match rules — prefer these for components signaled by
      // a standalone class name (e.g. <button class="btn primary">).
      if (Array.isArray(m.anyClass) && m.anyClass.length) {
        if (!m.anyClass.some(c => classes.includes(c))) continue;
      }
      if (Array.isArray(m.allClass) && m.allClass.length) {
        if (!m.allClass.every(c => classes.includes(c))) continue;
      }
      // Substring-class match rules (legacy, looser).
      if (Array.isArray(m.anyClassContains) && m.anyClassContains.length) {
        if (!m.anyClassContains.some(f => hasClassContains(el, f))) continue;
      }
      if (Array.isArray(m.allClassContains) && m.allClassContains.length) {
        if (!m.allClassContains.every(f => hasClassContains(el, f))) continue;
      }
      return comp;
    }
    return null;
  }

  // For a given prop definition, walk its ordered `detect` rules and return
  // the first variant value whose class signal is present. Falls back to
  // the prop's `default` if nothing matches.
  //
  // Two rule shapes are supported per `detect` entry:
  //   { "if": "tier-pro",      "value": "pro" }   ← substring match (loose)
  //   { "hasClass": "primary", "value": "primary" } ← exact class match (strict)
  // Use `hasClass` whenever the variant is signaled by a standalone class
  // (e.g. `btn primary` style) so live-swap can toggle that class cleanly.
  function detectVariantValue(el, propDef) {
    if (!propDef) return undefined;
    const rules = Array.isArray(propDef.detect) ? propDef.detect : [];
    const classes = classListOf(el);
    for (const r of rules) {
      if (!r) continue;
      if (r.hasClass && classes.includes(r.hasClass)) return r.value;
      if (r.if && hasClassContains(el, r.if)) return r.value;
    }
    return propDef.default;
  }

  // Returns the single class name the inspector should add/remove when
  // switching to (or away from) this rule's value. Prefers `hasClass`; for
  // `if` rules, only returns it when the value looks like a real class
  // name (no spaces).
  function ruleToggleClass(rule) {
    if (!rule) return null;
    if (rule.hasClass) return rule.hasClass;
    if (rule.if && !/\s/.test(rule.if)) return rule.if;
    return null;
  }

  // Build the Component section that sits at the top of the Design tab.
  // Three states:
  //   1. Manifest matched a component → name, source, variant dropdowns.
  //   2. No match but Claude-design fallback is on → "Ask Claude" CTA.
  //   3. No match and fallback off → return '' (section hidden entirely).
  // Conversions are stored at the top level of the manifest. Filter them
  // by the current component name and the number of picks (`minCount` /
  // optional `maxCount`). Returns the applicable rules in declaration order.
  function applicableConversions(componentName, pickCount) {
    const manifest = activeManifest();
    const rules = Array.isArray(manifest.conversions) ? manifest.conversions : [];
    return rules.filter(r => {
      if (!r || r.from !== componentName) return false;
      const min = typeof r.minCount === 'number' ? r.minCount : 1;
      const max = typeof r.maxCount === 'number' ? r.maxCount : Infinity;
      return pickCount >= min && pickCount <= max;
    });
  }

  function conversionsHtml(componentName, pickCount) {
    const rules = applicableConversions(componentName, pickCount);
    if (!rules.length) return '';
    const buttons = rules.map((r, i) =>
      `<button class="component-convert-btn" type="button" data-convert-idx="${i}" ${r.note ? `data-inspector-tip="${esc(r.note)}"` : ''}>
         <span class="component-convert-arrow" aria-hidden="true">→</span>
         <span>${esc(r.label || `Convert to ${r.to}`)}</span>
       </button>`
    ).join('');
    return `
      <div class="component-convert-block">
        <div class="component-convert-title">Convert to…</div>
        ${buttons}
      </div>
    `;
  }

  function buildComponentSection(el, sel) {
    const picks = allSelected();
    // ── Multi-pick path ─────────────────────────────────────────────────
    if (picks.length > 1) {
      const matches = picks.map(p => matchComponent(p));
      const first = matches[0];
      const allSame = first && matches.every(m => m && m.name === first.name);
      if (allSame) {
        // All picks share the same component. Variant dropdowns show the
        // common value when uniform, "(mixed)" when picks disagree.
        const propsHtml = Object.entries(first.props || {}).map(([propName, def]) => {
          const values = picks.map(p => detectVariantValue(p, def));
          const uniform = values.every(v => v === values[0]) ? values[0] : null;
          const opts = (def.values || []).map(v =>
            `<option value="${esc(v)}"${v === uniform ? ' selected' : ''}>${esc(v)}</option>`
          ).join('');
          const mixedOpt = uniform == null
            ? `<option value="__mixed__" selected disabled>(mixed)</option>`
            : '';
          return `<div class="component-row">
            <span class="component-prop-label">${esc(propName)}</span>
            <select class="component-prop-select" data-prop="${esc(propName)}" data-from="${esc(uniform ?? '__mixed__')}">
              ${mixedOpt}${opts}
            </select>
          </div>`;
        }).join('');
        return `
          <div class="inspector-section component-section component-section-multi" data-component="${esc(first.name)}">
            <div class="inspector-section-hd">
              <span class="inspector-section-title">Component identified</span>
              <span class="component-badge">${esc(first.name)} × ${picks.length}</span>
            </div>
            ${first.source ? `<div class="component-source">${esc(first.source)}</div>` : ''}
            ${propsHtml || '<div class="component-empty">No variants defined.</div>'}
            ${conversionsHtml(first.name, picks.length)}
          </div>
        `;
      }
      // Mixed types in multi-pick. Always show the badge + breakdown so
      // the user sees what's selected; the Ask-Claude action is gated on
      // the settings.askClaudeFallback toggle.
      const counts = matches.reduce((acc, m) => {
        const key = m ? m.name : '(unknown)';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const breakdown = Object.entries(counts).map(([k, n]) => `${esc(k)} × ${n}`).join(' · ');
      const askBtn = settings && settings.askClaudeFallback
        ? `<button class="component-ask-btn" type="button">Ask Claude what these could become</button>`
        : '';
      return `
        <div class="inspector-section component-section component-section-fallback">
          <div class="inspector-section-hd">
            <span class="inspector-section-title">Component identified</span>
            <span class="component-badge component-badge-muted">Mixed (${picks.length})</span>
          </div>
          <div class="component-fallback-msg">${breakdown}</div>
          ${askBtn}
        </div>
      `;
    }
    // ── Single-pick path (existing) ─────────────────────────────────────
    const comp = matchComponent(el);
    if (comp) {
      const propsHtml = Object.entries(comp.props || {}).map(([propName, def]) => {
        const current = detectVariantValue(el, def);
        const opts = (def.values || []).map(v =>
          `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`
        ).join('');
        return `<div class="component-row">
          <span class="component-prop-label">${esc(propName)}</span>
          <select class="component-prop-select" data-prop="${esc(propName)}" data-from="${esc(current ?? '')}">
            ${opts}
          </select>
        </div>`;
      }).join('');
      return `
        <div class="inspector-section component-section" data-component="${esc(comp.name)}">
          <div class="inspector-section-hd">
            <span class="inspector-section-title">Component identified</span>
            <span class="component-badge">${esc(comp.name)}</span>
          </div>
          ${comp.source ? `<div class="component-source">${esc(comp.source)}</div>` : ''}
          ${propsHtml || '<div class="component-empty">No variants defined.</div>'}
          ${conversionsHtml(comp.name, 1)}
        </div>
      `;
    }
    // No-match branch. Component section is hidden by default to keep the
    // panel quiet; the user opts in via Settings → Ask Claude to surface
    // the fallback action when the manifest doesn't recognize an element.
    if (settings && settings.preset !== 'none' && settings.askClaudeFallback) {
      const isClaude = settings.preset === 'claude';
      return `
        <div class="inspector-section component-section component-section-fallback">
          <div class="inspector-section-hd">
            <span class="inspector-section-title">Component identified</span>
            <span class="component-badge component-badge-muted">${isClaude ? 'Identify' : 'Unknown'}</span>
          </div>
          <div class="component-fallback-msg">${isClaude
            ? 'Claude design — every pick is identified on the fly. Copy the prompt to ask Claude what this is and what variants make sense.'
            : 'No preset match. Ask Claude to identify this and suggest variants.'}</div>
          <button class="component-ask-btn" type="button">Ask Claude what this could be</button>
        </div>
      `;
    }
    return '';
  }

  function wireComponentSection(panel, el, sel) {
    const section = panel.querySelector('.component-section');
    if (!section) return;
    const componentName = section.dataset.component;
    // Re-resolve so we can read the matched component's prop defs. In
    // multi-pick mode `el` is the primary; we apply changes to every pick
    // whose match.name === componentName.
    const matchedComp = matchComponent(el);
    section.querySelectorAll('.component-prop-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const prop = e.target.dataset.prop;
        const to   = e.target.value;
        if (to === '__mixed__') return;
        const def = matchedComp?.props?.[prop];
        const rules = Array.isArray(def?.detect) ? def.detect : [];
        const toCls = ruleToggleClass(rules.find(r => r.value === to));
        // Targets: every currently-selected element whose match has the
        // same component name. In single-pick mode this collapses to [el].
        const targets = allSelected().filter(p => {
          const m = matchComponent(p);
          return m && m.name === componentName;
        });
        // Two-pass: snapshot every target's pre-swap identity FIRST (so all
        // selector / domIndex / text values are computed against the same
        // un-mutated DOM), then apply the swaps + emit intents.
        const pre = targets.map(target => {
          const current = detectVariantValue(target, def);
          const origSel = computeSelector(target);
          return {
            target, current, origSel,
            ctx: capturePickContext(target, origSel),
          };
        });
        pre.forEach(({ target, current, origSel, ctx }) => {
          if (current === to) return;
          const fromCls = ruleToggleClass(rules.find(r => r.value === current));
          if (fromCls) target.classList.remove(fromCls);
          if (toCls)   target.classList.add(toCls);
          recordComponentIntent({
            action: 'swap-variant',
            selector: origSel,
            component: componentName,
            prop,
            from: current,
            to,
            ...ctx,
          }, { element: target, fromCls, toCls });
        });
        // After applying, the dropdown's "from" baseline is the new value.
        e.target.dataset.from = to;
      });
    });
    const askBtn = section.querySelector('.component-ask-btn');
    if (askBtn) {
      askBtn.addEventListener('click', () => {
        const tag = el?.tagName?.toLowerCase() || '?';
        const classes = classListOf(el).join(' ');
        const intro = `Help me identify this element as a design-system component.\n` +
          `Selector: \`${sel}\`\n` +
          `Tag: \`${tag}\`\n` +
          `Classes: \`${classes}\`\n` +
          `What component is this likely to be, what variants/alternatives make sense, and what swap or refactor would you suggest?`;
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(intro).then(() => {
            askBtn.textContent = '✓ Copied — paste into Claude';
            setTimeout(() => { askBtn.textContent = 'Ask Claude what this could be'; }, 2000);
          });
        }
      });
    }
    // Convert-to buttons → emit a `convert` intent covering every picked
    // element that matches the source component. The intent carries each
    // pick's pinpoint context so paste-back can locate them in source.
    section.querySelectorAll('.component-convert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx  = parseInt(btn.dataset.convertIdx, 10);
        const componentName = section.dataset.component;
        const rules = applicableConversions(componentName, allSelected().length);
        const rule  = rules[idx];
        if (!rule) return;
        const targets = allSelected().filter(p => {
          const m = matchComponent(p);
          return m && m.name === componentName;
        });
        const pickContexts = targets.map(t => {
          const s = computeSelector(t);
          return { selector: s, ...capturePickContext(t, s) };
        });
        recordComponentIntent({
          action: 'convert',
          from: rule.from,
          to: rule.to,
          label: rule.label || `Convert to ${rule.to}`,
          note: rule.note,
          source: rule.source || null,
          selectors: pickContexts.map(p => p.selector),
          picks: pickContexts,
        });
        // Brief visual confirmation; the intent now lives in the Changes
        // bar and will ship in the Copy Prompt.
        const label = btn.querySelector('span:last-child');
        const orig = label?.textContent;
        if (label) label.textContent = '✓ Queued';
        setTimeout(() => { if (label && orig) label.textContent = orig; }, 1500);
      });
    });
  }

  // Capture disambiguation hints for the paste-back source-lookup step.
  // - `text`: trimmed visible text (first 80 chars). Lets the consumer grep
  //   the JSX for a unique-ish match when the selector hits many sites.
  // - `domIndex`: 0-based position of this element among same-selector
  //   matches in DOM order. Fallback for icon-only / empty-text elements.
  function capturePickContext(el, selector) {
    if (!el) return {};
    const out = {};
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) out.text = text.slice(0, 80);
    try {
      const sameSelectorAll = Array.from(targetDoc.querySelectorAll(selector));
      const idx = sameSelectorAll.indexOf(el);
      if (idx >= 0 && sameSelectorAll.length > 1) out.domIndex = idx;
    } catch (_) {
      // querySelectorAll can throw on selectors with characters it doesn't
      // understand; skip the index hint when that happens.
    }
    const chain = captureAncestorChain(el);
    if (chain.length) out.ancestorChain = chain;
    return out;
  }

  // Walk up to ~5 ancestors of `el` (stopping at body/html) and return
  // their distinctive class names — used by paste-back as a disambiguation
  // hint when the selector + text + domIndex don't uniquely identify a
  // JSX site. Each entry is a space-joined classname string (stripped
  // of inspector internals); empty/generic ancestors are skipped.
  function captureAncestorChain(el, maxDepth = 5) {
    if (!el || !el.parentNode) return [];
    const out = [];
    let node = el.parentNode;
    const stopAt = targetDoc.body || targetDoc.documentElement;
    while (node && node !== stopAt && out.length < maxDepth) {
      if (node.nodeType === 1 && node.classList && node.classList.length) {
        const classes = Array.from(node.classList)
          .filter(c => !c.startsWith('__inspector-'))
          .join(' ');
        if (classes) out.push(classes);
      }
      node = node.parentNode;
    }
    return out;
  }

  // Two intents target the same logical thing when their action,
  // selector, prop, and pinpoint hints (text + domIndex) all agree.
  // Lifted to module scope so undo/redo can match intents by identity.
  function sameIntentTarget(a, b) {
    return a.action === b.action &&
      a.selector === b.selector &&
      a.prop === b.prop &&
      (a.text || null) === (b.text || null) &&
      (a.domIndex ?? null) === (b.domIndex ?? null);
  }

  function recordComponentIntent(intent, dom) {
    // Replace existing intents for the SAME target — so toggling a
    // dropdown back and forth on one element only keeps the latest
    // value. Different elements sharing a selector (e.g. several
    // `.status-pill.product`s) are distinguished by `text` and
    // `domIndex`, so they each get their own intent entry.
    //
    // `dom` is optional metadata { element, fromCls, toCls } describing
    // the live DOM mutation that was applied to produce this intent.
    // It stays in-memory only (history) and never goes on the wire — so
    // undo/redo can reverse / re-apply the class swap.
    const idx = componentIntents.findIndex(i => sameIntentTarget(i, intent));
    redoStack.length = 0;
    if (idx >= 0) {
      const prev = componentIntents[idx];
      componentIntents[idx] = intent;
      history.push({ kind: 'intent-update', prev, next: intent, dom });
    } else {
      componentIntents.push(intent);
      history.push({ kind: 'intent-add', next: intent, dom });
    }
    syncBadge();
  }

  const PRESET_LABELS = {
    'claude':   'Claude design — let Claude identify components on the fly',
    'shadcn':   'shadcn/ui',
    'mui':      'Material UI',
    'chakra':   'Chakra UI',
    'mantine':  'Mantine',
    'antd':     'Ant Design',
    'nextui':   'NextUI',
    'tailwind': 'Tailwind (utility-only)',
    'custom':   'Custom file (.inspector/design-system.json)',
    'none':     'None',
  };

  // Brand glyphs for each preset radio. Where possible these are the
  // simple-icons (https://simpleicons.org) brand paths — single-color SVGs
  // that read cleanly at 14px and inherit currentColor for tinting. Where
  // an official mark doesn't simplify well at this size, a clean typographic
  // letter mark stands in (MUI, Mantine, NextUI, Claude).
  const PRESET_ICONS = {
    // Claude — exact Anthropic "asterisk" mark sourced from the Figma design.
    'claude':
      `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
         <path d="M6.70431 14.8698L10.1333 12.9457L10.1906 12.778L10.1333 12.6853H9.96557L9.39187 12.65L7.43247 12.597L5.73344 12.5264L4.08736 12.4382L3.67253 12.3499L3.28418 11.838L3.3239 11.582L3.67253 11.3481L4.17121 11.3923L5.27448 11.4673L6.92938 11.582L8.12973 11.6526L9.9082 11.838H10.1906L10.2304 11.7233L10.1333 11.6526L10.0582 11.582L8.34597 10.4214L6.49248 9.19456L5.52161 8.48847L4.99645 8.13101L4.73167 7.79562L4.61693 7.06305L5.09354 6.53789L5.73344 6.58202L5.89672 6.62615L6.54544 7.12483L7.93115 8.19721L9.74051 9.52995L10.0053 9.75061L10.1112 9.67559L10.1244 9.62263L10.0053 9.42404L9.02118 7.64557L7.97086 5.83621L7.50308 5.08599L7.37951 4.63586C7.33538 4.45051 7.30449 4.29605 7.30449 4.10629L7.8473 3.3693L8.14739 3.27222L8.87113 3.3693L9.17563 3.63409L9.62577 4.66233L10.3539 6.28193L11.4837 8.48406L11.8147 9.13719L11.9912 9.74178L12.0574 9.92713H12.1721V9.82122L12.2648 8.58114L12.4369 7.05863L12.6046 5.09923L12.662 4.5476L12.9356 3.88563L13.4784 3.52818L13.902 3.73118L14.2507 4.22985L14.2021 4.55201L13.9947 5.898L13.5887 8.00744L13.3239 9.41963H13.4784L13.6549 9.24311L14.3698 8.29429L15.5702 6.79385L16.0997 6.19808L16.7176 5.54054L17.1148 5.22721H17.865L18.4166 6.04804L18.1695 6.89535L17.3972 7.87505L16.7573 8.70471L15.8394 9.94037L15.2657 10.9289L15.3186 11.0083L15.4554 10.9951L17.5296 10.5538L18.6505 10.3508L19.9877 10.1213L20.5923 10.4037L20.6585 10.6906L20.4201 11.2775L18.9903 11.6306L17.3133 11.966L14.8155 12.5573L14.7846 12.5794L14.82 12.6235L15.9453 12.7294L16.4263 12.7559H17.6046L19.7979 12.9192L20.3716 13.2987L20.7158 13.7621L20.6585 14.1151L19.7758 14.5653L18.5843 14.2828L15.8041 13.6209L14.8508 13.3826H14.7185V13.462L15.5128 14.2387L16.9691 15.5538L18.7917 17.2484L18.8844 17.6677L18.6505 17.9986L18.4034 17.9633L16.8014 16.7586L16.1836 16.2158L14.7846 15.0375H14.692V15.161L15.0141 15.6332L16.7176 18.1928L16.8058 18.9783L16.6823 19.2343L16.241 19.3888L15.7555 19.3005L14.7582 17.9016L13.7299 16.3261L12.9003 14.9139L12.7988 14.9713L12.3089 20.2449L12.0794 20.5141L11.5499 20.7171L11.1086 20.3817L10.8747 19.8389L11.1086 18.7665L11.391 17.3676L11.6205 16.2555L11.8279 14.8742L11.9515 14.4152L11.9426 14.3843L11.8411 14.3976L10.7996 15.8274L9.21535 17.9678L7.96204 19.3093L7.66195 19.4285L7.14121 19.1593L7.18975 18.6783L7.48101 18.2502L9.21535 16.0437L10.2612 14.6756L10.9364 13.8857L10.932 13.7709H10.8923L6.28507 16.763L5.46424 16.8689L5.11119 16.5379L5.15532 15.9951L5.32302 15.8186L6.70872 14.8654L6.70431 14.8698Z" fill="#D97757"/>
       </svg>`,
    // shadcn — two-slash mark sourced from the Figma design (white on dark).
    'shadcn':
      `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
         <path d="M17.3122 3.8964C17.6287 3.86711 17.8407 3.88235 18.1273 4.0249C18.7765 4.34781 19.062 5.29281 18.6027 5.89196C18.2968 6.29099 17.7345 6.79921 17.3464 7.19046L13.9996 10.5362L8.54509 15.9905L7.09728 17.4378C6.76583 17.773 6.4344 18.1148 6.09201 18.439C5.88545 18.6346 5.72572 18.717 5.45453 18.7932C5.42885 18.8002 5.40287 18.8061 5.37668 18.8108C4.40825 18.9813 3.58658 17.9669 3.96902 17.0163C4.08066 16.7389 4.50981 16.3423 4.73274 16.1205L5.53033 15.326L8.47756 12.3799L14.134 6.72132L15.6888 5.16609C15.9856 4.86734 16.2865 4.55503 16.5939 4.26784C16.8199 4.05672 17.0054 3.94586 17.3122 3.8964Z" fill="#fff"/>
         <path d="M18.7525 11.037C19.4244 10.9772 20.0655 11.5128 20.1099 12.1882C20.1376 12.6091 20.0566 12.9046 19.7584 13.2145C19.3221 13.6679 18.8724 14.109 18.4273 14.5541L15.7981 17.1834L14.0222 18.9597C13.7631 19.2189 13.5057 19.4808 13.2418 19.7352C12.9985 19.9697 12.7741 20.0883 12.4339 20.109C12.0424 20.1166 11.8171 20.0773 11.5043 19.8294C10.9226 19.3683 10.8689 18.4795 11.3716 17.9413C11.6892 17.6013 12.0269 17.2808 12.3567 16.949C13.1035 16.193 13.855 15.4416 14.611 14.6948C15.3795 13.9177 16.1521 13.1448 16.929 12.376C17.2756 12.0302 17.6171 11.6638 17.9797 11.3347C18.2107 11.1251 18.4472 11.063 18.7525 11.037Z" fill="#fff"/>
       </svg>`,
    // Material UI — multi-color M from the Figma design (clip path made
    // unique so it doesn't collide with any other inline SVG on the page).
    'mui':
      `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
         <g clip-path="url(#__inspector-clip-mui)">
           <path d="M2 12.7218V4.06177L9.5 8.39177V11.2784L4.5 8.39177V14.1651L2 12.7218Z" fill="#00B0FF"/>
           <path d="M9.5 8.39177L17 4.06177V12.7218L12 15.6084L9.5 14.1651L14.5 11.2784V8.39177L9.5 11.2784V8.39177Z" fill="#0081CB"/>
           <path d="M9.5 14.165V17.0517L14.5 19.9384V17.0517L9.5 14.165Z" fill="#00B0FF"/>
           <path d="M14.5 19.9384L22 15.6084V9.8351L19.5 11.2784V14.1651L14.5 17.0518V19.9384ZM19.5 8.39177V5.5051L22 4.06177V6.94843L19.5 8.39177Z" fill="#0081CB"/>
         </g>
         <defs>
           <clipPath id="__inspector-clip-mui">
             <rect width="20" height="15.88" fill="white" transform="translate(2 4.06006)"/>
           </clipPath>
         </defs>
       </svg>`,
    // Chakra UI — official "lightning in circle" mark in Chakra teal.
    'chakra':
      `<svg viewBox="0 0 24 24" fill="#319795" aria-hidden="true">
         <path d="M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0zm1.49 6.084c.063-.516-.633-.793-.962-.379l-6.703 8.45a.591.591 0 0 0 .461.964h5.039l-.514 4.243c-.063.515.633.792.962.379l6.703-8.45a.591.591 0 0 0-.461-.965l-5.039-.001.514-4.241z"/>
       </svg>`,
    // Mantine — typographic M inside a rounded square, Mantine blue.
    'mantine':
      `<svg viewBox="0 0 24 24" fill="none" stroke="#339AF0" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
         <rect x="3" y="3" width="18" height="18" rx="4"/>
         <path d="M7 17V9l5 5 5-5v8" stroke-linecap="round"/>
       </svg>`,
    // Ant Design — geometric ant glyph in Ant blue.
    'antd':
      `<svg viewBox="0 0 24 24" fill="#1677FF" aria-hidden="true">
         <path d="M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0zm-.5 4.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zm0 5.75a2 2 0 0 0-2 2v.5a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-.5a2 2 0 0 0-2-2zm0 5.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5zM5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm14 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM5 12.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm14 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
       </svg>`,
    // NextUI — stylized N, neutral (their brand uses gradients we can't fake well).
    'nextui':
      `<svg viewBox="0 0 24 24" fill="none" stroke="#e0e0e0" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
         <path d="M5 19V5l14 14V5"/>
       </svg>`,
    // Tailwind CSS — official wave glyph from the Figma design, with the
    // teal→cyan brand gradient. IDs prefixed to avoid collisions when
    // other inline SVGs are present on the page.
    'tailwind':
      `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
         <g clip-path="url(#__inspector-clip-tailwind)">
           <path d="M12 4.74414C8.7984 4.74414 6.82096 6.34492 5.97349 9.54648C7.19762 7.9457 8.61007 7.38072 10.2109 7.75738C11.1525 7.9457 11.7175 8.60485 12.4708 9.35816C13.6949 10.5823 15.0132 11.9947 18.0264 11.9947C21.228 11.9947 23.2054 10.394 24.0529 7.19239C22.8288 8.79317 21.4163 9.35816 19.8155 8.9815C18.8739 8.69901 18.3089 8.03987 17.5556 7.28656C16.3315 6.15659 15.0132 4.74414 12 4.74414ZM5.97349 11.9947C2.77193 11.9947 0.794494 13.5955 -0.0529785 16.7971C1.17115 15.1963 2.5836 14.6313 4.18438 15.008C5.12602 15.1963 5.691 15.8554 6.44431 16.6088C7.66844 17.8329 8.98673 19.2453 12 19.2453C15.2015 19.2453 17.179 17.6446 18.0264 14.3488C16.8023 15.9496 15.3898 16.6088 13.7891 16.2321C12.8474 15.9496 12.2825 15.2905 11.5291 14.5372C10.305 13.4072 8.98673 11.9947 5.97349 11.9947Z" fill="url(#__inspector-grad-tailwind)"/>
         </g>
         <defs>
           <linearGradient id="__inspector-grad-tailwind" x1="-0.727943" y1="9.38452" x2="20.1168" y2="21.3843" gradientUnits="userSpaceOnUse">
             <stop stop-color="#2298BD"/>
             <stop offset="1" stop-color="#0ED7B5"/>
           </linearGradient>
           <clipPath id="__inspector-clip-tailwind">
             <rect width="24" height="24" fill="white"/>
           </clipPath>
         </defs>
       </svg>`,
    // Custom — folder.
    'custom':
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
         <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.8L11.7 7.4H19.5A1.5 1.5 0 0 1 21 8.9V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5z"/>
       </svg>`,
    // None — em-dash.
    'none':
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
         <line x1="6" y1="12" x2="18" y2="12"/>
       </svg>`,
  };

  // Two-column grid of preset cards. The first PRIMARY_PRESETS are shown
  // by default; PRESET_SECONDARY surfaces behind a "See more" toggle so the
  // panel stays compact for the common case.
  const PRESET_PRIMARY   = ['claude', 'tailwind', 'mui', 'shadcn'];
  const PRESET_SECONDARY = ['chakra', 'mantine', 'antd', 'nextui'];
  const PRESET_SHORT = {
    'claude':   'Claude Design',
    'shadcn':   'Shadcn UI',
    'mui':      'Material UI',
    'chakra':   'Chakra UI',
    'mantine':  'Mantine',
    'antd':     'Ant Design',
    'nextui':   'NextUI',
    'tailwind': 'Tailwind',
    'custom':   'Custom',
    'none':     'None',
  };

  function presetCardHtml(key) {
    // Claude Design is the baseline — always on, can't be toggled off.
    // Other presets layer on top: their manifest is used for detection,
    // and Claude still picks up anything that doesn't match.
    const isClaude = key === 'claude';
    const checked  = isClaude || settings.preset === key;
    const disabled = isClaude;
    const cls = `ds-card${checked ? ' ds-card-checked' : ''}${disabled ? ' ds-card-locked' : ''}`;
    // Two indicator styles:
    //   - Claude (locked): a grey filled checkbox with a check, signaling
    //     "on but you can't toggle this."
    //   - Other presets (radio-style): empty circle when unselected,
    //     filled blue dot when the user has picked them.
    const indicator = isClaude
      ? `<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
           <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="#555"/>
           <path d="M3.7 6.2 5.3 7.8 8.6 4.5" stroke="#1c1c1c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>`
      : checked
        ? `<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
             <circle cx="6" cy="6" r="5" fill="#3B82F6"/>
             <circle cx="6" cy="6" r="2" fill="#fff"/>
           </svg>`
        : `<svg viewBox="0 0 12 12" fill="none" stroke="#555" stroke-width="1.2" aria-hidden="true">
             <circle cx="6" cy="6" r="4.5"/>
           </svg>`;
    return `
      <label class="${cls}" data-preset="${key}"${disabled ? ' aria-disabled="true" data-inspector-tip="Claude Design is always on"' : ''}>
        <input type="checkbox" name="__inspector-preset" value="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="ds-card-radio" aria-hidden="true">${indicator}</span>
        <span class="ds-card-icon" aria-hidden="true">${PRESET_ICONS[key] || ''}</span>
        <span class="ds-card-label">${esc(PRESET_SHORT[key] || key)}</span>
      </label>`;
  }

  function renderSettings() {
    const panel = root.querySelector('#__inspector-panel-settings');
    if (!panel) return;
    const det = settings.detection || { detected: [], recommended: null };
    const detRow = det.recommended
      ? `<div class="settings-detect-row">
           <strong>Detected:</strong> ${esc(PRESET_LABELS[det.recommended] || det.recommended)}
           ${det.detected?.[0]?.confidence ? `<span class="settings-detect-conf">(${esc(det.detected[0].confidence)} confidence)</span>` : ''}
         </div>`
      : '';

    // If the current preset is in the secondary group, expand it on render
    // so the user can see what they have selected.
    const expandSecondary = PRESET_SECONDARY.includes(settings.preset);
    const primaryCards   = PRESET_PRIMARY.map(presetCardHtml).join('');
    const secondaryCards = PRESET_SECONDARY.map(presetCardHtml).join('');

    panel.innerHTML = `
      <div class="settings-section">
        <h3>Design system <span class="settings-beta">beta</span></h3>
        ${detRow}
        <div class="ds-grid">${primaryCards}</div>
        <div class="ds-grid ds-grid-secondary ${expandSecondary ? 'open' : ''}">${secondaryCards}</div>
        <button class="ds-see-more" type="button" data-open="${expandSecondary ? '1' : '0'}">
          ${expandSecondary ? 'Show less' : 'See more'}
        </button>
        ${settings.preset === 'custom'
          ? `<div class="ds-import ds-import-loaded" aria-label="Custom design system loaded">
               <span class="ds-import-check" aria-hidden="true">
                 <svg viewBox="0 0 12 12" fill="none">
                   <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="#3B82F6"/>
                   <path d="M3.7 6.2 5.3 7.8 8.6 4.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                 </svg>
               </span>
               <span class="ds-import-icon" aria-hidden="true">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
                 </svg>
               </span>
               <span class="ds-import-label">${esc(settings.customLabel || 'Custom design system')}</span>
               <span class="ds-import-meta">${(settings.manifest?.components?.length || 0)} components loaded</span>
             </div>`
          : `<button class="ds-import" type="button" disabled aria-disabled="true" data-inspector-tip="Coming soon">
               <span class="ds-import-icon" aria-hidden="true">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M12 4v12"/>
                   <path d="m6 10 6 6 6-6"/>
                   <path d="M5 20h14"/>
                 </svg>
               </span>
               <span class="ds-import-label">Import Custom design system</span>
               <span class="ds-import-soon">Coming soon</span>
             </button>`}
        <div class="settings-foot">
          Pick your design system to edit components and variants directly. <strong>Claude Design</strong> asks Claude to identify each pick instead.
        </div>
      </div>
      <div class="settings-section">
        <h3>Picker <span class="settings-beta">beta</span></h3>
        <label class="settings-toggle" data-settings-check="multi">
          <div class="inspector-check-box${settings.multiSelect ? ' on' : ''}">
            <svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
          </div>
          <span>
            <strong>Multi-select picker</strong>
            <span class="settings-sub">Pick several elements at once. Variant changes and conversions apply to all picks together. When off, the multi-select button is hidden from the header.</span>
          </span>
        </label>
      </div>
      <div class="settings-section">
        <h3>Ask Claude <span class="settings-beta">beta</span></h3>
        <label class="settings-toggle" data-settings-check="ask">
          <div class="inspector-check-box${settings.askClaudeFallback ? ' on' : ''}">
            <svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
          </div>
          <span>
            <strong>"Ask Claude" fallback</strong>
            <span class="settings-sub">Show an "Ask Claude what this could be" button in the Component section when the picked element doesn't match any manifest entry. Clicking it copies a chat-ready intro with the element's selector, tag, and classes — paste it back to Claude to get identification + variant suggestions.</span>
          </span>
        </label>
      </div>
    `;

    // Claude Design is permanently on (baseline). Picking another card
    // layers its manifest on top; clicking the already-selected card
    // returns to the Claude-only baseline. The Claude card itself is
    // disabled at the DOM level, so its change events never fire.
    panel.querySelectorAll('input[name="__inspector-preset"]').forEach(r => {
      r.addEventListener('change', (e) => {
        const value  = e.target.value;
        const wasSel = settings.preset === value;
        saveSettings({ preset: wasSel ? 'claude' : value });
        renderSettings();
        renderDesignPanel();
      });
    });
    panel.querySelector('.ds-see-more')?.addEventListener('click', (e) => {
      const grid = panel.querySelector('.ds-grid-secondary');
      const isOpen = grid.classList.toggle('open');
      e.target.dataset.open = isOpen ? '1' : '0';
      e.target.textContent = isOpen ? 'Show less' : 'See more';
    });
    // Settings checkboxes now use the Design-tab .inspector-check-box
    // widget. The click handler lives on the wrapping <label>, toggles
    // the .on class, saves the setting, and runs the same side effects.
    panel.querySelectorAll('.settings-toggle[data-settings-check]').forEach(label => {
      label.addEventListener('click', (e) => {
        // Don't intercept clicks on links / inner buttons (none today, future-proof).
        if (e.target.closest && e.target.closest('a,button')) return;
        e.preventDefault();
        const which = label.dataset.settingsCheck;
        const box = label.querySelector('.inspector-check-box');
        const on = !box.classList.contains('on');
        box.classList.toggle('on', on);
        if (which === 'multi') {
          saveSettings({ multiSelect: on });
          applyMultiSelectVisibility();
          // If the user disables multi-select while in multi-pick mode,
          // collapse the extras and exit multi-mode for consistency.
          if (!settings.multiSelect && multiPickMode) setMultiPickMode(false);
        } else if (which === 'ask') {
          saveSettings({ askClaudeFallback: on });
          renderDesignPanel();
        }
      });
    });
    // Import Custom design system is disabled for now (coming-soon state),
    // so no click handler is attached.
  }

  // Show/hide the header multi-select button based on the current setting.
  // Called on boot and whenever the toggle changes.
  function applyMultiSelectVisibility() {
    const btn = root.querySelector('#__inspector-multi-btn');
    if (btn) btn.style.display = settings.multiSelect ? '' : 'none';
  }

  function renderAbout() {
    const panel = root.querySelector('#__inspector-panel-about');
    if (!panel || panel.dataset._rendered) return;
    panel.dataset._rendered = '1';
    panel.innerHTML = `
      <h3>CSS Inspector</h3>
      <p>A visual CSS inspector for Claude Code. Pick any element on your page, tweak its styles with sliders, scrubs, and color pickers — then hand the changes off to Claude with one paste. Built for vibe coders who left Cursor for Claude in VS Code and miss the visual muscle memory Webflow / Figma / DevTools trained into their hands.</p>
      <p>The Copy button next to the selector pill puts a chat-ready intro on your clipboard. Pick a leaf element to discuss <strong>"this element"</strong>, or a container (div / section) to discuss <strong>"this area"</strong>.</p>
      <div class="__inspector-about-sep"></div>
      <div class="__inspector-about-author">
        <span>By <strong>Aviran Revach</strong></span>
        <div class="__inspector-about-links">
          <a href="https://github.com/aviranrevach" target="_blank" rel="noopener noreferrer" data-inspector-tip="GitHub: aviranrevach">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-1.94c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.13v3.15c0 .3.21.66.8.55 4.56-1.52 7.85-5.83 7.85-10.91C23.5 5.65 18.35.5 12 .5z"/>
            </svg>
          </a>
          <a href="https://www.aviranr.com/" target="_blank" rel="noopener noreferrer" data-inspector-tip="Website: aviranr.com">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </a>
        </div>
      </div>`;
  }

  root.querySelectorAll('.inspector-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  root.querySelector('#__inspector-close').addEventListener('click', () => {
    targetDoc.querySelectorAll('.__inspector-selected-highlight').forEach(n =>
      n.classList.remove('__inspector-selected-highlight')
    );
    root.remove();
    tooltip.remove();
    styleEl.remove();
    if (targetStyleEl) targetStyleEl.remove();
    if (liveChangesStyleEl) liveChangesStyleEl.remove();
    exitPickMode();
  });


  root.querySelector('#__inspector-minimize').addEventListener('click', () => {
    const isMinimized = root.classList.toggle('minimized');
    root.querySelector('#__inspector-minimize').textContent = isMinimized ? '▲' : '—';
  });

  root.querySelector('#__inspector-undo').addEventListener('click', undoLast);
  root.querySelector('#__inspector-redo').addEventListener('click', redoLast);
  root.querySelector('#__inspector-changes-pill').addEventListener('click', () => {
    const drawer = root.querySelector('#__inspector-bar-drawer');
    if (!drawer) return;
    const isOpen = drawer.classList.toggle('open');
    if (isOpen) renderChangesDrawer();
  });

  root.querySelector('#__inspector-pick-btn').addEventListener('click', togglePickMode);
  // The whole select-group acts as the pick affordance — clicks on its
  // padding/gap (anywhere not on another interactive child) trigger
  // pick mode just like clicking the cursor button itself.
  root.querySelector('#__inspector-select-group')?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('[contenteditable]')) return;
    togglePickMode();
  });
  root.querySelector('#__inspector-multi-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setMultiPickMode(!multiPickMode);
    // Turning multi-pick ON auto-enters pick mode so the user can start
    // accumulating immediately; turning OFF leaves any current single pick
    // intact and exits pick mode.
    if (multiPickMode && !pickMode) enterPickMode();
  });
  // Hide the multi-select button from the header when the feature is off
  // in settings (default). Users opt in via Settings → Picker.
  applyMultiSelectVisibility();
  // Esc cascade — handle the most-recent-mode first:
  //   1. Mid-drag → handled by onDragKey (separate listener).
  //   2. Multi-pick active → exit multi-pick (keep primary selection).
  //   3. Pick mode active → exit pick mode (no selection).
  //   4. Something selected → clear the selection.
  // Skip entirely if focus is in an editable field (let the input handle it).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dragState) return;
    if (isEditableTarget && isEditableTarget(document.activeElement)) return;
    if (multiPickMode) { setMultiPickMode(false); return; }
    if (pickMode) { exitPickMode(); return; }
    if (selectedElement) { clearSelection(); }
  });

  // Arrow keys reorder the selected element among its siblings.
  // Axis is inferred from the parent's layout: vertical contexts use
  // Up/Down, horizontal contexts use Left/Right. No modifier needed
  // (Figma parity). Blocked when focus is in an editable field, when
  // multi-pick is active, or for absolutely-positioned elements.
  function isEditableTarget(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  function handleArrowKey(e) {
    if (!selectedElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (isEditableTarget(e.target)) return;
    if (isEditableTarget(document.activeElement)) return;
    if (targetDoc && isEditableTarget(targetDoc.activeElement)) return;

    // Use armedLevel if cursor-exit promotion is active, else fall
    // back to the selected element itself.
    const target = (armedLevel && armedLevel.element) || selectedElement;
    const parent = target.parentNode;
    if (!parent) return;
    const axis = (armedLevel && armedLevel.axis) || inferAxis(parent);
    let dir = 0;
    if (axis === 'vertical' && e.key === 'ArrowUp')    dir = -1;
    else if (axis === 'vertical' && e.key === 'ArrowDown')  dir = 1;
    else if (axis === 'horizontal' && e.key === 'ArrowLeft')  dir = -1;
    else if (axis === 'horizontal' && e.key === 'ArrowRight') dir = 1;
    else return;

    e.preventDefault();
    reorderAmongSiblings(target, dir);
    renderArmedIndicator(); // reposition after move
  }
  document.addEventListener('keydown', handleArrowKey);
  if (targetDoc && targetDoc !== document) {
    targetDoc.addEventListener('keydown', handleArrowKey);
  }

  // Track cursor for armed-level promotion. Listen on both parent
  // and iframe so the user's hover anywhere updates the state.
  //
  // Coordinate system: we normalize everything to TARGET-DOC LOCAL
  // coords (i.e. iframe-relative when the target is in an iframe).
  // That's where `getBoundingClientRect()` lives for picked elements,
  // so insideX/Y checks line up correctly. Overlays drawn in the
  // parent doc translate back via `iframeOffset()` at render time.
  function iframeOffset() {
    if (targetWin === window || !targetWin.frameElement) return { dx: 0, dy: 0 };
    const fr = targetWin.frameElement.getBoundingClientRect();
    return { dx: fr.left, dy: fr.top };
  }
  function onCursorMove(e) {
    let cx = e.clientX, cy = e.clientY;
    if (e.view === window && targetWin !== window && targetWin.frameElement) {
      // Event fired in the parent doc — subtract iframe offset to
      // map cursor into the iframe's local coordinate space.
      const { dx, dy } = iframeOffset();
      cx -= dx; cy -= dy;
    }
    // From iframe events: already iframe-local.
    updateArmedLevel(cx, cy);
    updateSelectionHover(cx, cy);
  }
  document.addEventListener('mousemove', onCursorMove);
  if (targetDoc && targetDoc !== document) {
    targetDoc.addEventListener('mousemove', onCursorMove);
  }
  // Reposition armed indicator + FABs + selection overlays on scroll /
  // resize so they track the live element bounds.
  document.addEventListener('scroll', () => { renderArmedIndicator(); positionFabs(); repositionSelectionOverlays(); }, true);
  window.addEventListener('resize', () => { renderArmedIndicator(); positionFabs(); repositionSelectionOverlays(); });
  root.querySelector('#__inspector-deselect').addEventListener('click', (e) => {
    e.stopPropagation();
    clearSelection();
  });

  root.querySelector('#__inspector-selector-pill').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedElement) return;
    if (treePopup.classList.contains('visible')) {
      closeTreePopup();
    } else {
      openTreePopup(root.querySelector('#__inspector-selector-pill'));
    }
  });

  // Render initial design panel
  renderDesignPanel();

  // ── Element tree helpers ─────────────────────────────────────────────────
  function getElementIndicators(el) {
    const cs = targetWin.getComputedStyle(el);
    const fill = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ? cs.backgroundColor : null;
    const stroke = (cs.borderStyle !== 'none' && cs.borderWidth !== '0px') ? cs.borderColor : null;
    const text = cs.color || null;
    const layout = cs.display.includes('flex') ? 'flex' : cs.display.includes('grid') ? 'grid' : null;
    const fx = (cs.boxShadow !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none');
    return { fill, stroke, text, layout, fx };
  }

  function renderIndicators(ind) {
    let html = '';
    const hasVisual = ind.fill || ind.stroke || ind.text;
    const hasStructural = ind.layout || ind.fx;
    if (ind.fill) html += `<div class="tree-swatch" style="background:${ind.fill};" title="background: ${ind.fill}"></div>`;
    if (ind.stroke) html += `<div class="tree-stroke" style="box-shadow:inset 0 0 0 2px ${ind.stroke};" title="border: ${ind.stroke}"></div>`;
    if (ind.text) html += `<span class="tree-text-badge" title="color: ${ind.text}">T</span>`;
    if (hasVisual && hasStructural) html += `<div class="tree-sep"></div>`;
    if (ind.layout === 'flex') html += `<span class="tree-layout-icon flex" title="display: flex"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg></span>`;
    else if (ind.layout === 'grid') html += `<span class="tree-layout-icon grid" title="display: grid"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg></span>`;
    if (ind.fx) html += `<span class="tree-fx" title="has shadow/filter">FX</span>`;
    return html ? `<div class="tree-props">${html}</div>` : '';
  }

  function buildTreeTag(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `<span class="tree-tag-id">#${el.id}</span>` : '';
    const cls = el.classList.length
      ? `<span class="tree-tag-cls">.${Array.from(el.classList).filter(c => !c.startsWith('__inspector')).slice(0,2).join('.')}</span>`
      : (!el.id ? `<span class="tree-tag-anon">no class</span>` : '');
    return `<span class="tree-tag"><span class="tree-tag-el">${tag}</span>${id}${cls}</span>`;
  }

  function buildConnector(depth, isLast) {
    if (depth === 0) return '';
    let html = '';
    for (let i = 1; i < depth; i++) html += `<div class="tree-conn-spacer"></div>`;
    html += `<div class="tree-conn-pipe${isLast ? ' last' : ''}"></div>`;
    return `<div class="tree-conn">${html}</div>`;
  }

  function openTreePopup(anchorEl) {
    if (!selectedElement) return;

    const ancestors = [];
    let cur = selectedElement.parentElement;
    while (cur && cur.tagName && cur !== document.documentElement) {
      if (cur.tagName !== 'HEAD') ancestors.unshift(cur);
      if (ancestors.length >= 5) break;
      cur = cur.parentElement;
    }

    const siblings = selectedElement.parentElement
      ? Array.from(selectedElement.parentElement.children)
          .filter(el => el !== selectedElement && !el.closest('#__inspector-root') && el.id !== '__inspector-tree-popup' && el.id !== '__inspector-color-popup')
          .slice(0, 6)
      : [];

    let html = '';

    if (ancestors.length > 0) {
      html += `<div class="tree-section-label">Parents</div>`;
      ancestors.forEach((el, i) => {
        const ind = getElementIndicators(el);
        html += `<div class="tree-row tree-dim" data-tree-idx="${i}">${buildConnector(i, false)}${buildTreeTag(el)}${renderIndicators(ind)}</div>`;
      });
    }

    html += `<div class="tree-section-label">Selected</div>`;
    const selDepth = ancestors.length;
    html += `<div class="tree-row tree-selected" data-tree-idx="${ancestors.length}">${buildConnector(selDepth, siblings.length === 0)}${buildTreeTag(selectedElement)}${renderIndicators(getElementIndicators(selectedElement))}</div>`;

    if (siblings.length > 0) {
      html += `<div class="tree-section-label">Siblings</div>`;
      siblings.forEach((el, i) => {
        const idx = ancestors.length + 1 + i;
        const ind = getElementIndicators(el);
        html += `<div class="tree-row tree-dim" data-tree-idx="${idx}">${buildConnector(selDepth, i === siblings.length - 1)}${buildTreeTag(el)}${renderIndicators(ind)}</div>`;
      });
    }

    const sel = computeSelector(selectedElement);
    const kind = elementKind(selectedElement);
    // Top-of-popup action: copy a chat-ready intro to the clipboard.
    // Clipboard icon + text, styled as a link button. Used to live in the
    // header next to the selector pill; moved here so the header just
    // carries Clear (✕). Tooltip explains the handoff.
    const copyBtnHtml =
      `<button class="tree-copy-btn" id="__inspector-tree-copy" type="button"
               data-inspector-tip="Paste into Claude, then type your ask — Claude will know the selected ${kind} is ${sel}.">
         <svg class="tree-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
           <rect x="8" y="2.5" width="8" height="4" rx="1" fill="currentColor" stroke="none"/>
         </svg>
         <span>Copy chat-ready intro</span>
       </button>`;
    treePopup.innerHTML =
      copyBtnHtml +
      html +
      `<div class="tree-hint">Tip: this puts <span class="tree-hint-sel">${esc(sel)}</span> on your clipboard as a chat intro. Paste it back to Claude, then type your ask.</div>`;
    const copyBtn = treePopup.querySelector('#__inspector-tree-copy');
    copyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      copySelectionIntro(copyBtn);
    });
    // First-pick pulse — runs once per session the first time the popup
    // renders after a selection so users notice the chat-handoff link.
    if (hasShownCopyHint && copyBtn && !copyBtn.dataset._pulsed) {
      copyBtn.dataset._pulsed = '1';
      copyBtn.classList.add('first-hint');
      setTimeout(() => copyBtn.classList.remove('first-hint'), 3200);
    }

    const allEls = [...ancestors, selectedElement, ...siblings];
    treePopup.querySelectorAll('.tree-row').forEach((row) => {
      const idx = parseInt(row.dataset.treeIdx);
      const target = allEls[idx];
      if (!target) return;
      row.addEventListener('mouseenter', () => {
        target.style.outline = '2px solid #3B82F6';
        target.style.outlineOffset = '1px';
      });
      row.addEventListener('mouseleave', () => {
        target.style.outline = '';
        target.style.outlineOffset = '';
      });
      if (!row.classList.contains('tree-selected')) {
        row.addEventListener('click', () => treeSelectElement(target));
      }
    });

    // Remember how this popup was opened so it can reposition itself when
    // the inspector panel is dragged or the viewport scrolls/resizes.
    treePopup._anchorEl = anchorEl || null;
    treePopup.classList.add('visible');
    positionTreePopup();

    setTimeout(() => document.addEventListener('click', treeOutsideClick), 0);
  }

  function closeTreePopup() {
    treePopup.classList.remove('visible');
    treePopup._anchorEl = null;
    document.removeEventListener('click', treeOutsideClick);
  }

  function treeOutsideClick(e) {
    if (!treePopup.contains(e.target) && e.target !== root.querySelector('#__inspector-selector-pill')) {
      closeTreePopup();
    }
  }

  // Reposition the tree popup against its current anchor (selector pill, or
  // a stored cursor position from a right-click). Called on open, on
  // inspector-panel drag, and on viewport scroll/resize so the popup tracks
  // its source and never lands off-screen.
  function positionTreePopup() {
    if (!treePopup.classList.contains('visible')) return;
    // Minimum gap (in px) between the popup and any viewport edge.
    const SAFE = 30;
    // Temporarily clear max-height so we can measure the popup's natural
    // size; then re-apply a max-height based on the chosen position.
    treePopup.style.maxHeight = '';
    const actualH = Math.min(treePopup.scrollHeight, window.innerHeight - 2 * SAFE);
    const actualW = Math.min(treePopup.offsetWidth,  window.innerWidth  - 2 * SAFE);
    let top, left;
    if (treePopup._anchorEl) {
      const rect = treePopup._anchorEl.getBoundingClientRect();
      left = rect.left;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      top = (spaceBelow >= spaceAbove)
        ? rect.bottom + 4
        : rect.top - Math.min(actualH, spaceAbove) - 4;
    } else {
      left = treePopup._posX || 100;
      top  = treePopup._posY || 100;
      if (top + actualH > window.innerHeight - 8) {
        top = (treePopup._posY || 100) - actualH - 8;
      }
    }
    // Hard clamp against the measured popup box so it stays fully on-screen.
    left = Math.max(SAFE, Math.min(window.innerWidth  - actualW - SAFE, left));
    top  = Math.max(SAFE, Math.min(window.innerHeight - actualH - SAFE, top));
    treePopup.style.left = left + 'px';
    treePopup.style.top  = top  + 'px';
    treePopup.style.maxHeight = (window.innerHeight - top - SAFE) + 'px';
  }
  window.addEventListener('scroll', positionTreePopup, true);
  window.addEventListener('resize', positionTreePopup);

  function treeSelectElement(el) {
    el.style.outline = '';
    el.style.outlineOffset = '';
    closeTreePopup();
    setSelection(el);
    renderDesignPanel();
    switchTab('design');
  }

  // ── Color picker state ────────────────────────────────────────────────────
  let cpState = { h: 0, s: 0, v: 0, a: 1 };
  let cpMode = 'HEX';
  let cpProp = null;
  let cpSel = null;
  let cpOriginal = null;

  function openColorPicker(prop, currentValue, anchorEl) {
    cpProp = prop;
    cpSel = computeSelector(selectedElement);
    cpOriginal = currentValue;
    cpState = parseColor(currentValue);
    cpMode = 'HEX';

    const rect = anchorEl.getBoundingClientRect();
    const popupHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    colorPopup.style.left = rect.left + 'px';
    colorPopup.style.top = spaceBelow >= popupHeight
      ? (rect.bottom + 4) + 'px'
      : (rect.top - popupHeight - 4) + 'px';

    colorPopup.classList.add('visible');

    colorPopup.querySelectorAll('.cp-fmt-btn').forEach(b => {
      b.classList.toggle('on', b.dataset.fmt === cpMode);
    });

    cpUpdateUI();
    cpWireEvents();

    setTimeout(() => {
      document.addEventListener('click', cpOutsideClick);
    }, 0);
  }

  function closeColorPicker(commit) {
    colorPopup.classList.remove('visible');
    document.removeEventListener('click', cpOutsideClick);
    if (commit && cpProp && cpSel) {
      const finalValue = formatColor(cpState.h, cpState.s, cpState.v, cpState.a, cpMode);
      if (finalValue !== cpOriginal) {
        trackChange(cpSel, cpProp, cpOriginal, finalValue);
      }
    }
    cpProp = null; cpSel = null; cpOriginal = null;
  }

  function cpOutsideClick(e) {
    if (!colorPopup.contains(e.target) && !e.target.closest('.inspector-color-field')) {
      closeColorPicker(true);
    }
  }

  function cpUpdateUI() {
    const { h, s, v, a } = cpState;
    const hueColor = `hsl(${h}, 100%, 50%)`;
    const { r, g, b } = hsvToRgb(h, s, v);

    const canvas = colorPopup.querySelector('#__inspector-cp-canvas');
    canvas.style.background = `linear-gradient(to bottom, rgba(0,0,0,0), #000), linear-gradient(to right, #fff, ${hueColor})`;

    const cursor = colorPopup.querySelector('#__inspector-cp-cursor');
    cursor.style.left = (s * 100) + '%';
    cursor.style.top = ((1 - v) * 100) + '%';

    const hueThumb = colorPopup.querySelector('#__inspector-cp-hue-thumb');
    hueThumb.style.left = (h / 360 * 100) + '%';

    const alphaGrad = colorPopup.querySelector('#__inspector-cp-alpha-gradient');
    alphaGrad.style.background = `linear-gradient(to right, rgba(${r},${g},${b},0), rgba(${r},${g},${b},1))`;
    const alphaThumb = colorPopup.querySelector('#__inspector-cp-alpha-thumb');
    alphaThumb.style.left = (a * 100) + '%';

    const preview = colorPopup.querySelector('#__inspector-cp-preview-color');
    preview.style.background = `rgba(${r},${g},${b},${a})`;

    const valueInput = colorPopup.querySelector('#__inspector-cp-value-input');
    if (cpMode === 'HEX') valueInput.value = hsvToHex(h, s, v);
    else if (cpMode === 'RGB') valueInput.value = `${r}, ${g}, ${b}`;
    else { const hsl = hsvToHsl(h, s, v); valueInput.value = `${hsl.h}, ${hsl.s}%, ${hsl.l}%`; }

    colorPopup.querySelector('#__inspector-cp-alpha-input').value = Math.round(a * 100) + '%';

    if (selectedElement && cpProp) {
      selectedElement.style.setProperty(cpProp, formatColor(h, s, v, a, cpMode));
    }
    const panelSwatch = root.querySelector(`.inspector-color-swatch[data-prop="${cpProp}"]`);
    if (panelSwatch) panelSwatch.style.background = `rgba(${r},${g},${b},${a})`;
  }

  function cpWireEvents() {
    const canvas = colorPopup.querySelector('#__inspector-cp-canvas');
    function canvasDrag(e) {
      const rect = canvas.getBoundingClientRect();
      cpState.s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      cpState.v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      cpUpdateUI();
    }
    canvas.onmousedown = (e) => {
      e.preventDefault();
      document.body.style.userSelect = 'none';
      canvasDrag(e);
      const mm = (e) => canvasDrag(e);
      const mu = () => {
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    };

    const hueTrack = colorPopup.querySelector('#__inspector-cp-hue-track');
    function hueDrag(e) {
      const rect = hueTrack.getBoundingClientRect();
      cpState.h = Math.max(0, Math.min(360, (e.clientX - rect.left) / rect.width * 360));
      cpUpdateUI();
    }
    hueTrack.onmousedown = (e) => {
      e.preventDefault();
      document.body.style.userSelect = 'none';
      hueDrag(e);
      const mm = (e) => hueDrag(e);
      const mu = () => {
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    };

    const alphaTrack = colorPopup.querySelector('#__inspector-cp-alpha-track');
    function alphaDrag(e) {
      const rect = alphaTrack.getBoundingClientRect();
      cpState.a = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      cpUpdateUI();
    }
    alphaTrack.onmousedown = (e) => {
      e.preventDefault();
      document.body.style.userSelect = 'none';
      alphaDrag(e);
      const mm = (e) => alphaDrag(e);
      const mu = () => {
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    };

    colorPopup.querySelectorAll('.cp-fmt-btn').forEach(btn => {
      btn.onclick = () => {
        cpMode = btn.dataset.fmt;
        colorPopup.querySelectorAll('.cp-fmt-btn').forEach(b => b.classList.toggle('on', b.dataset.fmt === cpMode));
        cpUpdateUI();
      };
    });

    const valueInput = colorPopup.querySelector('#__inspector-cp-value-input');
    valueInput.oninput = () => {
      const raw = valueInput.value.trim();
      let parsed;
      if (cpMode === 'HEX') parsed = parseColor(raw.startsWith('#') ? raw : '#' + raw);
      else if (cpMode === 'RGB') parsed = parseColor(`rgb(${raw})`);
      else parsed = parseColor(`hsl(${raw})`);
      if (parsed && (parsed.h !== 0 || parsed.s !== 0 || parsed.v !== 0)) {
        cpState.h = parsed.h; cpState.s = parsed.s; cpState.v = parsed.v;
        cpUpdateUI();
      }
    };

    const alphaInput = colorPopup.querySelector('#__inspector-cp-alpha-input');
    alphaInput.oninput = () => {
      const val = parseFloat(alphaInput.value) / 100;
      if (!isNaN(val)) { cpState.a = Math.max(0, Math.min(1, val)); cpUpdateUI(); }
    };

    colorPopup.onkeydown = (e) => { if (e.key === 'Escape') closeColorPicker(true); };
  }

  // ── Helper: suppress iframe pointer events during a drag ──
  // The inspector panel lives in the parent document. When a drag is in
  // progress and the cursor crosses into the iframe area, mouse events go
  // to the iframe's contentDocument instead of the parent — so the parent's
  // mousemove listener stops firing and the drag "sticks" mid-motion. By
  // setting pointer-events:none on the iframe while a drag is active, we
  // force every move event back to the parent doc.
  function suppressIframePointerEvents(suppress) {
    if (targetDoc === document) return; // live mode: no iframe, nothing to do
    const iframe = document.querySelector('iframe');
    if (!iframe) return;
    iframe.style.pointerEvents = suppress ? 'none' : '';
  }

  // ── Value/unit helpers shared between wireUpInputs and initScrub ─────────
  // Resolve the CSS value to apply, given an input's raw text + displayed unit.
  // Special cases:
  //   opacity with % unit: 50 → "0.5" (CSS opacity is 0-1, not 0-100)
  //   ° unit (rotate):     45 → "45deg" (° is not a real CSS unit)
  //   numeric + unit:      "32" + "px" → "32px"
  //   non-numeric:         "auto", "normal" — pass through unchanged
  function cssValueFor(prop, raw, unit) {
    if (raw === '' || raw === '-' || raw == null) return null;
    const trimmed = String(raw).trim();
    const num = parseFloat(trimmed);
    if (isNaN(num)) return trimmed;
    if (prop === 'opacity' && unit === '%') return String(num / 100);
    if (unit === '°') return num + 'deg';
    if (unit) return num + unit;
    return String(num);
  }
  function unitFor(el) {
    return (
      el.closest('.inspector-field')?.querySelector('.inspector-fu')?.textContent ||
      el.closest('.inspector-field-sm')?.querySelector('.inspector-fu')?.textContent ||
      ''
    );
  }

  // ── Panel drag ──
  function initDrag() {
    const header = root.querySelector('#__inspector-header');
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('[contenteditable]')) return;
      // Don't start a drag from any click inside the blue Select group —
      // the whole inner area acts as the pick affordance, not as a drag
      // handle. Clicks on dead space (padding/gap) route to the pick
      // button via the click handler below.
      if (e.target.closest('#__inspector-select-group')) return;
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      root.style.right = 'auto';
      root.style.left = rect.left + 'px';
      root.style.top = rect.top + 'px';
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragUp);
      document.body.style.userSelect = 'none';
      suppressIframePointerEvents(true);
    });

    function onDragMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(0, Math.min(window.innerWidth - root.offsetWidth, startLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 40, startTop + dy));
      root.style.left = newLeft + 'px';
      root.style.top = newTop + 'px';
      // Tree popup is anchored to the selector pill in the inspector — it
      // needs to track the panel as it moves.
      positionTreePopup();
    }

    function onDragUp() {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragUp);
      document.body.style.userSelect = '';
      suppressIframePointerEvents(false);
    }
  }

  // ── Panel resize ──
  function initResize() {
    const handle = root.querySelector('#__inspector-resize-handle');
    let startY = 0, startHeight = 0;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startHeight = root.offsetHeight;
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
      suppressIframePointerEvents(true);
    });

    function onResizeMove(e) {
      const dy = e.clientY - startY;
      const newHeight = Math.max(200, Math.min(window.innerHeight - 32, startHeight + dy));
      root.style.maxHeight = newHeight + 'px';
    }

    function onResizeUp() {
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      suppressIframePointerEvents(false);
    }
  }

  initDrag();
  initResize();

  // Wire custom tooltips — replace native title behavior.
  // Sentinel-guarded so re-running this block (e.g. if some external
  // hot-reload re-invokes boot) doesn't stack multiple listeners,
  // which would fire showPanelTip multiple times per hover.
  if (!root._inspectorTipsBound) {
    root._inspectorTipsBound = true;
    root.addEventListener('mouseenter', (e) => {
      const el = e.target.closest('[data-inspector-tip]');
      if (el) {
        showPanelTip(el.dataset.inspectorTip, el);
        e.target.title = ''; // suppress native tooltip
      }
    }, true);
    root.addEventListener('mouseleave', (e) => {
      if (e.target.closest('[data-inspector-tip]')) hidePanelTip();
    }, true);
  }

  // ── Forward declarations (stubs — filled in by Tasks 7-10) ────────────────
  // computeSelector is defined at module scope (above) — boot picks it up via closure.

  function trackChange(selector, property, from, to) {
    const file = cssMap[selector]?.[property]?.file ?? null;
    const line = cssMap[selector]?.[property]?.line ?? null;
    const existing = changes.findIndex(c => c.selector === selector && c.property === property);
    const originalFrom = existing >= 0 ? changes[existing].from : from;

    redoStack.length = 0;   // clear redo on any new edit

    if (to === originalFrom) {
      // Toggle back to the original value — remove the change and
      // record the removal so undo can restore it.
      if (existing >= 0) {
        const removed = changes.splice(existing, 1)[0];
        history.push({ kind: 'css-remove', prev: { ...removed } });
      }
    } else if (existing >= 0) {
      const prev = { ...changes[existing] };
      changes[existing].to = to;
      history.push({ kind: 'css-update', prev, next: { ...changes[existing] } });
    } else {
      const next = { selector, property, from, to, file, line };
      changes.push(next);
      history.push({ kind: 'css-add', next: { ...next } });
    }
    syncBadge();
    syncModifiedIndicators();
    rebuildLiveChangesStyles();
  }
  function undoChange(index) {
    const removed = changes.splice(index, 1)[0];
    if (removed) {
      history.push({ kind: 'css-remove', prev: { ...removed } });
      redoStack.length = 0;
    }
    clearInlineForChange(removed);
    syncBadge();
    syncModifiedIndicators();
    rebuildLiveChangesStyles();
  }

  function syncBadge() {
    const undoBtn = root.querySelector('#__inspector-undo');
    const redoBtn = root.querySelector('#__inspector-redo');
    if (undoBtn) undoBtn.disabled = history.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    renderChangesBar();
  }

  function syncModifiedIndicators() {
    const panel = root.querySelector('#__inspector-panel-design');
    if (!panel || !selectedElement) return;
    const sel = computeSelector(selectedElement);
    const modifiedProps = new Set(
      changes.filter(c => c.selector === sel).map(c => c.property)
    );
    panel.querySelectorAll('.inspector-field[data-prop]').forEach(field => {
      field.classList.toggle('modified', modifiedProps.has(field.dataset.prop));
    });
    panel.querySelectorAll('.inspector-field-sm[data-prop]').forEach(field => {
      field.classList.toggle('modified', modifiedProps.has(field.dataset.prop));
    });
    panel.querySelectorAll('.inspector-sv input[data-prop]').forEach(input => {
      const sv = input.closest('.inspector-sv');
      if (sv) sv.classList.toggle('modified', modifiedProps.has(input.dataset.prop));
    });
  }

  function resetField(prop) {
    if (!selectedElement) return;
    const sel = computeSelector(selectedElement);
    const change = changes.find(c => c.selector === sel && c.property === prop);
    if (!change) return;
    const originalValue = change.from;
    selectedElement.style.removeProperty(prop);
    const panel = root.querySelector('#__inspector-panel-design');
    const input = panel?.querySelector(`input[data-prop="${prop}"]`);
    if (input) input.value = parseFloat(originalValue) || originalValue;
    const idx = changes.findIndex(c => c.selector === sel && c.property === prop);
    if (idx >= 0) {
      const removed = changes.splice(idx, 1)[0];
      history.push({ kind: 'css-remove', prev: { ...removed } });
      redoStack.length = 0;
    }
    syncBadge();
    syncModifiedIndicators();
    rebuildLiveChangesStyles();
  }

  function undoLast() {
    if (history.length === 0) return;
    const h = history.pop();
    redoStack.push(h);

    if (h.kind === 'css-add') {
      // Reverse a CSS add: locate the live entry by selector+property and remove it.
      const idx = changes.findIndex(c => c.selector === h.next.selector && c.property === h.next.property);
      if (idx >= 0) {
        const removed = changes.splice(idx, 1)[0];
        // Inline style lives on whichever element was picked at edit time.
        // Clear from every matching element so orphaned inlines don't beat
        // the class-scope stylesheet revert. Harmless on elements without
        // the inline property.
        clearInlineForChange(removed);
      }
    } else if (h.kind === 'css-update') {
      const idx = changes.findIndex(c => c.selector === h.next.selector && c.property === h.next.property);
      if (idx >= 0) {
        clearInlineForChange(changes[idx]);
        changes[idx] = { ...h.prev };
      }
    } else if (h.kind === 'css-remove') {
      // Restore a removed change.
      changes.push({ ...h.prev });
    } else if (h.kind === 'intent-add') {
      const idx = componentIntents.findIndex(i => sameIntentTarget(i, h.next));
      if (idx >= 0) componentIntents.splice(idx, 1);
      revertSwapDom(h.dom);
    } else if (h.kind === 'intent-update') {
      const idx = componentIntents.findIndex(i => sameIntentTarget(i, h.next));
      if (idx >= 0) componentIntents[idx] = h.prev;
      revertSwapDom(h.dom);
    } else if (h.kind === 'intent-remove') {
      // X-removal didn't touch the DOM, so undo only restores
      // the bookkeeping entry — no class swap to replay.
      componentIntents.push(h.prev);
    } else if (h.kind === 'reorder') {
      revertReorder(h);
    } else if (h.kind === 'dom-remove') {
      // Undo a delete: re-insert the element at its original position
      // (just before the saved `nextSibling`, or appended if it was last).
      const dom = h.dom;
      if (dom && dom.element && dom.parent && !dom.element.isConnected) {
        dom.parent.insertBefore(dom.element, dom.nextSibling || null);
      }
    }

    syncBadge();
    syncModifiedIndicators();
    // Class-scope live stylesheet must rebuild so popped CSS rules
    // no longer apply to sibling instances.
    rebuildLiveChangesStyles();
    // If a variant swap reverted, the design panel's dropdowns need
    // to re-detect against the now-current classes.
    if (selectedElement && (h.kind === 'intent-add' || h.kind === 'intent-update')) {
      renderDesignPanel();
    }
    // If a reorder reverted, the selected element may have moved.
    if (h.kind === 'reorder') {
      repositionSelectionOverlays();
      positionFabs();
    }
  }

  // Reverse the live class swap that produced a variant intent — used
  // by undo on intent-add / intent-update history entries. The element
  // reference is kept on the history entry so we revert the SAME node
  // that was originally mutated, regardless of current selection.
  function revertSwapDom(dom) {
    if (!dom || !dom.element) return;
    if (dom.toCls && dom.element.classList.contains(dom.toCls)) {
      dom.element.classList.remove(dom.toCls);
    }
    if (dom.fromCls) dom.element.classList.add(dom.fromCls);
  }
  function reapplySwapDom(dom) {
    if (!dom || !dom.element) return;
    if (dom.fromCls && dom.element.classList.contains(dom.fromCls)) {
      dom.element.classList.remove(dom.fromCls);
    }
    if (dom.toCls) dom.element.classList.add(dom.toCls);
  }

  // ── Sibling reorder (Phase 2 — arrow-key version) ─────────────
  // Determines whether `parent` lays its children out horizontally
  // or vertically. Decides which arrow keys reorder the selected
  // child + which ancestor levels qualify for cursor-exit promotion.
  //
  // For flex containers we trust flex-direction (most reliable). For
  // anything else — block, grid, table, inline-flow — we MEASURE the
  // children's actual positions: if their X spread is bigger than their
  // Y spread, the layout is horizontal. This handles grid-based row
  // layouts (common for tables and dashboards) where the CSS display
  // value alone doesn't tell you the axis.
  function measureChildAxis(parent) {
    const kids = Array.from(parent.children);
    if (kids.length < 2) return 'vertical';
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.left);
      minY = Math.min(minY, r.top);  maxY = Math.max(maxY, r.top);
    }
    return (maxX - minX) > (maxY - minY) ? 'horizontal' : 'vertical';
  }

  function inferAxis(parent) {
    if (!parent || !targetWin) return 'vertical';
    const cs = targetWin.getComputedStyle(parent);
    const display = cs.display || '';
    if (display.includes('flex') && !display.includes('inline')) {
      return (cs.flexDirection || 'row').startsWith('row') ? 'horizontal' : 'vertical';
    }
    // Grid / block / inline / table — measure the actual layout.
    return measureChildAxis(parent);
  }

  // Per-parent snapshot of children at the FIRST reorder. Stored as a
  // WeakMap of element references — so the Copy Prompt emit can collapse
  // any number of subsequent nudges on the same parent into ONE entry
  // describing { before-state, new permutation }. Element refs survive
  // repeated re-orderings of the same children inside the same parent.
  const initialChildrenByParent = new WeakMap();
  function cleanClassesForWire(cls) {
    return (cls || '').split(/\s+/)
      .filter(c => c && !c.startsWith('__inspector-'))
      .join(' ');
  }
  function snapshotInitialChildrenIfNew(parent) {
    if (!parent || initialChildrenByParent.has(parent)) return;
    const kids = Array.from(parent.children);
    // Try to associate the parent with a manifest component — gives
    // Claude a source-file hint at paste-back time.
    let source = null;
    try {
      const match = matchComponent(parent);
      if (match && match.source) source = match.source;
    } catch (_) {}
    initialChildrenByParent.set(parent, {
      elements: kids,
      descriptors: kids.map(c => ({
        text: (c.textContent || '').trim().slice(0, 80),
        classes: cleanClassesForWire(c.className),
      })),
      ancestorChain: captureAncestorChain(parent),
      source,
    });
  }

  // Move `el` one slot earlier (dir=-1) or later (dir=+1) among its
  // element siblings. Pushes a `reorder` history entry. Returns true
  // if the move happened, false if blocked (no parent, edge of list,
  // multi-pick active, abs-positioned). Pure DOM tree op — no class
  // mutations, no inline styles.
  function reorderAmongSiblings(el, dir) {
    if (!el || !el.parentNode || !targetWin) return false;
    if (multiPickMode) return false;
    const cs = targetWin.getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') return false;

    const parent = el.parentNode;
    // Snapshot pre-mutation children once per parent — used at Copy
    // Prompt time to express the net permutation.
    snapshotInitialChildrenIfNew(parent);
    const siblings = Array.from(parent.children);
    const fromIdx = siblings.indexOf(el);
    if (fromIdx < 0) return false;
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= siblings.length) return false;

    const parentSelector = computeSelector(parent);
    const child = {
      text: (el.textContent || '').trim().slice(0, 80),
      classes: cleanClassesForWire(el.className),
    };
    const siblingsSnapshot = siblings.map(s => ({
      text: (s.textContent || '').trim().slice(0, 80),
      classes: cleanClassesForWire(s.className),
    }));

    const targetSib = siblings[toIdx];
    if (dir < 0) {
      parent.insertBefore(el, targetSib);
    } else {
      parent.insertBefore(el, targetSib.nextElementSibling);
    }

    redoStack.length = 0;
    history.push({
      kind: 'reorder',
      parent: parentSelector,
      from: fromIdx,
      to: toIdx,
      child,
      siblingsSnapshot,
      dom: { element: el, parent },
    });
    syncBadge();
    repositionSelectionOverlays();
    positionFabs();
    return true;
  }

  // Move the recorded element back to its `from` index. Robust to
  // intermediate DOM mutations — we compute the target sibling from
  // the live other-children list rather than trusting cached refs.
  function revertReorder(h) {
    const dom = h && h.dom;
    if (!dom || !dom.element || !dom.parent) return;
    const el = dom.element;
    const par = dom.parent;
    if (el.parentNode !== par) return;
    const others = Array.from(par.children).filter(c => c !== el);
    par.insertBefore(el, others[h.from] || null);
  }
  function reapplyReorder(h) {
    const dom = h && h.dom;
    if (!dom || !dom.element || !dom.parent) return;
    const el = dom.element;
    const par = dom.parent;
    if (el.parentNode !== par) return;
    const others = Array.from(par.children).filter(c => c !== el);
    par.insertBefore(el, others[h.to] || null);
  }

  // ── Armed level (cursor-exit promotion) ───────────────────────
  // The "armed level" is the element that arrow keys / drag handles
  // currently act on. When the cursor is inside (or hasn't moved
  // since selection), the armed level IS selectedElement. When the
  // cursor exits selected, we walk up the ancestor chain looking
  // for the first ancestor whose layout axis matches the exit
  // direction AND has ≥2 children — and arm THAT level's child
  // that contains selectedElement. This lets the user nudge the
  // selected card itself among ITS siblings, not just its children.
  let armedLevel = null; // { element, axis } or null

  function inferExitAxis(cursorX, cursorY, rect) {
    const insideX = cursorX >= rect.left && cursorX <= rect.right;
    const insideY = cursorY >= rect.top && cursorY <= rect.bottom;
    if (insideX && insideY) return null;
    if (insideX) return 'vertical';
    if (insideY) return 'horizontal';
    const dx = cursorX < rect.left ? rect.left - cursorX : cursorX - rect.right;
    const dy = cursorY < rect.top  ? rect.top  - cursorY : cursorY - rect.bottom;
    return dx > dy ? 'horizontal' : 'vertical';
  }

  function walkUpForAxis(el, axis) {
    // Returns the highest reachable direct-child node whose parent's
    // layout matches `axis` AND has ≥2 children. Null if none found
    // before reaching <body>.
    let node = el;
    const stopAt = targetDoc.body || targetDoc.documentElement;
    while (node && node.parentNode && node.parentNode !== stopAt) {
      const par = node.parentNode;
      if (par.children.length >= 2 && inferAxis(par) === axis) {
        return node;
      }
      node = par;
    }
    return null;
  }

  function updateArmedLevel(cursorX, cursorY) {
    if (dragState) return;  // freeze armed level while a drag is in progress
    if (!selectedElement) { armedLevel = null; renderArmedIndicator(); return; }
    const rect = selectedElement.getBoundingClientRect();
    const insideX = cursorX >= rect.left && cursorX <= rect.right;
    const insideY = cursorY >= rect.top && cursorY <= rect.bottom;
    if (insideX && insideY) {
      armedLevel = { element: selectedElement, axis: inferAxis(selectedElement.parentNode) };
    } else {
      const axis = inferExitAxis(cursorX, cursorY, rect);
      const promoted = axis ? walkUpForAxis(selectedElement, axis) : null;
      armedLevel = promoted
        ? { element: promoted, axis }
        : { element: selectedElement, axis: inferAxis(selectedElement.parentNode) };
    }
    renderArmedIndicator();
  }

  // Subtle pink outline on the armed element when it's not the
  // currently selected one — gives visual feedback for promotion.
  let armedIndicator = null;
  function ensureArmedIndicator() {
    if (armedIndicator) return armedIndicator;
    armedIndicator = document.createElement('div');
    armedIndicator.id = '__inspector-armed-indicator';
    armedIndicator.style.cssText = 'position:fixed;pointer-events:none;border:1px solid #ff3d8b;z-index:2147483642;display:none;';
    document.body.appendChild(armedIndicator);
    return armedIndicator;
  }

  // Two kinds of overlay markup per armed level:
  //   - CIRCLE grippers, one per sibling, centered on the child. THESE are
  //     the actual grab handles — mousedown here starts a drag of that child.
  //   - Subtle BARS in the gaps between siblings — purely decorative gap
  //     indicators (no interaction; pointer-events: none). Future feature
  //     will repurpose them as gap-size handles (Figma-style auto-layout gap).
  // Live in parent doc so they don't pollute the target source.
  let grippers = [];
  let gapBars = [];
  // Tracks what's currently rendered, so renderArmedIndicator can skip
  // tearing down + recreating gripper DOM on every mousemove. Without
  // this guard, the `:hover` state on a gripper resets the moment the
  // cursor jiggles (because the hovered element gets replaced with a
  // fresh one), causing the visible disc to flicker between sizes.
  let renderedArmedElement = null;
  let renderedArmedAxis = null;
  let renderedSiblingCount = 0;
  function clearGrippers() {
    grippers.forEach(g => g.remove()); grippers = [];
    gapBars.forEach(g => g.remove());  gapBars = [];
    renderedArmedElement = null;
    renderedArmedAxis = null;
    renderedSiblingCount = 0;
  }
  function renderGrippers() {
    if (!armedLevel || !armedLevel.element || !armedLevel.element.parentNode) {
      clearGrippers();
      return;
    }
    if (dragState) {
      clearGrippers();
      return;
    }
    const parent = armedLevel.element.parentNode;
    const siblings = Array.from(parent.children);
    if (siblings.length < 2) {
      clearGrippers();
      return;
    }
    const axis = armedLevel.axis;
    const { dx, dy } = iframeOffset();

    // FAST PATH: the armed level + sibling count match the last full
    // render. Just reposition the existing grippers in place — no DOM
    // teardown, so the cursor's `:hover` state is preserved across
    // every mousemove. This is what kept the hover flickering before.
    if (renderedArmedElement === armedLevel.element &&
        renderedArmedAxis === axis &&
        renderedSiblingCount === siblings.length &&
        grippers.length === siblings.length) {
      siblings.forEach((sib, i) => {
        const r = sib.getBoundingClientRect();
        const midX = (r.left + r.right) / 2 + dx;
        const midY = (r.top + r.bottom) / 2 + dy;
        grippers[i].style.left = (midX - 8.5) + 'px';
        grippers[i].style.top  = (midY - 8.5) + 'px';
      });
      // Reposition bars (some may have been skipped due to wrapping,
      // so iterate through gapBars in parallel with valid sibling pairs).
      let barIdx = 0;
      for (let i = 0; i < siblings.length - 1; i++) {
        const a = siblings[i].getBoundingClientRect();
        const b = siblings[i + 1].getBoundingClientRect();
        const perpOverlap = axis === 'vertical'
          ? Math.min(a.right, b.right) > Math.max(a.left, b.left)
          : Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
        if (!perpOverlap) continue;
        const bar = gapBars[barIdx++];
        if (!bar) continue;
        if (axis === 'vertical') {
          const midY = (a.bottom + b.top) / 2 + dy;
          const midX = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 + dx;
          bar.style.left = (midX - 9) + 'px';
          bar.style.top  = (midY - 0.75) + 'px';
        } else {
          const midX = (a.right + b.left) / 2 + dx;
          const midY = (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2 + dy;
          bar.style.left = (midX - 0.75) + 'px';
          bar.style.top  = (midY - 6.75) + 'px';
        }
      }
      return;
    }

    // SLOW PATH: armed level changed → tear down and rebuild.
    clearGrippers();
    renderedArmedElement = armedLevel.element;
    renderedArmedAxis = axis;
    renderedSiblingCount = siblings.length;

    // Circle grippers — the grab handles. Visual styles come from the
    // `.__inspector-gripper` CSS class (hollow pink ring stack, scales
    // on hover). Only position is inlined here. Box is 7×7 so offset
    // is 3.5px from the sibling's center.
    siblings.forEach((sib, i) => {
      const r = sib.getBoundingClientRect();
      const midX = (r.left + r.right) / 2 + dx;
      const midY = (r.top + r.bottom) / 2 + dy;
      const g = document.createElement('div');
      g.className = '__inspector-gripper';
      g.dataset.siblingIndex = String(i);
      g.style.left = (midX - 8.5) + 'px';   // -half of 17px hit pad
      g.style.top  = (midY - 8.5) + 'px';
      g.addEventListener('mousedown', (e) => startGripperDrag(e, sib, parent, axis));
      document.body.appendChild(g);
      grippers.push(g);
    });

    // Decorative gap bars — between adjacent siblings only. Skip the
    // bar if two consecutive siblings are NOT visually adjacent on the
    // perpendicular axis (i.e., a flex/grid container wrapped to a new
    // line). Otherwise we'd draw a diagonal "ghost" bar in mid-air.
    for (let i = 0; i < siblings.length - 1; i++) {
      const a = siblings[i].getBoundingClientRect();
      const b = siblings[i + 1].getBoundingClientRect();
      const perpOverlap = axis === 'vertical'
        ? Math.min(a.right, b.right) > Math.max(a.left, b.left)
        : Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
      if (!perpOverlap) continue;
      const bar = document.createElement('div');
      bar.className = '__inspector-gap-bar';
      if (axis === 'vertical') {
        // Horizontal gap bar: 18px long (was 24, trimmed to 75%).
        const midY = (a.bottom + b.top) / 2 + dy;
        const midX = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 + dx;
        bar.style.left = (midX - 9) + 'px';
        bar.style.top  = (midY - 0.75) + 'px';
        bar.style.width = '18px';
        bar.style.height = '1.5px';
      } else {
        // Vertical gap bar: 13.5px tall (was 18, trimmed to 75%).
        const midX = (a.right + b.left) / 2 + dx;
        const midY = (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2 + dy;
        bar.style.left = (midX - 0.75) + 'px';
        bar.style.top  = (midY - 6.75) + 'px';
        bar.style.width = '1.5px';
        bar.style.height = '13.5px';
      }
      document.body.appendChild(bar);
      gapBars.push(bar);
    }
  }

  // ── Drag-and-drop ────────────────────────────────────────────
  // Drag state lives in module-scope vars so the global move/up
  // handlers can read it. Ghost = absolute-positioned clone that
  // follows the cursor; drop line = a thin pink bar showing where
  // the dropped sibling will land.
  let dragState = null; // { source, parent, axis, ghost, dropLine, lastTargetIdx }
  function startGripperDrag(e, source, parent, axis) {
    e.preventDefault();
    e.stopPropagation();
    if (!source || !parent) return;

    const { dx, dy } = iframeOffset();
    const r = source.getBoundingClientRect();

    // Ghost: a simple wireframe placeholder of the source's size.
    // We deliberately don't clone the source node — cloning carries
    // the target-doc's font / inherited styles, which look wrong in
    // the parent doc and add layout/style work. A clean rect reads
    // as "I'm moving something this big" and avoids style mismatches.
    const ghost = document.createElement('div');
    ghost.id = '__inspector-drag-ghost';
    ghost.style.cssText = [
      'position:fixed',
      `left:${r.left + dx}px`, `top:${r.top + dy}px`,
      `width:${r.width}px`,    `height:${r.height}px`,
      'background:rgba(255,61,139,0.18)',
      'outline:2px solid #ff3d8b',
      'border-radius:4px',
      'box-shadow:0 6px 18px rgba(255,61,139,0.30)',
      'opacity:0.85', 'pointer-events:none',
      'z-index:2147483646',
    ].join(';');
    document.body.appendChild(ghost);

    const dropLine = document.createElement('div');
    dropLine.id = '__inspector-drop-line';
    dropLine.style.cssText = `position:fixed;background:#ff3d8b;border-radius:2px;z-index:2147483644;pointer-events:none;display:none;box-shadow:0 0 6px rgba(255,61,139,0.5);`;
    document.body.appendChild(dropLine);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    // Suppress iframe pointer events so ALL mouse events route to the
    // parent doc for the entire drag. This solves three real bugs the
    // user hit: (1) target-doc hover styles firing under the cursor,
    // (2) mouseup landing on iframe contents and never reaching our
    // up handler ("stuck — only refresh helps"), (3) mousemove inside
    // the iframe triggering armed-level promotion mid-drag. Restored
    // in teardown.
    suppressIframePointerEvents(true);
    clearGrippers();   // hide static handles during drag

    dragState = {
      source, parent, axis, ghost, dropLine,
      offsetX: e.clientX - (r.left + dx),
      offsetY: e.clientY - (r.top + dy),
      lastTargetIdx: -1,
    };

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
    document.addEventListener('keydown', onDragKey, true);
  }

  function gapBetween(siblings, idx, axis, off) {
    // Compute the visual position (parent-viewport coords) of the gap AT idx —
    // i.e., the boundary BEFORE siblings[idx]. idx ranges 0..siblings.length.
    const { dx, dy } = off;
    if (idx <= 0) {
      const r = siblings[0].getBoundingClientRect();
      return axis === 'vertical'
        ? { x: r.left + dx, y: r.top + dy, span: r.width }
        : { x: r.left + dx, y: r.top + dy, span: r.height };
    }
    if (idx >= siblings.length) {
      const r = siblings[siblings.length - 1].getBoundingClientRect();
      return axis === 'vertical'
        ? { x: r.left + dx, y: r.bottom + dy, span: r.width }
        : { x: r.right + dx, y: r.top + dy, span: r.height };
    }
    const a = siblings[idx - 1].getBoundingClientRect();
    const b = siblings[idx].getBoundingClientRect();
    if (axis === 'vertical') {
      return { x: Math.min(a.left, b.left) + dx, y: (a.bottom + b.top) / 2 + dy, span: Math.max(a.width, b.width) };
    } else {
      return { x: (a.right + b.left) / 2 + dx, y: Math.min(a.top, b.top) + dy, span: Math.max(a.height, b.height) };
    }
  }

  function chooseDropIndex(parent, axis, cursorX, cursorY) {
    // Cursor coords already in parent-viewport. Compare to each sibling's
    // midpoint along the axis; drop index = first sibling whose midpoint
    // is past the cursor. Returns 0..siblings.length.
    const siblings = Array.from(parent.children).filter(c => c !== dragState.source);
    if (siblings.length === 0) return 0;
    const { dx, dy } = iframeOffset();
    for (let i = 0; i < siblings.length; i++) {
      const r = siblings[i].getBoundingClientRect();
      const midA = axis === 'vertical' ? (r.top + r.bottom) / 2 + dy : (r.left + r.right) / 2 + dx;
      const cursorA = axis === 'vertical' ? cursorY : cursorX;
      if (cursorA < midA) return i;
    }
    return siblings.length;
  }

  function onDragMove(e) {
    if (!dragState) return;
    const { ghost, axis, parent, dropLine } = dragState;
    ghost.style.left = (e.clientX - dragState.offsetX) + 'px';
    ghost.style.top = (e.clientY - dragState.offsetY) + 'px';

    const off = iframeOffset();
    const dropIdxFiltered = chooseDropIndex(parent, axis, e.clientX, e.clientY);
    // Translate filtered index back to full-children index so we can look up gap position.
    // The drop line position is between the appropriate siblings in the LIVE order.
    const siblings = Array.from(parent.children).filter(c => c !== dragState.source);
    if (siblings.length === 0) { dropLine.style.display = 'none'; return; }
    const gap = gapBetween(siblings, dropIdxFiltered, axis, off);
    if (axis === 'vertical') {
      dropLine.style.left = gap.x + 'px';
      dropLine.style.top = (gap.y - 2) + 'px';
      dropLine.style.width = gap.span + 'px';
      dropLine.style.height = '4px';
    } else {
      dropLine.style.left = (gap.x - 2) + 'px';
      dropLine.style.top = gap.y + 'px';
      dropLine.style.width = '4px';
      dropLine.style.height = gap.span + 'px';
    }
    dropLine.style.display = '';
    dragState.lastTargetIdx = dropIdxFiltered;
  }

  function onDragUp(e) {
    if (!dragState) return;
    const { source, parent, axis, ghost, dropLine, lastTargetIdx } = dragState;
    const teardown = () => {
      ghost.remove();
      dropLine.remove();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      suppressIframePointerEvents(false);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragUp);
      document.removeEventListener('keydown', onDragKey, true);
      dragState = null;
      renderArmedIndicator();          // grippers at new positions
      repositionSelectionOverlays();   // blue box follows the moved element
      positionFabs();                  // FABs follow the moved element
    };

    // Snapshot pre-mutation children once per parent — used at Copy
    // Prompt time to express the net permutation.
    snapshotInitialChildrenIfNew(parent);

    // Snapshot original index BEFORE moving (for history).
    const originalSiblings = Array.from(parent.children);
    const fromIdx = originalSiblings.indexOf(source);
    if (lastTargetIdx < 0) { teardown(); return; }

    // Build siblings array WITHOUT source, then insert at targetIdx.
    const others = originalSiblings.filter(c => c !== source);
    const refNode = others[lastTargetIdx] || null;
    parent.insertBefore(source, refNode);

    // No-op detection AFTER the move (more reliable than predicting it):
    // if the source landed at the same index, undo and skip history push.
    const newIdx = Array.from(parent.children).indexOf(source);
    if (newIdx === fromIdx) { teardown(); return; }
    const siblingsSnapshot = originalSiblings.map(s => ({
      text: (s.textContent || '').trim().slice(0, 80),
      classes: cleanClassesForWire(s.className),
    }));
    redoStack.length = 0;
    history.push({
      kind: 'reorder',
      parent: computeSelector(parent),
      from: fromIdx,
      to: newIdx,
      child: {
        text: (source.textContent || '').trim().slice(0, 80),
        classes: cleanClassesForWire(source.className),
      },
      siblingsSnapshot,
      dom: { element: source, parent },
    });
    syncBadge();
    teardown();
  }

  function onDragKey(e) {
    if (!dragState) return;
    if (e.key === 'Escape') {
      // Cancel: just tear down without moving the source.
      e.preventDefault();
      e.stopPropagation();
      const { ghost, dropLine } = dragState;
      ghost.remove();
      dropLine.remove();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      suppressIframePointerEvents(false);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragUp);
      document.removeEventListener('keydown', onDragKey, true);
      dragState = null;
      renderArmedIndicator();
    }
  }

  // ── Floating action buttons (FABs) ─────────────────────────────
  // Two button groups that follow the selected element:
  //   FAB-A (horizontal, top-right of selection): Reselect + Clear
  //   FAB-B (vertical, right of selection):       Parent + First sibling
  // Lazy-created on first call, then repositioned on every selection /
  // scroll / resize. Live in parent doc; pointer-events:auto so clicks
  // work normally and don't bleed through to the iframe.
  let fabA = null, fabB = null;
  const ICON_CURSOR = '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 2 L13 7 L8 9 L6 14 Z" fill="currentColor"/></svg>';
  const ICON_X      = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4 L12 12 M12 4 L4 12"/></svg>';
  const ICON_UP     = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10 L8 6 L12 10"/></svg>';
  const ICON_DOWN   = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6 L8 10 L12 6"/></svg>';

  function ensureFabs() {
    if (fabA && fabB) return;
    fabA = document.createElement('div');
    fabA.id = '__inspector-fab-a';
    fabA.className = '__inspector-fab horizontal';
    fabA.innerHTML = `
      <button data-act="reselect" title="Reselect (clear + pick again)">${ICON_CURSOR}</button>
      <button data-act="clear" title="Clear selection">${ICON_X}</button>
    `;
    document.body.appendChild(fabA);

    fabB = document.createElement('div');
    fabB.id = '__inspector-fab-b';
    fabB.className = '__inspector-fab vertical';
    fabB.innerHTML = `
      <button data-act="parent" title="Select parent">${ICON_UP}</button>
      <button data-act="first-sibling" title="Select first sibling">${ICON_DOWN}</button>
    `;
    document.body.appendChild(fabB);

    fabA.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'clear') clearSelection();
      else if (act === 'reselect') { clearSelection(); enterPickMode(); }
    });
    fabB.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act;
      if (!selectedElement) return;
      if (act === 'parent') {
        const par = selectedElement.parentNode;
        if (par && par.nodeType === 1 && par !== targetDoc.body && par !== targetDoc.documentElement) {
          setSelection(par);
        }
      } else if (act === 'first-sibling') {
        const par = selectedElement.parentNode;
        const sib = par && par.firstElementChild;
        if (sib && sib !== selectedElement) setSelection(sib);
      }
    });
  }

  // ── Floating selection overlays ────────────────────────────────
  // One per selected element (multi-pick supported). Survives any
  // overflow:hidden ancestor in the target by living in the parent
  // doc. Hovered state (2px ring) is driven from cursor coords.
  let selectionOverlays = [];
  function clearSelectionOverlays() {
    selectionOverlays.forEach(o => o.remove());
    selectionOverlays = [];
  }
  // Position the overlay 1px OUTSIDE the element's bounds so the blue
  // ring has a visible 1px gap before it (mirrors `outline-offset: 1px`).
  function applyOverlayRect(o, r, dx, dy) {
    o.style.left   = (r.left + dx - 1) + 'px';
    o.style.top    = (r.top  + dy - 1) + 'px';
    o.style.width  = (r.width  + 2)    + 'px';
    o.style.height = (r.height + 2)    + 'px';
  }
  function renderSelectionOverlays() {
    clearSelectionOverlays();
    if (!settings.showSelectedOutline) return;
    const elements = (typeof allSelected === 'function' ? allSelected() : (selectedElement ? [selectedElement] : []));
    if (!elements.length) return;
    const { dx, dy } = iframeOffset();
    elements.forEach((el) => {
      const r = el.getBoundingClientRect();
      const o = document.createElement('div');
      o.className = '__inspector-selection-overlay';
      applyOverlayRect(o, r, dx, dy);
      document.body.appendChild(o);
      // Store the element reference so the hover detector can match.
      o._inspectorEl = el;
      selectionOverlays.push(o);
    });
  }
  function repositionSelectionOverlays() {
    if (!selectionOverlays.length) return;
    const { dx, dy } = iframeOffset();
    selectionOverlays.forEach(o => {
      const el = o._inspectorEl;
      if (!el || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      applyOverlayRect(o, r, dx, dy);
    });
  }

  // ── Pick-mode hover overlay ─────────────────────────────────────
  // One singleton div in parent doc that follows whichever element
  // the cursor is currently hovering during pick mode. Same overflow-
  // escape trick as the selection overlay.
  let pickHoverOverlay = null;
  function ensurePickHoverOverlay() {
    if (pickHoverOverlay) return pickHoverOverlay;
    pickHoverOverlay = document.createElement('div');
    pickHoverOverlay.className = '__inspector-pick-hover-overlay';
    document.body.appendChild(pickHoverOverlay);
    return pickHoverOverlay;
  }
  function showPickHoverOverlay(el) {
    if (!el) return;
    ensurePickHoverOverlay();
    const { dx, dy } = iframeOffset();
    const r = el.getBoundingClientRect();
    applyOverlayRect(pickHoverOverlay, r, dx, dy);
    // Inline `block` overrides the stylesheet's `display: none` default.
    pickHoverOverlay.style.display = 'block';
  }
  function hidePickHoverOverlay() {
    if (pickHoverOverlay) pickHoverOverlay.style.display = 'none';
  }
  function updateSelectionHover(cursorXLocal, cursorYLocal) {
    // cursorX/Y are in TARGET-DOC local space (same space as
    // getBoundingClientRect on selected elements).
    selectionOverlays.forEach(o => {
      const el = o._inspectorEl;
      if (!el) { o.classList.remove('hovered'); return; }
      const r = el.getBoundingClientRect();
      const inside = cursorXLocal >= r.left && cursorXLocal <= r.right
                  && cursorYLocal >= r.top  && cursorYLocal <= r.bottom;
      o.classList.toggle('hovered', inside);
    });
  }

  function positionFabs() {
    // FABs share the "Show selection box" toggle — they're decoration
    // pinned to the selection outline; hiding the outline also hides
    // these action buttons (otherwise they'd float disconnected).
    if (!selectedElement || !settings.showSelectedOutline) {
      if (fabA) fabA.classList.remove('visible');
      if (fabB) fabB.classList.remove('visible');
      return;
    }
    ensureFabs();
    const { dx, dy } = iframeOffset();
    const r = selectedElement.getBoundingClientRect();
    const rl = r.left + dx, rt = r.top + dy, rr = r.right + dx, rb = r.bottom + dy;

    // Show first so we can measure
    fabA.classList.add('visible');
    fabB.classList.add('visible');
    const ar = fabA.getBoundingClientRect();
    const br = fabB.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;

    // FAB-A: anchor to top-right corner of selection. Default ABOVE the
    // selection; flip below if there's no room above. Clamp horizontally
    // to viewport when selection extends past the right edge.
    let aLeft = rr - ar.width;
    let aTop  = rt - ar.height - 6;
    if (aTop < 6) aTop = rb + 6;
    if (aLeft + ar.width > vw - 6) aLeft = vw - ar.width - 6;
    if (aLeft < 6) aLeft = 6;
    fabA.style.left = aLeft + 'px';
    fabA.style.top  = aTop  + 'px';

    // FAB-B: ALWAYS on the right side of the selection, vertically
    // centered. Clamp to the viewport's right edge when the selection
    // is wider than the viewport (full-width rows are the case where
    // this matters). Never flip to the left — keeps the buttons in
    // their expected spot regardless of selection size.
    let bLeft = rr + 6;
    let bTop  = rt + (rb - rt) / 2 - br.height / 2;
    if (bLeft + br.width > vw - 6) bLeft = vw - br.width - 6;
    if (bLeft < 6) bLeft = 6;
    if (bTop < 6) bTop = 6;
    if (bTop + br.height > vh - 6) bTop = vh - br.height - 6;
    fabB.style.left = bLeft + 'px';
    fabB.style.top  = bTop  + 'px';

    // Disable parent / first-sibling buttons when not applicable.
    const par = selectedElement.parentNode;
    const parDisabled = !par || par.nodeType !== 1 || par === targetDoc.body || par === targetDoc.documentElement;
    fabB.querySelector('[data-act="parent"]').disabled = parDisabled;
    const isFirst = par && par.firstElementChild === selectedElement;
    fabB.querySelector('[data-act="first-sibling"]').disabled = !par || isFirst;
  }

  function renderArmedIndicator() {
    const ind = ensureArmedIndicator();
    if (!armedLevel || armedLevel.element === selectedElement) {
      ind.style.display = 'none';
    } else {
      const { dx, dy } = iframeOffset();
      const r = armedLevel.element.getBoundingClientRect();
      ind.style.left = (r.left + dx) + 'px';
      ind.style.top = (r.top + dy) + 'px';
      ind.style.width = r.width + 'px';
      ind.style.height = r.height + 'px';
      ind.style.display = '';
    }
    renderGrippers();
  }

  function clearInlineForChange(change) {
    if (!change || !change.selector || !change.property) return;
    try {
      targetDoc.querySelectorAll(change.selector).forEach(el => {
        el.style.removeProperty(change.property);
      });
    } catch (_) {
      // Selector might be invalid as a CSS query (e.g. contains : pseudo
      // classes the inspector composed). Fall back to the active pick.
      if (selectedElement) selectedElement.style.removeProperty(change.property);
    }
  }

  function redoLast() {
    if (redoStack.length === 0) return;
    const h = redoStack.pop();
    history.push(h);

    if (h.kind === 'css-add') {
      changes.push({ ...h.next });
      if (selectedElement) {
        selectedElement.style.setProperty(h.next.property, h.next.to);
      }
    } else if (h.kind === 'css-update') {
      const idx = changes.findIndex(c => c.selector === h.next.selector && c.property === h.next.property);
      if (idx >= 0) changes[idx] = { ...h.next };
      else changes.push({ ...h.next });
    } else if (h.kind === 'css-remove') {
      const idx = changes.findIndex(c => c.selector === h.prev.selector && c.property === h.prev.property);
      if (idx >= 0) {
        const removed = changes.splice(idx, 1)[0];
        clearInlineForChange(removed);
      }
    } else if (h.kind === 'intent-add') {
      componentIntents.push(h.next);
      reapplySwapDom(h.dom);
    } else if (h.kind === 'intent-update') {
      const idx = componentIntents.findIndex(i => sameIntentTarget(i, h.prev));
      if (idx >= 0) componentIntents[idx] = h.next;
      else componentIntents.push(h.next);
      reapplySwapDom(h.dom);
    } else if (h.kind === 'intent-remove') {
      const idx = componentIntents.findIndex(i => sameIntentTarget(i, h.prev));
      if (idx >= 0) componentIntents.splice(idx, 1);
    } else if (h.kind === 'reorder') {
      reapplyReorder(h);
    } else if (h.kind === 'dom-remove') {
      // Redo a delete: pull the element back out of the DOM.
      if (h.dom && h.dom.element && h.dom.element.isConnected) {
        h.dom.element.remove();
      }
    }

    syncBadge();
    syncModifiedIndicators();
    rebuildLiveChangesStyles();
    if (selectedElement && (h.kind === 'intent-add' || h.kind === 'intent-update')) {
      renderDesignPanel();
    }
    if (h.kind === 'reorder') {
      repositionSelectionOverlays();
      positionFabs();
    }
  }

  function generateChangesJson() {
    return JSON.stringify(changes, null, 2);
  }

  // Human-readable line for a component intent — mirrors the bullets used
  // for CSS changes so the summary at the top of the prompt reads naturally.
  function componentIntentLine(i) {
    if (i.action === 'swap-variant') {
      return `- \`${i.selector}\` (${i.component}): ${i.prop} ${i.from} → ${i.to}`;
    }
    if (i.action === 'convert') {
      const sels = Array.isArray(i.selectors) ? i.selectors.join(', ') : i.selector;
      return `- Convert ${sels} → ${i.to}`;
    }
    return `- ${JSON.stringify(i)}`;
  }

  // Collapse all reorders to ONE entry per parent describing the net
  // permutation. Compact regardless of how many nudges happened —
  // ships the pre-mutation children list + the new order as indices
  // into that list. Skips parents whose net effect is identity.
  function buildCollapsedReorders() {
    const reorders = reorderEntries();
    if (!reorders.length) return [];
    // Use insertion-order traversal so the OUTPUT order matches the
    // order the user first reordered each parent — feels stable.
    const parentEls = [];
    const seen = new Set();
    reorders.forEach(h => {
      if (h.dom && h.dom.parent && !seen.has(h.dom.parent)) {
        seen.add(h.dom.parent);
        parentEls.push(h.dom.parent);
      }
    });
    const out = [];
    parentEls.forEach(parentEl => {
      const initial = initialChildrenByParent.get(parentEl);
      if (!initial) return;
      const currentKids = Array.from(parentEl.children);
      // Permutation: for each live child, find its index in the
      // pre-mutation list. Element refs make this stable even with
      // duplicate text/classes (which trip up simple text matching).
      const order = currentKids.map(c => initial.elements.indexOf(c)).filter(i => i >= 0);
      // Skip identity (no net change — every undo, no-op move, etc).
      const isIdentity = order.length === initial.elements.length &&
                         order.every((v, i) => v === i);
      if (isIdentity) return;
      const entry = {
        action: 'reorder',
        parent: computeSelector(parentEl),
        children: initial.descriptors,
        order,
        // Carry the parentEl ref out for the drawer / X-click handler.
        _parentEl: parentEl,
      };
      if (initial.source) entry.source = initial.source;
      if (initial.ancestorChain && initial.ancestorChain.length) {
        entry.ancestorChain = initial.ancestorChain;
      }
      out.push(entry);
    });
    return out;
  }

  // Build a preview of JUST ONE change — used by the per-row hover
  // tooltip in the drawer. `kind` is 'css' | 'intent' | 'reorder',
  // `idx` is the position within that kind's collection. Returns the
  // same {summary line + JSON block} pair the full prompt uses, just
  // scoped to one entry.
  function buildSinglePrompt(kind, idx) {
    if (kind === 'css') {
      const c = changes[idx];
      if (!c) return '';
      const line = `- \`${c.selector}\`: ${c.property} ${c.from} → ${c.to}`;
      return `Just this CSS edit:\n${line}\n\n<changes>\n${JSON.stringify([c], null, 2)}\n</changes>`;
    }
    if (kind === 'intent') {
      const i = componentIntents[idx];
      if (!i) return '';
      return `Just this component change:\n${componentIntentLine(i)}\n\n<components>\n${JSON.stringify([i], null, 2)}\n</components>`;
    }
    if (kind === 'reorder') {
      const collapsed = buildCollapsedReorders();
      const r = collapsed[idx];
      if (!r) return '';
      const newOrderTexts = r.order.map(i => `"${(r.children[i] && r.children[i].text) || '—'}"`);
      const line = `- Reorder in \`${r.parent}\`: ${newOrderTexts.join(' → ')}`;
      const { _parentEl, ...wire } = r;
      return `Just this reorder:\n${line}\n\n<reorders>\n${JSON.stringify([wire], null, 2)}\n</reorders>`;
    }
    if (kind === 'dom-remove') {
      const h = domRemoveEntries()[idx];
      if (!h) return '';
      const line = `- Remove \`${h.target.selector}\` (${h.target.tag}) from \`${h.parent}\``;
      const wire = { action: 'remove', parent: h.parent, target: h.target, ancestorChain: h.ancestorChain };
      return `Just this deletion:\n${line}\n\n<removals>\n${JSON.stringify([wire], null, 2)}\n</removals>`;
    }
    return '';
  }

  function generateCopyPrompt() {
    const hasChanges = changes.length > 0;
    const hasIntents = componentIntents.length > 0;
    const collapsedReorders = buildCollapsedReorders();
    const hasReorders = collapsedReorders.length > 0;
    const removals = domRemoveEntries();
    const hasRemovals = removals.length > 0;
    if (!hasChanges && !hasIntents && !hasReorders && !hasRemovals) return 'No changes to apply.';

    // Page context inlined into the lead sentence (reads more naturally
    // than a separate "Inspector context:" label).
    let contextSuffix = '';
    try {
      const title = (targetDoc.title || '').trim();
      const path  = (targetWin.location && targetWin.location.pathname) || '';
      const bits  = [title, path].filter(Boolean);
      if (bits.length) contextSuffix = ` I'm working on **${bits.join(' · ')}**.`;
    } catch (_) {}

    // Opening line — states the ask directly. Tool-agnostic; works
    // pasted into Claude or any other assistant.
    const lead = `Please apply the edits I just made in the CSS Inspector to the source code.${contextSuffix}`;

    // Section-by-section human summary. Counts let Claude double-check
    // they processed everything in the JSON blocks below.
    const parts = [];
    if (hasChanges) {
      const lines = changes.map(c =>
        `- \`${c.selector}\`: ${c.property} ${c.from} → ${c.to}`
      );
      parts.push(`**CSS changes** (${changes.length}):\n` + lines.join('\n'));
    }
    if (hasIntents) {
      const lines = componentIntents.map(componentIntentLine);
      parts.push(`**Component changes** (${componentIntents.length}):\n` + lines.join('\n'));
    }
    if (hasReorders) {
      const lines = collapsedReorders.map(r => {
        const newOrderTexts = r.order.map(i => `"${(r.children[i] && r.children[i].text) || '—'}"`);
        return `- Reorder in \`${r.parent}\`: ${newOrderTexts.join(' → ')}`;
      });
      parts.push(`**Sibling reorders** (${collapsedReorders.length}):\n` + lines.join('\n'));
    }
    if (hasRemovals) {
      const lines = removals.map(h =>
        `- Remove \`${h.target.selector}\` (${h.target.tag}) from \`${h.parent}\``
      );
      parts.push(`**Element removals** (${removals.length}):\n` + lines.join('\n'));
    }
    const summary = parts.join('\n\n');

    // Strip internal `_parentEl` (DOM ref) from the wire payload.
    const wireReorders = collapsedReorders.map(({ _parentEl, ...rest }) => rest);
    // Removals: strip the DOM-ref so the wire payload is plain data.
    const wireRemovals = removals.map(h => ({
      action: 'remove',
      parent: h.parent,
      target: h.target,
      ancestorChain: h.ancestorChain,
    }));

    const blocks = [];
    if (hasChanges)   blocks.push(`<changes>\n${JSON.stringify(changes, null, 2)}\n</changes>`);
    if (hasIntents)   blocks.push(`<components>\n${JSON.stringify(componentIntents, null, 2)}\n</components>`);
    if (hasReorders)  blocks.push(`<reorders>\n${JSON.stringify(wireReorders, null, 2)}\n</reorders>`);
    if (hasRemovals)  blocks.push(`<removals>\n${JSON.stringify(wireRemovals, null, 2)}\n</removals>`);

    const trailer = `The structured blocks below carry the same data — use them to locate the right files and verify counts. Confirm with me before writing if anything's ambiguous.`;

    return `${lead}\n\n${summary}\n\n${trailer}\n\n${blocks.join('\n\n')}`;
  }
  function renderDisabledPreview(panel) {
    const placeholder = (label, val, unit) => `
      <div class="inspector-field">
        <span class="inspector-fi" style="color:#333;">${label}</span>
        <input value="${val}" disabled style="color:#333;">
        ${unit ? `<span class="inspector-fu" style="color:#2a2a2a;">${unit}</span>` : ''}
      </div>`;

    panel.innerHTML = `
      <div class="inspector-disabled-hint">Click <strong style="color:#666;">Select</strong> to pick an element</div>
      <div class="inspector-panel-disabled">
        <div class="inspector-section">
          <div class="inspector-section-hd"><span class="inspector-section-title" style="color:#444;">Position</span></div>
          <div class="inspector-g3" style="margin-bottom:6px;">
            ${placeholder('X','0','px')}${placeholder('Y','0','px')}${placeholder('Z','0','')}
          </div>
          <div class="inspector-row">${placeholder('∠','0','°')}</div>
        </div>
        <div class="inspector-section">
          <div class="inspector-section-hd"><span class="inspector-section-title" style="color:#444;">Layout</span></div>
          <div class="inspector-sub-label" style="margin-top:0;color:#333;">Flow</div>
          <div class="inspector-row">
            <div class="inspector-ig" style="opacity:0.3;">
              <div class="inspector-ig-btn" style="height:22px;"></div>
              <div class="inspector-ig-btn" style="height:22px;"></div>
              <div class="inspector-ig-btn" style="height:22px;"></div>
              <div class="inspector-ig-btn" style="height:22px;"></div>
            </div>
          </div>
          <div class="inspector-sub-label" style="color:#333;">Dimensions</div>
          <div class="inspector-g2" style="margin-bottom:8px;">
            ${placeholder('W','0','px')}${placeholder('H','0','px')}
          </div>
          <div class="inspector-sub-label" style="color:#333;">Padding &amp; Margin</div>
          <div class="inspector-sp-widget" style="margin-bottom:4px;">
            <div class="inspector-sp-margin">
              <span class="inspector-sp-margin-label">Margin</span>
              <div class="inspector-sv" style="grid-column:2;grid-row:1;align-self:center;color:#2a2808;">0</div>
              <div class="inspector-sv" style="grid-column:1;grid-row:2;align-self:center;justify-self:center;color:#2a2808;">0</div>
              <div class="inspector-sp-padding" style="grid-column:2;grid-row:2;">
                <span class="inspector-sp-padding-label">Padding</span>
                <div class="inspector-sv" style="grid-column:2;grid-row:1;align-self:center;color:#0a2828;">0</div>
                <div class="inspector-sv" style="grid-column:1;grid-row:2;align-self:center;justify-self:center;color:#0a2828;">0</div>
                <div class="inspector-sp-element">element</div>
                <div class="inspector-sv" style="grid-column:3;grid-row:2;align-self:center;justify-self:center;color:#0a2828;">0</div>
                <div class="inspector-sv" style="grid-column:2;grid-row:3;align-self:center;color:#0a2828;">0</div>
              </div>
              <div class="inspector-sv" style="grid-column:3;grid-row:2;align-self:center;justify-self:center;color:#2a2808;">0</div>
              <div class="inspector-sv" style="grid-column:2;grid-row:3;align-self:center;color:#2a2808;">0</div>
            </div>
          </div>
        </div>
        <div class="inspector-section">
          <div class="inspector-section-hd"><span class="inspector-section-title" style="color:#444;">Appearance</span></div>
          <div class="inspector-g2">
            ${placeholder('◎','100','%')}${placeholder('◜','0','px')}
          </div>
        </div>
        <div class="inspector-section">
          <div class="inspector-section-hd"><span class="inspector-section-title" style="color:#444;">Typography</span></div>
          <div class="inspector-row">
            <div class="inspector-field" style="flex:1;"><input value="Font family" disabled style="color:#333;"></div>
            <div class="inspector-field-sm"><input value="16" disabled style="color:#333;"><span class="inspector-fu" style="color:#2a2a2a;">px</span></div>
          </div>
          <div class="inspector-g2" style="margin-top:6px;">
            ${placeholder('','400','')}${placeholder('','1.2','')}
          </div>
        </div>
        <div class="layer-section">
          <div class="layer-section-hd"><span class="layer-section-title" style="color:#444;">Fill</span></div>
        </div>
        <div class="layer-section">
          <div class="layer-section-hd"><span class="layer-section-title" style="color:#444;">Stroke</span></div>
        </div>
        <div class="layer-section" style="border:none;">
          <div class="layer-section-hd"><span class="layer-section-title" style="color:#444;">Effects</span></div>
        </div>
      </div>`;
  }

  // ── Shared SVG icons for layer sections ──────────────────────────────────
  const SVG_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const SVG_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
  const SVG_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

  function layerRow(id, swatchColor, valueHtml, opacityVal, isHidden) {
    return `<div class="layer-row${isHidden ? ' layer-hidden' : ''}" data-layer-id="${id}">
      <div class="layer-swatch" data-layer-swatch="${id}"><div class="layer-swatch-color" style="background:${swatchColor};"></div></div>
      ${valueHtml}
      <div class="layer-opacity-field"><input value="${opacityVal}" data-layer-opacity="${id}"><span class="fu">%</span></div>
      <button class="layer-eye-btn${isHidden ? ' hidden' : ''}" data-layer-eye="${id}" data-inspector-tip="${isHidden ? 'Show layer' : 'Hide layer'}">${isHidden ? SVG_EYE_OFF : SVG_EYE}</button>
      <button class="layer-minus-btn" data-layer-remove="${id}" data-inspector-tip="Remove layer">−</button>
    </div>`;
  }

  // 3×3 alignment pad for flex / grid containers. Maps each dot to a
  // (horizontal, vertical) alignment pair, then translates to the right
  // CSS properties for the container's layout type:
  //   flex row    → col controls justify-content,  row controls align-items
  //   flex column → col controls align-items,      row controls justify-content
  //   grid        → col controls justify-items,    row controls align-items
  // So clicking the top-right dot always lands the children at the top-right
  // of the container regardless of flex direction.
  function alignmentPadAxes(cs) {
    const display = cs.display || '';
    const isGrid = display.indexOf('grid') !== -1;
    const isFlex = display.indexOf('flex') !== -1;
    if (!isGrid && !isFlex) return null;
    const colReversed = cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse';
    if (isGrid) {
      return { colProp: 'justify-items',   rowProp: 'align-items',     mode: 'grid' };
    }
    if (colReversed) {
      return { colProp: 'align-items',     rowProp: 'justify-content', mode: 'flex' };
    }
    return     { colProp: 'justify-content', rowProp: 'align-items',   mode: 'flex' };
  }

  // Map a CSS alignment value (flex-start / start / center / flex-end / end)
  // to a 0/1/2 index, or -1 for anything else (stretch, space-between, etc.).
  function alignToIdx(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'flex-start' || v === 'start' || v === 'normal') return 0;
    if (v === 'center') return 1;
    if (v === 'flex-end'   || v === 'end')   return 2;
    return -1;
  }

  // Translate a 0/1/2 index back to a CSS value appropriate for the property.
  // flex-* properties want `flex-start`/`flex-end`; grid-* / items properties
  // want bare `start`/`end`.
  function idxToValue(idx, prop) {
    const isFlexProp = prop === 'justify-content' || prop === 'align-items';
    const useFlex = isFlexProp; // both `align-items` and `justify-content` accept both forms; flex-* is the older spelling.
    if (idx === 0) return useFlex ? 'flex-start' : 'start';
    if (idx === 1) return 'center';
    if (idx === 2) return useFlex ? 'flex-end' : 'end';
    return '';
  }

  function buildAlignmentPad(cs) {
    const axes = alignmentPadAxes(cs);
    if (!axes) return '';
    const colVal = cs[axes.colProp.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    const rowVal = cs[axes.rowProp.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    const colIdx = alignToIdx(colVal);
    const rowIdx = alignToIdx(rowVal);
    let dots = '';
    const POS = ['start','center','end'];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const active = (c === colIdx && r === rowIdx);
        const tip = `${POS[c]}, ${POS[r]} (${axes.colProp}: ${idxToValue(c, axes.colProp)}, ${axes.rowProp}: ${idxToValue(r, axes.rowProp)})`;
        dots += `<button class="align-pad-dot${active ? ' active' : ''}" data-align-col="${c}" data-align-row="${r}" data-inspector-tip="${esc(tip)}"></button>`;
      }
    }
    // Caller is responsible for the section label (e.g. "Align children")
    // so this builder can be inlined into different layouts without duplicating it.
    return `
      <div class="inspector-align-pad" data-align-mode="${axes.mode}" data-col-prop="${axes.colProp}" data-row-prop="${axes.rowProp}">
        ${dots}
      </div>
    `;
  }

  function buildFillSection(cs, sel) {
    const bgColor = cs.backgroundColor;
    const hasBg = bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';
    let inheritedBg = null;
    let el = selectedElement?.parentElement;
    while (el && el !== document.documentElement) {
      const bg = targetWin.getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') { inheritedBg = bg; break; }
      el = el.parentElement;
    }
    const displayColor = hasBg ? bgColor : (inheritedBg || null);
    const hex = displayColor ? (() => { try { const c = parseColor(displayColor); return hsvToHex(c.h, c.s, c.v); } catch(e) { return ''; } })() : '';
    let rowsHtml = '';
    if (displayColor) {
      const valueHtml = `<div class="layer-value-field" data-color-prop="background-color" data-color-val="${displayColor}" style="cursor:pointer;"><input value="${hex}" readonly style="cursor:pointer;"></div>`;
      rowsHtml = layerRow('fill-0', displayColor, valueHtml, '100', false);
      if (!hasBg && inheritedBg) rowsHtml = `<div style="font-size:9px;color:#555;margin-top:6px;margin-bottom:2px;">Inherited from parent</div>` + rowsHtml;
    }
    return `<div class="layer-section" id="__layer-fill">
      <div class="layer-section-hd">
        <span class="layer-section-title">Fill</span>
        <button class="layer-add-btn" data-layer-add="fill" data-inspector-tip="Add fill layer"${hasBg ? ' disabled' : ''}>${SVG_PLUS}</button>
      </div>
      ${rowsHtml}
    </div>`;
  }

  function wireFillSection(panel, sel, cs) {
    const sec = panel.querySelector('#__layer-fill');
    if (!sec) return;
    // Color picker on hex field OR swatch
    sec.querySelectorAll('[data-color-prop]').forEach(el => {
      el.addEventListener('click', () => openColorPicker(el.dataset.colorProp, el.dataset.colorVal || cs.backgroundColor, el));
    });
    sec.querySelectorAll('.layer-swatch').forEach(sw => {
      sw.style.cursor = 'pointer';
      sw.addEventListener('click', () => {
        const field = sw.closest('.layer-row')?.querySelector('[data-color-prop]');
        if (field) openColorPicker(field.dataset.colorProp, field.dataset.colorVal || cs.backgroundColor, field);
      });
    });
    sec.querySelectorAll('[data-layer-eye]').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.layer-row');
        const isHidden = row.classList.toggle('layer-hidden');
        btn.classList.toggle('hidden', isHidden);
        btn.innerHTML = isHidden ? SVG_EYE_OFF : SVG_EYE;
        if (isHidden) {
          // Snapshot the current color before hiding
          const current = selectedElement ? targetWin.getComputedStyle(selectedElement).backgroundColor : cs.backgroundColor;
          row.dataset.savedColor = current;
          if (selectedElement) selectedElement.style.backgroundColor = 'transparent';
          trackChange(sel, 'background-color', current, 'transparent');
        } else {
          const restore = row.dataset.savedColor || cs.backgroundColor;
          if (selectedElement) selectedElement.style.backgroundColor = restore;
          trackChange(sel, 'background-color', 'transparent', restore);
          // Update the swatch and value field to reflect restored color
          const swatchColor = sec.querySelector('.layer-swatch-color');
          if (swatchColor) swatchColor.style.background = restore;
          const valueInput = sec.querySelector('.layer-value-field input');
          if (valueInput) { try { const c = parseColor(restore); valueInput.value = hsvToHex(c.h, c.s, c.v); } catch(e){} }
        }
      });
    });
    const addBtn = sec.querySelector('[data-layer-add="fill"]');
    sec.querySelectorAll('[data-layer-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.layer-row')?.remove();
        if (selectedElement) selectedElement.style.removeProperty('background-color');
        trackChange(sel, 'background-color', cs.backgroundColor, '');
        if (addBtn) addBtn.disabled = false;
      });
    });
    addBtn?.addEventListener('click', () => {
      if (sec.querySelector('.layer-row')) return;
      const defaultColor = 'rgba(255,255,255,1)';
      const hex = 'ffffff';
      const valueHtml = `<div class="layer-value-field" data-color-prop="background-color" data-color-val="${defaultColor}" style="cursor:pointer;"><input value="${hex}" readonly style="cursor:pointer;"></div>`;
      sec.insertAdjacentHTML('beforeend', layerRow('fill-0', defaultColor, valueHtml, '100', false));
      addBtn.disabled = true;
      wireFillSection(panel, sel, cs);
    });
  }

  function buildStrokeSection(cs, sel) {
    // Check individual sides — shorthand cs.borderStyle is 'none' if sides differ (e.g. border-bottom only)
    const effectiveStyle = cs.borderStyle !== 'none' ? cs.borderStyle :
      [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle].find(s => s && s !== 'none') || 'none';
    const effectiveWidth = cs.borderWidth && cs.borderWidth !== '0px' ? cs.borderWidth :
      [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].find(w => w && w !== '0px') || '0px';
    const hasBorder = effectiveStyle !== 'none' && effectiveWidth !== '0px';
    let rowsHtml = '';
    if (hasBorder) {
      const hex = (() => { try { const c = parseColor(cs.borderColor); return hsvToHex(c.h, c.s, c.v); } catch(e) { return ''; } })();
      const valueHtml = `<div class="layer-value-field" data-color-prop="border-color" data-color-val="${cs.borderColor}" style="cursor:pointer;"><input value="${hex}" readonly style="cursor:pointer;"></div>`;
      rowsHtml = layerRow('stroke-0', cs.borderColor, valueHtml, '100', false);
      rowsHtml += buildStrokeDetail(sel, effectiveWidth, effectiveStyle);
    }
    return `<div class="layer-section" id="__layer-stroke">
      <div class="layer-section-hd">
        <span class="layer-section-title">Stroke</span>
        <button class="layer-add-btn" data-layer-add="stroke" data-inspector-tip="Add stroke"${hasBorder ? ' disabled' : ''}>${SVG_PLUS}</button>
      </div>
      ${rowsHtml}
    </div>`;
  }

  function buildStrokeDetail(sel, width, style) {
    const w = parseFloat(width) || 1;
    const s = style || 'solid';
    return `<div class="layer-detail" id="__layer-stroke-detail">
      <div class="layer-detail-row">
        <span class="layer-detail-label">Width</span>
        <div class="layer-detail-field"><input value="${w}" data-prop="border-width" data-sel="${sel}" data-from="${width || '0px'}"><span class="fu">px</span></div>
        <div class="layer-detail-field" style="flex:1;">
          <select style="width:100%;background:none;border:none;outline:none;color:#ccc;font-size:10px;font-family:Inter,system-ui,sans-serif;" data-prop="border-style" data-sel="${sel}" data-from="${s}">
            <option${s==='solid'?' selected':''}>solid</option>
            <option${s==='dashed'?' selected':''}>dashed</option>
            <option${s==='dotted'?' selected':''}>dotted</option>
            <option${s==='double'?' selected':''}>double</option>
          </select>
        </div>
      </div>
    </div>`;
  }

  // ── Standard: scrub + keyboard for any .layer-detail-field input ──────────
  // Call this on any container that has .layer-detail-field inputs.
  // onLiveChange() is called after every value update for immediate preview.
  function wireDetailInputs(container, onLiveChange) {
    container.querySelectorAll('.layer-detail-field input').forEach(inp => {
      if (inp.dataset._wired) return;
      inp.dataset._wired = '1';
      const lbl = inp.parentElement?.querySelector('.lbl');
      const getUnit = () => inp.parentElement?.querySelector('.fu')?.textContent || '';

      const notify = () => { if (onLiveChange) onLiveChange(); };

      // Up/Down arrow keys
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const cur = parseFloat(inp.value) || 0;
        const unit = getUnit();
        let newVal = Math.round((e.key === 'ArrowUp' ? cur + step : cur - step) * 10) / 10;
        if (unit === '%') newVal = Math.min(100, Math.max(0, newVal));
        inp.value = String(newVal);
        notify();
      });

      // Scrub — on .lbl label (no threshold), or on input itself (3px threshold)
      const scrubEl = lbl || inp;
      const needsThreshold = !lbl;
      scrubEl.addEventListener('mousedown', (e) => {
        const startX = e.clientX;
        const startVal = parseFloat(inp.value) || 0;
        let dragging = false;

        function onMove(e) {
          const delta = e.clientX - startX;
          if (!dragging) {
            if (needsThreshold && Math.abs(delta) < 3) return;
            dragging = true;
            suppressIframePointerEvents(true);
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
          }
          const unit = getUnit();
          let newVal = Math.round((startVal + delta * (e.shiftKey ? 10 : 1)) * 10) / 10;
          if (unit === '%') newVal = Math.min(100, Math.max(0, newVal));
          inp.value = String(newVal);
          notify();
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (dragging) {
            suppressIframePointerEvents(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            notify();
          }
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        if (lbl) e.preventDefault(); // prevent label text selection; allow input focus
      });

      // Blur/change: commit after typing
      inp.addEventListener('change', notify);
    });
  }

  function wireStrokeSection(panel, sel, cs) {
    const sec = panel.querySelector('#__layer-stroke');
    if (!sec) return;
    const addBtn = sec.querySelector('[data-layer-add="stroke"]');

    sec.querySelectorAll('[data-color-prop]').forEach(el => {
      if (el.dataset._wired) return;
      el.dataset._wired = '1';
      el.addEventListener('click', () => openColorPicker(el.dataset.colorProp, el.dataset.colorVal || cs.borderColor, el));
    });
    sec.querySelectorAll('.layer-swatch').forEach(sw => {
      if (sw.dataset._wired) return;
      sw.dataset._wired = '1';
      sw.style.cursor = 'pointer';
      sw.addEventListener('click', () => {
        const field = sw.closest('.layer-row')?.querySelector('[data-color-prop]');
        if (field) openColorPicker(field.dataset.colorProp, field.dataset.colorVal || cs.borderColor, field);
      });
    });
    sec.querySelectorAll('[data-layer-eye]').forEach(btn => {
      if (btn.dataset._wired) return;
      btn.dataset._wired = '1';
      btn.addEventListener('click', () => {
        const row = btn.closest('.layer-row');
        const isHidden = row.classList.toggle('layer-hidden');
        btn.classList.toggle('hidden', isHidden);
        btn.innerHTML = isHidden ? SVG_EYE_OFF : SVG_EYE;
        if (isHidden) {
          const currentStyle = selectedElement ? targetWin.getComputedStyle(selectedElement).borderStyle : cs.borderStyle;
          const currentColor = selectedElement ? targetWin.getComputedStyle(selectedElement).borderColor : cs.borderColor;
          row.dataset.savedBorderStyle = currentStyle || 'solid';
          row.dataset.savedBorderColor = currentColor || '#000000';
          if (selectedElement) selectedElement.style.borderStyle = 'none';
          trackChange(sel, 'border-style', currentStyle, 'none');
        } else {
          const restoreStyle = row.dataset.savedBorderStyle || cs.borderStyle || 'solid';
          const restoreColor = row.dataset.savedBorderColor || cs.borderColor;
          if (selectedElement) { selectedElement.style.borderStyle = restoreStyle; if (restoreColor) selectedElement.style.borderColor = restoreColor; }
          trackChange(sel, 'border-style', 'none', restoreStyle);
          const swatchColor = sec.querySelector('.layer-swatch-color');
          if (swatchColor && restoreColor) swatchColor.style.background = restoreColor;
        }
      });
    });
    sec.querySelectorAll('[data-layer-remove]').forEach(btn => {
      if (btn.dataset._wired) return;
      btn.dataset._wired = '1';
      btn.addEventListener('click', () => {
        sec.querySelector('.layer-row')?.remove();
        sec.querySelector('#__layer-stroke-detail')?.remove();
        if (selectedElement) { selectedElement.style.removeProperty('border-style'); selectedElement.style.removeProperty('border-width'); }
        trackChange(sel, 'border-style', cs.borderStyle, 'none');
        if (addBtn) addBtn.disabled = false;
      });
    });

    // Wire width input (scrub + keyboard) and style select
    const detail = sec.querySelector('#__layer-stroke-detail');
    if (detail) {
      wireDetailInputs(detail, () => {
        const widthInput = detail.querySelector('input[data-prop="border-width"]');
        if (widthInput && selectedElement) {
          const val = widthInput.value + 'px';
          selectedElement.style.borderWidth = val;
          trackChange(sel, 'border-width', widthInput.dataset.from, val);
        }
      });
      const styleSelect = detail.querySelector('select[data-prop="border-style"]');
      if (styleSelect && !styleSelect.dataset._wired) {
        styleSelect.dataset._wired = '1';
        styleSelect.addEventListener('change', () => {
          if (selectedElement) selectedElement.style.borderStyle = styleSelect.value;
          trackChange(sel, 'border-style', styleSelect.dataset.from, styleSelect.value);
        });
      }
    }

    if (addBtn && !addBtn.dataset._wired) {
      addBtn.dataset._wired = '1';
      addBtn.addEventListener('click', () => {
        if (sec.querySelector('.layer-row')) return;
        const defaultColor = '#000000';
        const valueHtml = `<div class="layer-value-field" data-color-prop="border-color" data-color-val="${defaultColor}" style="cursor:pointer;"><input value="000000" readonly style="cursor:pointer;"></div>`;
        sec.insertAdjacentHTML('beforeend', layerRow('stroke-0', defaultColor, valueHtml, '100', false) + buildStrokeDetail(sel, '1px', 'solid'));
        if (selectedElement) { selectedElement.style.borderStyle = 'solid'; selectedElement.style.borderWidth = '1px'; selectedElement.style.borderColor = defaultColor; }
        addBtn.disabled = true;
        wireStrokeSection(panel, sel, cs);
      });
    }
  }

  function buildEffectDetail(id, typeLabel) {
    if (typeLabel === 'Drop shadow' || typeLabel === 'Inner shadow') {
      return `<div class="layer-detail-row"><span class="layer-detail-label">Position</span><div class="layer-detail-g2"><div class="layer-detail-field"><span class="lbl">X</span><input value="0" data-effect-param="x"><span class="fu">px</span></div><div class="layer-detail-field"><span class="lbl">Y</span><input value="4" data-effect-param="y"><span class="fu">px</span></div></div></div>
      <div class="layer-detail-row"><span class="layer-detail-label">Blur</span><div class="layer-detail-field"><input value="12" data-effect-param="blur"><span class="fu">px</span></div></div>
      <div class="layer-detail-row"><span class="layer-detail-label">Spread</span><div class="layer-detail-field"><input value="0" data-effect-param="spread"><span class="fu">px</span></div></div>
      <div class="layer-detail-row"><span class="layer-detail-label">Color</span><div class="layer-detail-color-row"><div class="layer-detail-swatch" data-color-prop="box-shadow-color" data-color-val="rgba(0,0,0,0.25)"><div class="layer-detail-swatch-c" style="background:rgba(0,0,0,0.25);"></div></div><div class="layer-detail-hex"><input value="000000" data-effect-param="color"></div><div class="layer-detail-opacity"><input value="25" data-effect-param="opacity"><span class="fu">%</span></div></div></div>`;
    }
    return `<div class="layer-detail-row"><span class="layer-detail-label">Blur</span><div class="layer-detail-field"><input value="4" data-effect-param="blur"><span class="fu">px</span></div></div>`;
  }

  function effectRow(id, swatchColor, typeLabel, isHidden) {
    const types = ['Drop shadow', 'Inner shadow', 'Layer blur', 'Background blur'];
    const opts = types.map(t => `<option${t === typeLabel ? ' selected' : ''}>${t}</option>`).join('');
    return `<div class="layer-row${isHidden ? ' layer-hidden' : ''}" data-layer-id="${id}" data-effect-type="${typeLabel}">
      <div class="layer-swatch"><div class="layer-swatch-color" style="background:${swatchColor};"></div></div>
      <div class="layer-type-dd"><select style="background:none;border:none;outline:none;color:#ccc;font-size:11px;font-family:Inter,system-ui,sans-serif;width:100%;cursor:pointer;">${opts}</select><span class="layer-dd-arrow">▾</span></div>
      <button class="layer-eye-btn${isHidden ? ' hidden' : ''}" data-layer-eye="${id}" data-inspector-tip="Toggle effect">${isHidden ? SVG_EYE_OFF : SVG_EYE}</button>
      <button class="layer-minus-btn" data-layer-remove="${id}" data-inspector-tip="Remove effect">−</button>
    </div>
    <div class="layer-detail" id="__effect-detail-${id}" style="display:none;">${buildEffectDetail(id, typeLabel)}</div>`;
  }

  function applyEffectFromDetail(id, typeLabel, panel, sel) {
    const detail = panel.querySelector(`#__effect-detail-${id}`);
    if (!detail || !selectedElement) return;
    const get = (p) => parseFloat(detail.querySelector(`[data-effect-param="${p}"]`)?.value || 0);
    if (typeLabel === 'Drop shadow' || typeLabel === 'Inner shadow') {
      const x = get('x'), y = get('y'), blur = get('blur'), spread = get('spread'), opacity = get('opacity') / 100;
      const inset = typeLabel === 'Inner shadow' ? 'inset ' : '';
      const val = `${inset}${x}px ${y}px ${blur}px ${spread}px rgba(0,0,0,${opacity.toFixed(2)})`;
      selectedElement.style.boxShadow = val;
      trackChange(sel, 'box-shadow', 'none', val);
    } else if (typeLabel === 'Layer blur') {
      const val = `blur(${get('blur')}px)`;
      selectedElement.style.filter = val;
      trackChange(sel, 'filter', 'none', val);
    } else if (typeLabel === 'Background blur') {
      const val = `blur(${get('blur')}px)`;
      selectedElement.style.backdropFilter = val;
      trackChange(sel, 'backdrop-filter', 'none', val);
    }
  }

  function buildEffectsSection(cs, sel) {
    const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
    const hasFilter = cs.filter && cs.filter !== 'none';
    const hasBackdrop = cs.backdropFilter && cs.backdropFilter !== 'none';
    let rowsHtml = '';
    if (hasShadow) rowsHtml += effectRow('fx-shadow-0', 'rgba(0,0,0,0.25)', 'Drop shadow', false);
    if (hasFilter) rowsHtml += effectRow('fx-filter-0', 'rgba(148,163,184,0.2)', 'Layer blur', false);
    if (hasBackdrop) rowsHtml += effectRow('fx-backdrop-0', 'rgba(148,163,184,0.15)', 'Background blur', false);
    return `<div class="layer-section" id="__layer-effects">
      <div class="layer-section-hd">
        <span class="layer-section-title">Effects</span>
        <button class="layer-add-btn" data-layer-add="effect" data-inspector-tip="Add effect">${SVG_PLUS}</button>
      </div>
      ${rowsHtml}
    </div>`;
  }

  function wireEffectDetail(id, panel, sel, getType) {
    const detail = panel.querySelector(`#__effect-detail-${id}`);
    if (!detail) return;
    // scrub + keyboard on all numeric inputs
    wireDetailInputs(detail, () => applyEffectFromDetail(id, getType(), panel, sel));
    // color pickers
    if (!detail.dataset._colorWired) {
      detail.dataset._colorWired = '1';
      detail.querySelectorAll('[data-color-prop]').forEach(el => {
        el.addEventListener('click', () => openColorPicker(el.dataset.colorProp, el.dataset.colorVal, el));
      });
      detail.querySelectorAll('.layer-detail-swatch').forEach(sw => {
        sw.style.cursor = 'pointer';
        sw.addEventListener('click', () => {
          const field = sw.closest('.layer-detail-color-row')?.querySelector('[data-color-prop]');
          if (field) openColorPicker(field.dataset.colorProp, field.dataset.colorVal, field);
        });
      });
    }
  }

  function wireEffectsSection(panel, sel, cs) {
    const sec = panel.querySelector('#__layer-effects');
    if (!sec) return;

    sec.querySelectorAll('.layer-row').forEach(row => {
      if (row.dataset._wired) return;
      row.dataset._wired = '1';
      const id = row.dataset.layerId;
      const detail = panel.querySelector(`#__effect-detail-${id}`);
      const getType = () => row.dataset.effectType;

      // Click row to toggle detail
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('select')) return;
        if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
      });

      // Swatch toggles detail
      row.querySelector('.layer-swatch')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
      });

      // Wire detail inputs (scrub + keyboard + color pickers)
      wireEffectDetail(id, panel, sel, getType);

      // Type change dropdown — rebuild detail and re-wire
      const ddSelect = row.querySelector('select');
      if (ddSelect) {
        ddSelect.addEventListener('change', () => {
          row.dataset.effectType = ddSelect.value;
          if (detail) {
            detail.innerHTML = buildEffectDetail(id, ddSelect.value);
            delete detail.dataset._colorWired;
            detail.querySelectorAll('input').forEach(i => delete i.dataset._wired);
            detail.style.display = 'block';
            wireEffectDetail(id, panel, sel, getType);
            applyEffectFromDetail(id, ddSelect.value, panel, sel);
          }
        });
      }

      // Eye toggle
      row.querySelector(`[data-layer-eye]`)?.addEventListener('click', () => {
        const isHidden = row.classList.toggle('layer-hidden');
        const eyeBtn = row.querySelector(`[data-layer-eye]`);
        eyeBtn?.classList.toggle('hidden', isHidden);
        if (eyeBtn) eyeBtn.innerHTML = isHidden ? SVG_EYE_OFF : SVG_EYE;
        const typeLabel = getType();
        if (selectedElement) {
          if (typeLabel === 'Drop shadow' || typeLabel === 'Inner shadow') { selectedElement.style.boxShadow = isHidden ? 'none' : cs.boxShadow; trackChange(sel, 'box-shadow', cs.boxShadow, isHidden ? 'none' : cs.boxShadow); }
          else if (typeLabel === 'Layer blur') { selectedElement.style.filter = isHidden ? 'none' : cs.filter; trackChange(sel, 'filter', cs.filter, isHidden ? 'none' : cs.filter); }
          else if (typeLabel === 'Background blur') { selectedElement.style.backdropFilter = isHidden ? 'none' : cs.backdropFilter; trackChange(sel, 'backdrop-filter', cs.backdropFilter, isHidden ? 'none' : cs.backdropFilter); }
        }
      });

      // Remove
      row.querySelector(`[data-layer-remove]`)?.addEventListener('click', () => {
        const typeLabel = getType();
        panel.querySelector(`#__effect-detail-${id}`)?.remove();
        row.remove();
        if (selectedElement) {
          if (typeLabel === 'Drop shadow' || typeLabel === 'Inner shadow') { selectedElement.style.removeProperty('box-shadow'); trackChange(sel, 'box-shadow', cs.boxShadow, 'none'); }
          else if (typeLabel === 'Layer blur') { selectedElement.style.removeProperty('filter'); trackChange(sel, 'filter', cs.filter, 'none'); }
          else if (typeLabel === 'Background blur') { selectedElement.style.removeProperty('backdrop-filter'); trackChange(sel, 'backdrop-filter', cs.backdropFilter, 'none'); }
        }
      });
    });

    // Add effect — apply defaults immediately and auto-show detail
    const addBtn = sec.querySelector('[data-layer-add="effect"]');
    if (addBtn && !addBtn.dataset._wired) {
      addBtn.dataset._wired = '1';
      addBtn.addEventListener('click', () => {
        const id = 'fx-new-' + Date.now();
        sec.insertAdjacentHTML('beforeend', effectRow(id, 'rgba(0,0,0,0.25)', 'Drop shadow', false));
        const detail = panel.querySelector(`#__effect-detail-${id}`);
        if (detail) detail.style.display = 'block';
        // Apply defaults immediately so the user sees the effect
        if (selectedElement) {
          const val = '0px 4px 12px 0px rgba(0,0,0,0.25)';
          selectedElement.style.boxShadow = val;
          trackChange(sel, 'box-shadow', 'none', val);
        }
        wireEffectsSection(panel, sel, cs);
      });
    }
  }

  function buildFontOptions(currentFont) {
    const POPULAR_FONTS = [
      'Inter','Roboto','Open Sans','Lato','Montserrat','Poppins','Raleway',
      'Oswald','Merriweather','Playfair Display','Source Sans Pro','Nunito',
      'Rubik','Work Sans','DM Sans','Plus Jakarta Sans','Outfit','Figtree',
      'Geist','Space Grotesk'
    ];

    // Get fonts loaded on the page
    const loadedFonts = [];
    try {
      const seen = new Set();
      document.fonts.forEach(f => {
        const name = f.family.replace(/['"]/g, '');
        if (!seen.has(name)) { seen.add(name); loadedFonts.push(name); }
      });
    } catch(e) {}

    // Merge: loaded first, then popular (deduplicated)
    const allFonts = [...new Set([...loadedFonts, ...POPULAR_FONTS])];
    const current = currentFont.split(',')[0].replace(/['"]/g, '').trim();

    // Build <option> groups
    let options = '';
    if (loadedFonts.length) {
      options += `<optgroup label="Page fonts">`;
      loadedFonts.forEach(f => {
        options += `<option${f === current ? ' selected' : ''}>${f}</option>`;
      });
      options += `</optgroup>`;
    }
    options += `<optgroup label="Popular fonts">`;
    POPULAR_FONTS.filter(f => !loadedFonts.includes(f)).forEach(f => {
      options += `<option${f === current ? ' selected' : ''}>${f}</option>`;
    });
    options += `</optgroup>`;

    // If current font isn't in either list, add it at top
    if (!allFonts.includes(current) && current) {
      options = `<option selected>${current}</option>` + options;
    }

    return options;
  }

  function loadGoogleFont(fontName) {
    const id = `__inspector-gfont-${fontName.replace(/\s/g, '-')}`;
    if (document.getElementById(id)) return; // already loaded
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;500;600&display=swap`;
    document.head.appendChild(link);
  }

  function renderDesignPanel() {
    const panel = root.querySelector('#__inspector-panel-design');
    if (!selectedElement) {
      renderDisabledPreview(panel);
      return;
    }
    const sel = computeSelector(selectedElement);
    const cs = targetWin.getComputedStyle(selectedElement);

    function field(label, property, value, unit) {
      const unitHtml = unit ? `<span class="inspector-fu">${unit}</span>` : '';
      const tip = TIPS[property] || property;
      return `<div class="inspector-field" data-prop="${property}">
        <span class="inspector-fi" data-scrub="${property}" data-inspector-tip="${tip}">${label}</span>
        <input value="${value}" data-prop="${property}" data-sel="${sel}" data-from="${value}">
        ${unitHtml}
        <button class="inspector-reset-btn" data-reset="${property}" data-inspector-tip="Reset ${property} to original value">×</button>
      </div>`;
    }

    function iconField(svgHtml, property, value, unit) {
      const unitHtml = unit ? `<span class="inspector-fu">${unit}</span>` : '';
      const tip = TIPS[property] || property;
      return `<div class="inspector-field" data-prop="${property}">
        <span class="inspector-fi" data-scrub="${property}" data-inspector-tip="${tip}">${svgHtml}</span>
        <input value="${value}" data-prop="${property}" data-sel="${sel}" data-from="${value}">
        ${unitHtml}
        <button class="inspector-reset-btn" data-reset="${property}" data-inspector-tip="Reset ${property} to original value">×</button>
      </div>`;
    }

    function selectField(label, property, value, options) {
      const opts = options.map(o => `<option${o === value ? ' selected' : ''}>${o}</option>`).join('');
      return `<div class="inspector-field" data-prop="${property}">
        ${label ? `<span class="inspector-fi">${label}</span>` : ''}
        <select data-prop="${property}" data-sel="${sel}" data-from="${value}">${opts}</select>
      </div>`;
    }

    function colorField(property, value) {
      const hex = (() => {
        try { const c = parseColor(value); return hsvToHex(c.h, c.s, c.v); } catch(e) { return value; }
      })();
      return `<div class="inspector-color-field" data-color-prop="${property}" data-color-val="${value}" style="cursor:pointer;">
        <div class="inspector-color-swatch" style="background:${value}" data-prop="${property}"></div>
        <span style="flex:1;font-size:11px;color:#888;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hex}</span>
      </div>`;
    }

    const icons = {
      opacity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
      radius: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 L3 9 Q3 3 9 3 L20 3"/></svg>',
      lineHeight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="13" x="3" y="8" rx="1"/><path d="m15 2-3 3-3-3"/><rect width="7" height="13" x="14" y="8" rx="1"/></svg>',
      letterSpacing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 16 2.536-7.328a1.02 1.02 0 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/></svg>',
      flipH: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/></svg>',
      flipV: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/></svg>',
      reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    };

    const pxStr = (v) => { const n = parseFloat(v); return isNaN(n) ? v : String(Math.round(n)); };

    // ── POSITION ──
    const positionHtml = `
      <div class="inspector-section">
        <div class="inspector-section-hd" style="cursor:pointer;" data-collapse="section">
          <span class="inspector-section-title">Position</span>
          <button class="inspector-section-chevron" data-inspector-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="inspector-g3" style="margin-bottom:6px;">
          ${field('X', 'left', pxStr(cs.left), 'px')}
          ${field('Y', 'top', pxStr(cs.top), 'px')}
          ${field('Z', 'z-index', cs.zIndex === 'auto' ? '0' : cs.zIndex, '')}
        </div>
        <div class="inspector-row">
          ${iconField('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>', 'rotate', '0', '°')}
          <div class="inspector-ig" style="flex:1;padding:2px;gap:2px;">
            <button class="inspector-ig-btn" data-action="reset" data-inspector-tip="${TIPS['reset']}">${icons.reset}</button>
            <button class="inspector-ig-btn" data-action="flipH" data-inspector-tip="${TIPS['flipH']}">${icons.flipH}</button>
            <button class="inspector-ig-btn" data-action="flipV" data-inspector-tip="${TIPS['flipV']}">${icons.flipV}</button>
          </div>
        </div>
      </div>`;

    // ── LAYOUT ──
    const flowIcons = {
      row: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>',
      col: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/></svg>',
      wrap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16-3 3 3 3"/><path d="M3 12h14.5a1 1 0 0 1 0 7H13"/><path d="M3 19h6"/><path d="M3 5h18"/></svg>',
      grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
    };
    const display = cs.display;
    const flexDir = cs.flexDirection;
    const isRow = display.includes('flex') && flexDir === 'row';
    const isCol = display.includes('flex') && flexDir === 'column';
    const isWrap = cs.flexWrap === 'wrap';
    const isGrid = display === 'grid';
    const mt = pxStr(cs.marginTop), mr = pxStr(cs.marginRight), mb = pxStr(cs.marginBottom), ml = pxStr(cs.marginLeft);
    const pt = pxStr(cs.paddingTop), pr = pxStr(cs.paddingRight), pb = pxStr(cs.paddingBottom), pl = pxStr(cs.paddingLeft);

    // Build the 3×3 child-alignment pad — only renders when the picked
    // element is a flex/grid container. Maps screen-position dots to
    // (justify-content, align-items) — for flex-column, the axes swap so
    // the dot's visual position always matches the resulting layout.
    const alignPadHtml = buildAlignmentPad(cs);

    // Gap values (only meaningful for flex/grid; fields are hidden otherwise).
    const cg = pxStr(cs.columnGap);
    const rg = pxStr(cs.rowGap);

    // Figma-style shorthand SVGs for the compact controls.
    const SVG_GAP_COL = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="3" y1="2.5" x2="3" y2="11.5"/><line x1="11" y1="2.5" x2="11" y2="11.5"/><line x1="6" y1="7" x2="8" y2="7" stroke-dasharray="1.5 1"/></svg>';
    const SVG_GAP_ROW = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="2.5" y1="3" x2="11.5" y2="3"/><line x1="2.5" y1="11" x2="11.5" y2="11"/><line x1="7" y1="6" x2="7" y2="8" stroke-dasharray="1.5 1"/></svg>';
    const SVG_PAD_X = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="4.5" y="3" width="5" height="8" rx="0.8"/><line x1="2" y1="2.5" x2="2" y2="11.5"/><line x1="12" y1="2.5" x2="12" y2="11.5"/></svg>';
    const SVG_PAD_Y = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="3" y="4.5" width="8" height="5" rx="0.8"/><line x1="2.5" y1="2" x2="11.5" y2="2"/><line x1="2.5" y1="12" x2="11.5" y2="12"/></svg>';

    // Compact padding shorthand: padding-x (left+right) and padding-y
    // (top+bottom). Uses synthetic data-prop names that wireUpInputs
    // expands to two real CSS properties. data-from-a / data-from-b
    // carry the original values for each side so trackChange records
    // both sides correctly even after multiple edits.
    function paddingShort(axis, valA, valB) {
      const icon = axis === 'x' ? SVG_PAD_X : SVG_PAD_Y;
      const mixed = valA !== valB;
      const displayed = mixed ? '' : valA;
      const propName = `padding-${axis}`;
      const tip = `Padding ${axis === 'x' ? 'left + right' : 'top + bottom'} (drag to scrub)`;
      return `<div class="inspector-field" data-prop="${propName}">
        <span class="inspector-fi" data-scrub="${propName}" data-inspector-tip="${tip}">${icon}</span>
        <input value="${displayed}" ${mixed ? 'placeholder="Mixed"' : ''} data-prop="${propName}" data-sel="${sel}" data-from="${valA}" data-from-a="${valA}" data-from-b="${valB}">
        <span class="inspector-fu">px</span>
        <button class="inspector-reset-btn" data-reset="${propName}" data-inspector-tip="Reset to original">×</button>
      </div>`;
    }

    const layoutHtml = `
      <div class="inspector-section">
        <div class="inspector-section-hd" style="cursor:pointer;" data-collapse="section">
          <span class="inspector-section-title">Layout</span>
          <button class="inspector-section-chevron" data-inspector-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>

        <div class="inspector-sub-label" style="margin-top:0;">Flow</div>
        <div class="inspector-row"><div class="inspector-ig">
          <button class="inspector-ig-btn${isRow ? ' on' : ''}" data-flow="row" data-inspector-tip="${TIPS['row']}">${flowIcons.row}</button>
          <button class="inspector-ig-btn${isCol ? ' on' : ''}" data-flow="column" data-inspector-tip="${TIPS['column']}">${flowIcons.col}</button>
          <button class="inspector-ig-btn${isWrap ? ' on' : ''}" data-flow="wrap" data-inspector-tip="${TIPS['wrap']}">${flowIcons.wrap}</button>
          <button class="inspector-ig-btn${isGrid ? ' on' : ''}" data-flow="grid" data-inspector-tip="${TIPS['grid']}">${flowIcons.grid}</button>
        </div></div>

        <!-- Dimensions: always full-width, two columns -->
        <div class="inspector-sub-label">Dimensions</div>
        <div class="inspector-g2" style="margin-bottom:8px;">
          ${field('W', 'width',  pxStr(cs.width),  'px')}
          ${field('H', 'height', pxStr(cs.height), 'px')}
        </div>

        ${alignPadHtml
          ? `<div class="inspector-layout-split">
               <div class="inspector-layout-half">
                 <div class="inspector-sub-label" style="margin-top:0;">Align children</div>
                 ${alignPadHtml}
               </div>
               <div class="inspector-layout-half">
                 <div class="inspector-sub-label" style="margin-top:0;">Gap</div>
                 <div class="inspector-stack-v">
                   ${iconField(SVG_GAP_COL, 'column-gap', cg, 'px')}
                   ${iconField(SVG_GAP_ROW, 'row-gap',    rg, 'px')}
                 </div>
               </div>
             </div>`
          : ''}

        <!-- Compact padding row: x | y | corner-brackets icon. Two distinct
             affordances on this row:
             • "Show margins box" link (in the label above) toggles the
               orange/teal margin+padding diagram below.
             • Corner-brackets icon (right of the padding-y field) toggles
               the individual per-side padding fields (↑ → ↓ ←). -->
        <div class="inspector-sub-label">
          <span>Padding</span>
          <button class="inspector-expand-link" data-expand="box" data-inspector-tip="Show the full margin + padding diagram">Show margins box</button>
        </div>
        <div class="inspector-padding-row" style="margin-bottom:8px;">
          ${paddingShort('x', pl, pr)}
          ${paddingShort('y', pt, pb)}
          <button class="inspector-padding-individual-btn" data-expand="individual" data-inspector-tip="Edit each side individually" aria-label="Individual padding sides">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 5.5V2.5h3"/>
              <path d="M10.5 2.5h3v3"/>
              <path d="M13.5 10.5v3h-3"/>
              <path d="M5.5 13.5h-3v-3"/>
            </svg>
          </button>
        </div>

        <!-- Individual padding (per-side) — toggled by the corner-brackets
             icon. Laid out so each column aligns under the compact field
             that controls those sides:
               col 1 (under padding-x): ← (left) over → (right)
               col 2 (under padding-y): ↑ (top) over ↓ (bottom)
             Each compact-x/y field becomes a vertically-stacked pair. -->
        <div id="__inspector-padding-individual" style="display:none;margin-bottom:8px;">
          <div class="inspector-g2">
            <div class="inspector-stack-v">
              ${field('←', 'padding-left',   pl, 'px')}
              ${field('→', 'padding-right',  pr, 'px')}
            </div>
            <div class="inspector-stack-v">
              ${field('↑', 'padding-top',    pt, 'px')}
              ${field('↓', 'padding-bottom', pb, 'px')}
            </div>
          </div>
        </div>

        <!-- Margins box (orange/teal diagram, editable margins + paddings)
             — toggled by the "Show margins box" text link above. -->
        <div id="__inspector-margins-box" style="display:none;">
          <div class="inspector-sp-widget" style="margin-bottom:8px;">
            <div class="inspector-sp-margin">
              <span class="inspector-sp-margin-label">Margin</span>
              <div class="inspector-sv" style="grid-column:2;grid-row:1;align-self:center;"><input value="${mt}" data-prop="margin-top" data-sel="${sel}" data-from="${mt}"></div>
              <div class="inspector-sv" style="grid-column:1;grid-row:2;align-self:center;justify-self:center;"><input value="${ml}" data-prop="margin-left" data-sel="${sel}" data-from="${ml}"></div>
              <div class="inspector-sp-padding" style="grid-column:2;grid-row:2;">
                <span class="inspector-sp-padding-label">Padding</span>
                <div class="inspector-sv" style="grid-column:2;grid-row:1;align-self:center;"><input value="${pt}" data-prop="padding-top" data-sel="${sel}" data-from="${pt}"></div>
                <div class="inspector-sv" style="grid-column:1;grid-row:2;align-self:center;justify-self:center;"><input value="${pl}" data-prop="padding-left" data-sel="${sel}" data-from="${pl}"></div>
                <div class="inspector-sp-element">element</div>
                <div class="inspector-sv" style="grid-column:3;grid-row:2;align-self:center;justify-self:center;"><input value="${pr}" data-prop="padding-right" data-sel="${sel}" data-from="${pr}"></div>
                <div class="inspector-sv" style="grid-column:2;grid-row:3;align-self:center;"><input value="${pb}" data-prop="padding-bottom" data-sel="${sel}" data-from="${pb}"></div>
              </div>
              <div class="inspector-sv" style="grid-column:3;grid-row:2;align-self:center;justify-self:center;"><input value="${mr}" data-prop="margin-right" data-sel="${sel}" data-from="${mr}"></div>
              <div class="inspector-sv" style="grid-column:2;grid-row:3;align-self:center;"><input value="${mb}" data-prop="margin-bottom" data-sel="${sel}" data-from="${mb}"></div>
            </div>
          </div>
        </div>
        <div class="inspector-check-pair">
          <div class="inspector-check-row" data-check="overflow" data-inspector-tip="Clip content — overflow: hidden clips content outside the element bounds">
            <div class="inspector-check-box${cs.overflow === 'hidden' ? ' on' : ''}">
              <svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
            </div>
            <span class="inspector-check-label">Clip content</span>
          </div>
          <div class="inspector-check-row" data-check="box-sizing" data-inspector-tip="Border box — box-sizing: border-box makes width/height include padding and border">
            <div class="inspector-check-box${cs.boxSizing === 'border-box' ? ' on' : ''}">
              <svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
            </div>
            <span class="inspector-check-label">Border box</span>
          </div>
        </div>
      </div>`;

    // ── APPEARANCE ──
    // Radius first, opacity second (matches the Figma reading order).
    // Below them: a split-button row for element-level actions —
    // Hide element (primary, eye-shut icon) and Delete element
    // (revealed by the dropdown caret).
    const isHidden = cs.display === 'none';
    const appearanceHtml = `
      <div class="inspector-section">
        <div class="inspector-section-hd" style="cursor:pointer;" data-collapse="section">
          <span class="inspector-section-title">Appearance</span>
          <button class="inspector-section-chevron" data-inspector-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="inspector-g2">
          ${iconField(icons.radius, 'border-radius', pxStr(cs.borderRadius), 'px')}
          ${iconField(icons.opacity, 'opacity', pxStr(parseFloat(cs.opacity) * 100), '%')}
        </div>
        <div class="inspector-split-btn-wrap">
          <div class="inspector-split-btn">
            <button class="inspector-split-btn-main${isHidden ? ' active' : ''}"
                    data-action="hide"
                    data-inspector-tip="${isHidden ? 'Show element (clear display:none)' : 'Hide element — sets display:none'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></svg>
              <span>${isHidden ? 'Show element' : 'Hide element'}</span>
            </button>
            <button class="inspector-split-btn-toggle"
                    data-action="open-menu"
                    data-inspector-tip="More element actions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          <div class="inspector-split-btn-menu" data-menu="hide">
            <button data-action="delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Delete element</span>
            </button>
          </div>
        </div>
      </div>`;

    // ── TYPOGRAPHY ──
    const alignIcons = {
      left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/></svg>',
      center: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 5H3"/><path d="M21 12H3"/><path d="M19 19H3"/></svg>',
      right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H3"/><path d="M21 12H9"/><path d="M21 19H7"/></svg>',
      vTop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="9" height="6" x="6" y="14" rx="2"/><rect width="16" height="6" x="6" y="4" rx="2"/><path d="M2 2v20"/></svg>',
      vMid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4"/><path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"/><path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1"/><path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"/></svg>',
      vBot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="6" x="2" y="4" rx="2"/><rect width="9" height="6" x="9" y="14" rx="2"/><path d="M22 22V2"/></svg>',
    };
    const textAlign = cs.textAlign;
    const typographyHtml = `
      <div class="inspector-section">
        <div class="inspector-section-hd" style="cursor:pointer;" data-collapse="section">
          <span class="inspector-section-title">Typography</span>
          <button class="inspector-section-chevron" data-inspector-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="inspector-row">
          <div class="inspector-field" data-prop="font-family" style="padding-right:4px;">
            <select id="__inspector-font-select" data-prop="font-family" data-sel="${sel}" data-from="${cs.fontFamily}"
              style="background:none;border:none;outline:none;color:#ccc;font-size:11px;font-family:Inter,system-ui,sans-serif;width:100%;cursor:pointer;min-width:0;">
              ${buildFontOptions(cs.fontFamily)}
            </select>
          </div>
          <div class="inspector-field-sm" data-prop="font-size">
            <input value="${pxStr(cs.fontSize)}" data-prop="font-size" data-sel="${sel}" data-from="${cs.fontSize}" style="cursor:ew-resize;">
            <span class="inspector-fu">px</span>
          </div>
        </div>
        <div class="inspector-row">
          ${selectField('', 'font-weight', cs.fontWeight, ['100','200','300','400','500','600','700','800','900'])}
          ${iconField(icons.lineHeight, 'line-height', pxStr(cs.lineHeight), 'px')}
        </div>
        <div style="font-size:10px;color:#555;margin:6px 0 5px;">Color</div>
        ${selectField('', 'color-type', 'Solid', ['Solid','Gradient','None'])}
        <div class="inspector-row" style="margin-top:6px;">
          ${colorField('color', cs.color)}
          <div class="inspector-field-sm">
            <input value="100" data-prop="color-opacity" data-sel="${sel}" data-from="100">
            <span class="inspector-fu">%</span>
          </div>
        </div>
        <div class="inspector-g2" style="margin-top:6px;margin-bottom:6px;">
          <div>
            <div style="font-size:10px;color:#555;margin-bottom:4px;">Line Height</div>
            ${iconField(icons.lineHeight, 'line-height', pxStr(cs.lineHeight), 'px')}
          </div>
          <div>
            <div style="font-size:10px;color:#555;margin-bottom:4px;">Letter Spacing</div>
            ${iconField(icons.letterSpacing, 'letter-spacing', pxStr(cs.letterSpacing), 'px')}
          </div>
        </div>
        <div style="font-size:10px;color:#555;margin-bottom:5px;">Text alignment</div>
        <div class="inspector-ig">
          <button class="inspector-ig-btn${textAlign === 'left' || textAlign === 'start' ? ' on' : ''}" data-align="left" data-inspector-tip="Align text left">${alignIcons.left}</button>
          <button class="inspector-ig-btn${textAlign === 'center' ? ' on' : ''}" data-align="center" data-inspector-tip="Align text center">${alignIcons.center}</button>
          <button class="inspector-ig-btn${textAlign === 'right' || textAlign === 'end' ? ' on' : ''}" data-align="right" data-inspector-tip="Align text right">${alignIcons.right}</button>
        </div>
      </div>`;

    // ── LAYER SECTIONS ──
    const fillHtml = buildFillSection(cs, sel);
    const strokeHtml = buildStrokeSection(cs, sel);
    const effectsHtml = buildEffectsSection(cs, sel);

    // ── COMPONENT SECTION (design system) ──
    const componentHtml = buildComponentSection(selectedElement, sel);

    // ── SCOPE ROW ─ Sits just above Position. Hosts two toggles styled
    // to match the rest of the panel's checkboxes (.inspector-check-box
    // — dark square, white-with-check when on) + a tag showing the
    // active selector. ──
    const scopeCheck = (on) =>
      `<div class="inspector-check-box${on ? ' on' : ''}">
         <svg viewBox="0 0 10 10" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
       </div>`;
    const scopeHtml = `
      <div class="inspector-scope-row">
        <div class="inspector-scope-toggle" data-scope-toggle="classscope" data-inspector-tip="ON: edits apply to every element sharing this class. OFF: edits apply only to this one picked element.">
          ${scopeCheck(settings.classScope)}
          <span>Edit by class</span>
        </div>
        <div class="inspector-scope-toggle" data-scope-toggle="outline" data-inspector-tip="Show a persistent blue outline on the picked element">
          ${scopeCheck(settings.showSelectedOutline)}
          <span>Show selection box</span>
        </div>
        <span class="inspector-scope-target" data-inspector-tip="${esc(sel)}"><code>${esc(sel)}</code></span>
      </div>
    `;

    // ── RENDER ALL ──
    panel.innerHTML = componentHtml + scopeHtml + positionHtml + layoutHtml + appearanceHtml + typographyHtml + fillHtml + strokeHtml + effectsHtml;

    // Component section needs its own wiring (dropdowns + Ask-Claude btn).
    wireComponentSection(panel, selectedElement, sel);
    // Scope-row wire-up — two custom-styled checkboxes gate preview
    // behavior. Click anywhere on the toggle div flips the `.on` class
    // on its inner .inspector-check-box, persists the setting, and runs
    // the corresponding side effect.
    panel.querySelectorAll('.inspector-scope-toggle[data-scope-toggle]').forEach(t => {
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        const which = t.dataset.scopeToggle;
        const box = t.querySelector('.inspector-check-box');
        const on = !box.classList.contains('on');
        box.classList.toggle('on', on);
        if (which === 'classscope') {
          saveSettings({ classScope: on });
          rebuildLiveChangesStyles();
          renderDesignPanel();
        } else if (which === 'outline') {
          saveSettings({ showSelectedOutline: on });
          applySelectedOutlineVisibility();
          // FABs + selection overlays are pinned to the selection
          // outline, so they share its visibility.
          renderSelectionOverlays();
          positionFabs();
        }
      });
    });

    // ── HIDE / DELETE SPLIT BUTTON ──
    // Primary: toggles display:none on the selected element (tracked
    // as a normal CSS edit so the existing changes pipeline picks it
    // up). Caret reveals a dropdown with Delete (removes the element
    // from the DOM and pushes a `dom-remove` history entry — restored
    // on undo via parent.insertBefore).
    const hideBtn = panel.querySelector('[data-action="hide"]');
    const menuBtn = panel.querySelector('[data-action="open-menu"]');
    const menuEl  = panel.querySelector('[data-menu="hide"]');
    const delBtn  = panel.querySelector('[data-action="delete"]');
    if (hideBtn) {
      hideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!selectedElement) return;
        const curDisplay = targetWin.getComputedStyle(selectedElement).display;
        if (curDisplay === 'none') {
          selectedElement.style.removeProperty('display');
          trackChange(sel, 'display', 'none', '');
        } else {
          trackChange(sel, 'display', curDisplay, 'none');
          selectedElement.style.display = 'none';
        }
        renderDesignPanel();
      });
    }
    if (menuBtn && menuEl) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuEl.classList.toggle('open');
      });
      // Click outside closes the menu.
      document.addEventListener('click', () => menuEl.classList.remove('open'));
    }
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!selectedElement) return;
        const target = selectedElement;
        const parent = target.parentNode;
        if (!parent) return;
        const confirmed = confirm(`Delete this ${target.tagName.toLowerCase()} element?\n\nIt's a destructive action — Claude will be told to remove it from source on paste-back. You can undo locally.`);
        if (!confirmed) return;
        const nextSibling = target.nextElementSibling;
        const cleanCls = (cls) => (cls || '').split(/\s+/).filter(c => c && !c.startsWith('__inspector-')).join(' ');
        history.push({
          kind: 'dom-remove',
          parent: computeSelector(parent),
          dom: { element: target, parent, nextSibling },
          target: {
            selector: computeSelector(target),
            tag: target.tagName.toLowerCase(),
            text: (target.textContent || '').trim().slice(0, 80),
            classes: cleanCls(target.className),
          },
          ancestorChain: captureAncestorChain(target),
        });
        target.remove();
        clearSelection();
        redoStack.length = 0;
        syncBadge();
        menuEl?.classList.remove('open');
      });
    }

    // ── WIRE UP ALL INPUTS ──
    wireUpInputs(panel, sel);
    wireFillSection(panel, sel, cs);
    wireStrokeSection(panel, sel, cs);
    wireEffectsSection(panel, sel, cs);

    // Font switcher
    const fontSelect = panel.querySelector('#__inspector-font-select');
    if (fontSelect) {
      fontSelect.addEventListener('change', (e) => {
        const fontName = e.target.value;
        const from = e.target.dataset.from;
        loadGoogleFont(fontName);
        if (selectedElement) selectedElement.style.fontFamily = `'${fontName}', sans-serif`;
        trackChange(sel, 'font-family', from, `'${fontName}', sans-serif`);
      });
    }

    // Spacing widget inputs
    // `input` event = live preview while typing (no trackChange churn).
    // `change` event (blur/Enter) = commit, records the edit in trackChange.
    panel.querySelectorAll('.inspector-sv input').forEach(input => {
      const unitOf = (prop) =>
        prop.includes('margin') || prop.includes('padding') ? 'px' : '';
      input.addEventListener('input', (e) => {
        const prop = e.target.dataset.prop;
        const raw = e.target.value.trim();
        if (raw === '' || raw === '-') return; // mid-typing
        const to = raw + unitOf(prop);
        if (selectedElement) selectedElement.style.setProperty(prop, to);
      });
      input.addEventListener('change', (e) => {
        const prop = e.target.dataset.prop;
        const from = e.target.dataset.from;
        const to = e.target.value + unitOf(prop);
        if (selectedElement) selectedElement.style.setProperty(prop, to);
        trackChange(sel, prop, from, to);
      });
    });

    // Toggle: "Show margins box" link reveals the orange/teal margin+padding
    // diagram beneath the compact controls.
    panel.querySelectorAll('.inspector-expand-link[data-expand="box"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const box = panel.querySelector('#__inspector-margins-box');
        if (!box) return;
        const isOpen = box.style.display !== 'none';
        box.style.display = isOpen ? 'none' : 'block';
        btn.textContent = isOpen ? 'Show margins box' : 'Hide margins box';
      });
    });
    // Toggle: corner-brackets icon (right of the padding-y field) reveals
    // the per-side padding fields (↑ → ↓ ←). Independent of the margins box.
    panel.querySelectorAll('.inspector-padding-individual-btn[data-expand="individual"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ind = panel.querySelector('#__inspector-padding-individual');
        if (!ind) return;
        const isOpen = ind.style.display !== 'none';
        ind.style.display = isOpen ? 'none' : 'block';
        btn.classList.toggle('active', !isOpen);
      });
    });

    // Checkboxes
    panel.querySelectorAll('.inspector-check-row').forEach(row => {
      row.addEventListener('click', () => {
        const box = row.querySelector('.inspector-check-box');
        box.classList.toggle('on');
        const check = row.dataset.check;
        if (check === 'overflow') {
          const val = box.classList.contains('on') ? 'hidden' : 'visible';
          if (selectedElement) selectedElement.style.overflow = val;
          trackChange(sel, 'overflow', cs.overflow, val);
        } else if (check === 'box-sizing') {
          const val = box.classList.contains('on') ? 'border-box' : 'content-box';
          if (selectedElement) selectedElement.style.boxSizing = val;
          trackChange(sel, 'box-sizing', cs.boxSizing, val);
        }
      });
    });

    // Text alignment buttons
    panel.querySelectorAll('[data-align]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.align;
        if (selectedElement) selectedElement.style.textAlign = val;
        trackChange(sel, 'text-align', cs.textAlign, val);
        panel.querySelectorAll('[data-align]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
      });
    });

    // Flow buttons
    panel.querySelectorAll('[data-flow]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.flow;
        panel.querySelectorAll('[data-flow]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        if (val === 'grid') {
          if (selectedElement) selectedElement.style.display = 'grid';
          trackChange(sel, 'display', cs.display, 'grid');
        } else if (val === 'wrap') {
          if (selectedElement) { selectedElement.style.display = 'flex'; selectedElement.style.flexWrap = 'wrap'; }
          trackChange(sel, 'flex-wrap', cs.flexWrap, 'wrap');
        } else {
          if (selectedElement) { selectedElement.style.display = 'flex'; selectedElement.style.flexDirection = val; }
          trackChange(sel, 'flex-direction', cs.flexDirection, val);
        }
      });
    });

    // Alignment pad dots — set both axes' alignment properties in one click.
    // Axes were chosen in buildAlignmentPad based on the current display +
    // flex-direction; the pad's data-* attributes carry the actual CSS
    // properties so we don't need to re-derive them here.
    const pad = panel.querySelector('.inspector-align-pad');
    if (pad) {
      const colProp = pad.dataset.colProp;
      const rowProp = pad.dataset.rowProp;
      pad.querySelectorAll('.align-pad-dot').forEach(dot => {
        dot.addEventListener('click', () => {
          const c = parseInt(dot.dataset.alignCol, 10);
          const r = parseInt(dot.dataset.alignRow, 10);
          const colVal = idxToValue(c, colProp);
          const rowVal = idxToValue(r, rowProp);
          // Live preview on the picked element.
          if (selectedElement) {
            selectedElement.style.setProperty(colProp, colVal);
            selectedElement.style.setProperty(rowProp, rowVal);
          }
          // Track both changes so the live class-scope sheet + paste-back
          // both see them.
          trackChange(sel, colProp, cs[colProp.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())], colVal);
          trackChange(sel, rowProp, cs[rowProp.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())], rowVal);
          // Visual: clear all dots, mark the picked one.
          pad.querySelectorAll('.align-pad-dot').forEach(d => d.classList.remove('active'));
          dot.classList.add('active');
        });
      });
    }

    initScrub(panel, sel);
    initKeyboard(panel, sel);
    initSpacingScrub(panel, sel);
    syncModifiedIndicators();

    // Collapsible section headers
    panel.querySelectorAll('.inspector-section-hd[data-collapse]').forEach(hd => {
      hd.addEventListener('click', (e) => {
        if (e.target.closest('button') && !e.target.closest('.inspector-section-chevron')) return;
        hd.closest('.inspector-section').classList.toggle('collapsed');
      });
    });
  }

  // Map synthetic compact props (used by the Figma-style Layout controls)
  // to the pair of real CSS properties they cover. Used by wireUpInputs so
  // the input/change handlers apply to both sides and trackChange records
  // each real property separately.
  const COMPACT_PROP_PAIRS = {
    'padding-x': ['padding-left', 'padding-right'],
    'padding-y': ['padding-top',  'padding-bottom'],
    'margin-x':  ['margin-left',  'margin-right'],
    'margin-y':  ['margin-top',   'margin-bottom'],
  };

  function wireUpInputs(panel, sel) {
    panel.querySelectorAll('.inspector-field input, .inspector-field-sm input').forEach(input => {
      if (input.dataset._wired) return;
      input.dataset._wired = '1';
      const prop = input.dataset.prop;
      const pair = COMPACT_PROP_PAIRS[prop];

      // Live preview while typing (no trackChange churn yet).
      input.addEventListener('input', (e) => {
        const value = cssValueFor(prop, e.target.value, unitFor(e.target));
        if (value == null) return;
        if (selectedElement) {
          if (pair) pair.forEach(p => selectedElement.style.setProperty(p, value));
          else      selectedElement.style.setProperty(prop, value);
        }
      });

      // Commit on blur/Enter.
      input.addEventListener('change', (e) => {
        const value = cssValueFor(prop, e.target.value, unitFor(e.target));
        if (value == null) return;
        if (selectedElement) {
          if (pair) pair.forEach(p => selectedElement.style.setProperty(p, value));
          else      selectedElement.style.setProperty(prop, value);
        }
        if (pair) {
          // Record each real side separately so the source-edit step can
          // touch both. The compact field carries the original per-side
          // values in data-from-a / data-from-b.
          const fromA = e.target.dataset.fromA ?? e.target.dataset.from;
          const fromB = e.target.dataset.fromB ?? e.target.dataset.from;
          trackChange(sel, pair[0], fromA, value);
          trackChange(sel, pair[1], fromB, value);
        } else {
          trackChange(sel, prop, e.target.dataset.from, value);
        }
      });
    });

    // <select> elements (display, position, etc.) — values are CSS keywords,
    // no unit handling needed. `change` is the only event selects fire.
    panel.querySelectorAll('.inspector-field select').forEach(select => {
      if (select.dataset._wired) return;
      select.dataset._wired = '1';
      select.addEventListener('change', (e) => {
        const prop = e.target.dataset.prop;
        const from = e.target.dataset.from;
        const to = e.target.value;
        if (selectedElement) selectedElement.style.setProperty(prop, to);
        trackChange(sel, prop, from, to);
      });
    });

    panel.querySelectorAll('.inspector-color-field[data-color-prop]').forEach(field => {
      if (field.dataset._wired) return;
      field.dataset._wired = '1';
      field.addEventListener('click', () => {
        const prop = field.dataset.colorProp;
        const val = field.dataset.colorVal;
        openColorPicker(prop, val, field);
      });
    });

    panel.querySelectorAll('.inspector-reset-btn[data-reset]').forEach(btn => {
      if (btn.dataset._wired) return;
      btn.dataset._wired = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetField(btn.dataset.reset);
      });
    });
  }

  // ── Scrub-to-change: drag on labels to adjust numeric values ──
  function initScrub(panel, sel) {
    panel.querySelectorAll('[data-scrub]').forEach(label => {
      let startX = 0, startVal = 0, input = null;

      label.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input = label.closest('.inspector-field, .inspector-field-sm')?.querySelector('input');
        if (!input) return;
        startX = e.clientX;
        startVal = parseFloat(input.value) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        suppressIframePointerEvents(true);
      });

      function onMove(e) {
        if (!input) return;
        const delta = e.clientX - startX;
        const multiplier = e.shiftKey ? 10 : 1;
        const unit = unitFor(input);
        let newVal = Math.round(startVal + delta * multiplier);
        if (unit === '%') newVal = Math.min(100, Math.max(0, newVal));
        input.value = String(newVal);
        const prop = input.dataset.prop;
        const cssValue = cssValueFor(prop, String(newVal), unit);
        if (selectedElement && prop && cssValue != null) {
          // Synthetic compact props (padding-x / padding-y / margin-x /
          // margin-y) expand to both real CSS sides.
          const pair = COMPACT_PROP_PAIRS[prop];
          if (pair) pair.forEach(p => selectedElement.style.setProperty(p, cssValue));
          else      selectedElement.style.setProperty(prop, cssValue);
        }
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        suppressIframePointerEvents(false);
        if (input) {
          const prop = input.dataset.prop;
          const unit = unitFor(input);
          const cssValue = cssValueFor(prop, input.value, unit);
          if (cssValue != null) {
            const pair = COMPACT_PROP_PAIRS[prop];
            if (pair) {
              const fromA = input.dataset.fromA ?? input.dataset.from;
              const fromB = input.dataset.fromB ?? input.dataset.from;
              trackChange(sel, pair[0], fromA, cssValue);
              trackChange(sel, pair[1], fromB, cssValue);
            } else {
              trackChange(sel, prop, input.dataset.from, cssValue);
            }
          }
          input = null;
        }
      }
    });

    // .inspector-field-sm inputs have no label to drag on — attach scrub directly to the input.
    // Use a drag threshold so a plain click still focuses the input for keyboard use.
    panel.querySelectorAll('.inspector-field-sm[data-prop] input[data-prop]').forEach(inp => {
      inp.addEventListener('mousedown', (e) => {
        const startX = e.clientX;
        const startVal = parseFloat(inp.value) || 0;
        let dragging = false;

        function onMove(e) {
          const delta = e.clientX - startX;
          if (!dragging) {
            if (Math.abs(delta) < 3) return;
            dragging = true;
            suppressIframePointerEvents(true);
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
          }
          const unit = inp.closest('.inspector-field-sm')?.querySelector('.inspector-fu')?.textContent || '';
          let newVal = Math.round(startVal + delta * (e.shiftKey ? 10 : 1));
          if (unit === '%') newVal = Math.min(100, Math.max(0, newVal));
          inp.value = String(newVal);
          const prop = inp.dataset.prop;
          if (selectedElement && prop) selectedElement.style.setProperty(prop, newVal + unit);
        }

        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (dragging) {
            suppressIframePointerEvents(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const prop = inp.dataset.prop;
            const from = inp.dataset.from;
            const unit = inp.closest('.inspector-field-sm')?.querySelector('.inspector-fu')?.textContent || '';
            trackChange(sel, prop, from, inp.value + unit);
          }
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        // No e.preventDefault() — let click focus the input normally for keyboard editing
      });
    });
  }

  // ── Keyboard: Up/Down arrows to increment/decrement ──
  function initKeyboard(panel, sel) {
    panel.querySelectorAll('.inspector-field input, .inspector-field-sm input, .inspector-sv input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const current = parseFloat(input.value) || 0;
        let step = 1;
        if (e.shiftKey) step = 10;
        if (e.altKey) step = 0.1;
        const newVal = e.key === 'ArrowUp' ? current + step : current - step;
        const rounded = Math.round(newVal * 10) / 10;
        input.value = String(rounded);
        const prop = input.dataset.prop;
        const unit = input.closest('.inspector-field')?.querySelector('.inspector-fu')?.textContent
          || input.closest('.inspector-field-sm')?.querySelector('.inspector-fu')?.textContent
          || '';
        if (selectedElement && prop) {
          selectedElement.style.setProperty(prop, rounded + unit);
        }
        trackChange(sel, prop, input.dataset.from, String(rounded) + unit);
      });
    });
  }

  // ── Spacing widget scrub: drag on .inspector-sv cells ──
  // The input fills the whole cell with cursor: ew-resize, so the user
  // naturally tries to drag on the visible number. Attach scrub to BOTH the
  // cell wrapper and the input itself, with a drag threshold so a plain
  // click on the input still focuses it for typing.
  function initSpacingScrub(panel, sel) {
    panel.querySelectorAll('.inspector-sv').forEach(sv => {
      const input = sv.querySelector('input[data-prop]');
      if (!input) return;

      function startScrub(e) {
        const startX = e.clientX;
        const startVal = parseFloat(input.value) || 0;
        let dragging = false;
        // When mousedown lands on the cell wrapper (not the input itself)
        // we know it's a scrub gesture — no threshold needed, prevent the
        // default to keep focus off the input.
        const onWrapper = e.target !== input;
        if (onWrapper) {
          dragging = true;
          e.preventDefault();
          suppressIframePointerEvents(true);
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
        }

        function onMove(ev) {
          const delta = ev.clientX - startX;
          if (!dragging) {
            if (Math.abs(delta) < 3) return;
            dragging = true;
            suppressIframePointerEvents(true);
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
          }
          const newVal = Math.round(startVal + delta * (ev.shiftKey ? 10 : 1));
          input.value = String(newVal);
          const prop = input.dataset.prop;
          if (selectedElement && prop) {
            selectedElement.style.setProperty(prop, newVal + 'px');
          }
        }

        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (dragging) {
            suppressIframePointerEvents(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const prop = input.dataset.prop;
            const from = input.dataset.from;
            trackChange(sel, prop, from, input.value + 'px');
          }
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }

      sv.addEventListener('mousedown', startScrub);
    });
  }

  function renderCssRaw() {
    const panel = root.querySelector('#__inspector-panel-raw');
    if (!selectedElement) {
      panel.innerHTML = '<div class="inspector-empty">No element selected.</div>';
      return;
    }
    const sel = computeSelector(selectedElement);
    const matchedRules = [];
    try {
      Array.from(targetDoc.styleSheets).forEach(sheet => {
        try {
          Array.from(sheet.cssRules || []).forEach(rule => {
            if (rule.selectorText && selectedElement.matches(rule.selectorText)) {
              matchedRules.push(rule.cssText);
            }
          });
        } catch (e) { /* cross-origin sheet — skip */ }
      });
    } catch (e) {}

    const rawText = matchedRules.length
      ? matchedRules.join('\n\n')
      : `/* No stylesheet rules matched ${sel} */\n/* Computed styles: */\n${sel} {\n  font-size: ${targetWin.getComputedStyle(selectedElement).fontSize};\n  color: ${targetWin.getComputedStyle(selectedElement).color};\n}`;

    panel.innerHTML = `
      <textarea id="__inspector-css-raw" spellcheck="false">${rawText}</textarea>
      <div class="inspector-raw-toolbar">
        <button id="__inspector-apply-raw" class="inspector-raw-apply" data-inspector-tip="Parse the CSS above and record each declaration as a tracked change. The changes appear in the bottom drawer and ship to Claude in the Copy Prompt.">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8 L6.5 11.5 L13 4"/>
          </svg>
          <span>Apply to tracker</span>
        </button>
      </div>
    `;

    panel.querySelector('#__inspector-apply-raw').addEventListener('click', () => {
      const text = panel.querySelector('#__inspector-css-raw').value;
      const declarations = text.match(/[\w-]+\s*:\s*[^;{]+/g) || [];
      let count = 0;
      declarations.forEach(decl => {
        const colonIdx = decl.indexOf(':');
        if (colonIdx < 0) return;
        const prop = decl.slice(0, colonIdx).trim();
        const val = decl.slice(colonIdx + 1).trim();
        if (!prop || !val) return;
        const from = targetWin.getComputedStyle(selectedElement).getPropertyValue(prop) || '';
        trackChange(sel, prop, from, val);
        selectedElement.style.setProperty(prop, val);
        count++;
      });
      const btn = panel.querySelector('#__inspector-apply-raw');
      btn.textContent = `Tracked ${count} declarations`;
      setTimeout(() => { btn.textContent = 'Apply to tracker'; }, 2000);
    });
  }
  function reorderEntries() {
    return history.filter(h => h.kind === 'reorder');
  }
  function domRemoveEntries() {
    return history.filter(h => h.kind === 'dom-remove');
  }

  function renderChangesBar() {
    const bar = root.querySelector('#__inspector-changes-bar');
    const countEl = root.querySelector('#__inspector-bar-count');
    if (!bar) return;

    // Reorders collapse to ONE logical change per parent (matches the
    // drawer + Copy Prompt). Internal history depth (e.g. 3 nudges on
    // the same list) is bookkeeping, not user-facing.
    const collapsedReorderCount = buildCollapsedReorders().length;
    const totalCount = changes.length + componentIntents.length + collapsedReorderCount + domRemoveEntries().length;
    const hasActivity = totalCount > 0 || redoStack.length > 0;
    if (!hasActivity) {
      bar.classList.remove('visible');
      const drawer = root.querySelector('#__inspector-bar-drawer');
      if (drawer) drawer.classList.remove('open');
    } else {
      bar.classList.add('visible');
      const pill = root.querySelector('#__inspector-changes-pill');
      if (pill) pill.style.display = totalCount > 0 ? '' : 'none';
      if (countEl) countEl.textContent = String(totalCount);
    }

    const drawer = root.querySelector('#__inspector-bar-drawer');
    if (drawer?.classList.contains('open')) renderChangesDrawer();
  }

  function renderChangesDrawer() {
    const drawer = root.querySelector('#__inspector-bar-drawer');
    if (!drawer) return;
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const rows = changes.map((c, i) => `
      <div class="changes-row" data-row-kind="css" data-row-index="${i}">
        <div class="changes-row-top">
          <span class="changes-row-selector">${esc(c.selector)}</span>
          <button class="changes-row-rm" data-index="${i}">×</button>
        </div>
        <div class="changes-row-bottom">
          <span class="changes-row-prop">${esc(c.property)}</span>
          <div class="changes-row-values">
            <span class="changes-row-from">${esc(c.from || '—')}</span>
            <span class="changes-row-arrow">→</span>
            <span class="changes-row-to">${esc(c.to)}</span>
          </div>
        </div>
      </div>`).join('');

    // Component intents render in their own block under the CSS rows so the
    // user can see exactly what variant swaps / conversions will be sent.
    const intentRows = componentIntents.map((i, idx) => {
      const label = i.action === 'swap-variant'
        ? `${esc(i.component)} · ${esc(i.prop)}: ${esc(i.from || '—')} → ${esc(i.to)}`
        : `Convert → ${esc(i.to)}`;
      const sels = Array.isArray(i.selectors) ? i.selectors.join(', ') : (i.selector || '');
      return `
        <div class="changes-row changes-row-intent" data-row-kind="intent" data-row-index="${idx}">
          <div class="changes-row-top">
            <span class="changes-row-selector">${esc(sels)}</span>
            <button class="changes-row-rm" data-intent-index="${idx}">×</button>
          </div>
          <div class="changes-row-bottom">
            <span class="changes-row-prop">component</span>
            <div class="changes-row-values">${label}</div>
          </div>
        </div>`;
    }).join('');

    // Same-parent reorders ARE one logical change (regardless of how
    // many nudges produced the net effect). Drawer shows one row per
    // parent. We index by parent index in collapsedReorders[] so the X
    // can unwind every history entry tied to that parent.
    const collapsedReorders = buildCollapsedReorders();
    const reorderRows = collapsedReorders.map((r, idx) => {
      const newOrderTexts = r.order.map(i => (r.children[i] && r.children[i].text) || '—');
      // Showing 4+ texts gets long; truncate visually but the full
      // order is always in the JSON block.
      const previewTexts = newOrderTexts.length > 4
        ? newOrderTexts.slice(0, 4).concat(`…+${newOrderTexts.length - 4}`)
        : newOrderTexts;
      const netLabel = previewTexts.map(t => esc(String(t))).join(' → ');
      return `
        <div class="changes-row changes-row-intent" data-row-kind="reorder" data-row-index="${idx}">
          <div class="changes-row-top">
            <span class="changes-row-selector">${esc(r.parent || '—')}</span>
            <button class="changes-row-rm" data-reorder-parent="${idx}">×</button>
          </div>
          <div class="changes-row-bottom">
            <span class="changes-row-prop">reorder</span>
            <div class="changes-row-values">${netLabel}</div>
          </div>
        </div>`;
    }).join('');

    // Element-removal rows (from the Delete element split-button action).
    // Each row shows the deleted element's tag + selector + a snippet
    // of its text. X-button undoes (re-inserts via dom-remove undo path).
    const removals = domRemoveEntries();
    const removalRows = removals.map((h, idx) => {
      const lbl = `${esc(h.target.tag)} · ${esc((h.target.text || '').slice(0, 40) || '—')}`;
      return `
        <div class="changes-row changes-row-intent" data-row-kind="dom-remove" data-row-index="${idx}">
          <div class="changes-row-top">
            <span class="changes-row-selector">${esc(h.target.selector || '—')}</span>
            <button class="changes-row-rm" data-remove-hi="${history.indexOf(h)}">×</button>
          </div>
          <div class="changes-row-bottom">
            <span class="changes-row-prop">delete</span>
            <div class="changes-row-values">${lbl}</div>
          </div>
        </div>`;
    }).join('');

    const totalCount = changes.length + componentIntents.length + collapsedReorders.length + removals.length;
    drawer.innerHTML = `
      <div class="changes-drawer-hd">
        <div class="changes-drawer-hd-left">
          <span class="changes-drawer-title">${totalCount} Change${totalCount !== 1 ? 's' : ''}</span>
          <span class="changes-drawer-pending">pending</span>
        </div>
        <button class="changes-drawer-close" title="Close">✕</button>
      </div>
      ${rows}
      ${intentRows}
      ${removalRows}
      ${reorderRows}
      <button class="changes-bar-copy" id="__inspector-bar-copy">✦&nbsp; Copy Prompt for Claude</button>
    `;

    drawer.querySelectorAll('.changes-row-rm[data-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        undoChange(parseInt(btn.dataset.index));
        renderChangesDrawer();
      });
    });
    drawer.querySelectorAll('.changes-row-rm[data-intent-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const removed = componentIntents.splice(parseInt(btn.dataset.intentIndex), 1)[0];
        if (removed) {
          history.push({ kind: 'intent-remove', prev: removed });
          redoStack.length = 0;
        }
        syncBadge();
        renderChangesDrawer();
      });
    });
    // X on a reorder row removes the WHOLE logical change for that
    // parent — unwind every history entry that touched it, restoring
    // the parent's children to their pre-reorder state. Matches the
    // user's mental model of "one row = one change".
    drawer.querySelectorAll('.changes-row-rm[data-reorder-parent]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.reorderParent);
        const r = collapsedReorders[idx];
        if (!r || !r._parentEl) return;
        // Walk history in REVERSE so each revertReorder lands on the
        // current DOM state correctly (LIFO undo semantics).
        for (let i = history.length - 1; i >= 0; i--) {
          const h = history[i];
          if (h.kind === 'reorder' && h.dom && h.dom.parent === r._parentEl) {
            revertReorder(h);
            history.splice(i, 1);
          }
        }
        redoStack.length = 0;
        syncBadge();
        renderChangesDrawer();
        repositionSelectionOverlays();
        positionFabs();
      });
    });
    // X on a delete row: re-insert the element + drop the history entry.
    drawer.querySelectorAll('.changes-row-rm[data-remove-hi]').forEach(btn => {
      btn.addEventListener('click', () => {
        const hi = parseInt(btn.dataset.removeHi);
        const h = history[hi];
        if (h && h.kind === 'dom-remove' && h.dom && h.dom.element && h.dom.parent && !h.dom.element.isConnected) {
          h.dom.parent.insertBefore(h.dom.element, h.dom.nextSibling || null);
        }
        if (h) history.splice(hi, 1);
        redoStack.length = 0;
        syncBadge();
        renderChangesDrawer();
      });
    });

    drawer.querySelector('.changes-drawer-close').addEventListener('click', () => {
      drawer.classList.remove('open');
    });

    drawer.querySelector('#__inspector-bar-copy').addEventListener('click', () => {
      const prompt = generateCopyPrompt();
      navigator.clipboard.writeText(prompt).then(() => {
        const btn = drawer.querySelector('#__inspector-bar-copy');
        btn.innerHTML = '✓ Copied!';
        setTimeout(() => { btn.innerHTML = '✦&nbsp; Copy Prompt for Claude'; }, 2000);
      });
    });

    // Hover preview routing:
    //   · Copy Prompt button → full prompt for ALL pending changes.
    //   · Individual change row → JUST that row's slice (one summary
    //     line + the relevant single-entry JSON block).
    // Keeps the per-row hover focused on what you're about to remove
    // / inspect, while the button still shows the full payload.
    const copyBtn = drawer.querySelector('#__inspector-bar-copy');
    if (copyBtn) {
      copyBtn.addEventListener('mouseenter', () => showPromptPreview(copyBtn));
      copyBtn.addEventListener('mouseleave', hidePromptPreview);
    }
    drawer.querySelectorAll('.changes-row[data-row-kind]').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const text = buildSinglePrompt(row.dataset.rowKind, parseInt(row.dataset.rowIndex));
        if (text) showPromptPreview(row, text);
      });
      row.addEventListener('mouseleave', hidePromptPreview);
    });
  }

  // Tooltip element rendered into parent doc (above everything else).
  // Lazy-created on first show. Styles live in the stylesheet (above)
  // — only positioning is inline here.
  let promptPreviewEl = null;
  let promptPreviewHideTimer = null;
  function ensurePromptPreview() {
    if (promptPreviewEl) return promptPreviewEl;
    promptPreviewEl = document.createElement('div');
    promptPreviewEl.id = '__inspector-prompt-preview';
    document.body.appendChild(promptPreviewEl);
    // Cancel pending hide while the cursor is over the tooltip itself,
    // and hide on leave. Lets the user scroll a long prompt.
    promptPreviewEl.addEventListener('mouseenter', () => {
      if (promptPreviewHideTimer) { clearTimeout(promptPreviewHideTimer); promptPreviewHideTimer = null; }
    });
    promptPreviewEl.addEventListener('mouseleave', () => hidePromptPreview());
    return promptPreviewEl;
  }
  // Light syntax highlighting for the preview tooltip ONLY. The text
  // that hits the clipboard stays plain. Keep this subtle: structural
  // anchors (block tags + selectors) coral / blue; JSON keys soft blue;
  // numbers + booleans soft amber; null muted. No bracket coloring,
  // no per-line backgrounds — it's a preview, not an editor.
  function colorizePromptPreview(plain) {
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let out = esc(plain);
    // 1. Block tags <changes>, <components>, <reorders> — coral.
    out = out.replace(/&lt;(\/?(?:changes|components|reorders))&gt;/g,
      '<span style="color:#DA7756">&lt;$1&gt;</span>');
    // 2. Selectors inside backticks (`.cell-pills`, `.btn`) — soft blue.
    out = out.replace(/`([^`\n]+)`/g, '<span style="color:#6ba5f8">`$1`</span>');
    // 3. JSON keys: "word": → soft blue. Match only when followed by colon.
    out = out.replace(/("[\w-]+")(\s*:)/g, '<span style="color:#6ba5f8">$1</span>$2');
    // 4. JSON numbers / booleans — soft amber.
    //    Two cases: inline (`"key": 42`) and array elements on their own
    //    line in pretty-printed JSON (`  42,`). The second regex is /gm
    //    so each line is matched independently.
    out = out.replace(/(:\s*)(-?\d+(?:\.\d+)?)\b/g, '$1<span style="color:#cda165">$2</span>');
    out = out.replace(/^(\s+)(-?\d+(?:\.\d+)?)(,?)$/gm,
      '$1<span style="color:#cda165">$2</span>$3');
    out = out.replace(/(:\s*)(true|false)\b/g, '$1<span style="color:#cda165">$2</span>');
    // 5. null — muted italic.
    out = out.replace(/(:\s*)null\b/g, '$1<span style="color:#777;font-style:italic">null</span>');
    // 6. Markdown bold **text** in the summary — slightly brighter.
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<span style="color:#fff;font-weight:600">$1</span>');
    return out;
  }

  function showPromptPreview(anchor, overrideText) {
    const text = overrideText !== undefined ? overrideText : generateCopyPrompt();
    if (!text || text === 'No changes to apply.') return;
    const tip = ensurePromptPreview();
    // Cancel any pending hide so a quick mouse jiggle doesn't drop us.
    if (promptPreviewHideTimer) { clearTimeout(promptPreviewHideTimer); promptPreviewHideTimer = null; }
    tip.innerHTML = colorizePromptPreview(text);
    // Reset scroll to top — when switching between rows the tooltip
    // should always start at the beginning of its new content.
    tip.scrollTop = 0;
    // Make it visible (offsetHeight needs the element to be rendered)
    tip.style.display = 'block';

    const ar = anchor.getBoundingClientRect();
    const th = tip.offsetHeight;
    const tw = tip.offsetWidth;
    const vw = window.innerWidth, vh = window.innerHeight;

    // Default: above the anchor, right-aligned to the anchor's right edge.
    let left = Math.min(ar.right - tw, vw - tw - 8);
    let top  = ar.top - th - 8;
    if (top < 8) top = ar.bottom + 8;       // flip below if no room above
    if (left < 8) left = 8;
    if (top + th > vh - 8) top = vh - th - 8;
    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
  }
  function hidePromptPreview() {
    // Small grace period so the cursor can bridge from the trigger
    // (e.g., Copy Prompt button) to the tooltip without it flashing
    // closed. Cancelled by mouseenter on either the trigger or the
    // tooltip itself.
    if (promptPreviewHideTimer) clearTimeout(promptPreviewHideTimer);
    promptPreviewHideTimer = setTimeout(() => {
      if (promptPreviewEl) promptPreviewEl.style.display = 'none';
      promptPreviewHideTimer = null;
    }, 140);
  }
  function togglePickMode() {
    pickMode ? exitPickMode() : enterPickMode();
  }

  function enterPickMode() {
    pickMode = true;
    document.body.style.cursor = 'crosshair';
    if (targetDoc !== document && targetDoc.body) targetDoc.body.style.cursor = 'crosshair';
    const pickBtn = root.querySelector('#__inspector-pick-btn');
    pickBtn?.classList.add('active');
    pickBtn?.classList.remove('has-selection');
    root.querySelector('#__inspector-header')?.classList.remove('has-selection');
    targetDoc.addEventListener('mouseover', onPickHover, true);
    targetDoc.addEventListener('click', onPickClick, true);
    targetDoc.addEventListener('contextmenu', onPickRightClick, true);
  }

  function exitPickMode() {
    pickMode = false;
    document.body.style.cursor = '';
    if (targetDoc !== document && targetDoc.body) targetDoc.body.style.cursor = '';
    root.querySelector('#__inspector-pick-btn')?.classList.remove('active');
    targetDoc.querySelectorAll('.__inspector-highlight').forEach(el =>
      el.classList.remove('__inspector-highlight')
    );
    hidePickHoverOverlay();
    clearPrePickLayers();
    tooltip.style.display = 'none';
    targetDoc.removeEventListener('mouseover', onPickHover, true);
    targetDoc.removeEventListener('click', onPickClick, true);
    targetDoc.removeEventListener('contextmenu', onPickRightClick, true);
  }

  function onPickHover(e) {
    // Guard against non-Element targets (text nodes, document, etc.)
    // — closest/classList only exist on Elements.
    if (!e.target || !e.target.classList) return;
    if (e.target.closest && e.target.closest('#__inspector-root')) return;
    targetDoc.querySelectorAll('.__inspector-highlight').forEach(el =>
      el.classList.remove('__inspector-highlight')
    );
    e.target.classList.add('__inspector-highlight');
    showPickHoverOverlay(e.target);
    renderPrePickLayers(e.target);
    const rect = getFrameRect();
    tooltip.style.display = 'block';
    tooltip.style.left = (rect.left + e.clientX + 12) + 'px';
    tooltip.style.top = (rect.top + e.clientY + 12) + 'px';
    tooltip.textContent = computeSelector(e.target);
  }

  // Tags treated as a "region" / "area" when the user copies an intro.
  // Everything else copies as "element". Heuristic, not exhaustive — fine
  // because the user can edit the prefix word after pasting.
  const AREA_TAGS = new Set([
    'DIV','SECTION','MAIN','NAV','ARTICLE','ASIDE',
    'HEADER','FOOTER','FORM','UL','OL','FIGURE','DETAILS'
  ]);
  function elementKind(el) {
    return AREA_TAGS.has(el.tagName) ? 'area' : 'element';
  }

  function copySelectionIntro(triggerBtn) {
    if (!selectedElement) return;
    const sel = computeSelector(selectedElement);
    const tag = selectedElement.tagName.toLowerCase();

    // Page hint: title + URL pathname so the assistant knows which
    // entry point in the codebase to look at.
    let pageBit = '';
    try {
      const title = (targetDoc.title || '').trim();
      const path  = (targetWin.location && targetWin.location.pathname) || '';
      const bits  = [title, path].filter(Boolean);
      if (bits.length) pageBit = ` on ${bits.join(' · ')}`;
    } catch (_) {}

    // Ancestor chain (top → leaf direction). Take the first class of
    // each ancestor; .inspector- prefixed classes already filtered by
    // captureAncestorChain.
    let ancestorBit = '';
    const chain = captureAncestorChain(selectedElement);
    if (chain.length) {
      const tops = chain.slice().reverse()
        .map(c => '.' + (c.split(/\s+/)[0] || ''))
        .filter(c => c !== '.')
        .join(' > ');
      if (tops) ancestorBit = ` Ancestors: ${tops}.`;
    }

    // Children list — only for actual containers (≥2 children).
    // Truncate at 6 names so this doesn't blow up for long lists.
    let childrenBit = '';
    const kids = Array.from(selectedElement.children || []);
    if (kids.length >= 2) {
      const kidName = c => {
        const firstClass = (c.className || '').split(/\s+/)
          .find(x => x && !x.startsWith('__inspector-'));
        return firstClass ? '.' + firstClass : `<${c.tagName.toLowerCase()}>`;
      };
      const names = kids.map(kidName);
      const preview = names.length > 6
        ? names.slice(0, 5).concat(`…+${names.length - 5}`).join(', ')
        : names.join(', ');
      childrenBit = ` Children: ${kids.length} (${preview}).`;
    }

    const intro = `Looking at \`${sel}\` (a <${tag}>)${pageBit}.${ancestorBit}${childrenBit}`;

    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(intro).then(() => {
      const btn = triggerBtn || root.querySelector('.tree-copy-btn');
      if (!btn) return;
      btn.classList.add('just-copied');
      setTimeout(() => btn.classList.remove('just-copied'), 1500);
    });
  }
  // The chat-ready-intro copy action now lives inside the tree popup
  // (`.tree-copy-btn`). The header's pill-clear button is wired below.
  root.querySelector('#__inspector-pill-clear')
      ?.addEventListener('click', () => clearSelection());

  // First selection of the session: pulse the copy button so the user
  // discovers the chat handoff. Pulses only once per page load.
  let hasShownCopyHint = false;

  // The list of all currently-picked elements (primary + extras). Centralized
  // so panels and intent emitters don't have to know about multi-pick state.
  function allSelected() {
    return selectedElement ? [selectedElement, ...selectedElements] : [];
  }

  // Toggle the selected-outline class on every currently-picked element
  // based on settings.showSelectedOutline. Called by the row checkbox.
  function applySelectedOutlineVisibility() {
    const on = !!settings.showSelectedOutline;
    const picks = allSelected();
    if (on) {
      picks.forEach(p => p.classList.add('__inspector-selected-highlight'));
    } else {
      targetDoc.querySelectorAll('.__inspector-selected-highlight').forEach(n =>
        n.classList.remove('__inspector-selected-highlight')
      );
    }
  }

  function setSelection(el) {
    // Drop any previous persistent highlight before tagging the new pick.
    // In multi-pick mode the previous primary stays selected — it just
    // moves into the `selectedElements` extras list.
    if (multiPickMode) {
      if (selectedElement && selectedElement !== el && !selectedElements.includes(selectedElement)) {
        selectedElements.push(selectedElement);
      }
    } else {
      targetDoc.querySelectorAll('.__inspector-selected-highlight').forEach(n =>
        n.classList.remove('__inspector-selected-highlight')
      );
      selectedElements = [];
    }
    selectedElement = el;
    if (settings.showSelectedOutline) el.classList.add('__inspector-selected-highlight');
    root.querySelector('#__inspector-pick-btn').classList.add('has-selection');
    root.querySelector('#__inspector-header').classList.add('has-selection');
    const count = allSelected().length;
    root.querySelector('#__inspector-selector-pill').textContent =
      count > 1 ? `${count} selected` : computeSelector(el);
    renderMultiBadges();
    // Refresh the design panel so the Component section reflects the new
    // selection set (single vs multi, same vs mixed types). The existing
    // single-pick onPickClick path also calls switchTab('design') which
    // re-renders; multi-pick stays in pick mode so we need this explicitly.
    renderDesignPanel();
    renderSelectionOverlays();
    positionFabs();
    // First-pick pulse: the copy link lives in the tree popup now, so the
    // pulse is applied lazily — next time the popup renders, the link
    // animation runs once. We just flip the flag here and let the popup
    // render path pick it up.
    if (!hasShownCopyHint) hasShownCopyHint = true;
  }

  function clearSelection() {
    targetDoc.querySelectorAll('.__inspector-selected-highlight').forEach(n =>
      n.classList.remove('__inspector-selected-highlight')
    );
    selectedElement = null;
    selectedElements = [];
    renderMultiBadges();
    root.querySelector('#__inspector-pick-btn').classList.remove('has-selection');
    root.querySelector('#__inspector-header').classList.remove('has-selection');
    root.querySelector('#__inspector-selector-pill').textContent = '—';
    renderDesignPanel();
    renderSelectionOverlays();
    positionFabs();
  }

  // Remove a single element from the multi-pick set. If it was the
  // primary, promote the last-added extra to primary so something is
  // still selected; if nothing's left, fall through to clearSelection.
  function removeFromSelection(el) {
    if (!el) return;
    el.classList.remove('__inspector-selected-highlight');
    if (el === selectedElement) {
      selectedElement = selectedElements.length ? selectedElements.pop() : null;
    } else {
      const idx = selectedElements.indexOf(el);
      if (idx >= 0) selectedElements.splice(idx, 1);
    }
    if (!selectedElement) {
      clearSelection();
      return;
    }
    const count = allSelected().length;
    root.querySelector('#__inspector-selector-pill').textContent =
      count > 1 ? `${count} selected` : computeSelector(selectedElement);
    renderMultiBadges();
    renderDesignPanel();
  }

  // Numbered badges floating near each picked element. They live in the
  // outer document and are positioned in fixed coords; we recompute on
  // scroll/resize so they stay glued to their targets.
  function renderMultiBadges() {
    // Tear down existing badges first.
    multiBadges.forEach(b => b.remove());
    multiBadges = [];
    const els = allSelected();
    if (els.length < 2) return; // Single pick: no numbering needed.
    const frame = getFrameRect();
    els.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.className = '__inspector-multi-badge';
      badge.textContent = String(i + 1);
      const top  = Math.max(2, frame.top  + rect.top  - 8);
      const left = Math.max(2, frame.left + rect.left - 8);
      badge.style.top  = top  + 'px';
      badge.style.left = left + 'px';
      document.body.appendChild(badge);
      multiBadges.push(badge);
    });
  }
  window.addEventListener('scroll', renderMultiBadges, true);
  window.addEventListener('resize', renderMultiBadges);

  function setMultiPickMode(on) {
    multiPickMode = !!on;
    const btn = root.querySelector('#__inspector-multi-btn');
    btn?.classList.toggle('active', multiPickMode);
    btn?.setAttribute('aria-pressed', multiPickMode ? 'true' : 'false');
    if (!multiPickMode) {
      // Leaving multi mode collapses to just the primary; extras lose their
      // highlight so the UI doesn't mislead.
      selectedElements.forEach(el => el.classList.remove('__inspector-selected-highlight'));
      selectedElements = [];
      renderMultiBadges();
      // Refresh pill text now that count is back to 1.
      if (selectedElement) {
        root.querySelector('#__inspector-selector-pill').textContent = computeSelector(selectedElement);
      }
    }
  }

  function onPickRightClick(e) {
    if (e.target.closest('#__inspector-root')) return;
    e.preventDefault();
    e.stopPropagation();
    setSelection(e.target);
    exitPickMode();
    treePopup._posX = e.clientX;
    treePopup._posY = e.clientY + 8;
    openTreePopup(null);
  }

  function onPickClick(e) {
    if (e.target.closest('#__inspector-root')) return;
    e.preventDefault();
    e.stopPropagation();
    // Multi-pick: clicking an already-selected element removes it from
    // the set instead of adding a duplicate.
    if (multiPickMode && allSelected().includes(e.target)) {
      removeFromSelection(e.target);
      // Stay in pick mode so the user can keep adding/removing.
      return;
    }
    setSelection(e.target);
    if (multiPickMode) {
      // Stay in pick mode for the next click.
      return;
    }
    exitPickMode();
    switchTab('design');
  }

  } // ── end boot() ───────────────────────────────────────────────────────────

})();
