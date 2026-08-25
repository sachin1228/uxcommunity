import { darkTheme } from "./dark";

/**
 * The product now has one intentional dark visual language. This alias keeps
 * the public package API stable for existing consumers while removing drift.
 */
export const lightTheme = darkTheme;
export type LightTheme = typeof lightTheme;
