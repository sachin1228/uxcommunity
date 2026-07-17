/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@draft/shared", "@draft/design-system"],
};

module.exports = nextConfig;
