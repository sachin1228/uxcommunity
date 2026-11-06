/** A slice of a fixed-row-height list plus the spacer heights around it. */
export interface VirtualWindow {
  start: number;
  end: number;
  topSpacer: number;
  bottomSpacer: number;
}

/**
 * Index window for a fixed-height list. `start` already includes the leading
 * overscan; the rendered slice therefore spans the visible rows plus overscan
 * on both sides. Pure so the boundary rules can be tested without a DOM.
 */
export function virtualWindow(
  itemCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 4,
): VirtualWindow {
  if (itemCount <= 0) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  const row = Math.max(1, rowHeight);
  const viewport = Math.max(0, viewportHeight);
  const visibleRows = Math.ceil(viewport / row) + 1;
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / row) - overscan);
  const end = Math.min(itemCount, start + visibleRows + overscan * 2);
  return {
    start,
    end,
    topSpacer: start * row,
    bottomSpacer: (itemCount - end) * row,
  };
}
