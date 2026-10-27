/**
 * One fixed light palette: white cards on a cool grey page, near-black ink,
 * and one blue for actions. Blue and orange figures only mean money someone
 * gets back or owes; green means settled or online.
 */
export const colors = {
  /** The page behind cards. */
  background: '#f2f4f6',
  /** Cards, fields, and the bottom navigation. */
  surface: '#ffffff',
  ink: '#10161d',
  /** Secondary text and section labels. */
  muted: '#56606b',
  /** Body copy that is quieter than ink but more than a caption. */
  soft: '#39424c',
  /** Text of an excluded or unavailable choice. */
  faint: '#6b747e',
  /** The one main action on a page, and links. */
  action: '#1b5fc1',
  actionInk: '#ffffff',
  /** Quieter text on an action-blue surface. */
  actionInkSoft: '#d6e6ff',
  actionDark: '#134a99',
  actionSoft: '#e6effc',
  /** A main action that is working and cannot be pressed again. */
  actionBusy: '#8fa9cf',
  /** The row that is you, in a list of everyone. */
  youRow: '#eef4fd',
  /** Card edges. */
  border: '#dde2e7',
  /** Lines between rows inside a card. */
  rule: '#e7ebef',
  /** Field and secondary button edges. */
  field: '#c9d0d7',
  /** Unchecked boxes, unselected radios, and unclaimed markers. */
  control: '#8a949e',
  /** Segmented control tracks. */
  track: '#e3e7eb',
  /** Quiet information panels. */
  pale: '#e8ecf0',
  /** Someone gets money back. */
  owed: '#1b5fc1',
  /** Someone owes money. */
  owes: '#a9470c',
  settled: '#2f5d3a',
  settledSoft: '#e3f0e6',
  online: '#2f7d4a',
  warning: '#fff4e5',
  /** The edge of changes waiting for review. */
  warningEdge: '#f3c9a8',
  /** The bell's count and the dot on an expense waiting for review. */
  alert: '#c2410c',
  /** Activity entries that are new since last marked seen. */
  fresh: '#f2f7fe',
  /** People entries in Activity. */
  peopleSoft: '#f1eafb',
  peopleInk: '#5b3a8c',
  /** The total row under a breakdown. */
  totalRow: '#f8f9fa',
  warningInk: '#6b3305',
  danger: '#fdeee3',
  dangerInk: '#7a3206',
  /** The dark balance and invite cards. */
  night: '#10161d',
  nightOwed: '#8ec1ff',
};

/**
 * Corner radii: small controls inside rows, fields and buttons, cards and
 * tiles, sheets and dialogs, and fully rounded pills.
 */
export const radius = { small: 10, control: 12, card: 16, sheet: 24, pill: 999 } as const;

/** Shadows: raised for a control lifted off its track, floating for anything over the page. */
export const shadows = {
  raised: '0 1px 3px rgba(16, 22, 29, 0.15)',
  floating: '0 6px 18px rgba(16, 22, 29, 0.18)',
} as const;

/** Body text, labels, and controls. */
export const fontFamily = 'IBM Plex Sans';

/** Amounts, currency codes, and invite links. */
export const monoFamily = 'IBM Plex Mono';

/** Page titles, group names, and empty-state titles. */
export const displayFamily = 'Bricolage Grotesque';
