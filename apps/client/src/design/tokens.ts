/**
 * Splitnext's design tokens: one fixed light theme of near-black ink on warm
 * paper, square black actions, and hairline rules instead of cards. Green
 * means money someone gets back, orange money someone owes or something that
 * needs attention.
 *
 * The set is deliberately small: a role gets its own token only when no other
 * token already looks and means the same. Screens and components take every
 * color, size, and duration from here; the `/components` catalog shows each.
 */

/** Every color the app paints, named for its role. */
export const colors = {
  /** The page, everything on it, and text on ink: nothing sits on a card. */
  background: '#f6f5f1',
  /** Text, icons, strong rules, and the main action's black block. */
  ink: '#141413',
  /** Secondary text, labels, and quiet actions. */
  muted: '#5c5b56',
  /** Placeholders, unchecked controls, resting underlines, idle actions' text, and a left group. */
  faint: '#8b8a83',
  /** Hairlines between rows, and an action that cannot be pressed yet. */
  rule: '#dddbd3',
  /** A quiet fill: your own row, a pressed row, a bar's empty track, a neutral notice, the offline strip. */
  tint: '#ebe9e2',
  /** Text of money someone gets back, and of everyone being square. */
  owed: '#00683d',
  /** Text of money someone owes, failures, and destructive actions. */
  danger: '#9c3a11',
  /** Behind a failure. */
  dangerSurface: '#f6e4dc',
  /** Fills that mean good: money back in a bar, someone online, an action on ink. */
  positive: '#3db07c',
  /** Fills that ask for attention: money owed in a bar, counts, new and review marks. */
  alert: '#d4663f',
} as const;

export type ColorName = keyof typeof colors;

/**
 * Soft fills behind a person's initials, one per member in the order they
 * were added, repeating after the last. Initials on them are always ink.
 */
export const avatarTints = ['#f6d3b8', '#cfe6c6', '#c9dcf2', '#e4d3f1', '#f3d0d5', '#cde9e6', '#efe3b5', '#d9d6f0'] as const;

/** One color per person in an expense's split bar, in member order. */
export const splitHues = ['#3db07c', '#549de5', '#a584dc', '#d2833b', '#dd7577', '#00afb8'] as const;

/** Ink at a given opacity: the scrim and the hairline under a scrolled header. */
export function inkAlpha(alpha: number): string {
  return `rgba(20, 20, 19, ${alpha})`;
}

/** What dims the page behind anything above it: a dialog, a drawer, or an in-place edit. */
export const scrim = inkAlpha(0.36);

/** The hairline under a header once content scrolls beneath it; 0 hides it. */
export function hairlineShadow(strength = 1): string {
  return strength > 0 ? `0 1px 0 ${inkAlpha(Number((0.14 * strength).toFixed(3)))}` : 'none';
}

export const fonts = {
  /** Every text but figures. */
  body: 'Instrument Sans',
  /** Amounts and invite links. */
  mono: 'Geist Mono',
} as const;

/** Weights text may be set in beside its step's own. */
export const fontWeights = { regular: '400', semibold: '600', bold: '700' } as const;

export type FontWeight = keyof typeof fontWeights;

/**
 * The type ramp. Each step is a size, its line height, and the weight it has
 * unless told otherwise; `figure` steps are monospaced, for amounts.
 */
export const typeScale = {
  /** The homepage's headline, and its size on a phone. */
  hero: { fontFamily: fonts.body, fontSize: 68, lineHeight: 70, fontWeight: '700', letterSpacing: -2 },
  heroCompact: { fontFamily: fonts.body, fontSize: 46, lineHeight: 48, fontWeight: '700', letterSpacing: -1.4 },
  /** A screen's large title, at rest; see `titleStyle` for its scrolled sizes. */
  title: { fontFamily: fonts.body, fontSize: 32, lineHeight: 38.4, fontWeight: '700', letterSpacing: -0.96 },
  /** Dialog and drawer titles. */
  heading: { fontFamily: fonts.body, fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.6 },
  /** A group's name in the list, empty states, and sections of a long page. */
  headline: { fontFamily: fonts.body, fontSize: 20, lineHeight: 25, fontWeight: '600' },
  /** Text typed into a form. */
  large: { fontFamily: fonts.body, fontSize: 17, lineHeight: 22, fontWeight: '400' },
  /** What a row is about, such as a person or an expense, and button labels. */
  strong: { fontFamily: fonts.body, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, fontWeight: '400' },
  /** A row's second line, section labels, hints, notices, and small actions. */
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Tags, timestamps, and the offline strip. */
  meta: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  /** A count on a badge, and a check mark. */
  count: { fontFamily: fonts.body, fontSize: 10, lineHeight: 12, fontWeight: '700' },
  /** Amounts in rows. */
  figure: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 20, fontWeight: '500' },
  /** Amounts and links in small print. */
  figureSmall: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const;

