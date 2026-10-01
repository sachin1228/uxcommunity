import { QuestionCircleRegular } from "@fluentui/react-icons/headless/svg/question-circle";
import { ChatRegular } from "@fluentui/react-icons/headless/svg/chat";
import { LightbulbRegular } from "@fluentui/react-icons/headless/svg/lightbulb";
import { MegaphoneRegular } from "@fluentui/react-icons/headless/svg/megaphone";
import type { ThreadCategory } from "@/lib/communities/models/threads";

export const CATEGORY_ICONS: Record<ThreadCategory, React.ElementType> = {
  question: QuestionCircleRegular,
  discussion: ChatRegular,
  idea: LightbulbRegular,
  feedback: MegaphoneRegular,
};

export function CategoryIcon({
  category,
  size = 12,
  className,
}: {
  category: ThreadCategory;
  size?: number;
  className?: string;
}) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon fontSize={size} className={className} />;
}
