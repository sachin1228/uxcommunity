import {
  HelpCircle,
  MessageCircle,
  Palette,
  BookOpen,
  Lightbulb,
  Megaphone,
  Briefcase,
  Users,
} from "lucide-react";
import type { ThreadCategory } from "./types";

export const CATEGORY_ICONS: Record<ThreadCategory, React.ElementType> = {
  question: HelpCircle,
  discussion: MessageCircle,
  showcase: Palette,
  resource: BookOpen,
  idea: Lightbulb,
  feedback: Megaphone,
  job: Briefcase,
  collaboration: Users,
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
  return <Icon size={size} className={className} />;
}
