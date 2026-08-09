# UX Community — Landing Page Design System

**Status:** Implementation guide  
**Audience:** The agent building the public landing page and anyone adding web UI  
**Product:** UX Community — a home for UI/UX, product, and social media designers

This document is the source of truth for the landing page's visual language. It turns the existing UX Community web tokens into practical guidance for marketing sections, navigation, application CTAs, responsive layouts, and accessible components.

## 1. Product character

UX Community should feel:

- **Focused:** clear hierarchy, generous space, and one obvious action per section.
- **Credible:** precise typography, calm surfaces, restrained decoration, and useful proof.
- **Creative:** a confident blue signal, a subtle grid, real member imagery, and editorial composition.
- **Welcoming:** copy should be human and inclusive, never elitist or overly corporate.
- **Fast:** lightweight surfaces, short copy blocks, and motion that supports comprehension.

The visual direction is Geist/Vercel-inspired: cool neutrals, crisp blue, compact controls, soft elevation, and near-black dark mode.

## 2. Theme contract

### 2.1 Theme behavior

- Light mode is the default.
- Dark mode follows `prefers-color-scheme` on the web. Do not build a second, independently named palette.
- Use semantic tokens in UI code. Do not hard-code primitive hex values inside components.
- The existing web runtime is defined in `apps/web/app/globals.css` and is mirrored by `packages/design-system/src/css/tokens.css`.
- When a token is absent in a theme, use its semantic fallback rather than inventing a new color.

> **Known alignment note:** `packages/design-system/src/themes/dark.ts` defines a lighter dark-mode semantic accent (`#52A8FF`), while the current CSS runtime in `globals.css` uses `#0070F3` in both modes. For the landing page, follow the CSS runtime below so the new page matches the existing web app. Reconcile the shared TypeScript theme later if a class-based theme switcher is introduced.

### 2.2 Light theme — complete web runtime palette

| Semantic token | Hex / value | Use |
|---|---:|---|
| `background` | `#FAFAFA` | Page background |
| `background-subtle` | `#F5F5F5` | Subtle section or sidebar background |
| `surface` | `#FFFFFF` | Cards, panels, inputs |
| `surface-raised` | `#F5F5F5` | Raised card, dropdown, or selected surface |
| `foreground` | `#0A0A0A` | Primary text and headings |
| `foreground-muted` | `#525252` | Body copy and supporting text |
| `foreground-subtle` | `#737373` | Metadata, captions, placeholders |
| `accent` | `#0070F3` | Primary CTA, link, active state |
| `accent-hover` | `#0060D1` | Hover and pressed primary action |
| `accent-soft` | `#F0F8FF` | Accent-tinted background |
| `accent-foreground` | `#FFFFFF` | Text/icon on accent |
| `border` | `#EAEAEA` | Structural divider or input boundary |
| `border-subtle` | `#F5F5F5` | Low-contrast divider |
| `signal` | `#0070F3` | Brand signal, same as accent |
| `overlay` | `#0A0A0A` | Always-dark brand panel, footer, code block |
| `overlay-raised` | `#111111` | Raised element inside an overlay |
| `overlay-elevated` | `#1A1A1A` | Highest overlay surface |
| `overlay-foreground` | `#EDEDED` | Primary text on overlay |
| `overlay-muted` | `#737373` | Supporting text on overlay |

Light theme shadow values:

| Token | Value |
|---|---|
| `shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)` |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)` |
| `shadow-card` | `0 0 0 1px #EAEAEA, 0 2px 4px rgb(0 0 0 / 0.04)` |

### 2.3 Dark theme — complete web runtime palette

