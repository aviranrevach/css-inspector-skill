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

  if (typeof module !== 'undefined') {
    module.exports = { computeSelector };
  }

  // ── Browser-only from here ────────────────────────────────────────────────
  if (typeof document === 'undefined') return;
  if (document.getElementById('__inspector-root')) return;

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
      width: 264px; max-height: calc(100vh - 32px);
      background: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 8px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      z-index: 999999; display: flex; flex-direction: column;
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
    .inspector-select-btn {
      flex: 1; display: flex; align-items: center; gap: 5px;
      background: none; border: 1px solid #333; border-radius: 5px;
      color: #999; font-size: 10px; font-weight: 500;
      padding: 4px 10px; cursor: pointer; font-family: Inter, system-ui, sans-serif;
      min-width: 0;
    }
    .inspector-select-btn:hover { border-color: #555; color: #ccc; }
    .inspector-select-btn.active { border-color: #3B82F6; color: #3B82F6; }
    .inspector-select-btn svg { width: 11px; height: 11px; flex-shrink: 0; }
    .inspector-select-btn.has-selection { flex: none; border-color: #3B82F6; color: #3B82F6; padding: 4px; width: 26px; height: 26px; justify-content: center; }
    .inspector-select-btn.has-selection .inspector-select-label { display: none; }
    #__inspector-pill-wrap {
      display: none; flex: 1; align-items: center; gap: 4px; min-width: 0;
    }
    #__inspector-header.has-selection #__inspector-pill-wrap { display: flex; }
    #__inspector-selector-pill {
      flex: 1; background: #252525; border: 1px solid #3a3a3a;
      border-radius: 4px; padding: 4px 9px; font-size: 10px; color: #DA7756;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      cursor: text; outline: none; min-width: 0;
    }
    #__inspector-selector-pill:focus { border-color: #888; box-shadow: none; }
    #__inspector-deselect {
      background: none; border: none; color: #555; cursor: pointer;
      font-size: 13px; line-height: 1; padding: 0 2px; flex-shrink: 0;
    }
    #__inspector-deselect:hover { color: #aaa; }
    /* Copy-intro button — same visual weight as deselect, sits between pill and ✕ */
    #__inspector-pill-copy {
      background: none; border: none; color: #555; cursor: pointer;
      padding: 0 2px; flex-shrink: 0; display: flex; align-items: center;
      border-radius: 4px;
    }
    #__inspector-pill-copy svg { width: 12px; height: 12px; }
    #__inspector-pill-copy:hover { color: #DA7756; }
    #__inspector-pill-copy.just-copied { color: #3d9e6d; }
    /* One-time pulse so first-time users notice the button after picking */
    @keyframes __inspector-copy-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(218,119,86,0.55); color: #DA7756; }
      70%  { box-shadow: 0 0 0 8px rgba(218,119,86,0);   color: #DA7756; }
      100% { box-shadow: 0 0 0 0 rgba(218,119,86,0);     color: #555; }
    }
    #__inspector-pill-copy.first-hint {
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

    /* Tab panels */
    #__inspector-panels { overflow-y: auto; flex: 1; scrollbar-width: none; }
    #__inspector-panels::-webkit-scrollbar { display: none; }
    .inspector-panel { display: none; }
    .inspector-panel.active { display: block; }

    /* Sections */
    .inspector-section { padding: 12px 12px; border-bottom: 1px solid #252525; }
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
    .inspector-section-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .inspector-section-title { font-size: 11px; font-weight: 600; color: #c0c0c0; }

    /* Fields (28px height) */
    .inspector-field {
      display: flex; align-items: center;
      background: #252525; border: 1px solid #2e2e2e; border-radius: 4px;
      height: 28px; padding: 0 8px; gap: 6px; flex: 1; min-width: 0;
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
      cursor: ew-resize; user-select: none; width: 14px; text-align: center;
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
    .inspector-g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
    .inspector-row { display: flex; gap: 6px; margin-bottom: 6px; }
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
    .inspector-check-box svg { width: 10px; height: 10px; }
    .inspector-check-label { font-size: 11px; color: #888; }

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

    /* Expand button */
    .inspector-expand-btn {
      background: none; border: none; color: #444; cursor: pointer; padding: 0;
      display: flex; align-items: center;
    }
    .inspector-expand-btn svg { width: 13px; height: 13px; }
    .inspector-expand-btn:hover { color: #888; }

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

    /* Picker highlight + tooltip */
    .__inspector-highlight { outline: 2px solid #3B82F6 !important; outline-offset: 1px !important; cursor: crosshair !important; }
    #__inspector-tooltip {
      position: fixed; background: #1a1a1a; border: 1px solid #333; border-radius: 4px;
      padding: 4px 8px; font-size: 11px; color: #888; pointer-events: none; z-index: 1000000; display: none;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    /* Custom panel tooltip */
    #__inspector-panel-tip {
      position: fixed; z-index: 1000003; pointer-events: none;
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

    /* ── Element tree popup ── */
    #__inspector-tree-popup {
      display: none; position: fixed; z-index: 1000002;
      width: 272px; background: #1e1e1e; border: 1px solid #2e2e2e;
      border-radius: 10px; overflow: hidden;
      max-height: calc(100vh - 24px); overflow-y: auto; scrollbar-width: none;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04);
      font-family: Inter, system-ui, sans-serif; font-size: 11px; color: #d4d4d4;
    }
    #__inspector-tree-popup::-webkit-scrollbar { display: none; }
    #__inspector-tree-popup.visible { display: block; }
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
      display: none; position: fixed; z-index: 1000001;
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

    /* CSS Raw */
    #__inspector-css-raw {
      width: 100%; min-height: 160px; background: #1a1a1a;
      border: none; border-top: 1px solid #252525;
      color: #888; font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
      padding: 12px; resize: vertical; outline: none; line-height: 1.6;
    }
    #__inspector-css-raw:focus { color: #ccc; }

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
  `;

  // ── Inject styles ──────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.id = '__inspector-styles';
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // Highlight class needs to apply to elements inside the target document.
  // In live mode targetDoc === document and this is a no-op; in static mode
  // it's required for the picker outline to render inside the iframe.
  let targetStyleEl = null;
  if (targetDoc !== document) {
    targetStyleEl = targetDoc.createElement('style');
    targetStyleEl.id = '__inspector-target-styles';
    targetStyleEl.textContent = `
      .__inspector-highlight {
        outline: 2px solid #3B82F6 !important;
        outline-offset: 1px !important;
        cursor: crosshair !important;
      }
    `;
    targetDoc.head.appendChild(targetStyleEl);
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedElement = null;
  let pickMode = false;
  const changes = [];
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
      <button class="inspector-select-btn" id="__inspector-pick-btn" data-tip="Select — click any element on the page to inspect it">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l7 18 3-7 7-3z"/></svg>
        <span class="inspector-select-label">Select element</span>
      </button>
      <div id="__inspector-pill-wrap">
        <span id="__inspector-selector-pill" contenteditable="true" spellcheck="false">—</span>
        <button id="__inspector-pill-copy" data-tip='Copy a chat-ready intro &mdash; paste into Claude, then type your ask'>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button id="__inspector-deselect" data-tip="Clear selection">✕</button>
      </div>
      <div id="__inspector-header-controls">
        <button id="__inspector-minimize" data-tip="Minimize — collapse panel to header bar">—</button>
        <button id="__inspector-close" data-tip="Close inspector">✕</button>
      </div>
    </div>
    <div id="__inspector-tabs">
      <span class="inspector-tab active" data-tab="design">Design</span>
      <span class="inspector-tab" data-tab="raw">CSS Raw</span>
    </div>
    <div id="__inspector-panels">
      <div class="inspector-panel active" id="__inspector-panel-design"></div>
      <div class="inspector-panel" id="__inspector-panel-raw"></div>
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
  const panelTip = document.createElement('div');
  panelTip.id = '__inspector-panel-tip';
  document.body.appendChild(panelTip);
  let panelTipTimer = null;

  function showPanelTip(text, targetEl) {
    clearTimeout(panelTipTimer);
    panelTip.textContent = text;
    panelTip.classList.add('show');
    const rect = targetEl.getBoundingClientRect();
    const tipW = Math.min(220, text.length * 7 + 20);
    let left = rect.left + rect.width / 2 - tipW / 2;
    let top = rect.bottom + 6;
    if (top + 40 > window.innerHeight) top = rect.top - 36;
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
    if (tabName === 'design') renderDesignPanel();
    if (tabName === 'raw') renderCssRaw();
  }

  root.querySelectorAll('.inspector-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  root.querySelector('#__inspector-close').addEventListener('click', () => {
    root.remove();
    tooltip.remove();
    styleEl.remove();
    if (targetStyleEl) targetStyleEl.remove();
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
    treePopup.innerHTML =
      html +
      `<div class="tree-hint">Tip: click the <span class="tree-hint-key">📋 copy icon</span> next to <span class="tree-hint-sel">${sel}</span> in the header to paste a chat-ready intro — Claude will then know the selected ${kind} is <span class="tree-hint-sel">${sel}</span>.</div>`;

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

    // Measure actual height by briefly rendering off-screen
    treePopup.style.visibility = 'hidden';
    treePopup.style.top = '-9999px';
    treePopup.style.left = '-9999px';
    treePopup.classList.add('visible');
    const actualH = Math.min(treePopup.scrollHeight, window.innerHeight - 24);
    treePopup.classList.remove('visible');
    treePopup.style.visibility = '';

    let top, left;
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      left = rect.left;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      if (spaceBelow >= actualH || spaceBelow >= spaceAbove) {
        top = rect.bottom + 4;
      } else {
        top = rect.top - actualH - 4;
      }
    } else {
      left = treePopup._posX || 100;
      top = treePopup._posY || 100;
      // If would overflow bottom, flip up
      if (top + actualH > window.innerHeight - 8) {
        top = (treePopup._posY || 100) - actualH - 8;
      }
    }
    left = Math.max(4, Math.min(window.innerWidth - 276, left));
    top = Math.max(4, Math.min(window.innerHeight - actualH - 4, top));
    treePopup.style.left = left + 'px';
    treePopup.style.top = top + 'px';
    treePopup.classList.add('visible');

    setTimeout(() => document.addEventListener('click', treeOutsideClick), 0);
  }

  function closeTreePopup() {
    treePopup.classList.remove('visible');
    document.removeEventListener('click', treeOutsideClick);
  }

  function treeOutsideClick(e) {
    if (!treePopup.contains(e.target) && e.target !== root.querySelector('#__inspector-selector-pill')) {
      closeTreePopup();
    }
  }

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

  // ── Panel drag ──
  function initDrag() {
    const header = root.querySelector('#__inspector-header');
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('[contenteditable]')) return;
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

  // Wire custom tooltips — replace native title behavior
  root.addEventListener('mouseenter', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) {
      showPanelTip(el.dataset.tip, el);
      e.target.title = ''; // suppress native tooltip
    }
  }, true);
  root.addEventListener('mouseleave', (e) => {
    if (e.target.closest('[data-tip]')) hidePanelTip();
  }, true);

  // ── Forward declarations (stubs — filled in by Tasks 7-10) ────────────────
  // computeSelector is defined at module scope (above) — boot picks it up via closure.

  function trackChange(selector, property, from, to) {
    const file = cssMap[selector]?.[property]?.file ?? null;
    const line = cssMap[selector]?.[property]?.line ?? null;
    const existing = changes.findIndex(c => c.selector === selector && c.property === property);
    const originalFrom = existing >= 0 ? changes[existing].from : from;

    if (to === originalFrom) {
      if (existing >= 0) changes.splice(existing, 1);
      redoStack.length = 0;
      syncBadge();
      syncModifiedIndicators();
      return;
    }

    redoStack.length = 0;   // clear redo on any new edit
    if (existing >= 0) {
      changes[existing].to = to;
    } else {
      changes.push({ selector, property, from, to, file, line });
    }
    syncBadge();
    syncModifiedIndicators();
  }
  function undoChange(index) {
    changes.splice(index, 1);
    syncBadge();
    syncModifiedIndicators();
  }

  function syncBadge() {
    const undoBtn = root.querySelector('#__inspector-undo');
    const redoBtn = root.querySelector('#__inspector-redo');
    if (undoBtn) undoBtn.disabled = changes.length === 0;
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
    if (idx >= 0) changes.splice(idx, 1);
    syncBadge();
    syncModifiedIndicators();
  }

  function undoLast() {
    if (changes.length === 0) return;
    const last = changes.pop();
    redoStack.push(last);
    if (selectedElement) {
      selectedElement.style.removeProperty(last.property);
    }
    syncBadge();
    syncModifiedIndicators();
  }

  function redoLast() {
    if (redoStack.length === 0) return;
    const entry = redoStack.pop();
    changes.push(entry);
    if (selectedElement) {
      selectedElement.style.setProperty(entry.property, entry.to);
    }
    syncBadge();
    syncModifiedIndicators();
  }

  function generateChangesJson() {
    return JSON.stringify(changes, null, 2);
  }
  function generateCopyPrompt() {
    if (changes.length === 0) return 'No changes to apply.';
    const lines = changes.map(c =>
      `- \`${c.selector}\`: ${c.property} ${c.from} → ${c.to}`
    );
    const summary = 'Apply these CSS changes:\n' + lines.join('\n');
    const json = JSON.stringify(changes);
    return `${summary}\n\n<changes>\n${json}\n</changes>`;
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
      <button class="layer-eye-btn${isHidden ? ' hidden' : ''}" data-layer-eye="${id}" data-tip="${isHidden ? 'Show layer' : 'Hide layer'}">${isHidden ? SVG_EYE_OFF : SVG_EYE}</button>
      <button class="layer-minus-btn" data-layer-remove="${id}" data-tip="Remove layer">−</button>
    </div>`;
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
        <button class="layer-add-btn" data-layer-add="fill" data-tip="Add fill layer"${hasBg ? ' disabled' : ''}>${SVG_PLUS}</button>
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
        <button class="layer-add-btn" data-layer-add="stroke" data-tip="Add stroke"${hasBorder ? ' disabled' : ''}>${SVG_PLUS}</button>
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
      <button class="layer-eye-btn${isHidden ? ' hidden' : ''}" data-layer-eye="${id}" data-tip="Toggle effect">${isHidden ? SVG_EYE_OFF : SVG_EYE}</button>
      <button class="layer-minus-btn" data-layer-remove="${id}" data-tip="Remove effect">−</button>
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
        <button class="layer-add-btn" data-layer-add="effect" data-tip="Add effect">${SVG_PLUS}</button>
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
        <span class="inspector-fi" data-scrub="${property}" data-tip="${tip}">${label}</span>
        <input value="${value}" data-prop="${property}" data-sel="${sel}" data-from="${value}">
        ${unitHtml}
        <button class="inspector-reset-btn" data-reset="${property}" data-tip="Reset ${property} to original value">×</button>
      </div>`;
    }

    function iconField(svgHtml, property, value, unit) {
      const unitHtml = unit ? `<span class="inspector-fu">${unit}</span>` : '';
      const tip = TIPS[property] || property;
      return `<div class="inspector-field" data-prop="${property}">
        <span class="inspector-fi" data-scrub="${property}" data-tip="${tip}">${svgHtml}</span>
        <input value="${value}" data-prop="${property}" data-sel="${sel}" data-from="${value}">
        ${unitHtml}
        <button class="inspector-reset-btn" data-reset="${property}" data-tip="Reset ${property} to original value">×</button>
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
          <button class="inspector-section-chevron" data-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="inspector-g3" style="margin-bottom:6px;">
          ${field('X', 'left', pxStr(cs.left), 'px')}
          ${field('Y', 'top', pxStr(cs.top), 'px')}
          ${field('Z', 'z-index', cs.zIndex === 'auto' ? '0' : cs.zIndex, '')}
        </div>
        <div class="inspector-row">
          ${iconField('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>', 'rotate', '0', '°')}
          <div class="inspector-ig" style="flex:1;padding:2px;gap:2px;">
            <button class="inspector-ig-btn" data-action="reset" data-tip="${TIPS['reset']}">${icons.reset}</button>
            <button class="inspector-ig-btn" data-action="flipH" data-tip="${TIPS['flipH']}">${icons.flipH}</button>
            <button class="inspector-ig-btn" data-action="flipV" data-tip="${TIPS['flipV']}">${icons.flipV}</button>
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

    const layoutHtml = `
      <div class="inspector-section">
        <div class="inspector-section-hd" style="cursor:pointer;" data-collapse="section">
          <span class="inspector-section-title">Layout</span>
          <button class="inspector-section-chevron" data-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="inspector-sub-label" style="margin-top:0;">Flow</div>
        <div class="inspector-row"><div class="inspector-ig">
          <button class="inspector-ig-btn${isRow ? ' on' : ''}" data-flow="row" data-tip="${TIPS['row']}">${flowIcons.row}</button>
          <button class="inspector-ig-btn${isCol ? ' on' : ''}" data-flow="column" data-tip="${TIPS['column']}">${flowIcons.col}</button>
          <button class="inspector-ig-btn${isWrap ? ' on' : ''}" data-flow="wrap" data-tip="${TIPS['wrap']}">${flowIcons.wrap}</button>
          <button class="inspector-ig-btn${isGrid ? ' on' : ''}" data-flow="grid" data-tip="${TIPS['grid']}">${flowIcons.grid}</button>
        </div></div>
        <div class="inspector-sub-label">Dimensions</div>
        <div class="inspector-g2" style="margin-bottom:8px;">
          ${field('W', 'width', pxStr(cs.width), 'px')}
          ${field('H', 'height', pxStr(cs.height), 'px')}
        </div>
        <div class="inspector-sub-label" style="margin-top:0;">
          <span>Padding &amp; Margin</span>
          <button class="inspector-expand-btn" data-expand="spacing" data-tip="Expand individual margin and padding controls">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="2"/></svg>
          </button>
        </div>
        <div class="inspector-sp-widget" style="margin-bottom:4px;">
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
        <div id="__inspector-sp-expanded" style="display:none;">
          <div class="inspector-sp-expanded">
            <div class="inspector-sp-expanded-title">Padding — individual</div>
            <div class="inspector-sp-4">
              ${field('↑', 'padding-top', pt, 'px')}
              ${field('→', 'padding-right', pr, 'px')}
              ${field('↓', 'padding-bottom', pb, 'px')}
              ${field('←', 'padding-left', pl, 'px')}
            </div>
          </div>
          <div class="inspector-sp-expanded" style="margin-top:6px;">
            <div class="inspector-sp-expanded-title">Margin — individual</div>
            <div class="inspector-sp-4">
              ${field('↑', 'margin-top', mt, 'px')}
              ${field('→', 'margin-right', mr, 'px')}
              ${field('↓', 'margin-bottom', mb, 'px')}
              ${field('←', 'margin-left', ml, 'px')}
            </div>
          </div>
        </div>
        <div class="inspector-check-row" data-check="overflow" data-tip="Clip content — hide overflow: hidden clips content outside the element bounds">
          <div class="inspector-check-box${cs.overflow === 'hidden' ? ' on' : ''}">
            <svg viewBox="0 0 10 10" fill="none" stroke="${cs.overflow === 'hidden' ? '#1c1c1c' : 'transparent'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
          </div>
          <span class="inspector-check-label">Clip content</span>
        </div>
        <div class="inspector-check-row" data-check="box-sizing" data-tip="Border box — box-sizing: border-box makes width/height include padding and border">
          <div class="inspector-check-box${cs.boxSizing === 'border-box' ? ' on' : ''}">
            <svg viewBox="0 0 10 10" fill="none" stroke="${cs.boxSizing === 'border-box' ? '#1c1c1c' : 'transparent'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,5 3.5,7.5 8.5,2"/></svg>
          </div>
          <span class="inspector-check-label">Border box</span>
        </div>
      </div>`;

    // ── APPEARANCE ──
    const appearanceHtml = `
      <div class="inspector-section">
        <div class="inspector-section-hd" style="cursor:pointer;" data-collapse="section">
          <span class="inspector-section-title">Appearance</span>
          <button class="inspector-section-chevron" data-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
        <div class="inspector-g2">
          ${iconField(icons.opacity, 'opacity', pxStr(parseFloat(cs.opacity) * 100), '%')}
          ${iconField(icons.radius, 'border-radius', pxStr(cs.borderRadius), 'px')}
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
          <button class="inspector-section-chevron" data-tip="Click to collapse/expand this section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>
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
        <div style="font-size:10px;color:#555;margin-bottom:5px;">Alignment</div>
        <div class="inspector-ig">
          <button class="inspector-ig-btn${textAlign === 'left' || textAlign === 'start' ? ' on' : ''}" data-align="left" data-tip="Align text left">${alignIcons.left}</button>
          <button class="inspector-ig-btn${textAlign === 'center' ? ' on' : ''}" data-align="center" data-tip="Align text center">${alignIcons.center}</button>
          <button class="inspector-ig-btn${textAlign === 'right' || textAlign === 'end' ? ' on' : ''}" data-align="right" data-tip="Align text right">${alignIcons.right}</button>
          <div class="inspector-ig-sep"></div>
          <button class="inspector-ig-btn" data-valign="top" data-tip="Vertical align top">${alignIcons.vTop}</button>
          <button class="inspector-ig-btn" data-valign="middle" data-tip="Vertical align middle">${alignIcons.vMid}</button>
          <button class="inspector-ig-btn" data-valign="bottom" data-tip="Vertical align bottom">${alignIcons.vBot}</button>
        </div>
      </div>`;

    // ── LAYER SECTIONS ──
    const fillHtml = buildFillSection(cs, sel);
    const strokeHtml = buildStrokeSection(cs, sel);
    const effectsHtml = buildEffectsSection(cs, sel);

    // ── RENDER ALL ──
    panel.innerHTML = positionHtml + layoutHtml + appearanceHtml + typographyHtml + fillHtml + strokeHtml + effectsHtml;

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

    // Expand/collapse spacing
    panel.querySelectorAll('.inspector-expand-btn[data-expand="spacing"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const expanded = panel.querySelector('#__inspector-sp-expanded');
        if (expanded) expanded.style.display = expanded.style.display === 'none' ? 'block' : 'none';
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

  function wireUpInputs(panel, sel) {
    // Resolve the CSS value to apply, given the input's raw text + displayed unit.
    // Special cases:
    //   - opacity with % unit: 50 → "0.5" (CSS opacity is 0-1, not 0-100)
    //   - ° unit (rotate): 45 → "45deg"
    //   - numeric value + numeric unit: "32" + "px" → "32px"
    //   - non-numeric ("auto", "normal"): pass through as-is
    function cssValueFor(prop, raw, unit) {
      if (raw === '' || raw === '-' || raw == null) return null; // mid-typing
      const trimmed = String(raw).trim();
      const num = parseFloat(trimmed);
      if (isNaN(num)) return trimmed; // 'auto', 'normal', etc.
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

    panel.querySelectorAll('.inspector-field input, .inspector-field-sm input').forEach(input => {
      if (input.dataset._wired) return;
      input.dataset._wired = '1';
      const prop = input.dataset.prop;

      // `input` event = live preview while typing (no trackChange churn).
      input.addEventListener('input', (e) => {
        const value = cssValueFor(prop, e.target.value, unitFor(e.target));
        if (value == null) return;
        if (selectedElement) selectedElement.style.setProperty(prop, value);
      });

      // `change` (blur/Enter) commits and records in trackChange.
      input.addEventListener('change', (e) => {
        const from = e.target.dataset.from;
        const value = cssValueFor(prop, e.target.value, unitFor(e.target));
        if (value == null) return;
        if (selectedElement) selectedElement.style.setProperty(prop, value);
        trackChange(sel, prop, from, value);
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
      });

      function onMove(e) {
        if (!input) return;
        const delta = e.clientX - startX;
        const multiplier = e.shiftKey ? 10 : 1;
        const unit = input.closest('.inspector-field, .inspector-field-sm')?.querySelector('.inspector-fu')?.textContent || '';
        let newVal = Math.round(startVal + delta * multiplier);
        if (unit === '%') newVal = Math.min(100, Math.max(0, newVal));
        input.value = String(newVal);
        const prop = input.dataset.prop;
        if (selectedElement && prop) {
          selectedElement.style.setProperty(prop, newVal + unit);
        }
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (input) {
          const prop = input.dataset.prop;
          const from = input.dataset.from;
          const unit = input.closest('.inspector-field, .inspector-field-sm')?.querySelector('.inspector-fu')?.textContent || '';
          trackChange(sel, prop, from, input.value + unit);
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
      <div class="inspector-section" style="border-top:1px solid #111;">
        <div class="inspector-section-title">Apply raw edits</div>
        <button id="__inspector-apply-raw" class="inspector-input" style="width:100%;cursor:pointer;text-align:center;padding:6px;">
          Apply to tracker
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
  function renderChangesBar() {
    const bar = root.querySelector('#__inspector-changes-bar');
    const countEl = root.querySelector('#__inspector-bar-count');
    if (!bar) return;

    const hasActivity = changes.length > 0 || redoStack.length > 0;
    if (!hasActivity) {
      bar.classList.remove('visible');
      const drawer = root.querySelector('#__inspector-bar-drawer');
      if (drawer) drawer.classList.remove('open');
    } else {
      bar.classList.add('visible');
      const pill = root.querySelector('#__inspector-changes-pill');
      if (pill) pill.style.display = changes.length > 0 ? '' : 'none';
      if (countEl && changes.length > 0) countEl.textContent = String(changes.length);
    }

    const drawer = root.querySelector('#__inspector-bar-drawer');
    if (drawer?.classList.contains('open')) renderChangesDrawer();
  }

  function renderChangesDrawer() {
    const drawer = root.querySelector('#__inspector-bar-drawer');
    if (!drawer) return;
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const rows = changes.map((c, i) => `
      <div class="changes-row">
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

    drawer.innerHTML = `
      <div class="changes-drawer-hd">
        <div class="changes-drawer-hd-left">
          <span class="changes-drawer-title">${changes.length} Change${changes.length !== 1 ? 's' : ''}</span>
          <span class="changes-drawer-pending">pending</span>
        </div>
        <button class="changes-drawer-close" title="Close">✕</button>
      </div>
      ${rows}
      <button class="changes-bar-copy" id="__inspector-bar-copy">✦&nbsp; Copy Prompt for Claude</button>
    `;

    drawer.querySelectorAll('.changes-row-rm').forEach(btn => {
      btn.addEventListener('click', () => {
        undoChange(parseInt(btn.dataset.index));
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
    tooltip.style.display = 'none';
    targetDoc.removeEventListener('mouseover', onPickHover, true);
    targetDoc.removeEventListener('click', onPickClick, true);
    targetDoc.removeEventListener('contextmenu', onPickRightClick, true);
  }

  function onPickHover(e) {
    if (e.target.closest && e.target.closest('#__inspector-root')) return;
    targetDoc.querySelectorAll('.__inspector-highlight').forEach(el =>
      el.classList.remove('__inspector-highlight')
    );
    e.target.classList.add('__inspector-highlight');
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

  function copySelectionIntro() {
    if (!selectedElement) return;
    const kind = elementKind(selectedElement);
    const sel = computeSelector(selectedElement);
    const tag = selectedElement.tagName.toLowerCase();
    const intro = `Let's talk about this ${kind} \`${sel}\` (${tag}): `;
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(intro).then(() => {
      const btn = root.querySelector('#__inspector-pill-copy');
      if (!btn) return;
      btn.classList.add('just-copied');
      setTimeout(() => btn.classList.remove('just-copied'), 1500);
    });
  }
  root.querySelector('#__inspector-pill-copy')
      ?.addEventListener('click', copySelectionIntro);

  // First selection of the session: pulse the Copy button so the user
  // discovers the chat handoff. Pulses only once per page load.
  let hasShownCopyHint = false;

  function setSelection(el) {
    selectedElement = el;
    root.querySelector('#__inspector-pick-btn').classList.add('has-selection');
    root.querySelector('#__inspector-header').classList.add('has-selection');
    root.querySelector('#__inspector-selector-pill').textContent = computeSelector(el);
    if (!hasShownCopyHint) {
      hasShownCopyHint = true;
      const btn = root.querySelector('#__inspector-pill-copy');
      if (btn) {
        btn.classList.add('first-hint');
        // Remove the class after the animation so re-adding it later works.
        setTimeout(() => btn.classList.remove('first-hint'), 3200);
      }
    }
  }

  function clearSelection() {
    selectedElement = null;
    root.querySelector('#__inspector-pick-btn').classList.remove('has-selection');
    root.querySelector('#__inspector-header').classList.remove('has-selection');
    root.querySelector('#__inspector-selector-pill').textContent = '—';
    renderDesignPanel();
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
    setSelection(e.target);
    exitPickMode();
    switchTab('design');
  }

  } // ── end boot() ───────────────────────────────────────────────────────────

})();