export type TypeVariant = keyof typeof typeScale;

/** Interpolates from one value to another as `progress` runs from 0 to 1. */
export function between(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * A screen title's text at a scroll progress: 32px at rest, 18px compact. Its
 * line leaves room for descenders, which a one-line title would clip.
 */
export function titleStyle(progress: number) {
  const size = between(typeScale.title.fontSize, 18, progress);

  return { color: colors.ink, fontFamily: fonts.body, fontSize: size, lineHeight: size * 1.2, fontWeight: '700', letterSpacing: -0.03 * size } as const;
}

/**
 * A balance large enough to lead a screen, such as where you stand in a
 * group: bold text figures of even width, which read better than monospaced
 * ones at this size.
 */
export function balanceStyle(size: number) {
  return { fontFamily: fonts.body, fontSize: size, lineHeight: size * 1.15, fontWeight: '700' as const, letterSpacing: -0.035 * size, fontVariant: ['tabular-nums' as const] };
}

/** A large amount at any size, tracked tighter as it grows. */
export function figureStyle(size: number) {
  return { fontFamily: fonts.mono, fontSize: size, lineHeight: size, fontWeight: '500', letterSpacing: -0.03 * size } as const;
}

/**
 * The spacing scale, in points, on a 4-point grid (with 2 for text set
 * tight). Gaps and padding take a step from it; layout primitives accept
 * nothing else.
 */
export const space = [0, 2, 4, 8, 12, 16, 24, 32, 56] as const;

export type Space = (typeof space)[number];

/** Fixed heights and widths that controls and rows share. */
export const sizes = {
  /** The smallest thing a finger can reliably hit: icon buttons, header rows, fields. */
  touch: 44,
  /** A button. */
  control: 48,
  /** One row of a list, whatever it holds. */
  row: 56,
  /** Something small inside a row or a header, such as Undo or a segmented control, with a hit area reaching past it; also the offline strip. */
  compact: 32,
} as const;

/** Line widths. */
export const strokes = {
  /** Between rows, and around a quiet chip. */
  hairline: 1,
  /** Outlines of controls, underlines of inline fields, and the rule that opens a section. */
  ink: 1.5,
  /** A focused field's underline. */
  focus: 2,
  /** A colored mark at an entry's start: a notice's edge, something new, a person's color in a split. */
  marker: 4,
} as const;

/**
 * Corners stay small: buttons and tabs are barely rounded, chips and pills a
 * little less, and only avatars, dots, radio marks, and counts are round.
 */
export const radii = { control: 8, chip: 6, round: 999 } as const;

export const opacities = {
  /** Anything pressable while it is held down. */
  pressed: 0.7,
  /** Anything that cannot be used right now, and a person left out of a split. */
  disabled: 0.4,
} as const;

/** Widths that keep the app one narrow column on every device. */
export const layout = {
  /** App screens: as wide as a phone. */
  column: 480,
  /** Space between the column's edge and its content. */
  gutter: 20,
  /** Public pages, such as the homepage. */
  page: 1040,
  /** A public page's readable text. */
  prose: 680,
  /** A dialog on a wide screen. */
  dialog: 440,
} as const;

/** The easing every movement shares: quick to start, long to settle. */
export const easeOut = 'cubic-bezier(.22,.8,.16,1)';

/** How long movements take, in milliseconds. */
export const durations = {
  /** A control answering: a field's label and underline, a person dropping out of a split. */
  quick: 150,
  /** Something appearing or leaving: a chevron turning, a cover fading. */
  medium: 300,
  /** Data changing shape: balance and split bars growing. */
  slow: 500,
} as const;

/** A style that eases changes to one property on the web, where views are elements. */
export function withTransition<const Style extends object>(style: Style, property: string, duration: number) {
  return { ...style, transitionProperty: property, transitionDuration: `${duration}ms`, transitionTimingFunction: easeOut };
}
