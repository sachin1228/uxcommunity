/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@draft/shared", "@draft/design-system"],
  allowedDevOrigins: ["*.replit.dev", "*.pike.replit.dev", "127.0.0.1"],
};

module.exports = nextConfig;