| Semantic token | Hex / value | Use |
|---|---:|---|
| `background` | `#09090B` | Page background |
| `background-subtle` | `#0E0E10` | Sidebar or secondary section background |
| `surface` | `#121214` | Cards, panels |
| `surface-raised` | `#1B1B1F` | Modal, dropdown, popover, raised card |
| `surface-hover` | `#17171A` | Hovered surface |
| `input-background` | `#151517` | Input and textarea fill |
| `foreground` | `#EDEDED` | Primary text and headings |
| `foreground-muted` | `#737373` | Body copy and supporting text |
| `foreground-subtle` | `#525252` | Metadata, captions, placeholders |
| `accent` | `#0070F3` | Primary CTA, link, active state |
| `accent-hover` | `#0060D1` | Hover and pressed primary action |
| `accent-soft` | `#18243D` | Accent-tinted background |
| `accent-foreground` | `#FFFFFF` | Text/icon on accent |
| `border` | `#202024` | Structural divider |
| `border-subtle` | `#1D1D21` | Low-contrast section divider |
| `border-strong` | `#2D2D34` | Active component boundary |
| `input-border` | `#303036` | Input boundary where required |
| `signal` | `#0070F3` | Brand signal, same as accent |
| `nav-hover` | `#17171A` | Navigation hover |
| `nav-active` | `#18243D` | Active navigation item |
| `nav-active-hover` | `#1D2A46` | Active navigation hover |
| `button-secondary` | `#1A1A1E` | Secondary button fill |
| `button-secondary-hover` | `#232329` | Secondary button hover |
| `button-secondary-active` | `#2A2A31` | Secondary button pressed |
| `overlay` | `#09090B` | Always-dark brand panel, footer, code block |
| `overlay-raised` | `#121214` | Raised element inside an overlay |
| `overlay-elevated` | `#1B1B1F` | Highest overlay surface |
| `overlay-foreground` | `#EDEDED` | Primary text on overlay |
| `overlay-muted` | `#737373` | Supporting text on overlay |

Dark theme shadow values:

| Token | Value |
|---|---|
| `shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.40)` |
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.50), 0 1px 2px -1px rgb(0 0 0 / 0.40)` |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.60), 0 2px 4px -2px rgb(0 0 0 / 0.48)` |
| `shadow-card` | `0 0 0 1px #202024, 0 2px 8px rgb(0 0 0 / 0.50)` |

### 2.4 Primitive palette reference

Use semantic tokens above in components. The primitive palette is useful when extending the system:

| Primitive | Values |
|---|---|
| Geist blue | `100 #000B1F`, `200 #00254D`, `300 #003C85`, `400 #0057B7`, `500 #006BDB`, `600 #0070F3`, `700 #52A8FF`, `800 #ADCFFF`, `900 #D9ECFF`, `1000 #F0F8FF` |
| Neutral | `0 #FFFFFF`, `50 #FAFAFA`, `100 #F5F5F5`, `200 #EAEAEA`, `300 #E0E0E0`, `400 #A8A8A8`, `500 #737373`, `600 #525252`, `700 #404040`, `800 #262626`, `900 #171717`, `1000 #0A0A0A` |
| Dark | `900 #0A0A0A`, `800 #111111`, `700 #1A1A1A`, `600 #2E2E2E`, `500 #3E3E3E`, `400 #737373`, `100 #EDEDED` |

## 3. Typography

Use Geist through the existing Next.js font variables:

```css
font-family: var(--font-display), Geist, ui-sans-serif, system-ui, sans-serif;
font-family: var(--font-mono), "Geist Mono", ui-monospace, monospace;
```

| Token | Size | Weight / line height | Typical use |
|---|---:|---|---|
| `2xs` | 10px | 400 / 1.5 | Rare micro-label |
| `xs` | 11px | 400–600 / 1.5 | Eyebrow, compact metadata |
| `sm` | 13px | 400–600 / 1.5 | Nav labels, captions |
| `base` | 14px | 400–500 / 1.5 | Default application UI |
| `md` | 16px | 400–600 / 1.5 | Body copy, buttons |
| `lg` | 18px | 500–600 / 1.375 | Lead/supporting text |
| `xl` | 20px | 600 / 1.25 | Card or section title |
| `2xl` | 24px | 600 / 1.25 | Small hero / page heading |
| `3xl` | 30px | 600–700 / 1.25 | Landing section heading |
| `4xl` | 36px | 600–700 / 1.25 | Desktop hero heading |

