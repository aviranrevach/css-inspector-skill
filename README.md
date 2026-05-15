# CSS Inspector — Claude Code Skill

A visual CSS inspector that lives inside your browser, built for Claude Code. Pick any element on your page, tweak its styles in real time, then let Claude apply the changes back to your source files — no DevTools, no manual diffs.

---

## What it does

The inspector docks to the top-right of your page (draggable, resizable, minimizable). Click **Select**, pick any element, and edit its styles in four collapsible sections:

| Section | Properties |
|---|---|
| Position | X / Y / Z, rotation, flip |
| Layout | flow (block/flex/grid/inline), width × height, padding & margin diagram, clip-content, border-box |
| Appearance | opacity, border-radius, fill, stroke, shadow |
| Typography | font family, size, weight, line height, color |

Every change previews live on the page. Prefer raw CSS? The **CSS Raw** tab shows the matched stylesheet rules as editable text and can apply them back to the change tracker.

When you're done, the bottom **Changes** bar shows undo / redo and a count of tracked edits. Click the pill to expand the list, then **Copy Prompt** — and paste back into Claude. Claude reads the structured `<changes>` block, updates the source files precisely, shows you a diff, and asks for confirmation before saving.

---

## How it attaches

| Project type | How it attaches |
|---|---|
| Static HTML + CSS | Serves your files locally on port 8787, wraps `index.html` in an iframe inside `inspector.html` |
| Vite / React / Vue / Next.js | Temporarily injects a `<script>` tag into your `index.html` (or `public/index.html`) — removed automatically when done |

Claude detects which mode to use. If it's ambiguous, it asks.

---

## How to trigger

Say any of these in Claude Code:

> "inspect my page"
> "let me tweak the styles"
> "visual CSS editor"
> "open the CSS inspector"
> "I want to edit styles visually"

---

## Picking elements

Click the **Select** button in the header → click any element on the page. The blue outline shows what you're about to select. The selector pill at the top shows what's currently selected (e.g. `.hero-title`, `#main-heading`).

**Right-click** a picked element to open the **element-tree popup** — a small overlay showing the parent chain and siblings. Click any entry to jump the selection up or sideways through the DOM without leaving picker mode.

---

## Editing styles

Open the **Design** tab. Sections collapse with a chevron; they remember their state between sessions. Every edit previews live — no reload needed.

Highlights:

- **Padding / margin diagram** — a visual box-model diagram with separate input fields for each of the eight edges; lock-toggle for symmetric values.
- **Color picker** — solid + linear-gradient with stops, an eyedropper, hex / HSL inputs, and an opacity slider. Click any swatch to open it inline.
- **Scrub-spacing** — drag horizontally on any numeric input (padding, margin, font-size, etc.) to nudge the value live.
- **Layers** — for shadows and gradients, layer rows with eye / remove / reorder controls.

---

## Reviewing your changes

The bottom **Changes** bar is always visible:

```
[ ↶ ] [ ↷ ]   (5) Changes to execute ▾                [Copy Prompt]
```

- Undo / Redo step backwards and forwards through every edit you've made.
- Click the pill to expand the drawer:

```
.hero-title · font-size    →  64px   ↩
.hero-title · color        →  #3B82F6 ↩
.nav        · padding      →  16px    ↩
```

- Each row has an individual undo. **Copy Prompt** copies the whole batch to your clipboard.

---

## What gets copied

```
Apply these CSS changes:
- `.hero-title`: font-size 48px → 64px
- `.hero-title`: color #ffffff → #3B82F6
- `.nav`: padding 0px → 16px

<changes>
[{"selector":".hero-title","property":"font-size","from":"48px","to":"64px","file":"styles.css","line":12}, ...]
</changes>
```

Claude parses the `<changes>` JSON block and updates the source files precisely (surgical in-place edit by selector + line number).

---

## How changes get applied

- **CSS / SCSS files** — in-place edit using selector + line from the changes block.
- **Component files** (CSS-in-JS, CSS Modules, Vue scoped, Svelte) — Claude locates the style declaration and updates it.
- **External stylesheets** (Tailwind CDN, etc.) — Claude adds an override rule to your project's own CSS.

A unified diff is shown before any file is written.

---

## Install

Clone the repo and run the install script:

```bash
git clone https://github.com/aviranrevach/css-inspector-skill ~/code/css-inspector
cd ~/code/css-inspector
./bin/install
```

`bin/install` creates a symlink at `~/.claude/skills/css-inspector` pointing at the cloned repo, so the skill loaded by Claude Code is always the repo's current HEAD. To remove: `./bin/uninstall`.

If you keep skills somewhere other than `~/.claude/skills`, set `CLAUDE_SKILLS_DIR` before running install.

**Requirements:** Python 3 (for the static-mode server) · Node.js 18+ (for tests) · Claude Code.

---

## Tests

```bash
npm test          # unit tests (selector, change tracker, copy prompt) — no install needed
npm install       # one-time, for the e2e suite
npm run test:e2e  # Playwright integration test for the iframe-aware picker
npm run test:all  # both
```

The e2e test (`tests/e2e/picker.spec.mjs`) is a regression guard for the iframe-picker bug: it spawns the static-mode server, loads `inspector.html` headlessly, clicks **Select**, picks `.hero-title` inside the iframe, and asserts the selector pill updates to `#main-heading` and that the Design panel reads a real `font-size` value through `targetWin.getComputedStyle`.

---

## File structure

```
css-inspector/
├── SKILL.md          # Claude workflow instructions (the brain)
├── overlay.js        # Inspector panel UI — injected into your page
├── server.py         # Local file server for static HTML projects
├── bin/
│   ├── install       # Symlink into ~/.claude/skills/css-inspector
│   └── uninstall     # Remove that symlink
├── tests/
│   ├── fixture.html              # Sample page for manual + E2E tests
│   ├── test-selector.js          # Unit tests — selector computation
│   ├── test-tracker.js           # Unit tests — change tracking
│   ├── test-prompt.js            # Unit tests — copy prompt format
│   ├── test-overlay-load.html    # Smoke test for overlay boot
│   └── e2e/
│       └── picker.spec.mjs       # Playwright: iframe-aware picker regression guard
├── playwright.config.mjs
└── package.json
```

---

## Design

Cold dark neutrals (`#1c1c1c` panel, `#d4d4d4` text) with Claude coral (`#DA7756`) on the selector pill, active accents, and the Copy Prompt button. Blue (`#3B82F6`) for the picker outline and Select button accent.

---

## Architecture notes

`overlay.js` is iframe-aware. In static mode the inspector page wraps the user's `index.html` in an `<iframe>`, and the overlay panel lives in the parent document. The overlay resolves `targetDoc` / `targetWin` from `iframe.contentDocument` after the frame's `load` event, then binds the picker listeners, `getComputedStyle` reads, and `document.styleSheets` iteration against the iframe's document — so a click inside the iframe is observed correctly by a panel that lives outside it.
