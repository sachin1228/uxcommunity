import {
  Briefcase,
  Brush,
  CircleEllipsis,
  Cuboid,
  FileText,
  LayoutGrid,
  Monitor,
  Package,
  Palette,
  Play,
  Search,
  Sparkles,
} from "lucide-react";
import type { ShowcaseCategory } from "./types";

/**
 * Single source of truth for showcase category icons. The composer chips and
 * the feed filter row both read from here, so adding a category only needs a
 * label (types.ts) plus an icon in this map.
 */
export const CATEGORY_ICONS: Record<ShowcaseCategory | "all", React.ElementType> = {
  all: LayoutGrid,
  product_design: Package,
  ai_design: Sparkles,
  ux_research: Search,
  ui_design: Monitor,
  portfolio: Briefcase,
  case_study: FileText,
  graphic_design: Palette,
  motion_design: Play,
  illustration: Brush,
  "3d_design": Cuboid,
  other: CircleEllipsis,
};
