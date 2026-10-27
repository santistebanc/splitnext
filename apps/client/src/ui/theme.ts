/**
 * One fixed light palette: near-black ink on warm paper, square black
 * actions, and hairline rules instead of cards. Green figures and bars mean
 * money someone gets back, orange money someone owes.
 */
export const colors = {
  /** The page. */
  background: '#f6f5f1',
  /** Fields and panels; the page itself, since nothing sits on a card. */
  surface: '#f6f5f1',
  ink: '#141413',
  /** Secondary text, labels, and quiet actions. */
  muted: '#5c5b56',
  /** Body copy that is quieter than ink. */
  soft: '#5c5b56',
  /** Text of an excluded or unavailable choice, and placeholders' rings. */
  faint: '#8b8a83',
  /** Placeholder text. */
  placeholder: '#b9b7ae',
  /** The one main action on a page: a black block. */
  action: '#141413',
  actionInk: '#f6f5f1',
  actionInkSoft: '#dddbd3',
  actionDark: '#000000',
  actionSoft: '#eeece5',
  /** A main action that cannot be pressed yet. */
  actionBusy: '#dddbd3',
  actionBusyInk: '#8b8a83',
  /** The row that is you, in a list of everyone. */
  youRow: '#eeece5',
  border: '#dddbd3',
  /** Lines between rows. */
  rule: '#dddbd3',
  /** Underlines of fields and outlines of secondary buttons. */
  field: '#141413',
  /** Unchecked boxes, unselected radios, and unclaimed markers. */
  control: '#8b8a83',
  /** The empty half of a balance bar. */
  track: '#e7e5dd',
  pale: '#eeece5',
  /** Someone gets money back. */
  owed: '#00683d',
  /** Someone owes money. */
  owes: '#9c3a11',
  /** Balance bars: money back, and money owed. */
  owedBar: '#3db07c',
  owesBar: '#df7752',
  settled: '#5c5b56',
  settledInk: '#195c2e',
  settledSoft: '#e4eee6',
  online: '#33854a',
  warning: '#f6eadb',
  /** The edge of changes waiting for review. */
  warningEdge: '#e2b48f',
  /** The Activity count and marks on new entries. */
  alert: '#cf6139',
  /** Activity entries that are new since last marked seen. */
  fresh: '#eeece5',
  peopleSoft: '#eeece5',
  peopleInk: '#141413',
  /** The total row under a breakdown. */
  totalRow: '#eeece5',
  warningInk: '#9c3a11',
  danger: '#f6e4dc',
  dangerInk: '#9c3a11',
  night: '#141413',
  nightOwed: '#3db07c',
};

/** One color per person in an expense's split bar, in member order. */
export const splitHues = ['#3db07c', '#549de5', '#a584dc', '#d2833b', '#dd7577', '#00afb8'];

/** Everything is square; only dots and counts are round. */
export const radius = { small: 0, control: 0, card: 0, sheet: 0, pill: 999 } as const;

/** The only shadow: a hairline under a header once content scrolls beneath it. */
export const shadows = {
  raised: 'none',
  floating: 'none',
} as const;

/** Body text, labels, controls, and titles. */
export const fontFamily = 'Instrument Sans';

/** Amounts and invite links. */
export const monoFamily = 'Geist Mono';

/** Page titles and group names. */
export const displayFamily = 'Instrument Sans';

/** The easing every movement shares: quick to start, long to settle. */
export const easeOut = 'cubic-bezier(.22,.8,.16,1)';

/** A style that eases changes to one property on the web, where views are elements. */
export function withTransition<const Style extends object>(style: Style, property: string, duration: number) {
  return { ...style, transitionProperty: property, transitionDuration: `${duration}ms`, transitionTimingFunction: easeOut };
}
