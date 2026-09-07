/**
 * Master-data tables that support the bulk "Fetch images" admin feature.
 * Shared between the API route and the admin UI components.
 */
export const MASTER_TABLES = [
  "cities",
  "design_sectors",
  "design_interests",
  "experience_levels",
] as const;

export type MasterTable = (typeof MASTER_TABLES)[number];