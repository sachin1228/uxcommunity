import Svg, { Path } from 'react-native-svg';

/**
 * The web cards' comment glyph (bubble with two text lines), shared by every
 * mobile card footer so threads, resources, showcase posts and events read the
 * same as the web. Drawn in the heart's 16-unit box with the same 1.5 stroke
 * and size, so the pair matches at any scale.
 */
export function CommentGlyph({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M1.334 7C1.334 3.667 4.001 2 8.001 2C12.001 2 14.668 3.667 14.668 7C14.668 10.333 12.001 12 8.001 12V14C8.001 14 1.334 12 1.334 7Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.334 5.666H10.668M5.334 8.333H8.001"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
