# CSS Inspector — Plan

Where we left off and what's next.
Last updated: 2026-05-16.

---

## Where we are

### Phase 1a — Settings panel + custom design-system support — **DONE**

- Gear-icon tab in the inspector header (right side, next to the About info-icon)
- Settings panel matches the Figma reference: 2-column card grid of presets, brand icons (Anthropic A, Tailwind, MUI, shadcn), "See more" expands secondary presets, "Import Custom design system" card (disabled — see below)
- Claude Design is locked-on (always checked, can't toggle off) — gray indicator vs blue radio for selectable options
- Each project has `.inspector/settings.json` as the source of truth — preset + inlined manifest
- localStorage caching of UI preferences was deliberately removed (it was overwriting fresh project manifests with stale ones — see `loadSettings` in `overlay.js`)
- `SKILL.md` Step 3.5 — design-system detection (package.json + classname signals → recommended preset)
- `SKILL.md` Step 3.6 — custom-DS manifest auto-generation when no preset matches (scans `.jsx`/`.tsx`/`.vue`/etc., writes `.inspector/design-system.json`)
- `SKILL.md` Step 6 — paste-back handling for both `<changes>` (CSS) and `<components>` (design-system intents) blocks

### Phase 1b — Multi-select picker — **DONE** (gated behind Settings → Picker, off by default)

- Two-square toggle icon in the header next to the cursor — turns blue when multi-mode is on
- **Default OFF.** Hidden until the user enables it in **Settings → Picker → Multi-select picker**. **Design system**, **Picker**, and **Ask Claude** sections in Settings all carry a small `BETA` pill.

### "Ask Claude" fallback — gated behind Settings, off by default

- The Component section used to always show an "Ask Claude what this could be" button when the manifest didn't recognize a pick. That button is now gated on **Settings → Ask Claude → "Ask Claude" fallback** (off by default).
- When the toggle is off: unmatched picks just don't render a Component section.
- When on: same behavior as before — the button copies a chat-ready intro with the element's selector + tag + classes to your clipboard.

### "Edit by class" — class-scope live preview, default ON

- When you change a CSS property in the inspector, the preview applies the change to **every** element matching the tracked selector (e.g., changing `.n` font-size updates all `.n` instances on the page). Previously the preview only changed the one picked element — which lied about scope, since the eventual source edit changes the whole rule.
- Implemented as an injected `<style id="__inspector-live-changes">` in the target document, rebuilt from the `changes` array on every edit. Uses `!important` to win over the original stylesheet.
- **Default ON.** Checkbox sits in the **Design panel, just above Position**: `☑ Edit by class (applies to all .n)`. The selector descriptor updates per pick. Uncheck for instance-only preview.
- Click accumulates picks; click an already-picked element to remove it (currently broken — see "known issues")
- Numbered floating badges (1, 2, 3…) on each picked element, reposition on scroll/resize
- Component section shows `× N` badge when all picks share the same component, `Mixed (N)` with per-component breakdown otherwise
- Variant dropdowns aggregate: show common value when uniform, `(mixed)` when picks disagree
- Variant change applies to all matching picks at once, emits one intent per element
- Two-pass implementation in `wireComponentSection` so per-element `selector` / `text` / `domIndex` are captured BEFORE any class mutations (otherwise sibling picks collide)
- Esc clears multi-pick mode (keeps the primary single selection)

### Phase 2 — Sibling reorder (arrow keys + drag) — **DONE**

- **Unified history refactor.** Replaced separate `changes[]` and `componentIntents[]` undo lanes with a single chronological `history[]` of kinded entries (`css-add`, `css-update`, `css-remove`, `intent-add`, `intent-update`, `intent-remove`, `reorder`). Renderer and wire format (`<changes>` / `<components>`) unchanged. Variant-swap undo (the existing bug — "i changed component variant and it wasnt in the changes that was in the changes bar, and couldnt undo it too") fixed as a side effect.
- **Axis detection** uses computed flex-direction when available; falls back to measuring children's X-spread vs Y-spread (handles grid + non-flex row layouts that table-style dashboards use).
- **Arrow-key reorder.** Selected element nudged among siblings with `↑/↓` (vertical context) or `←/→` (horizontal context), no modifier. Suppressed when focus is in an editable field, in multi-pick mode, or for absolutely-positioned elements. Each nudge pushes a `reorder` history entry.
- **Cursor-exit promotion.** Mousemove tracker maintains an `armedLevel` state. Cursor outside selected → walk up ancestor chain to find first axis-matching ancestor with ≥2 children → arrows act on the highest-promoted ancestor that contains selectedElement. Pink outline indicator on the armed level when ≠ selected.
- **Drag-and-drop.** Per-sibling pink grippers at each child's right edge (horizontal) or bottom edge (vertical). Mousedown starts drag → clone-ghost follows cursor → pink drop-line shows insertion gap → mouseup commits via `parent.insertBefore` → history push. Esc cancels.
- **Wire format.** New `<reorders>` block carries `{ action: "reorder", parent, from, to, child: {text, classes}, siblingsSnapshot[] }`. Inspector strips `__inspector-*` classes from the wire payload.
- **SKILL.md Step 6c.** Source-pattern classification tree: literal JSX → splice; `.map()` over hardcoded array → confirm; `.map()` + sort/filter → escalate with (a)/(b)/(c)/(d skip); `.map()` over imported data → escalate. `(d) skip` is mandatory on every escalated reorder so the user can resolve other changes in the batch without aborting.
- Net-effect collapse: same-parent reorders collapse to one prompt at paste-back time (don't ask 3 questions for 3 nudges on one list).
- Bonus fix shipped during reorder smoke-tests: changes-bar count text was leaving a stale value when the count dropped to 0. Now always updates.

### Phase 1c — Convert-to menu — **DONE**

- "Convert to…" block appears below variant dropdowns when the manifest has applicable `conversions` rules (`from` matches + `minCount` ≤ N ≤ `maxCount`)
- Each conversion renders as a button with a `→` glyph + label; hover tooltip shows the rule's `note`
- Click emits a `convert` intent carrying every pick's pinpoint context (selectors + text + domIndex), so paste-back can locate each source element
- Convert and swap-variant intents coexist in the Changes bar + Copy Prompt — they stack

### Robustness work — **DONE**

- Inspector intent payload includes `text` (trimmed inner text, first 80 chars) and `domIndex` (0-based among same-selector matches) so paste-back can disambiguate when a selector matches multiple source locations
- Matcher supports four rule shapes: `tag`, `anyClass` / `allClass` (exact), `anyClassContains` / `allClassContains` (substring)
- Detect rules support `hasClass` (exact) and `if` (substring); inspector prefers `hasClass` since live class swap needs an exact toggle target
- Manifest entries accept both `{name, match: {…}}` and shorthand `{name, tag, anyClass, …}` — paths are equivalent

### Verified end-to-end with Playwright

- Single-pick variant swap on `.btn.primary` → ghost: clipboard contains valid `<components>` block with text hint
- Multi-pick 2× `.status-pill.product` + 1× `.status-pill.insight` → `assumption`: 3 distinct intents emitted with correct selectors + domIndex
- Multi-pick 3× status pills → "Convert to SegmentedControl": clean `convert` intent with all 3 pinpoint contexts

---

## Test environment

Both servers run on port 8787. Only one can run at a time — `kill` the old before starting the next.

### Pulse for Product (primary test bed — custom design system)

```bash
lsof -ti:8787 | xargs kill -9 2>/dev/null
cd "/Users/aviranrevach/AI Projects Aviran/Demos/Pulse for Product"
python3 .inspector/server.py 8787 . &
# open http://localhost:8787/.inspector/inspector.html
```

- `Pulse for Product/.inspector/design-system.json` — 23 components, 4 conversions
- `Pulse for Product/.inspector/settings.json` — `preset: "custom"`, manifest inlined
- `Pulse for Product/.inspector/inspector.html` — iframes `../insights-prototype.html`

### E2E fixture (Remock dashboard)

```bash
cd /private/tmp/css-inspector-e2e
python3 .inspector/server.py 8787 . &
```

Has `preset: "shadcn"` with the shipped shadcn preset manifest.

### Resyncing overlay.js to all consumers

After any edit to `~/AI Projects Aviran/css inspector skill/overlay.js`:

```bash
cd "/Users/aviranrevach/AI Projects Aviran/css inspector skill"
node -c overlay.js && npm test
cp overlay.js "/Users/aviranrevach/.claude/skills/css-inspector/overlay.js"
cp overlay.js "/Users/aviranrevach/AI Projects Aviran/Demos/Pulse for Product/.inspector/overlay.js"
cp overlay.js "/private/tmp/css-inspector-e2e/.inspector/overlay.js"
```

`server.py` ships `Cache-Control: no-store`, so a plain reload picks up changes — no hard refresh needed.

---

## What's left, in priority order

### 1. Ship real preset manifests for MUI / Chakra / Mantine / antd / NextUI / Tailwind  (high value, mostly mechanical)

The radio options exist in the Settings panel but only `presets/shadcn.json` has actual component definitions. Each missing preset shows in the UI but matches nothing.

For each, follow the `shadcn.json` shape:
- Read the library's source for component names + their `cva` (or equivalent) variant definitions
- Build `components[]` with `match.anyClass` / `anyClassContains` + `props.<variant>.detect` rules
- Add a `conversions` block where it makes sense (e.g., MUI Button → ToggleButton, Chakra Button → ButtonGroup)
- Ship at `presets/<system>.json`
- Update SKILL.md Step 3.5 to inline the new preset's manifest when that system is detected

Suggested order: MUI → Chakra → antd → Mantine → NextUI → Tailwind. The first three have the largest installed bases.

### 2. Multi-pick deselect-by-click  (known bug)

Currently `onPickClick` checks `allSelected().includes(e.target)` and calls `removeFromSelection(e.target)`. The check seems to work in code but the user reported it doesn't behave as expected — picking an already-picked element re-adds it. Worth a 15-minute Playwright session to nail down what's happening (mouseenter / mouseleave hover handlers may be re-firing the pick after removal).

### 3. Open-ended AI conversion  (Phase 3 — designed but not started)

A top-level action available regardless of preset: "make these N elements better / fancier / more consistent". Open-ended prompt, no fixed rule. Two-tier UI:
- Above the Convert-to block: a permanent button labeled "Ask Claude to redesign these"
- Click → captures the picks' full classlists + texts + computed styles + a screenshot reference (or a description of the visual area) → emits a structured `<components>` intent with `action: "ai-redesign"` and the surface for Claude to work with
- Step 6 in `SKILL.md` will need a new handler for `ai-redesign` — basically "you read this intent and propose a structured edit; ask user before applying"

### 4. Source pinpointing v2 — parent class chain  (incremental polish)

Current `text` + `domIndex` hints fail when JSX uses variable interpolation (`{action}`, `{label}`) because the rendered text isn't in source. Adding a third hint — the chain of ancestor classnames (e.g., `.frame > .chrome > .toolbar`) — would uniquely identify most JSX locations since each ancestor chain typically appears once in source.

Implementation: in `capturePickContext`, walk up to ~5 ancestors and record their distinctive classnames. SKILL.md Step 6b's disambiguation list gets a new step: "if text and domIndex don't narrow to one, prefer the candidate whose surrounding source matches the most ancestor classes."

### 5. Enable the "Import Custom design system" UI card  (deferred, currently disabled)

Today the card is permanently disabled with a "COMING SOON" label. The Pulse demo works because `SKILL.md` Step 3.6 writes `settings.json` directly with `preset: "custom"` — bypassing this UI.

To enable the card: open-file picker → read user-selected `design-system.json` → save to `.inspector/design-system.json` and write the merged settings back. Needs a small server-side write endpoint (`server.py` is currently read-only).

### 6. Add the `<components>` block handling to SKILL.md Step 6 in more depth

Step 6 already covers `swap-variant` (className-driven and prop-driven) and `convert` (multi-element refactor with a few common patterns). What's thin:
- `ai-redesign` action handler (only meaningful once Phase 3 exists)
- Edge case: when a convert rule's source component is in a preset (e.g. shadcn Button → ToggleGroup) but the target component (`ToggleGroup`) isn't yet imported into the user's file. The doc says "add any new imports the target component needs" but doesn't describe how to figure out the import path from the manifest.

### 7. Phase 2 polish — sorted-list pre-detection on the inspector side  (deferred from Phase 2)

When the live DOM order of an armed level matches an obvious sort (alphabetical by `innerText`, numeric ascending, etc.), surface a small badge on the armed indicator: *"this list appears sorted; reordering will require a source decision."* Gives the user a heads-up BEFORE they reorder rather than at paste-back time. Pure inspector-side heuristic; no source inspection needed.

### 8. Pre-existing intent-dedup bug found during the Phase 2 smoke test  (not blocking)

`sameIntentTarget` matches on `selector`, but `selector` includes the variant class — so toggling a single dropdown twice creates 2 intents instead of replacing the first. The intent's own comment says "toggling a dropdown back and forth on one element only keeps the latest value" — which isn't what happens. Fix: capture the pre-mutation selector and use it for dedup, or strip variant-toggle classes from the dedup key. Undo works correctly through both intents (history rolls back cleanly), so this is only a wire-payload bloat issue, not correctness.

### 9. Multi-pick × reorder

Currently `reorderAmongSiblings` returns early when `multiPickMode` is true. The brainstorm landed on option (a) — disable reorder in multi-pick mode for v1. If real multi-pick reorder demand shows up (contiguous siblings moved as a group), revisit option (c) from the brainstorm.

---

## Known issues to revisit

| Issue | Workaround | Real fix |
|---|---|---|
| Multi-pick deselect-by-click doesn't behave as expected | Toggle off multi-mode and re-pick | See item #2 above |
| JSX with `{variable}` text breaks text-based source disambiguation | User confirms which candidate to edit (Step 6b's TODO path) | See item #4 — parent-class chain hint |
| Detection coverage = manifest coverage. "Unknown" badge surfaces a lot on Claude-Design-only projects | Add the missing component by hand-editing `.inspector/design-system.json` | A future "live-DOM-aware manifest generator" — scan rendered classnames and merge into manifest |
| Conversions are presented without `disabled` state when an identical intent already exists | Use the changes drawer's row X to remove duplicates | Add `disabled` styling when `componentIntents` already contains a matching entry |
| Intent dedup creates 2 entries for back-and-forth variant toggle on one element | Use the changes drawer X to remove the stale entry | See item #8 — fix the dedup key |

---

## Where things live

| Path | What |
|---|---|
| `~/AI Projects Aviran/css inspector skill/` | Source repo for the skill |
| `~/.claude/skills/css-inspector/` | Installed copy Claude reads from |
| `~/AI Projects Aviran/css inspector skill/presets/shadcn.json` | Only shipped preset manifest |
| `~/AI Projects Aviran/css inspector skill/presets/icons/` | Brand SVGs (claude, shadcn, mui, tailwind) |
| `~/AI Projects Aviran/Demos/Pulse for Product/.inspector/` | Test bed (custom DS manifest, settings, server) |
| `~/AI Projects Aviran/Demos/Pulse for Product/insights-prototype.html` | The prototype the inspector iframes |
| `/private/tmp/css-inspector-e2e/` | Original e2e fixture (Remock dashboard) |

---

## Quick session resume

```bash
# Restart the Pulse test bed
lsof -ti:8787 | xargs kill -9 2>/dev/null
cd "/Users/aviranrevach/AI Projects Aviran/Demos/Pulse for Product"
python3 .inspector/server.py 8787 . &
open http://localhost:8787/.inspector/inspector.html
```

Then in chat: *"resume the css-inspector plan — open PLAN.md and start on item #1"* (or whichever).
