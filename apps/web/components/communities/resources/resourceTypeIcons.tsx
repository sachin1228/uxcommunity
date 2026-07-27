import {
  Figma,
  FileText,
  Wrench,
  Play,
  BookOpen,
  Type,
  Shapes,
  Palette,
  LayoutTemplate,
  Sparkles,
  Package,
  type LucideIcon,
} from "lucide-react";
import type { ResourceType } from "./types";

const iconMap: Record<ResourceType, LucideIcon> = {
  figma:       Figma,
  article:     FileText,
  tool:        Wrench,
  video:       Play,
  book:        BookOpen,
  font:        Type,
  icon_pack:   Shapes,
  color:       Palette,
  template:    LayoutTemplate,
  inspiration: Sparkles,
  other:       Package,
};

export function ResourceTypeIcon({ type, size = 14, className }: { type: ResourceType; size?: number; className?: string }) {
  const Icon = iconMap[type] ?? Package;
  return <Icon size={size} className={className} />;
}
