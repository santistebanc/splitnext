import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** Stroked 24-unit outline icons, in ink unless given a colour. */
function Outline(props: IconProps & { children: ReactNode; fallback: number }) {
  return (
    <Svg
      aria-hidden
      width={props.size ?? props.fallback}
      height={props.size ?? props.fallback}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color ?? colors.ink}
      strokeWidth={props.strokeWidth ?? 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.children}
    </Svg>
  );
}

export function LinkIcon(props: IconProps & { broken?: boolean }) {
  return (
    <Outline {...props} fallback={18}>
      <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      {props.broken ? <Path d="M4 4l16 16" /> : null}
    </Outline>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={22}>
      <Path d="M15 5l-7 7 7 7" />
    </Outline>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={16}>
      <Path d="M9 6l6 6-6 6" />
    </Outline>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={16}>
      <Path d="M6 9l6 6 6-6" />
    </Outline>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.2} {...props} fallback={20}>
      <Path d="M12 5v14M5 12h14" />
    </Outline>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.2} {...props} fallback={16}>
      <Path d="M5 12l5 5 9-10" />
    </Outline>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={18}>
      <Path d="M6 6l12 12M18 6L6 18" />
    </Outline>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={20}>
      <Rect x={4} y={4} width={6.5} height={6.5} rx={1.5} />
      <Rect x={13.5} y={4} width={6.5} height={6.5} rx={1.5} />
      <Rect x={4} y={13.5} width={6.5} height={6.5} rx={1.5} />
      <Rect x={13.5} y={13.5} width={6.5} height={6.5} rx={1.5} />
    </Outline>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.2} {...props} fallback={14}>
      <Path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
      <Path d="M18 3v4h-4M6 21v-4h4" />
    </Outline>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={18}>
      <Path d="M12 3l9 16H3z" />
      <Path d="M12 10v4M12 17v.5" />
    </Outline>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={18}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v6M12 16.5v.5" />
    </Outline>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={15}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 11v5M12 7.5v.5" />
    </Outline>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={22}>
      <Path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <Path d="M9 8h6M9 12h6" />
    </Outline>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={22}>
      <Path d="M12 4v16M6 20h12M5 7h14" />
      <Path d="M7 7l-3 6h6zM17 7l-3 6h6z" />
    </Outline>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={22}>
      <Circle cx={12} cy={12} r={8} />
      <Path d="M12 8v4l3 2" />
    </Outline>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={22}>
      <Circle cx={9} cy={9} r={3} />
      <Path d="M3 19c0-3 3-5 6-5s6 2 6 5" />
      <Circle cx={17} cy={8} r={2.5} />
      <Path d="M16.5 14c2.5 0 4.5 2 4.5 5" />
    </Outline>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={15}>
      <Path d="M9 14L4 9l5-5" />
      <Path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Outline>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={16}>
      <Path d="M12 15V3M7 8l5-5 5 5" />
      <Path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </Outline>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2.2} {...props} fallback={16}>
      <Path d="M12 5v14M6 13l6 6 6-6" />
    </Outline>
  );
}

export function WifiIcon(props: IconProps & { off?: boolean }) {
  return (
    <Outline {...props} fallback={20}>
      <Path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0" />
      <Circle cx={12} cy={19} r={1} />
      {props.off ? <Path d="M3 3l18 18" /> : null}
    </Outline>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={20}>
      <Path d="M6 15l6-6 6 6" />
    </Outline>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={24}>
      <Path d="M6 10a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 15 6 10z" />
      <Path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </Outline>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={24}>
      <Path d="M9 2h6l.5 2.5 1.3.8 2.4-.8 3 5.2-1.9 1.7V13l1.9 1.7-3 5.2-2.4-.8-1.3.8L15 22H9l-.5-2.1-1.3-.8-2.4.8-3-5.2L3.7 13v-1.6L1.8 9.7l3-5.2 2.4.8 1.3-.8z" />
      <Circle cx={12} cy={12} r={3} />
    </Outline>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Outline strokeWidth={2} {...props} fallback={18}>
      <Path d="M5 12h14M13 6l6 6-6 6" />
    </Outline>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={20}>
      <Path d="M4 20h4l11-11-4-4L4 16z" />
      <Path d="M13.5 6.5l4 4" />
    </Outline>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={20}>
      <Circle cx={12} cy={8} r={3.5} />
      <Path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </Outline>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={20}>
      <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </Outline>
  );
}

/** Two opposite arrows, for repayments. */
export function RepayIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={18}>
      <Path d="M4 8h14l-4-4M20 16H6l4 4" />
    </Outline>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Outline {...props} fallback={18}>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-4-4" />
    </Outline>
  );
}
