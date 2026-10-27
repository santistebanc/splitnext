import { useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { formatAmount } from '@splitnext/client';
import { between, useCompactProgress } from './pageScroll';
import { AlertIcon, WarningIcon } from './icons';
import { morph } from './ScreenMorph';
import { colors, displayFamily, fontFamily, monoFamily, withTransition } from './theme';

export { colors } from './theme';

type ButtonProps = {
  children: ReactNode;
  onPress: () => void;
  /** Outlined in ink, for the second choice beside a main action. */
  secondary?: boolean;
  /** Underlined text without a block, for minor actions. */
  quiet?: boolean;
  /** Orange text, for leaving or removing. */
  danger?: boolean;
  /** A black block, for confirming a change that cannot be taken back. */
  dark?: boolean;
  /** A compact button for actions inside rows. */
  small?: boolean;
  disabled?: boolean;
  label?: string;
  grow?: boolean;
  icon?: ReactNode;
  /** For a button that shows or hides more below it. */
  expanded?: boolean;
};

export function Button(props: ButtonProps) {
  const filled = !props.secondary && !props.quiet && !props.danger;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled), ...(props.expanded !== undefined && { expanded: props.expanded }) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.button,
        props.small && s.smallButton,
        props.grow && s.growButton,
        props.secondary && s.secondary,
        props.quiet && s.quiet,
        props.danger && s.danger,
        pressed && !props.disabled && s.pressed,
        props.disabled && (filled ? s.busyButton : s.dim),
      ]}
    >
      {props.icon}
      <Text
        style={[
          s.buttonText,
          props.small && s.smallButtonText,
          props.secondary && s.inkText,
          props.quiet && s.quietText,
          props.danger && s.dangerText,
          filled && props.disabled && { color: colors.actionBusyInk },
        ]}
      >
        {props.children}
      </Text>
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  trailing?: ReactNode;
  inputRef?: Ref<TextInput>;
  /** A large monospaced figure, for the amount a form is about. */
  figure?: boolean;
};

/** A bare field over an ink underline, as the prototype's forms use. */
export function Field(props: FieldProps) {
  const { label, hideLabel, hint, trailing, inputRef, figure, ...input } = props;

  return (
    <View style={s.field}>
      {!hideLabel ? <Text style={s.label}>{label}</Text> : null}
      <View style={s.fieldRow}>
        <TextInput
          {...input}
          ref={inputRef}
          accessibilityLabel={label}
          placeholderTextColor={colors.placeholder}
          style={[s.input, figure && s.figureInput, input.style]}
        />
        {trailing}
      </View>
      {hint ? <Text style={s.caption}>{hint}</Text> : null}
    </View>
  );
}

type ChoiceProps = {
  children?: string;
  /** Richer content than a single line of text, such as a code and an amount. */
  content?: ReactNode;
  selected: boolean;
  onPress: () => void;
  /** One option of a segmented control rather than a free-standing chip. */
  segment?: boolean;
  label?: string;
};

/** A square outlined choice that fills black when chosen. */
export function Choice(props: ChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.selected }}
      aria-checked={props.selected}
      onPress={props.onPress}
      style={({ pressed }) => [
        props.segment ? s.segment : s.chip,
        props.selected && (props.segment ? s.segmentSelected : s.chipSelected),
        pressed && s.pressed,
      ]}
    >
      {props.content ?? (
        <Text
          numberOfLines={1}
          style={[s.chipText, props.selected && s.chipTextSelected]}
        >
          {props.children}
        </Text>
      )}
    </Pressable>
  );
}

/** A row with a round marker that thickens when chosen, ruled above. */
export function RadioRow(props: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; accessibilityLabel?: string; children?: ReactNode; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ checked: props.selected, disabled: Boolean(props.disabled) }}
      aria-checked={props.selected}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [s.radioRow, props.compact && { minHeight: 52 }, props.style, pressed && s.pressed, props.disabled && s.dim]}
    >
      <View style={[s.radioDot, props.compact && { width: 18, height: 18 }, props.selected && s.radioDotSelected]} />
      <Text numberOfLines={1} style={[s.radioLabel, props.compact && { fontSize: 16 }]}>{props.label}</Text>
      {props.children}
    </Pressable>
  );
}

