/** @type {import('next').NextConfig} */

// Derive the Supabase storage hostname from the env var so we don't hardcode
// the project ref. Falls back to a wildcard pattern if the var is absent.
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "*.supabase.co";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@draft/shared", "@draft/design-system"],
  allowedDevOrigins: ["*.replit.dev", "*.pike.replit.dev", "127.0.0.1"],
  images: {
    // Allow Next.js <Image> to optimise images from Supabase storage and the
    // external avatar providers (DiceBear, Robohash, etc.).
    // Next.js converts to WebP, resizes to the requested dimensions, and caches
    // the result — cutting Supabase egress on every subsequent page load.
    remotePatterns: [
      // Supabase storage (project-specific)
      {
        protocol: "https",
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/**",
      },
      // DiceBear avatars
      { protocol: "https", hostname: "api.dicebear.com" },
      // Robohash
      { protocol: "https", hostname: "robohash.org" },
      // Avataaars
      { protocol: "https", hostname: "api.avataaars.io" },
      { protocol: "https", hostname: "avataaars.io" },
      // Multiavatar
      { protocol: "https", hostname: "api.multiavatar.com" },
      // Boring Avatars CDN
      { protocol: "https", hostname: "source.boringavatars.com" },
    ],
  },
};

module.exports = nextConfig;
