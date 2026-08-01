---
name: Mobile avatar URL resolution
description: React Native cannot render SVGs — all SVG-serving avatar domains must be rewritten to PNG before passing to <Image>.
---

# Mobile avatar URL formats

## The rule
Never pass an SVG URL to React Native's `<Image>`. All avatar_url values from `designer_profiles` must be resolved to a raster (PNG/JPEG/WebP) URL before use on mobile.

## Why
The web app's `AvatarImg` component handles multiple URL formats (boring://, DiceBear SVG, multiavatar SVG, avataaars SVG) by rendering inline SVGs or rewriting URLs. React Native's `<Image>` silently fails on SVG URLs — `onError` fires and the fallback (initials) shows instead of the avatar. The failure is invisible in logs.

## URL formats stored in designer_profiles.avatar_url

| Format | Stored example | Mobile handling |
|--------|---------------|-----------------|
| Uploaded photo (R2) | `https://pub-xxx.r2.dev/avatars/…` | Pass through — already raster |
| DiceBear (SVG) | `https://api.dicebear.com/9.x/bottts/svg?seed=…` | Rewrite `/svg?` → `/png?` |
| boring:// protocol | `boring://marble/John%20Doe` | Convert to DiceBear PNG using decoded seed |
| Legacy boringavatars CDN | `https://source.boringavatars.com/beam/…` | Convert to DiceBear PNG using seed path segment |
| Multiavatar | `https://api.multiavatar.com/seed` | Append `?format=png` |
| Avataaars | `https://avataaars.io/…` | No PNG endpoint — fall back to DiceBear PNG from name |
| null | — | Generate DiceBear PNG from user's name |

## How to apply
Any React Native component that renders `avatar_url` from the DB must pass it through `resolveAvatarUri(avatarUrl, name)` first. This helper lives in `expo-app-standalone 3/components/chat/MessageBubble.tsx` and can be extracted to a shared util if needed elsewhere.

**Why DiceBear PNG:** DiceBear's `/png` endpoint returns a real raster image, is deterministic (same seed = same avatar), and matches the style used on web for generated avatars.