/** A section's title, with an optional action at its end. */
export function SectionHeading(props: { title: string; end?: ReactNode; onPress?: (() => void) | undefined; color?: string }) {
  return (
    <View style={s.sectionHeading}>
      <Text accessibilityRole="header" onPress={props.onPress} style={[s.sectionTitle, props.color !== undefined && { color: props.color }]}>{props.title}</Text>
      {props.end}
    </View>
  );
}

/** A balance figure, such as "+12.50", "−12.50", or "0.00". */
export function signedFigure(amount: number, currency: string): string {
  return `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${formatAmount(Math.abs(amount), currency)}`;
}

/** A balance's color: green when money comes back, orange when owed, grey when settled. */
export function balanceColor(amount: number): string {
  return amount > 0 ? colors.owed : amount < 0 ? colors.owes : colors.settled;
}

/**
 * A balance as two halves meeting at an ink line: what someone owes grows
 * left in orange, what they get back grows right in green, both as a share of
 * the largest balance shown beside it.
 */
export function BalanceBar(props: { amount: number; max: number; height?: number; track?: boolean }) {
  const share = props.max > 0 ? Math.min(1, Math.abs(props.amount) / props.max) : 0;
  const width = `${share * 100}%` as const;
  const half = { flex: 1, flexDirection: 'row', alignItems: 'center' } as const;
  const grow = withTransition({ height: props.track ? '100%' : (props.height ?? 14) }, 'width', 600);

  return (
    <View aria-hidden style={{ flexDirection: 'row', height: props.track ? (props.height ?? 6) : '100%', alignSelf: 'stretch' }}>
      <View style={[half, { justifyContent: 'flex-end', borderRightWidth: 1.5, borderColor: colors.ink }, props.track && { backgroundColor: colors.track }]}>
        <View style={[grow, { width: props.amount < 0 ? width : '0%', backgroundColor: colors.owesBar }]} />
      </View>
      <View style={[half, props.track && { backgroundColor: colors.track }]}>
        <View style={[grow, { width: props.amount > 0 ? width : '0%', backgroundColor: colors.owedBar }]} />
      </View>
    </View>
  );
}

/** A page title matching the size used in screen headers and drawers. */
export function PageTitle(props: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.pageTitle}>
      {props.children}
    </Text>
  );
}

/**
 * A screen's fixed header: a row with a text back action and actions at the
 * end, then a large title that shrinks as the page scrolls under it, with a
 * hairline appearing below. A heading that is more than text stands in for
 * the title and styles its text with `titleStyle(progress)`. `underRow`
 * opens directly under the row, such as a field for one of its actions;
 * `below` follows the title.
 */
export function ScreenHeader(props: { title?: string | undefined; heading?: ReactNode; context?: string | undefined; start?: ReactNode; end?: ReactNode; underRow?: ReactNode; below?: ReactNode; morph?: string | undefined }) {
  const progress = useCompactProgress();

  return (
    <View style={[s.screenHeader, { paddingBottom: between(14, 6, progress), boxShadow: `0 1px 0 rgba(20, 20, 19, ${(0.14 * progress).toFixed(3)})` }]}>
      <View style={s.screenHeaderRow}>
        <View style={s.screenHeaderStart}>{props.start}</View>
        {props.end ? <View style={s.screenHeaderEnd}>{props.end}</View> : null}
      </View>
      {props.underRow}
      {props.heading ?? props.title ? (
        <View style={[s.screenHeaderTitle, { paddingTop: between(16, 4, progress) }]}>
          {props.heading ?? (
            <Text ref={morph(props.morph)} accessibilityRole="header" numberOfLines={1} style={titleStyle(progress)}>
              {props.title}
            </Text>
          )}
        </View>
      ) : null}
      {props.below}
    </View>
  );
}

/** The large title's text at a scroll progress: 42px at rest, 22px compact. */
export function titleStyle(progress: number) {
  const size = between(42, 22, progress);

  return { color: colors.ink, fontFamily: displayFamily, fontSize: size, lineHeight: size * 1.05, fontWeight: '700', letterSpacing: -0.03 * size } as const;
}

/** No gap below the header: its own padding and hairline separate it from the page. */
export const headerGap = 0;

type HeaderActionProps = { label: string; onPress: () => void; disabled?: boolean };

