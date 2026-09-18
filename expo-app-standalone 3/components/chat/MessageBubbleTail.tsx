import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * WhatsApp-style bubble tail — a react-native-svg port of the web
 * `MessageBubbleTail` so an outgoing/incoming bubble has the identical
 * silhouette on both clients.
 *
 * Positioned by the parent: absolute, top 0, just outside the bubble edge.
 */
export function MessageBubbleTail({
  side = 'left',
  color,
}: {
  side?: 'left' | 'right';
  color: string;
}) {
  return (
    <Svg
      viewBox="0 0 8 13"
      width={8}
      height={13}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: 'absolute',
        top: 0,
        [side === 'right' ? 'right' : 'left']: -8,
        zIndex: 10,
      }}
      pointerEvents="none"
    >
      {side === 'right' ? (
        <Path
          fill={color}
          d="M6.467,2.568L0,11.193V0L5.188,0 C6.958,0,7.526,1.156,6.467,2.568z"
        />
      ) : (
        <Path
          fill={color}
          d="M1.533,2.568L8,11.193V0L2.812,0 C1.042,0,0.474,1.156,1.533,2.568z"
        />
      )}
    </Svg>
  );
}
