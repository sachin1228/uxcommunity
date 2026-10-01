import { BriefcaseRegular } from "@fluentui/react-icons/headless/svg/briefcase";
import { PaintBrushRegular } from "@fluentui/react-icons/headless/svg/paint-brush";
import { MoreCircleRegular } from "@fluentui/react-icons/headless/svg/more-circle";
import { CubeRegular } from "@fluentui/react-icons/headless/svg/cube";
import { DocumentTextRegular } from "@fluentui/react-icons/headless/svg/document-text";
import { AppsRegular } from "@fluentui/react-icons/headless/svg/apps";
import { DesktopRegular } from "@fluentui/react-icons/headless/svg/desktop";
import { BoxRegular } from "@fluentui/react-icons/headless/svg/box";
import { ColorRegular } from "@fluentui/react-icons/headless/svg/color";
import { PlayRegular } from "@fluentui/react-icons/headless/svg/play";
import { SearchRegular } from "@fluentui/react-icons/headless/svg/search";
import { SparkleRegular } from "@fluentui/react-icons/headless/svg/sparkle";
import type { ShowcaseCategory } from "./types";

/**
 * Single source of truth for showcase category icons. The composer chips and
 * the feed filter row both read from here, so adding a category only needs a
 * label (types.ts) plus an icon in this map.
 */
export const CATEGORY_ICONS: Record<ShowcaseCategory | "all", React.ElementType> = {
  all: AppsRegular,
  product_design: BoxRegular,
  ai_design: SparkleRegular,
  ux_research: SearchRegular,
  ui_design: DesktopRegular,
  portfolio: BriefcaseRegular,
  case_study: DocumentTextRegular,
  graphic_design: ColorRegular,
  motion_design: PlayRegular,
  illustration: PaintBrushRegular,
  "3d_design": CubeRegular,
  other: MoreCircleRegular,
};
