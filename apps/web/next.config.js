/** @type {import('next').NextConfig} */

// Derive the Supabase storage hostname from the env var so we don't hardcode
// the project ref. Falls back to a wildcard pattern if the var is absent.
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "*.supabase.co";

const nextConfig = {
  // Video uploads ship the ORIGINAL to this route (cap: 50MB), so the Next
  // proxy's default 10MB body limit would truncate every big video. Match
  // the app cap with headroom for multipart/form-data overhead. In Next 16
  // this lives under `experimental` (the legacy top-level
  // `middlewareClientMaxBodySize` is rejected by the config validator).
  experimental: {
    proxyClientMaxBodySize: "55mb",
  },

  // The generated schema is committed (lib/supabase/database.types.ts) and
  // wired into the service client with `createClient<Database>(...)`. That
  // removed the ~618 `never` errors that previously made every `.select()`
  // result unusable — the total fell from 767 to 89. Regenerate the schema
  // with `npm run db:types` after a migration.
  //
  // The 89 that remain are genuine (argument narrowing, dynamic table names
  // where `from()` takes a variable, a few column mismatches) rather than
  // schema-inference noise. Keep skipping the check at build time until they
  // are cleared, then set this to false so `next build` guards them again.
  //
  // NOTE: this flag only affects `next build`. `next dev` does not type-check
  // at all (the checker lives in Next's build path), so this is NOT what keeps
  // type errors out of the dev server. `npm run dev` therefore runs the dev
  // server alongside `tsc --watch` (scripts/dev-with-typecheck.mjs) so the
  // errors stay visible on localhost:3000 while developing.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Prevent k6 scripts from being pulled into Next.js file tracing.
  // The load-test route spawns k6/node as external processes; those files
  // must never be bundled or traced as app modules.
  outputFileTracingExcludes: {
    "*": ["../../k6/**"],
  },
  reactStrictMode: true,
  transpilePackages: ["@uxcommunity/shared", "@uxcommunity/design-system"],
  allowedDevOrigins: ["*.replit.dev", "*.pike.replit.dev", "*.sisko.replit.dev", "127.0.0.1"],
  // Allow Next.js <Image> to optimise uploaded images from Supabase storage.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
      // GIPHY CDN (for GIF and sticker messages)
      { protocol: "https", hostname: "media.giphy.com" },
      { protocol: "https", hostname: "media0.giphy.com" },
      { protocol: "https", hostname: "media1.giphy.com" },
      { protocol: "https", hostname: "media2.giphy.com" },
      { protocol: "https", hostname: "media3.giphy.com" },
      { protocol: "https", hostname: "media4.giphy.com" },
    ],
  },
};

module.exports = nextConfig;
