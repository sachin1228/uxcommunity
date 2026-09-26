# UX Community Mobile App

React Native (Expo) mobile app for the UX Community platform.

---

## Prerequisites

Make sure you have these installed on your machine:

- **Node.js** 22+ — https://nodejs.org
- **npm** 10+
- **Expo CLI** — `npm install -g expo-cli`
- **Android Studio** (for local Android builds) — https://developer.android.com/studio
- **Java 17** (Zulu recommended) — `brew install --cask zulu@17`
- **Xcode** (for iOS builds, Mac only) — App Store

### Set Android SDK path (one-time, Mac)

```bash
echo 'export ANDROID_HOME=$HOME/Library/Android/sdk' >> ~/.zshrc
echo 'export PATH=$PATH:$ANDROID_HOME/platform-tools' >> ~/.zshrc
source ~/.zshrc
```

---

## Environment Variables

Create a `.env` file in the root of this folder:

```
EXPO_PUBLIC_API_URL=https://app.uxcommunity.in
```

> `.env` is read automatically by Expo during local development and `prebuild`.

---

## Install Dependencies

```bash
npm install
```

---

## Run Locally (Development)

### Option 1 — Expo Go (fastest, no build needed)

```bash
npx expo start
```

- Scan the QR code with the **Expo Go** app on your phone.
- Any JS change reflects instantly — no rebuild required.
- Use this for day-to-day development.

### Option 2 — Development build on Android emulator

```bash
npx expo start --android
```

Requires Android Studio with a virtual device configured.

### Option 3 — Development build on iOS simulator (Mac only)

```bash
npx expo start --ios
```

---

## Build APK Locally (Android)

Use this to produce a real `.apk` you can install directly on a device.

### Step 1 — Generate native Android folder (one-time, or after adding native packages)

```bash
npx expo prebuild --platform android
```

> Re-run `prebuild` only when you add/remove native packages or change `app.json`. Not needed for JS-only changes.

### Step 2 — Build the APK

```bash
cd android
./gradlew assembleRelease
```

**First build:** ~20–30 min (downloads all dependencies).  
**Subsequent builds:** ~3–5 min (incremental).

### Output

```
android/app/build/outputs/apk/release/app-release.apk
```

Transfer the APK to your phone (AirDrop, Google Drive, USB cable) and install it.

---

## Build via EAS (Expo Cloud)

EAS builds run in the cloud — no local Android/Java setup needed. Environment variables are already configured in `eas.json` for all profiles.

### Install EAS CLI

```bash
npm install -g eas-cli
eas login
```

### Build profiles

| Profile | Use for | Command |
|---|---|---|
| `development` | Dev client build | `eas build --profile development --platform android` |
| `preview` | Internal testing APK | `eas build --profile preview --platform android` |
| `production` | Play Store release | `eas build --profile production --platform android` |

### Example — build a preview APK

```bash
eas build --profile preview --platform android
```

Download the APK from the link EAS provides when the build finishes.

---

## Project Structure

```
expo-app-standalone 3/
├── app/                      Expo Router screens
│   ├── (auth)/               Login screen
│   ├── (tabs)/               Main tabs: home, communities, explore, jobs
│   ├── community/[id].tsx    Community chat screen
│   ├── settings/             Notification settings + push diagnostics
│   └── index.tsx             Auth-based entry redirect
├── components/               UI components (chat/, communities/, community/, shared)
│   ├── PushNotificationsBridge.tsx   Headless push mount point
│   └── ErrorBoundary.tsx     App-wide error boundary
├── context/AuthContext.tsx   Auth context (session management)
├── hooks/                    useChatMessages, useCommunities, useCommunityContent,
│                             useSendMessage, useTypingPresence, usePushNotifications, …
├── lib/
│   ├── api.ts                Base fetch client (reads EXPO_PUBLIC_API_URL)
│   ├── auth.ts               Login / logout / getMe
│   ├── realtime.ts           Multiplexed Cloudflare WebSocket client (port of the web client)
│   ├── communities.ts        Community data fetching
│   ├── communityContent.ts   Threads / events / resources / showcase content
│   ├── push.ts               Push registration, channels, badge, diagnostics
│   └── eventTimezone.ts      Event timezone helpers
├── constants/                Colors and theme constants
├── scripts/                  Push doctor + google-services sync helpers
├── assets/                   Images and fonts
├── app.json                  Expo app config
├── eas.json                  EAS build profiles (env vars included)
└── .env                      Local env vars (not committed)
```

For routing, auth gating, realtime and push internals, see
[`docs/mobile-architecture.md`](../docs/mobile-architecture.md).

---

## Notes

- **Session handling:** The web backend sets an `HttpOnly` JWT cookie (`uxcommunity_session`). The mobile app captures it from `Set-Cookie` headers and replays it via `AsyncStorage`. It talks to the API only — no Supabase client and no Supabase Auth.
- **Realtime:** chat, typing, presence, comments and content updates arrive over the Cloudflare Durable Object worker (`apps/realtime`) through `lib/realtime.ts`; the same JWT authenticates the WebSocket.
- **Push notifications:** Expo push (see `docs/mobile-architecture.md`), with Android FCM wired through `google-services.json` and diagnostics on the notification settings screen.
- **Rate limiting:** Login and content writes are rate-limited on the server (Upstash Redis). If you hit too many attempts, wait a few minutes.
- **`EXPO_PUBLIC_*` vars** are baked into the JS bundle at build time. Changing them requires a rebuild.



## build locally
- cd "expo-app-standalone 3/android" && ./gradlew assembleRelease