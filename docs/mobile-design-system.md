# UX Community — Mobile Design System

**Status:** Implementation guide  
**Audience:** The Expo / React Native mobile app agent and mobile contributors  
**Product:** UX Community mobile app

This guide maps the existing web design system to native mobile patterns. It is intentionally separate from the landing-page guide: mobile uses the same brand language and semantic colors, but must account for safe areas, touch targets, keyboard behavior, gestures, performance, and platform conventions.

## 1. Source of truth and platform rules

- App source: `expo-app-standalone 3/`
- Theme source: `expo-app-standalone 3/constants/colors.ts`
- Theme hook: `expo-app-standalone 3/hooks/useColors.ts`
- Navigation: Expo Router
- Font packages already available: Geist and Inter
- Use `useColors()` for semantic color access. Do not hard-code color literals in screen or component styles.
- Use `useColorScheme()` through the existing hook so light/dark mode follows the device setting.
- Keep navigation, gestures, keyboard handling, and system UI native-feeling. Do not copy web hover patterns into the app.

The mobile palette mirrors the web design system, with a few native aliases (`card`, `primary`, `muted`, `input`) for existing components.

## 2. Theme palettes

### 2.1 Light mode — complete mobile palette

| Token | Hex | Use |
|---|---:|---|
| `text` | `#0A0A0A` | Legacy alias for primary text |
| `tint` | `#0070F3` | Legacy alias for brand tint |
| `background` | `#000000` | Existing mobile base background alias; prefer `subtle`/`surface` for normal screens |
| `foreground` | `#0A0A0A` | Primary text |
| `card` | `#FFFFFF` | Cards and raised surfaces |
| `cardForeground` | `#0A0A0A` | Text on cards |
| `primary` | `#0070F3` | Primary buttons, links, active controls |
| `primaryForeground` | `#FFFFFF` | Text/icon on primary |
| `primaryHover` | `#0060D1` | Pressed/active darkened primary state |
| `primarySoft` | `#F0F8FF` | Soft primary background |
| `secondary` | `#F5F5F5` | Secondary controls and muted surfaces |
| `secondaryForeground` | `#0A0A0A` | Text on secondary |
| `muted` | `#F5F5F5` | Muted surface |
| `mutedForeground` | `#737373` | Supporting text and metadata |
| `foregroundSoft` | `#8A8A8A` | Low-emphasis text |
| `accent` | `#0070F3` | Accent action |
| `accentForeground` | `#FFFFFF` | Text/icon on accent |
| `accentSoft` | `#F0F8FF` | Accent-tinted surface |
| `destructive` | `#EF4444` | Destructive action/error |
| `destructiveForeground` | `#FFFFFF` | Text/icon on destructive |
| `border` | `#EAEAEA` | Input or structural boundary |
| `input` | `#EAEAEA` | Input boundary/fill alias |
| `surface` | `#FFFFFF` | Normal raised surface |
| `subtle` | `#F5F5F5` | Page/secondary background |

### 2.2 Dark mode — complete mobile palette

| Token | Hex | Use |
|---|---:|---|
| `text` | `#EDEDED` | Legacy alias for primary text |
| `tint` | `#52A8FF` | Legacy alias for dark-mode-readable brand tint |
| `background` | `#000000` | Existing mobile base background alias |
| `foreground` | `#EDEDED` | Primary text |
| `card` | `#121214` | Cards and raised surfaces |
| `cardForeground` | `#EDEDED` | Text on cards |
| `primary` | `#0070F3` | Primary buttons, links, active controls |
| `primaryForeground` | `#FFFFFF` | Text/icon on primary |
| `primaryHover` | `#0060D1` | Pressed/active darkened primary state |
| `primarySoft` | `#18243D` | Soft primary background |
| `secondary` | `#1A1A1E` | Secondary controls and muted surfaces |
| `secondaryForeground` | `#EDEDED` | Text on secondary |
| `muted` | `#1A1A1E` | Muted surface |
| `mutedForeground` | `#525252` | Supporting text and metadata |
| `foregroundSoft` | `#888888` | Low-emphasis text |
| `accent` | `#0070F3` | Accent action |
| `accentForeground` | `#FFFFFF` | Text/icon on accent |
| `accentSoft` | `#18243D` | Accent-tinted surface |
| `destructive` | `#EF4444` | Destructive action/error |
| `destructiveForeground` | `#FFFFFF` | Text/icon on destructive |
| `border` | `#202024` | Input or structural boundary |
| `input` | `#151517` | Input fill |
| `surface` | `#121214` | Normal raised surface |
| `subtle` | `#0E0E10` | Page/secondary background |

### 2.3 Shared primitive reference

When extending the palette, use the shared primitives from `packages/design-system/src/tokens/colors.ts`:

