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
     <script>window.__inspectorCssMap = CSS_MAP_JSON_HERE;</script>
     <script src="overlay.js"></script>
     <iframe src="../index.html" style="width:100%;height:100vh;border:none;"></iframe>
   </body>
   </html>
   ```
   Replace `CSS_MAP_JSON_HERE` with the JSON-stringified cssMap.

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
   <script src="/.inspector/overlay.js"></script>
   <!-- css-inspector:end -->
   ```
5. Output: **Inspector injected. Open your dev server (http://localhost:PORT) to start inspecting. The panel will appear in the top-right corner.**

## Step 5 — Wait for user to finish

Tell the user:

- The panel docks to the top-right. Drag the header to move it; the bottom-left handle resizes it; the `—` button minimizes it to the header bar.
- Click the **Select** button (top-left of the header), then click any element on the page. The selector pill at the top shows what's currently selected. Right-click a picked element to open the element-tree popup for navigating parents and siblings.
- **⇧-click multiple elements while in pick mode** to build a **selected area** — a group, not a single element. An "area · N els" bar appears under the header with **Copy** (clipboard) and **✕** (clear) buttons. Use this when you want to talk to Claude about a region of the page rather than one node ("rewrite the layout of this selected area to use grid"). The single-element selection in the pill is independent — the Design tab keeps editing whichever element was last single-clicked.
- Edit in the **Design** tab — collapsible sections for **Position** (X/Y/Z, rotation, flip), **Layout** (flow, dimensions, padding/margin diagram, clip/border-box), **Appearance** (opacity, radius, fill, stroke, shadow), and **Typography** (font family, size, weight, line height, color). All edits preview live. The color picker supports solid and linear-gradient with eyedropper.
- Use the **CSS Raw** tab to edit matched stylesheet rules as plain text and click **Apply to tracker**.
- The bottom **Changes bar** shows undo/redo and a "Changes to execute" pill. Click the pill to expand the list of tracked edits, then click **Copy Prompt**.
- Paste the copied prompt back into this chat.

When the user pastes a prompt containing `<changes>`, proceed to Step 6.

## Step 6 — Apply changes to source

Parse the `<changes>` JSON block from the user's message. Each entry is `{ selector, property, from, to, file, line }`.

- **If `file` is set:** Open that file. Find the CSS rule for `selector`. Update the `property` value to `to`. If `line` is provided, start searching near that line.
- **If `file` is null:** Search the codebase for where `selector` is defined. Check CSS/SCSS files first. If found in a component file (CSS-in-JS, CSS Module, Vue/Svelte scoped styles), find the declaration and update it. If the style comes from an external/CDN stylesheet, add an override rule to the project's main CSS file.

After all changes are applied, show a unified diff and ask: "Apply these changes?"

## Step 7 — Session cleanup

After changes are applied (or if the user says they're done):
1. Remove the `<!-- css-inspector:start/end -->` block from the HTML entry point (live mode only)
2. Ask: "Delete the `.inspector/` directory?" (it's gitignored but takes up space)
