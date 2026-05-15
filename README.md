# CSS Inspector — Claude Code Skill

A visual CSS inspector that lives inside your browser, built for Claude Code. Pick any element on your page, tweak its styles in real time, then let Claude apply the changes back to your source files — no DevTools, no manual diffs.

---

## What it looks like

```
┌─────────────────────────────────┐
│ CSS Inspector        .hero-title│  ← selector pill (coral)
├──────────────────────────────────┤
│ Picker  Design  CSS Raw  Changes │  ← active tab has coral underline
├──────────────────────────────────┤
│ POSITION & LAYOUT                │
│  Display       block             │
│  Width         1200px            │
│  Height        auto              │
│ SPACING                          │
│  Padding       80px 40px         │
│  Margin        0                 │
│ TYPOGRAPHY                       │
│  Font Family   Inter             │
│  Font Size     48px      ← edit  │
│  Font Weight   700               │
│  Color         ■ #ffffff         │
│ BACKGROUND                       │
│  Background    ■ #1a1a2e         │
│ BORDER                           │
│  Border Radius 0px               │
│ SHADOW & BLUR                    │
│  Box Shadow    none              │
├──────────────────────────────────┤
│        [ Copy Prompt ]           │  ← coral button
└──────────────────────────────────┘
```

The panel appears fixed in the top-right corner of your page. It never breaks your layout.

---

## How to use it

### 1. Trigger the skill

Say any of these in Claude Code:

> "inspect my page"  
> "let me tweak the styles"  
> "visual CSS editor"  
> "open the CSS inspector"  
> "I want to edit styles visually"

Claude detects whether you have a dev server running or plain HTML files, and launches the inspector accordingly.

---

### 2. Pick an element

Click the **Picker** tab → hit **Pick element** → hover over anything on your page. A blue outline shows what you're about to select. Click to lock it in.

The selector pill at the top updates to show exactly which element is selected (e.g. `.hero-title`, `#main-heading`).

---

### 3. Edit in the Design panel

Switch to the **Design** tab. You'll see all computed styles grouped by category:

| Group | Properties |
|---|---|
| Position & Layout | display, position, width, height |
| Spacing | padding, margin |
| Typography | font-family, font-size, font-weight, line-height, letter-spacing, color |
| Background | background-color |
| Border | border-width, border-style, border-color, border-radius |
| Shadow & Blur | box-shadow, filter |

Every change previews **live on the page** — no reload needed.

Prefer working in raw CSS? The **CSS Raw** tab shows the matched stylesheet rules as editable text.

---

### 4. Review your changes

Open the **Changes** tab to see everything you've edited:

```
.hero-title · font-size    →  64px   ↩
.hero-title · color        →  #3B82F6 ↩
.nav        · padding      →  16px    ↩
```

Each change has an undo button. When you're happy, click **Copy Prompt**.

---

### 5. Paste into Claude

The copied prompt looks like this:

```
Apply these CSS changes:
- `.hero-title`: font-size 48px → 64px
- `.hero-title`: color #ffffff → #3B82F6
- `.nav`: padding 0px → 16px

<changes>
[{"selector":".hero-title","property":"font-size","from":"48px","to":"64px","file":"styles.css","line":12}, ...]
</changes>
```

Paste it back into Claude Code. Claude reads the structured `<changes>` block, updates the source files precisely, shows you a diff, and asks for confirmation before saving.

---

## Works with any project

| Project type | How it attaches |
|---|---|
| Static HTML + CSS | Serves your files locally on port 8787, wraps in inspector |
| Vite, React, Vue, Next.js | Temporarily injects a `<script>` tag into your `index.html` — removed automatically when done |

Claude detects which mode to use. If it's ambiguous, it asks.

---

## Install

Copy the skill folder into your Claude skills directory:

```bash
cp -r css-inspector ~/.claude/skills/
```

Or clone directly:

```bash
git clone https://github.com/aviranrevach/css-inspector-skill ~/.claude/skills/css-inspector
```

**Requirements:** Python 3 (for static mode server) · Node.js 18+ · Claude Code

---

## File structure

```
css-inspector/
├── SKILL.md          # Claude workflow instructions (the brain)
├── overlay.js        # Inspector panel UI — injected into your page
├── server.py         # Local file server for static HTML projects
└── tests/
    ├── test-selector.js   # Unit tests — selector computation
    ├── test-tracker.js    # Unit tests — change tracking
    ├── test-prompt.js     # Unit tests — copy prompt format
    └── fixture.html       # Sample page for manual testing
```

---

## Design

The inspector uses a **Vercel-structure + Claude accent** theme — cold dark neutrals with Claude coral (`#DA7756`) on the selector pill, active tab underline, input focus rings, change arrows, and the Copy Prompt button.

---

## How changes get applied

When Claude receives your Copy Prompt:

- **CSS/SCSS files** — surgical in-place edit using the selector and line number from the changes block
- **Component files** (CSS-in-JS, CSS Modules, Vue scoped, Svelte) — Claude finds the style declaration and updates it
- **External stylesheets** (Tailwind CDN, etc.) — Claude adds an override rule to your project's own CSS

Always shows a diff before writing anything.