- **Blue:** `#000B1F`, `#00254D`, `#003C85`, `#0057B7`, `#006BDB`, `#0070F3`, `#52A8FF`, `#ADCFFF`, `#D9ECFF`, `#F0F8FF`
- **Neutral:** `#FFFFFF`, `#FAFAFA`, `#F5F5F5`, `#EAEAEA`, `#E0E0E0`, `#A8A8A8`, `#737373`, `#525252`, `#404040`, `#262626`, `#171717`, `#0A0A0A`
- **Dark:** `#0A0A0A`, `#111111`, `#1A1A1A`, `#2E2E2E`, `#3E3E3E`, `#737373`, `#EDEDED`

Prefer semantic aliases over these raw values in app code.

## 3. Typography

Use Geist for the product UI. Inter is available for compatibility but should not be mixed into a single screen without a clear reason.

| Role | Size | Weight | Line height | Use |
|---|---:|---:|---:|---|
| Display | 32–36px | 700 | 1.15 | Onboarding or major screen title |
| Screen title | 24px | 600–700 | 1.25 | Tab and detail screen heading |
| Section title | 20px | 600 | 1.25 | Group heading |
| Body large | 17px | 400 | 1.45 | Intro copy and empty states |
| Body | 15–16px | 400 | 1.5 | Default content |
| Label/button | 15–16px | 500–600 | 1.25 | Interactive controls |
| Caption | 12–13px | 400–500 | 1.4 | Metadata, timestamps |
| Micro label | 11px | 600 | 1.3 | Compact status or eyebrow |

Rules:

- Use Dynamic Type-friendly sizing where possible; do not turn all text into fixed tiny labels.
- Keep body text at least 15px on phones.
- Use a maximum of two weights in one compact row.
- Use sentence case and concise labels.
- Never truncate a critical action label. Let non-critical metadata ellipsize.

## 4. Spacing and sizing

Use a 4px base rhythm:

| Token | Value | Use |
|---|---:|---|
| `space-1` | 4px | Icon/text gap |
| `space-2` | 8px | Compact gap |
| `space-3` | 12px | Row gap, input inset |
| `space-4` | 16px | Screen side padding, default card inset |
| `space-5` | 20px | Section gap |
| `space-6` | 24px | Card inset, major group gap |
| `space-8` | 32px | Screen header/section gap |
| `space-10` | 40px | Onboarding spacing |
| `space-12` | 48px | Large empty-state spacing |

Standard dimensions:

- Screen horizontal padding: 16px; use 20px for onboarding and marketing-led screens.
- Minimum touch target: 44×44px; prefer 48×48px for primary navigation and chat actions.
- Standard input/button height: 48px.
- Compact control height: 40px only when it still has a 44px hit slop.
- Avatar sizes: 32px compact, 40px list, 48px profile, 64–96px profile header.
- Tab bar icon: 24px; tab bar item hit area: at least 48px.
- Message bubble max width: about 78% of the content width.
- Bottom sheet corner radius: 20px top corners.

## 5. Radius, elevation, and surfaces

Mobile radius tokens:

| Token | Value | Use |
|---|---:|---|
| `none` | 0px | Full-bleed sections |
| `sm` | 4px | Compact badge |
| `md` | 8px | Buttons, inputs, standard cards |
| `lg` | 12px | Community rows, feature cards |
| `xl` | 16px | Large cards and image containers |
| `2xl` | 20px | Sheets and prominent media |
| `full` | 9999px | Avatars, pills, status |

React Native shadow guidance:

- Use subtle `shadowOpacity` / `shadowRadius` on iOS and `elevation` on Android.
- Do not rely on shadows alone for meaning; pair elevation with `card`/`surface` contrast.
- Avoid heavy shadows on dark backgrounds. A darker or lighter surface is usually clearer.
- Avoid borders around every row. Use section spacing and surface contrast; use a divider only for a real list boundary.

## 6. App structure and navigation

Current app areas:

- Auth: login and entry states.
- Tabs: home/community feed, explore, communities, and jobs.
- Community detail: message list and composer.

Navigation rules:

- Keep the bottom tab bar stable across primary destinations.
- Use labels with icons; icon-only tabs are not sufficient.
- Preserve the selected tab and scroll position when returning from a detail screen.
- Use a native stack for community detail and auth transitions.
- Back buttons must return to the previous logical screen, not reset the app.
- Use the safe-area insets for headers, tab bars, sheets, and the chat composer.
- Keep the tab bar visually quiet: `subtle` background, clear selected tint, no oversized branding.

## 7. Screen patterns

### Home / feed

- Start with a clear screen title or personalized greeting.
- Keep the first meaningful content above the fold.
- Use a vertical list with consistent row heights and generous touch space.
- Use skeletons or a purposeful loading state; avoid blank screens.
- Empty states explain what the user can do next and provide one action.

### Explore / communities

- Search and filtering controls sit near the content they affect.
- Community rows include image/avatar, name, short descriptor, and membership state.
- Use `card` or `surface` rows with `lg` radius; keep metadata muted.
- Do not overload each row with more than one secondary action.

### Community chat