/** “‹ Groups”: where back goes, named in the header's first row. */
export function BackButton(props: HeaderActionProps & { text?: string }) {
  const named = props.label.replace(/^Back to /, '');
  const text = props.text ?? (named === props.label ? 'Back' : named.charAt(0).toUpperCase() + named.slice(1));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [s.navIcon, pressed && s.pressed, props.disabled && s.dim]}
    >
      <Text numberOfLines={1} style={s.headerActionText}>‹ {text}</Text>
    </Pressable>
  );
}

/** A text action in a screen header, such as Cancel, or the black Save beside it. */
export function HeaderAction(props: HeaderActionProps & { text: string; danger?: boolean; primary?: boolean; quiet?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.headerAction,
        props.quiet && { paddingLeft: 24, paddingRight: 20 },
        props.primary && s.headerPrimary,
        props.primary && props.disabled && s.headerPrimaryIdle,
        pressed && s.pressed,
        !props.primary && props.disabled && s.dim,
      ]}
    >
      <Text style={[s.headerActionText, props.quiet && { color: colors.muted }, props.primary && s.headerPrimaryText, props.primary && props.disabled && { color: colors.actionBusyInk }, props.danger && s.dangerText]}>{props.text}</Text>
    </Pressable>
  );
}

/** A quiet empty state: a short title and one line of guidance, left aligned. */
export function EmptyState(props: { icon?: ReactNode; title: string; text?: string; tone?: 'action' | 'settled' }) {
  return (
    <View style={s.emptyState}>
      <Text style={[s.emptyTitle, props.tone === 'settled' && { color: colors.settledInk }]}>{props.tone === 'settled' ? '✓ ' : ''}{props.title}</Text>
      {props.text ? <Text style={s.emptyText}>{props.text}</Text> : null}
    </View>
  );
}

/**
 * The screen's main action at the foot of the screen: a full-width black
 * block, grey while it cannot be pressed, with a spinner while it works.
 */
export function FooterButton(props: { children: ReactNode; onPress: () => void; disabled?: boolean; busy?: boolean; label?: string; icon?: ReactNode; morph?: string }) {
  const idle = props.disabled || props.busy;

  return (
    <Pressable
      ref={morph(props.morph)}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(idle), busy: Boolean(props.busy) }}
      disabled={idle}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.footerButton,
        idle && s.footerButtonIdle,
        pressed && s.pressed,
      ]}
    >
      {props.busy ? <ActivityIndicator size="small" color={colors.actionBusyInk} /> : props.icon}
      <Text style={[s.footerButtonText, idle && { color: colors.actionBusyInk }]}>{props.children}</Text>
    </Pressable>
  );
}

/**
 * A text action, underlined, such as Invite people or Split equally. Filled,
 * it is a black block instead, as Record is beside a planned payment.
 */
export function Pill(props: { text: string; label?: string; onPress?: () => void; disabled?: boolean; filled?: boolean; large?: boolean; icon?: (color: string) => ReactNode }) {
  const ink = props.filled ? colors.actionInk : colors.ink;
  const style = [s.pill, props.large && s.largePill, props.filled && s.filledPill];

  const content = (
    <>
      {props.icon?.(ink)}
      <Text numberOfLines={1} style={[s.pillText, props.large && s.largePillText, !props.filled && s.link, { color: ink }]}>{props.text}</Text>
    </>
  );

  if (!props.onPress) return <View style={style}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [style, pressed && s.pressed, props.disabled && s.dim]}
    >
      {content}
    </Pressable>
  );
}

/** A pressable row ruled above, such as an expense or a person. */
export function ListRow(props: { label: string; onPress: () => void; disabled?: boolean; first?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [s.listRow, props.style, pressed && s.rowPressed]}
    >
      {props.children}
    </Pressable>
  );
}

/** A small quiet label, such as Taken, To review, or you. */
export function Tag(props: { children: string; tone?: 'neutral' | 'warning' | 'action' }) {
  return (
    <Text
      style={[
        s.tag,
        props.tone === 'warning' && s.tagWarning,
        props.tone === 'action' && s.tagAction,
      ]}
    >
      {props.children}
    </Text>
  );
}

/**
 * A message ruled in ink at its start: orange for a failure or something to
 * look at. It shows its message, or richer content such as a button.
 */
