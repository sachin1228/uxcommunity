import nextConfig from "eslint-config-next";

const config = [
  {
    // Build output. `next build`, `opennextjs-cloudflare build` and
    // `wrangler types` all write generated JS into the app directory; linting
    // it reported errors in files nobody can edit (the turbopack runtime
    // chunks alone accounted for a third of the error count), which in turn
    // made "eslint is clean" impossible to use as a gate.
    ignores: [".next/**", ".open-next/**", "dist/**", "cloudflare-env.d.ts", "next-env.d.ts"],
  },
  ...nextConfig,
];

export default config;
