import { Calendar, Image as ImageIcon, Link2, MessagesSquare, type LucideIcon } from "lucide-react";
import type { ContentKind } from "@/lib/communities/content-sync";

/**
 * One glyph per content kind, shared by every surface that labels a kind —
 * the community nav, profile activity tabs, the Library shelf and the tab
 * toggles in community settings. Keeping them in one map is what stops the
 * Showcase or Resources mark drifting between those screens. The mobile app
 * mirrors these in `components/community/TabIcons.tsx`.
 */
export const CONTENT_KIND_ICONS: Record<ContentKind, LucideIcon> = {
  thread: MessagesSquare,
  showcase: ImageIcon,
  resource: Link2,
  event: Calendar,
};