Additional rules:

- Use `-0.04em` for large display headings, `-0.02em` for section headings, and normal tracking for body copy.
- Keep body measure around 60–72 characters.
- Use sentence case. Avoid all caps except compact metadata or eyebrow labels.
- Use `font-semibold` for headings and primary labels; reserve bold for emphasis.
- The landing-page hero may scale above `4xl` responsively, but keep the same tight line-height and avoid oversized text that hides the CTA.

## 4. Spacing, radius, and layout

Use a 4px base rhythm:

| Token | Value | Use |
|---|---:|---|
| `space-1` | 4px | Icon/text gap, tiny inset |
| `space-2` | 8px | Control gap, compact padding |
| `space-3` | 12px | Card gap, input padding |
| `space-4` | 16px | Default component padding |
| `space-5` | 20px | Compact section gap |
| `space-6` | 24px | Card padding, control group gap |
| `space-8` | 32px | Section content gap |
| `space-10` | 40px | Small section padding |
| `space-12` | 48px | Large component/section gap |
| `space-16` | 64px | Desktop section padding |
| `space-20` | 80px | Hero/major section padding |
| `space-24` | 96px | Large desktop section padding |

Radius:

| Token | Value | Use |
|---|---:|---|
| `sm` | 4px | Small tags and compact controls |
| `md` | 8px | Buttons, inputs, standard cards |
| `lg` | 12px | Feature cards, panels |
| `xl` | 16px | Hero media, major cards |
| `2xl` | 20px | Optional editorial feature treatment |
| `full` | 9999px | Avatars, pills, status indicators |

Layout:

- Use a centered container with `max-width: 1200px`; use `max-width: 1280px` only for wide hero media.
- Mobile side padding: 20px. Tablet: 32px. Desktop: 40px.
- Use 12 columns on desktop, 8 on tablet, and a single-column flow on mobile.
- Prefer a 7/5 or 6/6 hero split. Do not make the hero copy and CTA compete with the primary visual.
- Desktop section padding: 96px top/bottom. Tablet: 72px. Mobile: 56px.
- Keep navigation sticky only when it improves orientation; use a single structural bottom divider, not a decorative border.

## 5. Landing-page composition

Recommended page order:

1. **Navigation** — wordmark, a small number of links, “Join the community” primary CTA.
2. **Hero** — specific value proposition, one primary CTA, one secondary text/link action, member/community visual.
3. **Credibility strip** — member count, disciplines, locations, or a concise social-proof statement. Only use real numbers.
4. **What members get** — three or four benefit cards, each with one icon and one sentence.
5. **Community preview** — show conversation, profiles, or community activity without exposing private information.
6. **How it works** — apply, get reviewed, meet the community. Keep to three steps.
7. **Featured member / editorial block** — optional, only with permission and real content.
8. **Final CTA** — repeat the action with a clear expectation of what happens next.
9. **Footer** — brand, essential links, legal/privacy, and a low-contrast dark or neutral surface.

Hero copy formula:

```text
[Eyebrow: WHO THIS IS FOR]
[Specific outcome-focused headline]
[One or two sentences explaining the value]
[Primary CTA] [Secondary action]
```

Avoid generic claims such as “the future of design.” Prefer language that says who belongs, what they can do, and what happens after applying.

## 6. Components

### Buttons

- **Primary:** `accent` fill, `accent-foreground` text, `accent-hover` on hover.
- **Secondary:** `surface-raised` or dark-mode `button-secondary`, `foreground` text, subtle shadow.
- **Tertiary:** transparent background, `foreground-muted` text, accent on hover.
- Minimum height: 40px desktop, 44px touch target on mobile.
- Horizontal padding: 16px minimum; use 20–24px for the hero CTA.
- Radius: `md` (8px). Do not use a pill shape for every button.
- Include a visible `:focus-visible` ring using the accent. Never remove focus without replacement.
- Loading state keeps button width stable and exposes `aria-busy="true"`.

### Cards

