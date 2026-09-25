import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { APP_NAME, APP_TAGLINE } from "@uxcommunity/shared";
import { NavigationGuard } from "@/components/ui/NavigationGuard";
import { GlobalFetchGuard } from "@/components/ui/GlobalFetchGuard";
import "./globals.css";

/**
 * Geist ships as two vendored variable fonts in ./fonts instead of through
 * `next/font/google`. That path downloads the stylesheet from Google during
 * `next build`, and when the request misbehaves Turbopack fails the whole
 * build — which silently leaves production on the previous deploy, because the
 * "Deploy web worker" step never runs (see fonts/README.md). Reading the files
 * from disk keeps the build offline and deterministic.
 *
 * `weight` is the variable axis the files carry, so `font-medium`,
 * `font-semibold` and `font-bold` keep resolving to real weights. The CSS
 * variable names are unchanged — `--font-display` / `--font-mono` are consumed
 * by globals.css and tailwind.config.ts.
 */
const geist = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-display",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://uxcommunity.in"),
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-circle.svg", type: "image/svg+xml" },
      { url: "/icons/icon-circle-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-circle-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/icon-circle.svg"],
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_TAGLINE,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "uxcommunity logo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} — ${APP_TAGLINE}`,
    description: APP_TAGLINE,
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground antialiased">
        <NavigationGuard />
        <GlobalFetchGuard />
        {children}
      </body>
    </html>
  );
}
