# CSS Inspector — Next Features

## ✅ Shipped (batch 2)
- Undo last change button (header)
- Changes bottom bar with count badge, expand drawer, copy prompt
- Empty state shows grayed-out zeros
- Spacing widget: amber margin + teal padding colors
- Draggable panel + height resize handle

## ✅ Shipped (batch 1)
- Override indicator (coral label + hover × reset, auto-remove on original)
- Scrub margin/padding values in spacing widget
- Minimize button (collapse to header bar)
- Disabled preview when nothing selected
- Font switcher (page fonts + popular Google Fonts)

---

## 1. Undo button (top bar)
Small undo icon button in the header bar. Undoes the last tracked change — restores the previous value on the element and removes it from the changes list.

## 2. Changes counter (bottom bar)
Move the Changes tab into a persistent bottom bar showing a small counter badge (e.g. "3 changes"). Clicking it opens a panel overlay showing the list of changes with × to remove each. Also shows instructions for how to apply the changes in Claude, and a "Copy prompt" command button. Needs brainstorm — this is a significant UI restructure.

## 3. Empty state (refined)
The disabled preview when nothing is selected should show zeros/real-looking values (not "—") grayed out — so it looks exactly like a real selected element but everything is dimmed. Refines what was already built.

## 4. Margin/padding area colors (needs brainstorm)
The current green tint (margin) and blue tint (padding) zones may not be the best choice. Brainstorm better color options that are visually clear, accessible, and match the dark theme.

## 5. Draggable + resizable panel
Allow the user to drag the panel anywhere on screen (not just fixed top-right). Allow resizing the panel height by dragging the bottom edge.
