# Changelog

All notable changes to this skill are recorded here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] — 2026-05-15

The first proper release. Captures the redesigned panel that had been deployed
ad-hoc into a downstream project but never landed back in the canonical skill
source, plus the iframe-aware picker fix discovered while testing the
release.

### Added

- **Redesigned inspector panel.** Replaces the v1 four-tab layout (Picker /
  Design / CSS Raw / Changes) with a denser, draggable, resizable, minimizable
  panel:
  - Header: **Select** button + selector pill + minimize / close.
  - Tabs: **Design** (default) and **CSS Raw**.
  - Design panel sections (collapsible, state remembered): **Position**,
    **Layout**, **Appearance**, **Typography**.
  - Padding / margin diagram with per-edge inputs and a lock-toggle for
    symmetric values.
  - Color picker: solid + linear-gradient with stops, eyedropper, hex / HSL,
    opacity slider, inline open from any swatch.
  - Scrub-spacing: horizontal drag on any numeric input nudges the value live.
  - Layer rows (shadows, gradients) with eye / remove / reorder controls.
  - Right-click a picked element to open the **element-tree popup** for
    parent / sibling navigation without leaving picker mode.
  - Bottom **Changes bar**: undo / redo + "Changes to execute" pill that
    expands into the per-change list; Copy Prompt lives in the pill.
- **Area-selection mode.** ⇧-click multiple elements while in pick mode
  to build a group; an area bar between header and tabs shows
  "area · N els" with **Copy** (clipboard) and **✕** (clear) buttons.
  Parallel to the single-element "the selected element" workflow, the
  group powers the **"this selected area"** chat reference — useful for
  refactor / layout asks that span multiple elements without committing
  to specific CSS edits. Area members get a persistent dashed coral
  outline; single-element selection (which drives the Design tab) is
  orthogonal.
- `bin/install` and `bin/uninstall` — symlink-based deploy so
  `~/.claude/skills/css-inspector` always points at the repo HEAD. Honors
  `CLAUDE_SKILLS_DIR` for non-standard layouts.
- `package.json` with `npm test` (unit) and `npm run test:e2e`
  (Playwright integration).
- `tests/e2e/picker.spec.mjs` — Playwright regression guard for the
  iframe-aware picker (spawns server.py, picks `.hero-title` through the
  iframe, asserts the selector pill and Design panel populate correctly).
- `tests/test-overlay-loads.js` — smoke test that fails immediately if
  overlay.js stops parsing or its exports break.
- `CHANGELOG.md` and `LICENSE` (MIT).

### Changed

- **Iframe-aware picker.** Static mode wraps the user's page in an iframe
  inside `inspector.html`. The overlay panel lives in the parent document,
  but picker listeners, highlight CSS, `getComputedStyle` reads, and
  `document.styleSheets` iteration are now routed through
  `iframe.contentDocument` / `contentWindow`. The boot wrapper waits past
  the initial `about:blank` document before binding so listeners attach to
  the real page document. Tooltip coordinates are translated by
  `iframe.getBoundingClientRect()` so the pill follows the cursor across
  the iframe boundary.
- `computeSelector` moved to module scope so unit tests import the real
  implementation from `overlay.js` rather than redeclaring it.
- `SKILL.md` Step 5 rewritten for the new panel layout; Step 6 unchanged —
  the `<changes>` JSON contract Claude consumes is stable across v1 → v2.
- `README.md` rewritten to describe the new feature set and install via
  `bin/install`.
- `.gitignore` added covering `.inspector/`, `.playwright-mcp/`,
  `.superpowers/`, `docs/superpowers/`, `node_modules/`, IDE folders,
  and Playwright caches.

### Fixed

- **Picker doesn't pick.** Before the iframe-aware fix, clicking **Select**
  toggled the button on but no hover / click ever registered because the
  listeners were attached to the parent document while the page lived
  inside an iframe.

## [1.0.0] — 2026-04-13

Initial unreleased version of the skill.

- Four-tab inspector panel (Picker, Design, CSS Raw, Changes).
- Static mode + live-mode deployment.
- cssMap → file/line round-trip via the `<changes>` JSON block.
- Unit tests for selector / tracker / copy-prompt logic (duplicated from
  overlay.js).

[2.0.0]: #200--2026-05-15
[1.0.0]: #100--2026-04-13
