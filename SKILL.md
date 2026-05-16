---
name: css-inspector
description: Launch a visual CSS inspector panel on any HTML project. Triggers on: "inspect my page", "visual CSS editor", "let me tweak the styles", "open the CSS inspector", "I want to edit styles visually"
---

# CSS Inspector Skill

When this skill is triggered, follow these steps exactly.

## Step 1 — Clean up any previous session

Search the project for leftover injection markers and remove them:

```bash
grep -rl "css-inspector:start" . --include="*.html" 2>/dev/null
```

For each file found, remove the block between `<!-- css-inspector:start -->` and `<!-- css-inspector:end -->` (inclusive).

## Step 2 — Gitignore setup

Check if `.gitignore` exists. If so, add `.inspector/` if not already present. If not, create it with `.inspector/`.

## Step 3 — Detect project type

**Live mode:** Check if a dev server is running on common ports:
```bash
lsof -i :3000 -i :5173 -i :4200 -i :8080 | grep LISTEN
```
If found → **live mode** with that port.

**Static mode:** If no dev server found and `index.html` exists in the project → **static mode**.

**Ambiguous:** Ask the user: "Is there a dev server running, or should I serve the HTML files directly?"

## Step 3.5 — Design system detection (always run)

Detect which design system (if any) the project uses. The result is written to `.inspector/settings.json` and consumed by the inspector to power the "Component" section of the Design tab.

1. **Read `package.json`** (if present) and check `dependencies` + `devDependencies` for these fingerprints:

   | System | Signal in deps |
   |---|---|
   | shadcn | any `@radix-ui/*` package **and** `class-variance-authority` |
   | mui | `@mui/material` or `@mui/joy` |
   | chakra | `@chakra-ui/react` |
   | mantine | `@mantine/core` |
   | antd | `antd` |
   | nextui | `@nextui-org/react` |
   | tailwind | `tailwindcss` (devDependencies counts) |

2. **Look for corroborating project files** to upgrade confidence:
   - `components.json` at the project root → strong shadcn signal
   - `src/components/ui/*.tsx` files that import from `class-variance-authority` → strong shadcn signal
   - `tailwind.config.{js,ts,mjs}` → tailwind confirmed

