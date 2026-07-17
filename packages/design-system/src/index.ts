/**
 * @draft/design-system
 *
 * Single entry point for the design system.
 *
 * Usage (TypeScript):
 *   import { tokens, lightTheme, darkTheme } from "@draft/design-system";
 *
 * Usage (CSS — import once in your global stylesheet):
 *   @import "@draft/design-system/css/tokens.css";
 */

// Raw primitive tokens
export { colors, purple, neutral, signal } from "./tokens/colors";
export { typography, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } from "./tokens/typography";
export { radius } from "./tokens/radius";
export { shadows } from "./tokens/shadows";

// Semantic themes
export { lightTheme, darkTheme } from "./themes";
export type { LightTheme, DarkTheme } from "./themes";

// Convenience re-export of all token groups
import { colors } from "./tokens/colors";
import { typography } from "./tokens/typography";
import { radius } from "./tokens/radius";
import { shadows } from "./tokens/shadows";

export const tokens = {
  colors,
  typography,
  radius,
  shadows,
} as const;

export type Tokens = typeof tokens;
