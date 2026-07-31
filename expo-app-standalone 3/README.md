# My App

A React Native mobile app built with Expo.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Expo Go](https://expo.dev/go) app on your phone (for quick device testing)

## Getting started

```bash
# Install dependencies
npm install

# Start the dev server
npm start
```

This opens Metro bundler in your terminal. From there you can:

- Press **`i`** to open in iOS Simulator (requires Xcode on macOS)
- Press **`a`** to open in Android Emulator (requires Android Studio)
- Press **`w`** to open in a web browser
- **Scan the QR code** with your phone's camera (iOS) or the Expo Go app (Android) to run on a real device

## Project structure

```
my-app/
├── app/                    # Screens (Expo Router — file-based routing)
│   ├── _layout.tsx         # Root layout & providers
│   ├── +not-found.tsx      # 404 screen
│   └── (tabs)/
│       ├── _layout.tsx     # Tab bar setup
│       └── index.tsx       # Home tab
├── assets/
│   └── images/
│       └── icon.png        # App icon
├── components/
│   ├── ErrorBoundary.tsx
│   ├── ErrorFallback.tsx
│   └── KeyboardAwareScrollViewCompat.tsx
├── constants/
│   └── colors.ts           # Design tokens / colour palette
├── hooks/
│   └── useColors.ts        # Light/dark theme hook
├── app.json                # Expo config
├── babel.config.js
├── metro.config.js
├── tsconfig.json
└── package.json
```

## Adding screens

Create a new file inside `app/` and it becomes a route automatically:

```tsx
// app/profile.tsx
import { View, Text } from 'react-native';

export default function ProfileScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Profile</Text>
    </View>
  );
}
```

Navigate to it with `<Link href="/profile" />` or `router.push('/profile')` from `expo-router`.

## Customising the theme

Edit `constants/colors.ts` to change the colour palette. To add dark mode support, add a `dark` key alongside `light` — the `useColors()` hook picks it up automatically.

## Useful commands

| Command | Description |
|---|---|
| `npm start` | Start Metro (interactive menu) |
| `npm run ios` | Open iOS Simulator directly |
| `npm run android` | Open Android Emulator directly |
| `npm run web` | Open in browser |
| `npm run typecheck` | Run TypeScript checks |

## Stack

- **Expo** ~54 / **React Native** 0.81
- **Expo Router** v6 (file-based routing)
- **TanStack React Query** v5 (async data)
- **React Native Reanimated** v4
- **React Native Gesture Handler** v2
- **Inter** font (via `@expo-google-fonts/inter`)