3. **Classname-only fallback** (when there's no `package.json`, e.g. static HTML): grep the rendered HTML for class prefixes:
   - `ant-*` → antd
   - `chakra-*` → chakra
   - `MuiButton-*` or emotion `css-*` patterns → mui
   - lots of `bg-*`, `text-*`, `rounded-*` utilities → tailwind

4. **Pick a winner** by confidence:
   - **High**: deps signal + at least one corroborating file or matching classnames
   - **Medium**: deps signal alone
   - **Low**: only classnames
   - If multiple match (e.g. tailwind + shadcn), prefer the higher layer (shadcn over tailwind).

5. **Build `settings.json`**. If the winner has a preset shipped under `~/.claude/skills/css-inspector/presets/<system>.json`, read it and inline its manifest:

   ```json
   {
     "detection": {
       "detected": [
         { "system": "shadcn", "confidence": "high",
           "signals": ["@radix-ui/react-slot in deps", "components.json at root", "src/components/ui/button.tsx uses cva"] }
       ],
       "recommended": "shadcn"
     },
     "preset": "shadcn",
     "manifest": { /* contents of presets/shadcn.json, inlined */ }
   }
   ```

   If no system matched: `recommended: null`, `preset: "claude"` (Claude design — Claude identifies components on the fly), `manifest: { "components": [] }`.

   Valid `preset` values: `"claude"`, `"shadcn"`, `"mui"`, `"chakra"`, `"mantine"`, `"antd"`, `"nextui"`, `"tailwind"`, `"custom"`, `"none"`. Picking `"none"` disables the Component section entirely. Picking `"claude"` skips the manifest and surfaces an "Ask Claude" action for every pick.

6. **Write the file**: `.inspector/settings.json`. Create `.inspector/` if it doesn't exist (it normally will by the time step 4a/4b runs, but this step can come first).

## Step 3.6 — Custom design-system manifest (run when no preset matched)

**Trigger:** Step 3.5 wrote `"recommended": null` (no known design system detected) **and** the project has source files that look hand-authored (custom React/JSX/Vue/Svelte/etc.). Skip this step if the recommended preset is one of the shipped ones — that preset's manifest already covers detection.

The goal: build a `design-system.json` describing the project's components so the inspector's Component section can identify them by classname instead of always falling back to "Ask Claude."

1. **Scan the source files** for component definitions. Prioritize, in order:
   - `*.jsx` / `*.tsx` files in `src/`, `app/`, `components/`, or the project root
   - `*.vue` / `*.svelte` files if present
   - `*.html` files with non-trivial markup (for static prototypes)

   For each file, find:
   - Component declarations (`function ComponentName(...)`, `const ComponentName = (...) =>`, `export function`, `export default function`)
   - The root JSX element's `className` — note all classname fragments, especially those that look like component identifiers (`card`, `chip`, `pill`, `btn`, `*-card`, etc.)
   - Conditional classnames driven by props (`className={\`base ${variant === 'foo' ? 'class-a' : 'class-b'}\`}`, `clsx(...)`, template strings) — these are variant signals.

2. **Pick component-worthy entries.** Keep only components that:
   - Have at least one distinctive classname on the root element (a class that wouldn't match unrelated components)
   - Are reusable enough to appear more than once, or are visually meaningful even as a one-off (cards, headers, large layout regions are fine even as singletons)

   Skip pure layout wrappers and one-line passthroughs with no classnames.

3. **Verify against the live DOM (recommended).** A pure source scan often produces incorrect class fragments (e.g. `filter-bar` vs `filterbar`, `src-chip` vs `src-pill`). If you have a way to render the prototype briefly:
   - Open the static HTML / dev server and let it hydrate
   - Enumerate the actually-rendered classnames on element samples
   - Cross-check the source-derived names against the rendered classes; fix any mismatches before writing the manifest

   If you can't render the page, write the manifest from source alone but mark uncertain entries with a `"$confidence": "low"` field — the user can refine later.

4. **Write `.inspector/design-system.json`** with this shape (matches `presets/shadcn.json`):

   ```json
   {
     "system": "custom",
     "label": "<Project name> (custom)",
     "description": "Generated by scanning <files scanned>.",
     "components": [
       {
         "name": "Button",
         "tag": "button",
         "anyClass": ["btn"],
         "source": "src/components/Button.tsx",
         "props": {
           "variant": {
             "values": ["default","primary","secondary","ghost"],
             "default": "default",
             "detect": [
               { "hasClass": "primary",   "value": "primary"   },
               { "hasClass": "secondary", "value": "secondary" },
               { "hasClass": "ghost",     "value": "ghost"     }
             ]
           }
         }
       }
     ]
   }
   ```

   **Match rule reference** (use the strictest rule that fits — exact match preferred):
   - `"anyClass": ["foo"]` — matches if the element has the exact class `foo` (any of the list)
   - `"allClass": ["foo","bar"]` — matches only if both classes are present
   - `"anyClassContains": ["foo"]` — matches if any class **contains** the substring (looser; use only when class names follow a `prefix-value` convention like `tier-pro`)
   - `"allClassContains": ["foo"]` — same but requires all
   - `"tag": "button"` — combine with class rules to scope

   **Detect rule reference** (for `props.<name>.detect`):
   - `{ "hasClass": "primary", "value": "primary" }` — exact-class match (preferred — required for live class swapping to work cleanly)
   - `{ "if": "tier-pro", "value": "pro" }` — substring match (loose; fine for unique prefix conventions)

5. **Set `preset: "custom"`** in `settings.json` and inline the new `design-system.json` into the `manifest` field. Add a `customLabel` field with a short project name (e.g. `"Pulse for Product"`); the Settings panel will display it on the Import card.

6. **Tell the user what was found.** After writing the manifest, surface a one-liner like: *"Generated a custom design-system manifest with N components for <project>. Edit `.inspector/design-system.json` to refine matches; reload the inspector to apply."*

## Step 4a — Static mode setup

1. Read `index.html` and all linked CSS/SCSS files.
2. Build a `cssMap` object mapping each `selector → property → { file, line }`. Example:
   ```json
   { ".hero-title": { "font-size": { "file": "styles.css", "line": 24 } } }
   ```
3. Create `.inspector/` directory in project root.
4. Copy `overlay.js` and `server.py` from the skill folder (`~/.claude/skills/css-inspector/`) into `.inspector/`.
5. Write `.inspector/inspector.html`:
   ```html
   <!DOCTYPE html>
   <html>
   <head><meta charset="UTF-8"><title>Inspector</title></head>
   <body style="margin:0;padding:0;">
     <script>
       window.__inspectorCssMap   = CSS_MAP_JSON_HERE;
       window.__inspectorSettings = SETTINGS_JSON_HERE;
     </script>
     <script src="overlay.js"></script>
     <iframe src="../index.html" style="width:100%;height:100vh;border:none;"></iframe>
   </body>
   </html>
   ```
   Replace `CSS_MAP_JSON_HERE` with the JSON-stringified cssMap, and `SETTINGS_JSON_HERE` with the contents of `.inspector/settings.json` written in step 3.5.

   The overlay is iframe-aware: it detects the iframe, waits for it to finish loading, and binds picker listeners to the iframe's `contentDocument`. The script tag and iframe can appear in either order.

6. Kill any process on port 8787: `lsof -ti:8787 | xargs kill -9 2>/dev/null || true`
7. Start server: `python3 .inspector/server.py 8787 . &`
8. Output: **Open http://localhost:8787/.inspector/inspector.html to start inspecting.**

## Step 4b — Live mode setup

1. Detect framework web root:
   - Check for `vite.config.*` → root is project root
   - Check for `public/index.html` (CRA / Next.js) → root is `public/`
   - Default: project root
2. Copy `overlay.js` from `~/.claude/skills/css-inspector/` into `<web-root>/.inspector/overlay.js`
3. Find the HTML entry point (`index.html` in project root, or `public/index.html`)
4. Inject before `</body>`:
   ```html
   <!-- css-inspector:start -->
   <script>window.__inspectorSettings = SETTINGS_JSON_HERE;</script>
   <script src="/.inspector/overlay.js"></script>
   <!-- css-inspector:end -->
   ```
   Replace `SETTINGS_JSON_HERE` with the inline JSON contents of `.inspector/settings.json` written in step 3.5.
5. Output: **Inspector injected. Open your dev server (http://localhost:PORT) to start inspecting. The panel will appear in the top-right corner.**

## Step 5 — Wait for user to finish

Tell the user:

- The panel docks to the top-right. Drag the header to move it; the bottom-left handle resizes it; the `—` button minimizes it to the header bar.
- Click the **Select** button (top-left of the header), then click any element on the page. The selector pill at the top shows what's currently selected. Right-click a picked element to open the element-tree popup for navigating parents and siblings.
- **Talk to Claude about the selection.** After picking, click the selector pill in the header — the element-tree popup opens with a **📋 Copy chat-ready intro** link at the top. Clicking it puts a chat-ready intro on your clipboard (`Let's talk about this element \`.hero-title\` (h1):` for leaf elements, `Let's talk about this area \`.hero\` (section):` for containers). Paste it into your next Claude message, then type the ask. Claude now has the selector unambiguously. (The **✕** next to the selector pill clears the current selection.)
- Edit in the **Design** tab — collapsible sections for **Position** (X/Y/Z, rotation, flip), **Layout** (flow, dimensions, padding/margin diagram, clip/border-box), **Appearance** (opacity, radius, fill, stroke, shadow), and **Typography** (font family, size, weight, line height, color). All edits preview live. The color picker supports solid and linear-gradient with eyedropper.
- Use the **CSS Raw** tab to edit matched stylesheet rules as plain text and click **Apply to tracker**.
- The bottom **Changes bar** shows undo/redo and a "Changes to execute" pill. Click the pill to expand the list of tracked edits, then click **Copy Prompt**.
- Paste the copied prompt back into this chat.

When the user pastes a prompt containing either a `<changes>` block or a `<components>` block, proceed to Step 6. A pasted prompt may contain one or both blocks.

## Step 6 — Apply changes to source

The Copy Prompt can carry three payloads:

- `<changes>` — raw CSS edits the user made in the Design / CSS Raw tabs.
- `<components>` — design-system intents (variant swaps, component conversions) the user picked from the Component section.
- `<reorders>` — sibling reorders (arrow-key nudges or drag-drops) the user made on the live DOM.

Handle whichever blocks are present. Apply order: CSS changes first → component intents → reorders. CSS first so classname swaps operate on the latest source; reorders last because they may move elements out from under earlier edits.

### 6a · Apply `<changes>` (CSS edits)

Parse the `<changes>` JSON block. Each entry is `{ selector, property, from, to, file, line }`.

- **If `file` is set:** Open that file. Find the CSS rule for `selector`. Update the `property` value to `to`. If `line` is provided, start searching near that line.
- **If `file` is null:** Search the codebase for where `selector` is defined. Check CSS/SCSS files first. If found in a component file (CSS-in-JS, CSS Module, Vue/Svelte scoped styles), find the declaration and update it. If the style comes from an external/CDN stylesheet, add an override rule to the project's main CSS file.

### 6b · Apply `<components>` (design-system intents)

Parse the `<components>` JSON block. Each entry has an `action` field; handle the two actions below. Look up the active manifest from `.inspector/settings.json` so you know how the component's variants are signaled (classname vs. prop).

#### Action: `swap-variant`

Shape:
```json
{ "action": "swap-variant", "selector": ".my-btn", "component": "Button",
  "prop": "variant", "from": "primary", "to": "destructive",
  "text": "Promote to backlog", "domIndex": 1, "source": "src/page.tsx:34" }
```

`text` and `domIndex` are pinpointing hints emitted by the inspector — they let you choose the right element when the bare selector matches several source locations.

**Source disambiguation (before either strategy below):** grep the candidate file for the element's signal. Filter the matches in this order, stopping when you have exactly one:

1. **`text` match (preferred when present):** keep candidates whose surrounding JSX contains the `text` value (or a normalized version — strip leading punctuation/icons, collapse whitespace). For `text: "+ Promote to backlog"`, match against the JSX literal "Promote to backlog".
2. **`domIndex` fallback (preferred for icon-only / textless elements):** if `text` is absent or didn't narrow to one, pick the Nth match in source-document order where N = `domIndex` (e.g., the second `<button className="btn primary">` in the file).
3. **Still ambiguous → surface a TODO** instead of guessing: *"Found 3 candidates for `.my-btn`; please confirm which one."*

Two strategies depending on how the manifest signals the variant — inspect the matching component entry in the manifest:

- **If the manifest's `props.<prop>.detect` rules use `hasClass` or `if` (classname-driven)** — typical for hand-authored design systems like Pulse:
  1. Find the JSX element matching `selector` in source. Use the `source` hint (file path + line) to narrow the search.
  2. In the element's `className` (string, template literal, or `clsx` call), remove the class fragment that signaled `from` and add the class fragment for `to`. Find both fragments in the manifest's `detect` rules (`hasClass: "primary"` → the literal class `primary`; `if: "tier-pro"` → that exact class).
  3. If the className is built from a prop or variable (e.g., `className={\`btn ${variant}\`}`), update the prop/variable's default value or the call site instead of the template literal.

- **If the manifest's component has a `props.<prop>.cvaProp` field, or the source looks like a cva-based shadcn-style component** — typical for prop-driven systems:
  1. Find the React component invocation matching `selector`. Use `source` to narrow.
  2. Update the prop assignment: `variant="primary"` → `variant="destructive"`. If the prop is omitted (using cva's default), add it explicitly with the new value.

If you can't confidently locate the source element, surface the intent to the user as a TODO instead of guessing: *"Couldn't find `.my-btn` in source. Best guess: src/page.tsx:34. Apply manually?"*

#### Action: `convert`

Shape:
```json
{ "action": "convert", "selectors": [".btn-1",".btn-2",".btn-3"],
  "from": "Button", "to": "SegmentedControl", "source": "src/page.tsx:34-46" }
```

This is a multi-element refactor — N source elements collapse into 1 new composite component.

1. Find the `from` component(s) at `source`. Verify all `selectors` map to siblings (or a contiguous group) — if they're scattered, ask the user before proceeding.
2. Read the target component's API. The `to` value names a component the user has either in their project or in their design-system preset (check `src/components/`, shadcn UI registry path, or the user's manifest source field).
3. Generate the replacement JSX. For common conversions:
   - **N Buttons → ToggleGroup / SegmentedControl:** wrap in `<ToggleGroup>` (or your DS's equivalent); replace each Button with a `<ToggleGroupItem value="…">{label}</ToggleGroupItem>`. Carry over `onClick` handlers as `onValueChange` if appropriate. Drop styling props that don't apply (variant, size) — confirm with user.
   - **1 Button (or icon-only Button) → IconButton:** replace with the IconButton component; carry over the icon + handlers; drop the text label.
   - **Other conversions:** if the manifest's `conversions` block has a `note` field, follow it. Otherwise propose a transform and ask the user.
4. Add any new imports the target component needs.

### 6c · Apply `<reorders>` (sibling reorders)

Parse the `<reorders>` JSON block. There is **one entry per parent**, even if the user nudged children multiple times — the inspector collapses to the net effect.

```json
{ "action": "reorder",
  "parent": ".filterbar",
  "children": [
    { "text": "Open",         "classes": "btn" },
    { "text": "Closed",       "classes": "btn" },
    { "text": "All Insights", "classes": "btn primary" }
  ],
  "order": [2, 0, 1] }
```

- `parent` — selector for the parent element in source.
- `children` — pre-mutation child list, in source order. Use this to identify the JSX block (sibling count + text/classes should match).
- `order` — permutation array. `order[i]` is the index into `children` that should land at position `i` in the new order. In the example above, the new order is `[children[2], children[0], children[1]]` = `["All Insights", "Open", "Closed"]`.

The format is the same whether the user did 1 nudge or 50 — `order` always represents the final desired arrangement.

**For each reorder, classify the source rendering pattern:**

1. Locate the parent's JSX element in source. Use the parent selector + ancestor-class chain (from Step 6b's disambiguation playbook) to narrow.
2. Verify by checking that the parent's children match `children` (same count, same texts in order). If they don't match, surface a TODO — the inspector likely targeted a different render.
3. Inspect HOW the parent renders its children:

| Source pattern | Action |
|---|---|
| **Literal JSX children** — `<Child/><Child/><Child/>` | Splice the children array. Apply directly. Trivial case. |
| **`.map()` on a hardcoded array in same module, no sort/filter** | Reorder the array literal. Confirm with user first: *"This list is rendered from an array. Reordering it changes the canonical order for everywhere this data is consumed, not just this view. OK?"* |
| **`.map()` chained through `.sort()` or `.filter()`** | Do NOT touch. Escalate to user: *"Your list is sorted by `<sortKey>`. To make this reorder stick, you'd need one of: (a) add a manual `order` field and sort by it, (b) change the sort criterion, (c) remove the sort and use literal array order, (d) skip this one. Which?"* |
| **`.map()` on imported / prop / hook / context data** | Escalate: *"This list comes from `<source>`. Either (a) reorder the data at its source, (b) override the ordering in this component by adding a local `.sort()`, or (d) skip this one. Which?"* |
| **Computed / state / unknown** | Escalate with the relevant snippet and present options. **Always include (d) skip this one.** |

**(d) skip is mandatory on every escalated reorder.** A paste-back batch may contain 5+ changes; the user shouldn't have to abort the whole batch to skip one thorny reorder. Skipped reorders are reported in the final summary: *"Skipped: 1 reorder on `.filterbar` (sorted list — left for later)."*

### 6d · Diff + confirm

After 6a, 6b, and 6c have produced their edits in memory (don't write yet), show the user a single unified diff covering everything, grouped by file. Then ask:

> "Apply these changes? (`<n>` CSS edits, `<m>` variant swaps, `<k>` conversions, `<r>` reorders across `<f>` files)"

Wait for explicit confirmation before writing. Component conversions and data-array reorders in particular can be hard to undo; never auto-apply a `convert` or `.map()`-array reorder without confirmation.

## Step 7 — Session cleanup

After changes are applied (or if the user says they're done):
1. Remove the `<!-- css-inspector:start/end -->` block from the HTML entry point (live mode only)
2. Ask: "Delete the `.inspector/` directory?" (it's gitignored but takes up space)
