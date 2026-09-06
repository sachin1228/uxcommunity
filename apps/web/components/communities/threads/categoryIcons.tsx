import {
  HelpCircle,
  MessageCircle,
  Lightbulb,
  Megaphone,
} from "lucide-react";
import type { ThreadCategory } from "./types";

export const CATEGORY_ICONS: Record<ThreadCategory, React.ElementType> = {
  question: HelpCircle,
  discussion: MessageCircle,
  idea: Lightbulb,
  feedback: Megaphone,
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
  return <Icon size={size} strokeWidth={2.5} className={className} />;
}