- Messages are grouped by sender and time, but each message remains understandable when read alone.
- Other-user bubbles use `card`/`surface` plus subtle elevation; current-user bubbles use `primary` or `accent`.
- Keep the composer above the keyboard and safe-area inset.
- Send, attachment, emoji, and close actions need explicit accessible labels.
- Preserve draft text when the keyboard opens, image picker is cancelled, or a send fails.
- Show send failure inline with a retry path; do not silently discard a message.
- Use a full-screen image viewer for media, with a clear close/back action.

### Auth and onboarding

- One task per screen where possible.
- Show progress for multi-step signup.
- Keep the primary action fixed only when it does not cover content and respects the bottom inset.
- Explain why profile, avatar, or interest information is requested.
- Use inline validation after a field has been touched; do not show a wall of errors on first render.

## 8. Controls and states

### Buttons

- Primary: `primary` fill with `primaryForeground` text.
- Secondary: `secondary` fill with `secondaryForeground`.
- Destructive: `destructive` fill or a text action with destructive color for secondary danger.
- Pressed state: use `primaryHover` or a platform-appropriate opacity change.
- Disabled state: reduce contrast and opacity without making the label unreadable.
- Keep button width stable during loading; show a spinner with an accessible label.
- Add haptic feedback only for meaningful completion, selection, or destructive confirmation.

### Inputs

- Use visible labels and helper text.
- Input fill: `surface`/`card` in light mode, `input` in dark mode.
- Use `border` only when needed to define the field; focus should also be visible through accent color or a focus ring-like fill change.
- Keyboard type, autocorrect, capitalization, and return key must match the field.
- Password fields need a show/hide control with a 44px target.
- Keep validation messages close to the input and preserve focus where possible.

### Lists

- Use `FlatList`/`SectionList` for long or realtime collections.
- Give each item a stable key.
- Do not nest independent virtualized lists.
- Separate sections with space and subtle dividers rather than a border on every card.
- Add pull-to-refresh only where refresh has a clear meaning.

## 9. Icons, avatars, and media

- Use the existing Expo Symbols / vector icon support consistently; do not mix icon families on one screen.
- Icon-only controls require `accessibilityLabel` and a visible or programmatic pressed/selected state.
- Avatars must have a deterministic fallback and a meaningful accessibility label.
- Images should use the existing image utilities and handle loading, failure, and remote URL variants.
- Do not render SVG avatar URLs directly through React Native `Image`; resolve them to a supported raster fallback first.
- Use `contentFit="cover"` for avatars and `contain` for logos or illustrations.
- Avoid autoplaying video or animated decoration in feed cells.

## 10. Motion, gestures, and feedback

- Use native-feeling transitions: short fades, slide-up sheets, and small press scale/opacity feedback.
- Respect reduced motion settings.
- Keep gesture targets large and provide a button alternative for important actions.
- Use haptics sparingly: selection, successful send, completed onboarding, and destructive confirmation are appropriate moments.
- Realtime updates should animate in without moving the user away from the message they are reading.
- Typing indicators can animate subtly; they must not be the only indication that a message is sending.

## 11. Accessibility and device behavior

- Support VoiceOver and TalkBack labels, roles, values, and hints.
- Every screen needs a logical accessibility order.
- Selected tabs, toggles, loading buttons, and message status must expose state programmatically.
- Maintain at least 4.5:1 contrast for normal text and 3:1 for large text/UI boundaries where applicable.
- Support large text without clipping or hiding primary actions.
- Respect safe-area insets on every edge-to-edge screen.
- Handle keyboard appearance without covering inputs or the chat composer.
- Test narrow phones, larger phones, dark mode, light mode, offline/retry states, and reduced motion.
- Never depend on color alone for unread, error, online, or selected states.

## 12. Performance and data states

Every network-backed screen must define:

1. Loading state.
2. Loaded state.
3. Empty state.
4. Error state with retry.
5. Offline or stale-data behavior where relevant.

Performance rules:

- Virtualize feeds and chats.
- Keep images sized to their rendered dimensions.
- Memoize expensive message rows and avoid rerendering the whole chat on typing.
- Subscribe only to the active community’s realtime events.
- Unsubscribe on screen unmount or community change.
- Debounce search input and cancel obsolete requests.
- Avoid large JSON or image work on the JS thread during gestures.

## 13. Mobile implementation checklist

- [ ] Read colors through `useColors()` and preserve light/dark semantic names.
- [ ] Use Geist consistently and keep body text at least 15px.
- [ ] Apply safe-area insets to headers, sheets, tab bars, and composers.
- [ ] Make all important controls at least 44×44px.
- [ ] Provide loading, empty, error, and retry states for every network screen.
- [ ] Preserve drafts and user input through keyboard, picker, and request failures.
- [ ] Add accessibility labels and selected/disabled/loading states.
- [ ] Verify realtime chat does not jump or duplicate messages.
- [ ] Test image loading failures and unsupported avatar URL formats.
- [ ] Test both themes, large text, reduced motion, and offline/retry behavior.
- [ ] Avoid adding a new token or component pattern without updating this guide and the shared design-system source.
