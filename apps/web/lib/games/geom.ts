import type { BuildingRect } from "./arenaTypes";

export interface XY {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(bx - ax, by - ay);

/** Closest point on a rect to a circle centre. */
function closestOnRect(px: number, py: number, r: BuildingRect): XY {
  return {
    x: clamp(px, r.x, r.x + r.w),
    y: clamp(py, r.y, r.y + r.h),
  };
}

/** True when a circle overlaps a rect (inflated by its radius). */
export function circleHitsRect(cx: number, cy: number, radius: number, rect: BuildingRect): boolean {
  const p = closestOnRect(cx, cy, rect);
  return (p.x - cx) ** 2 + (p.y - cy) ** 2 <= radius * radius;
}

/**
 * Push a circle out of a rect (axis-separated walls → circles slide along
 * walls instead of sticking). Returns the corrected position.
 */
export function resolveCircleRect(cx: number, cy: number, radius: number, rect: BuildingRect): XY {
  const p = closestOnRect(cx, cy, rect);
  const dx = cx - p.x;
  const dy = cy - p.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= radius * radius) return { x: cx, y: cy };
  const push = radius - Math.sqrt(d2);

  if (d2 > 1e-9) {
    // Centre outside the rect — push along the contact normal.
    const d = Math.sqrt(d2);
    return { x: cx + (dx / d) * push, y: cy + (dy / d) * push };
  }

  // Centre inside the rect — push out along the shallowest axis.
  const left = cx - rect.x + radius;
  const right = rect.x + rect.w - cx + radius;
  const top = cy - rect.y + radius;
  const bottom = rect.y + rect.h - cy + radius;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: rect.x - radius, y: cy };
  if (m === right) return { x: rect.x + rect.w + radius, y: cy };
  if (m === top) return { x: cx, y: rect.y - radius };
  return { x: cx, y: rect.y + rect.h + radius };
}

/** Bullet (a small circle) vs rect — true when it overlaps. */
export function bulletHitsRect(x: number, y: number, rect: BuildingRect): boolean {
  const r = 3;
  return circleHitsRect(x, y, r, rect);
}

/**
 * Move a disc from (x,y) by (dx,dy), resolving collisions against every
 * building + the world bounds, axis by axis so it slides along walls.
 */
export function moveWithCollisions(
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  obstacles: BuildingRect[],
  w: number,
  h: number,
): XY {
  let nx = clamp(x + dx, radius, w - radius);
  let ny = y;
  for (const rect of obstacles) {
    const p = resolveCircleRect(nx, ny, radius, rect);
    nx = p.x;
    ny = p.y;
  }
  ny = clamp(ny + dy, radius, h - radius);
  for (const rect of obstacles) {
    const p = resolveCircleRect(nx, ny, radius, rect);
    nx = p.x;
    ny = p.y;
  }
  return { x: nx, y: ny };
}
