# draft/ — Design Guidelines

These rules apply everywhere in the product. When picking up styles from the design system, follow these principles first.

---

## Borders vs. Shadows

**Do not use borders to visually separate or decorate UI elements.**  
Borders add visual noise and make the UI feel rigid. Use them only as a last resort for true structural layout divides.

| Situation | ✅ Do this | ❌ Not this |
|---|---|---|
| Card / panel | `shadow-sm` + `bg-surface-raised` | `border border-border` |
| Floating input / modal | `shadow-md` | `border border-border` |
| Message bubble (other user) | `bg-surface-raised` + subtle shadow | `border border-border` |
| Pill / badge / chip | `bg-surface-raised` + `shadow-xs` | `border border-border/50` |
| True layout divider (sidebar split, header bottom) | A single `border-b` or `border-r` is fine | — |

### Why
Elevation and grouping should be communicated through **light backgrounds** and **soft shadows** — the same language used by iOS, WhatsApp, and Linear. Borders everywhere flatten the UI and make every element feel equally important.

---

## Elevation scale

Use the shadow tokens in `packages/design-system/src/tokens/shadows.ts`:

| Token | Use case |
|---|---|
| `shadow-xs` | Subtle inline elements (pills, chips, badges) |
| `shadow-sm` | Cards, message bubbles, list items that need lift |
| `shadow-md` | Floating inputs, dropdowns, popovers |
| `shadow-lg` | Modals, sheets, bottom drawers |

---

## Background contrast for separation

Use background tokens to separate regions — no border needed:

```
bg-surface          → page / app background
bg-surface-raised   → cards, panels, inputs sitting on top of the page
bg-surface-overlay  → modals, drawers, tooltips
```

---

## When a border IS appropriate

- A single `border-b` beneath a sticky header (structural, not decorative)
- A single `border-r` or `border-l` between two persistent layout columns (e.g. sidebar + main)
- Focus rings (`ring`) on interactive elements for accessibility

Everything else → shadow + background contrast.
