/**
 * Showcase categories — the single source of truth.
 *
 * Both the composer chips / feed filter row (components/communities/showcase)
 * and server-side API validation (showcase-validation.ts) read from this list,
 * so a category can only ever be added or renamed in one place.
 */
export const SHOWCASE_CATEGORY_OPTIONS = [
  { value: "product_design", label: "Product Design" },
  { value: "ai_design", label: "AI design" },
  { value: "ux_research", label: "UX Research" },
  { value: "ui_design", label: "UI Design" },
  { value: "portfolio", label: "Portfolio" },
  { value: "case_study", label: "Case study" },
  { value: "graphic_design", label: "Graphic Design" },
  { value: "motion_design", label: "Motion Design" },
  { value: "illustration", label: "Illustration" },
  { value: "3d_design", label: "3D Design" },
  { value: "other", label: "Other" },
] as const;

export type ShowcaseCategory = (typeof SHOWCASE_CATEGORY_OPTIONS)[number]["value"];

/** Accepted category values — used by the create/update routes. */
export const SHOWCASE_CATEGORIES_SET = new Set<string>(
  SHOWCASE_CATEGORY_OPTIONS.map((option) => option.value),
);
