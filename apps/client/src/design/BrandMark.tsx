import { useId } from 'react';
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';
import { colors } from './tokens';

const LEFT_S_PATH =
  'M45.52 86.20Q38.55 86.20 33.22 83.71Q27.89 81.22 24.88 76.57Q21.87 71.93 21.87 65.39L21.87 62.98L33.05 62.98L33.05 65.39Q33.05 70.81 36.40 73.52Q39.75 76.23 45.52 76.23Q51.36 76.23 54.25 73.91Q57.13 71.58 57.13 67.97Q57.13 65.48 55.71 63.93Q54.29 62.38 51.58 61.39Q48.87 60.40 45 59.54L43.02 59.11Q36.83 57.74 32.40 55.63Q27.97 53.52 25.61 50.08Q23.24 46.64 23.24 41.14Q23.24 35.64 25.87 31.72Q28.49 27.81 33.26 25.70Q38.03 23.60 44.48 23.60Q50.93 23.60 55.97 25.79Q61 27.98 63.88 32.32Q66.76 36.67 66.76 43.20L66.76 45.78L55.58 45.78L55.58 43.20Q55.58 39.76 54.25 37.66Q52.91 35.55 50.42 34.56Q47.92 33.57 44.48 33.57Q39.32 33.57 36.87 35.51Q34.42 37.44 34.42 40.80Q34.42 43.03 35.58 44.58Q36.74 46.13 39.07 47.16Q41.39 48.19 45 48.97L46.98 49.40Q53.43 50.77 58.20 52.92Q62.97 55.07 65.64 58.60Q68.31 62.12 68.31 67.63Q68.31 73.13 65.51 77.30Q62.72 81.47 57.60 83.84Q52.48 86.20 45.52 86.20';

const RIGHT_S_PATH =
  'M59.52 86.20Q52.55 86.20 47.22 83.71Q41.89 81.22 38.88 76.57Q35.87 71.93 35.87 65.39L35.87 62.98L47.05 62.98L47.05 65.39Q47.05 70.81 50.40 73.52Q53.75 76.23 59.52 76.23Q65.36 76.23 68.25 73.91Q71.13 71.58 71.13 67.97Q71.13 65.48 69.71 63.93Q68.29 62.38 65.58 61.39Q62.87 60.40 59 59.54L57.02 59.11Q50.83 57.74 46.40 55.63Q41.97 53.52 39.61 50.08Q37.24 46.64 37.24 41.14Q37.24 35.64 39.87 31.72Q42.49 27.81 47.26 25.70Q52.03 23.60 58.48 23.60Q64.93 23.60 69.97 25.79Q75 27.98 77.88 32.32Q80.76 36.67 80.76 43.20L80.76 45.78L69.58 45.78L69.58 43.20Q69.58 39.76 68.25 37.66Q66.91 35.55 64.42 34.56Q61.92 33.57 58.48 33.57Q53.32 33.57 50.87 35.51Q48.42 37.44 48.42 40.80Q48.42 43.03 49.58 44.58Q50.74 46.13 53.07 47.16Q55.39 48.19 59 48.97L60.98 49.40Q67.43 50.77 72.20 52.92Q76.97 55.07 79.64 58.60Q82.31 62.12 82.31 67.63Q82.31 73.13 79.51 77.30Q76.72 81.47 71.60 83.84Q66.48 86.20 59.52 86.20';

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