export function Notice(props: { message?: string; children?: ReactNode; tone: 'warning' | 'danger' | 'info'; icon?: ReactNode; role?: 'alert' | 'status' }) {
  const ink = props.tone === 'info' ? colors.ink : colors.dangerInk;

  return (
    <View
      role={props.role}
      accessibilityLiveRegion={props.role ? 'polite' : undefined}
      style={[s.notice, props.tone === 'warning' && s.noticeWarning, props.tone === 'danger' && s.noticeDanger]}
    >
      {props.icon ?? (props.tone === 'warning' ? <WarningIcon color={ink} /> : <AlertIcon color={ink} />)}
      {props.message ? <Text style={[s.noticeText, { color: ink }]}>{props.message}</Text> : null}
      {props.children}
    </View>
  );
}

type ErrorProps = { message: string | null };

export function ErrorMessage(props: ErrorProps) {
  return props.message ? (
    <View accessibilityRole="alert" style={[s.notice, s.noticeDanger]}>
      <AlertIcon color={colors.dangerInk} />
      <Text style={[s.noticeText, { color: colors.dangerInk }]}>{props.message}</Text>
    </View>
  ) : null;
}

export function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    if (running.current) return;

    running.current = true;

    setBusy(true);
    setError(null);

    try {
      await action();
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error('request_failed');

      setError(errorMessage(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, error, run };
}

export function errorMessage(error: Error): string {
  switch (error.message) {
    case 'client_offline':
      return 'You’re offline. Connect to finish this step. Nothing you typed was lost.';
    case 'group_unavailable_offline':
      return 'This group is not saved on this device yet. Go online to open it.';
    case 'invite_invalid':
    case 'invite_required':
      return 'This invitation is not valid. Ask someone in the group for a new link.';
    case 'invite_replaced':
      return 'This invitation has been replaced. Ask for the current link.';
    case 'unauthorized':
      return 'This installation can no longer connect. Ask for an invite on a new installation.';
    case 'member_removed':
      return 'That member has been removed. Choose another member or add a new name.';
    case 'storage_unavailable':
      return 'Changes could not be saved on this device. Free some storage and try again.';
    case 'invalid_response':
    case 'invalid_json_response':
      return 'The server returned an unreadable reply. Your saved changes are retained. Try again.';
    case 'confirmation_context_changed':
      return 'The selected group changed. Request confirmation again.';
    case 'corrupt_document':
      return 'The saved data on this device could not be read. It has been kept intact.';
    case 'upgrade_requires_connection':
      return 'Connect once to update your saved groups. Your entries are still here.';
    case 'invalid_input':
      return 'Check what you entered and try again.';
    case 'workflow_busy':
      return 'Please wait for the current step to finish.';
    case 'no_open_group':
      return 'Open a group first.';
    default:
      return 'We could not finish that. Your entries are still here. Check your connection and try again.';
  }
}

/** A hairline above a row. */
const rule = {
  borderTopWidth: 1,
  borderColor: colors.rule,
} as const;

const caps = {
  color: colors.muted,
  fontFamily,
  fontSize: 13,
  fontWeight: '600',
} as const;

/** The compact title scale for drawers and dialogs. */
const viewTitle = { color: colors.ink, fontFamily: displayFamily, fontSize: 22, lineHeight: 26, fontWeight: '700', letterSpacing: -0.6 } as const;

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  wrap: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 34,
  },
  /** App screens are one narrow column, like the phone app, on every device. */
  appWrap: { maxWidth: 480, paddingHorizontal: 24 },
  screenColumn: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 24 },
  screenHeaderBar: { backgroundColor: colors.background, zIndex: 5 },
  screenHeader: { paddingTop: 8 },
  screenHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44 },
  screenHeaderStart: { flexDirection: 'row', alignItems: 'center', marginLeft: -24, minWidth: 0, flexShrink: 1 },
  screenHeaderTitle: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  /** Kept for screens that still lay out their own title. */
  screenHeaderInset: {},
  screenHeaderEnd: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: -12 },
  screenHeaderTitleContent: { alignSelf: 'flex-start', maxWidth: '100%' },
  screenContext: { color: colors.muted, fontFamily, fontSize: 13, lineHeight: 18 },
  screenTitle: { color: colors.ink, fontFamily: displayFamily, fontSize: 42, lineHeight: 44, fontWeight: '700', letterSpacing: -1.26 },
  pageTitle: viewTitle,
  /** The text back action: 44 high, its padding reaching the screen edge. */
  navIcon: { height: 44, justifyContent: 'center', paddingLeft: 24, paddingRight: 20 },
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  headerActionText: { color: colors.ink, fontFamily, fontSize: 15, fontWeight: '600' },
  headerPrimary: { backgroundColor: colors.action, paddingHorizontal: 22, marginRight: 12 },
  headerPrimaryIdle: { backgroundColor: colors.actionBusy },
  headerPrimaryText: { color: colors.actionInk },
  emptyState: { paddingVertical: 16, gap: 6, borderTopWidth: 1, borderColor: colors.rule },
  emptyIcon: {},
  emptyIconSettled: {},
  emptyTitle: { color: colors.ink, fontFamily, fontSize: 18, lineHeight: 22, fontWeight: '600' },
  emptyText: { color: colors.muted, fontFamily, fontSize: 15, lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingVertical: 10,
    gap: 8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  brandText: {
    color: colors.ink,
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
  },
  beta: {
    color: colors.muted,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  main: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: 28,
  },
  wide: { maxWidth: 1040 },
  eyebrow: caps,
  sectionHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  sectionTitle: { flex: 1, fontFamily, fontSize: 14, fontWeight: '600', color: colors.muted },
  /** One row of a list, ruled above. */
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 14, ...rule },
  rowPressed: { backgroundColor: colors.youRow },
  /** A row's second line. */
  rowCaption: { color: colors.muted, fontFamily, fontSize: 13, lineHeight: 17 },
  subtitle: { color: colors.muted, fontFamily, fontSize: 15, lineHeight: 21 },
  heading: viewTitle,
  body: { color: colors.ink, fontFamily, fontSize: 15, lineHeight: 21 },
  /** An explanation at the top of a screen or dialog, quieter than body text. */
  lead: { color: colors.muted, fontFamily, fontSize: 15, lineHeight: 21 },
  caption: { color: colors.muted, fontFamily, fontSize: 13, lineHeight: 18 },
  link: { textDecorationLine: 'underline', },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  stack: { gap: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  groupCard: { gap: 12, paddingVertical: 18, ...rule },
  /** A list of rows, closed by a rule below the last. */
  listCard: { borderBottomWidth: 1, borderColor: colors.rule },
  ruled: rule,
  prompt: {
    paddingVertical: 14,
    borderTopWidth: 1.5,
    borderColor: colors.ink,
    gap: 12,
  },
  divider: { borderTopWidth: 1, borderColor: colors.rule },
  button: {
    flexDirection: 'row',
    gap: 8,
    minWidth: 44,
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  growButton: { flex: 1 },
  buttonText: {
    color: colors.actionInk,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  smallButtonText: { fontSize: 15 },
  inkText: { color: colors.ink },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.ink },
  quiet: { backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 44 },
  quietText: { color: colors.ink, textDecorationLine: 'underline', },
  danger: { backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 44 },
  dangerText: { color: colors.owes },
  dark: { backgroundColor: colors.night },
  pressed: { opacity: 0.7 },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44 },
  pillWithIcon: {},
  largePill: { height: 56, backgroundColor: colors.action, paddingHorizontal: 22 },
  filledPill: { backgroundColor: colors.action, paddingHorizontal: 18 },
  pillText: { fontFamily, fontSize: 15, fontWeight: '600' },
  largePillText: { fontSize: 16 },
  dim: { opacity: 0.4 },
  busyButton: { backgroundColor: colors.actionBusy },
  chip: {
    height: 48,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.ink },
  chipText: { color: colors.ink, fontFamily, fontSize: 15, fontWeight: '600' },
  chipTextSelected: { color: colors.actionInk },
  segment: {
    flex: 1,
    height: 44,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: { backgroundColor: colors.ink },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 56,
    ...rule,
  },
  radioRowSelected: {},
  radioDot: { width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: colors.control },
  radioDotSelected: { borderWidth: 6, borderColor: colors.ink },
  radioLabel: { flex: 1, color: colors.ink, fontFamily, fontSize: 17, fontWeight: '500' },
  field: { gap: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1.5, borderColor: colors.ink },
  label: {
    color: colors.muted,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 52,
    paddingHorizontal: 0,
    color: colors.ink,
    fontFamily,
    fontSize: 20,
    fontWeight: '500',
  },
  inputFocused: {},
  /** A one-line text box ruled below, such as an expense's description. */
  textInput: {
    height: 52,
    paddingHorizontal: 0,
    borderBottomWidth: 1.5,
    borderColor: colors.ink,
    color: colors.ink,
    fontFamily,
    fontSize: 17,
    fontWeight: '500',
  },
  /** A large bare amount over an ink underline. */
  amountInput: {
    flex: 1,
    minWidth: 0,
    height: 64,
    paddingHorizontal: 0,
    color: colors.ink,
    fontFamily: monoFamily,
    fontSize: 56,
    fontWeight: '500',
    letterSpacing: -2.8,
  },
  figureInput: {
    height: 64,
    fontFamily: monoFamily,
    fontSize: 30,
    fontWeight: '500',
  },
  /** A field-height outlined button beside an input, such as Paste. */
  fieldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    backgroundColor: colors.action,
  },
  fieldButtonText: { color: colors.actionInk, fontFamily, fontSize: 14, fontWeight: '600' },
  copyButton: {
    width: 48,
    minHeight: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyIcon: { width: 22, height: 22 },
  copyBack: {
    position: 'absolute',
    top: 2,
    left: 3,
    width: 12,
    height: 14,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  copyFront: {
    position: 'absolute',
    top: 6,
    left: 7,
    width: 12,
    height: 14,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.background,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 3,
    borderColor: colors.ink,
    backgroundColor: colors.pale,
  },
  noticeWarning: { backgroundColor: colors.warning, borderColor: colors.owesBar },
  noticeDanger: { backgroundColor: colors.danger, borderColor: colors.owes },
  noticeText: { flex: 1, fontFamily, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  tag: {
    color: colors.muted,
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
  },
  tagWarning: { color: colors.warningInk, fontWeight: '600' },
  tagAction: { color: colors.muted, fontSize: 11, fontWeight: '400' },
  name: { color: colors.ink, fontFamily, fontSize: 16, fontWeight: '600' },
  memberNameInput: {
    height: 40,
    minWidth: 0,
    paddingHorizontal: 0,
    borderBottomWidth: 1.5,
    borderColor: colors.ink,
    color: colors.ink,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  presenceDot: { width: 6, height: 6, borderRadius: 3 },
  presenceOnline: { backgroundColor: colors.online },
  presenceOffline: { borderWidth: 1.5, borderColor: colors.muted },
  presenceUnclaimed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.control },
  rowAction: { color: colors.ink, fontFamily, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  skeleton: { backgroundColor: colors.track },
  skeletonLine: { width: '60%', height: 16 },
  skeletonShort: { width: '35%', height: 12 },
  banner: {
    backgroundColor: colors.warning,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 3,
    borderColor: colors.owesBar,
    gap: 6,
  },
  chosen: { borderWidth: 1.5, borderColor: colors.ink },
  amount: {
    color: colors.ink,
    fontFamily: monoFamily,
    fontSize: 15,
    fontWeight: '500',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 20, 19, 0.4)',
    justifyContent: 'flex-end',
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  /** Wider screens show a drawer as a popup in the middle. */
  overlayCentered: { justifyContent: 'center', padding: 24 },
  drawerTitle: viewTitle,
  drawer: { maxHeight: '88%', paddingTop: 20, gap: 14 },
  popup: { maxWidth: 440, maxHeight: '80%', paddingBottom: 24 },
  drawerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: colors.background,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 34,
    gap: 12,
  },
  footerBar: {
    backgroundColor: colors.background,
    paddingTop: 16,
    paddingBottom: 34,
  },
  footerBarRuled: {},
  footerInner: { gap: 10 },
  footerButton: {
    flexDirection: 'row',
    gap: 10,
    height: 56,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  footerButtonIdle: { backgroundColor: colors.actionBusy },
  footerButtonText: { color: colors.actionInk, fontFamily, fontSize: 16, fontWeight: '600' },
  mobileWrap: { paddingHorizontal: 24 },
  mobileHeader: { minHeight: 56, paddingVertical: 6 },
  mobileMain: { gap: 28 },
  hero: { paddingVertical: 56, gap: 22, maxWidth: 680 },
  mobileHero: { paddingVertical: 28, gap: 20 },
  mobileHeroTitle: { fontSize: 46, lineHeight: 48, letterSpacing: -1.4 },
  heroTitle: {
    fontFamily: displayFamily,
    fontSize: 68,
    lineHeight: 70,
    fontWeight: '700',
    letterSpacing: -2,
    color: colors.ink,
  },
  heroAccent: { color: colors.muted },
});
