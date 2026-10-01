import { DocumentTextRegular } from "@fluentui/react-icons/headless/svg/document-text";
import { WrenchRegular } from "@fluentui/react-icons/headless/svg/wrench";
import { PlayRegular } from "@fluentui/react-icons/headless/svg/play";
import { BookOpenRegular } from "@fluentui/react-icons/headless/svg/book-open";
import { TextFontRegular } from "@fluentui/react-icons/headless/svg/text-font";
import { ShapesRegular } from "@fluentui/react-icons/headless/svg/shapes";
import { ColorRegular } from "@fluentui/react-icons/headless/svg/color";
import { SlideLayoutRegular } from "@fluentui/react-icons/headless/svg/slide-layout";
import { SparkleRegular } from "@fluentui/react-icons/headless/svg/sparkle";
import { BoxRegular } from "@fluentui/react-icons/headless/svg/box";
import type { FluentIcon } from "@fluentui/react-icons/headless";
import { FigmaIcon } from "@/components/ui/BrandIcons";
import type { ResourceType } from "@/lib/communities/models/resources";

const iconMap: Record<ResourceType, FluentIcon> = {
  figma:       FigmaIcon,
  article:     DocumentTextRegular,
  tool:        WrenchRegular,
  video:       PlayRegular,
  book:        BookOpenRegular,
  font:        TextFontRegular,
  icon_pack:   ShapesRegular,
  color:       ColorRegular,
  template:    SlideLayoutRegular,
  inspiration: SparkleRegular,
  other:       BoxRegular,
};

export function ResourceTypeIcon({ type, size = 16, className }: { type: ResourceType; size?: number; className?: string }) {
  const Icon = iconMap[type] ?? BoxRegular;
  return <Icon fontSize={size} className={className} />;
}