- Use a surface contrast change and `shadow-sm` before adding a border.
- Use `shadow-md` for floating panels and `shadow-lg` for modals/sheets.
- Keep card padding at 20–24px.
- Use `surface-raised` for a card on `surface`/`background`; do not stack more than two elevation levels.
- Cards should not look clickable unless the whole card is actually interactive.

### Forms

- Labels are always visible; placeholders are not labels.
- Input height: 44px minimum. Use 12–14px horizontal padding.
- Use `input-background` and `input-border` only in dark mode; use `surface` and `border` in light mode.
- Error text sits directly below the field and explains how to fix the problem.
- Preserve entered values after validation errors.
- Group related fields under a short legend or heading.

### Navigation

- Keep the desktop nav focused: logo, 3–5 destinations, one primary CTA.
- Mobile navigation becomes a full-width sheet or menu with large tap targets.
- Active state is communicated by text/icon color and a soft surface, not a thick underline.
- The wordmark uses the brand name “UX Community”; do not introduce a second product name.

### Icons and imagery

- Use Lucide icons at 16px for controls, 20px for navigation, and 24px for feature cards.
- Icons are supportive; pair meaningful icons with visible text.
- Use real, permissioned member/community imagery where possible. Never invent testimonials or member counts.
- Keep image corners consistent with the containing card radius.
- Provide descriptive alt text for informative images and empty alt text for purely decorative visuals.

## 7. Elevation and borders

The product uses soft grouping rather than a border around everything:

- `shadow-xs`: pills, chips, compact metadata.
- `shadow-sm`: cards, list items, message-like previews.
- `shadow-md`: dropdowns, floating controls.
- `shadow-lg`: modal, sheet, or drawer.

Borders are allowed only for:

- A structural header bottom divider.
- A structural sidebar divider.
- An input boundary when contrast requires it.
- An accessible focus ring.

Do not use borders as decoration on every card, badge, or feature tile.

## 8. Background decoration

The existing system includes two restrained utilities:

- `.grid-dots`: `28px` repeating dot grid.
- `.grid-cross`: `14px` repeating cross/grid lines.

Use decoration only behind content, never behind small text or form controls. Keep opacity low and use the theme’s `grid-dot-color` / `grid-line-color`. A single hero or footer treatment is enough; do not put a pattern in every section.

## 9. Motion and interaction

- Use 150–200ms for hover/focus transitions and 250–350ms for section or modal transitions.
- Animate opacity and transform, not layout dimensions.
- Use small translate/scale changes only: avoid bouncing, parallax overload, or continuous decorative animation.
- Respect `prefers-reduced-motion: reduce`; the existing web CSS disables transitions and animation for reduced-motion users.
- Never make the primary CTA appear only after an animation.
- Hover effects must have an equivalent focus and touch state.

## 10. Accessibility requirements

- Maintain WCAG AA contrast for all text and controls.
- The blue accent is for actions and emphasis, not for body text on a light background unless contrast is verified.
- Every interactive element must be keyboard reachable and have a visible focus state.
- Use semantic landmarks: `header`, `nav`, `main`, `section`, and `footer`.
- Use one `h1`; headings must descend in a meaningful order.
- Provide a “Skip to content” link if the header is sticky.
- Do not communicate state through color alone; pair it with text, icon, or shape.
- Target at least 44×44px for touch interactions.
- Test at 200% zoom and with reduced motion.

## 11. Implementation checklist for the landing-page agent

- [ ] Import/use the existing Geist font variables and semantic Tailwind tokens.
- [ ] Use the CSS runtime palette in this document for light and dark mode.
- [ ] Build a responsive container before composing sections.
- [ ] Keep one clear primary CTA: “Join the community” or the approved equivalent.
- [ ] Use real content or explicit placeholders; do not fabricate social proof.
- [ ] Verify dark mode, keyboard focus, reduced motion, and mobile width.
- [ ] Verify every image has an intentional alt strategy.
- [ ] Keep decorative grids subtle and content readable.
- [ ] Avoid introducing a new color, radius, shadow, or font without documenting it here first.
