import { useId } from 'react';
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';
import { colors } from './tokens';

import { LEFT_S_PATH, RIGHT_S_PATH } from './brand';

/** The split-S mark of the favicon, drawn in ink with paper lines to match the app. */
export function BrandMark({
  size,
  background = colors.ink,
  color = colors.background,
}: {
  size: number;
  background?: string;
  color?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const leftClip = `sn-left-${uid}`;
  const rightClip = `sn-right-${uid}`;

  return (
    <Svg aria-hidden testID='splitnext-logo' width={size} height={size} viewBox='0 0 104 104' fill='none'>
      <Defs>
        <ClipPath id={leftClip}>
          <Rect x={0} y={0} width={46} height={104} />
        </ClipPath>
        <ClipPath id={rightClip}>
          <Rect x={58} y={0} width={46} height={104} />
        </ClipPath>
      </Defs>
      <Rect x={2} y={2} width={100} height={100} rx={26} fill={background} />
      <G clipPath={`url(#${leftClip})`}>
        <Path d={LEFT_S_PATH} fill={color} />
      </G>
      <G clipPath={`url(#${rightClip})`}>
        <Path d={RIGHT_S_PATH} fill={color} />
      </G>
      <Line
        x1={52}
        y1={20}
        x2={52}
        y2={84}
        stroke={color}
        strokeWidth={7}
        strokeLinecap='butt'
        strokeDasharray='7 9'
      />
    </Svg>
  );
}
