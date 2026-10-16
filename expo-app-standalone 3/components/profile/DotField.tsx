import React, { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/** The web grid's tile (`--grid-size`): dot spacing and dot radius. */
const GRID_SIZE = 8;
const DOT_RADIUS = 1;

/** The fade curve: full strength to 80dp, then a linear run to zero at 160dp. */
const FADE_START = 80;
const FADE_END = 160;

/** The band the texture can ever be seen in — where the mask reaches zero. */
export const DOT_BAND_HEIGHT = FADE_END;

/** The web mask evaluated at a dot's y — the opacity its row is drawn with. */
function fadeAt(y: number): number {
  if (y <= FADE_START) return 1;
  return Math.max(0, (FADE_END - y) / (FADE_END - FADE_START));
}

/** One dot as two arcs at (x, y) — SVG's circle-as-path idiom. */
function dotAt(x: number, y: number): string {
  const r = DOT_RADIUS;
  return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
}

/** The lattice's dot rows: one centre every `GRID_SIZE`, first to last. */
const ROWS = Array.from(
  { length: Math.ceil((FADE_END - GRID_SIZE / 2) / GRID_SIZE) },
  (_, row) => GRID_SIZE / 2 + row * GRID_SIZE,
);

/**
 * The profile page's dotted backdrop — the mobile reading of the web
 * profile's `DotField` (apps/web/components/ui/DotField.tsx): the same
 * lattice (a dot at every 8dp tile centre, 1dp radius) and the same dot
 * colour (the web `--grid-dot-color`, read through `useColors()`), so the
 * texture opens the page and never competes with the hero below it.
 *
 * The fade keeps the web mask's shape — full strength to 80dp, then a
 * linear run out — but the band reaches zero at 160dp, not the web's 200dp.
 *
 * The web field draws on a canvas so the dots can stir under the pointer; a
 * touch screen has no hover, so this renders the resting texture. Every dot
 * of a row lives in one path and every row carries its own fade opacity, so
 * the whole band costs a couple dozen SVG nodes instead of one per dot. The
 * parent owns the placement — the profile screen gives it the full-bleed
 * band behind the hero (see app/(tabs)/profile.tsx).
 */
export function DotField() {
  const colors = useColors();
  const { width } = useWindowDimensions();

  // Rebuilt only when the width changes (rotation): one `d` per row, holding
  // every dot centre across the window's width.
  const rows = useMemo(
    () =>
      ROWS.map((y) => {
        let d = '';
        for (let x = GRID_SIZE / 2; x < width; x += GRID_SIZE) d += dotAt(x, y);
        return { y, d, opacity: fadeAt(y) };
      }),
    [width],
  );

  return (
    <Svg width="100%" height="100%" pointerEvents="none">
      {rows.map((row) => (
        <Path key={row.y} d={row.d} fill={colors.gridDot} opacity={row.opacity} />
      ))}
    </Svg>
  );
}
