import type { Config } from "tailwindcss";

/**
 * Tailwind config — all colors reference CSS custom properties from
 * @draft/design-system/css/tokens.css (imported in globals.css).
 * Light/dark mode is handled entirely by `prefers-color-scheme` in CSS;
 * no class-based toggling needed.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Page / layout
        background:           "var(--color-background)",
        "background-subtle":  "var(--color-background-subtle)",

        // Surfaces (cards, panels)
        surface:              "var(--color-surface)",
        "surface-raised":     "var(--color-surface-raised)",

        // Text
        foreground:           "var(--color-foreground)",
        "foreground-muted":   "var(--color-foreground-muted)",
        "foreground-subtle":  "var(--color-foreground-subtle)",

        // Accent (draft/ purple brand)
        accent:               "var(--color-accent)",
        "accent-hover":       "var(--color-accent-hover)",
        "accent-soft":        "var(--color-accent-soft)",
        "accent-foreground":  "var(--color-accent-foreground)",

        // Borders
        border:               "var(--color-border)",
        "border-subtle":      "var(--color-border-subtle)",

        // Brand signal
        signal:               "var(--color-signal)",

        // Always-dark overlay panel (left brand panel, code blocks, etc.)
        overlay:               "var(--color-overlay)",
        "overlay-raised":      "var(--color-overlay-raised)",
        "overlay-elevated":    "var(--color-overlay-elevated)",
        "overlay-foreground":  "var(--color-overlay-foreground)",
        "overlay-muted":       "var(--color-overlay-muted)",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body:    ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono:    ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        xs:   "var(--shadow-xs)",
        sm:   "var(--shadow-sm)",
        md:   "var(--shadow-md)",
        card: "var(--shadow-card)",
      },
      borderRadius: {
        sm:   "var(--radius-sm)",
        md:   "var(--radius-md)",
        lg:   "var(--radius-lg)",
        xl:   "var(--radius-xl)",
        full: "var(--radius-full)",
      },
    },
  },
  plugins: [],
};

export default config;
