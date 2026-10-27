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

import { between, useCompactProgress } from './pageScroll';
import { AlertIcon, BackIcon, WarningIcon } from './icons';
import { colors, displayFamily, fontFamily, monoFamily } from './theme';

export { colors } from './theme';

type ButtonProps = {
  children: ReactNode;
  onPress: () => void;
  /** White with a grey edge, for the second choice beside a main action. */
  secondary?: boolean;
  /** Blue text without a background, for minor actions. */
  quiet?: boolean;
  /** Orange text, for leaving or removing. */
  danger?: boolean;
  /** Near-black, for confirming a change that cannot be taken back. */
  dark?: boolean;
  /** A compact button for actions inside rows and cards. */
  small?: boolean;
  disabled?: boolean;
  label?: string;
  grow?: boolean;
  icon?: ReactNode;
};

export function Button(props: ButtonProps) {
  const filled = !props.secondary && !props.quiet && !props.danger && !props.dark;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.button,
        props.small && s.smallButton,
        props.grow && s.growButton,
        props.secondary && s.secondary,
        props.quiet && s.quiet,
        props.danger && s.danger,
        props.dark && s.dark,
        pressed && !props.disabled && s.pressed,
        props.disabled && (filled ? s.busyButton : s.dim),
      ]}
    >
      {props.icon}
      <Text
        style={[
          s.buttonText,
          props.small && s.smallButtonText,
          (props.secondary || props.danger) && s.inkText,
          props.quiet && s.quietText,
          props.danger && s.dangerText,
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

export function Field(props: FieldProps) {
  const { label, hideLabel, hint, trailing, inputRef, figure, ...input } = props;
  const [focused, setFocused] = useState(false);

  return (
    <View style={s.field}>
      {!hideLabel ? <Text style={s.label}>{label}</Text> : null}
      <View style={s.fieldRow}>
        <TextInput
          {...input}
          ref={inputRef}
          accessibilityLabel={label}
          placeholderTextColor={colors.control}
          onFocus={(event) => {
            setFocused(true);
            input.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            input.onBlur?.(event);
          }}
          style={[s.input, figure && s.figureInput, focused && input.editable !== false && s.inputFocused, input.style]}
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
          style={[s.chipText, props.segment && !props.selected && { color: colors.soft }, props.selected && !props.segment && s.chipTextSelected]}
        >
          {props.children}
        </Text>
      )}
    </Pressable>
  );
}

/** A radio row with a round marker, as on the join screen. */
export function RadioRow(props: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; accessibilityLabel?: string; children?: ReactNode; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ checked: props.selected, disabled: Boolean(props.disabled) }}
      aria-checked={props.selected}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [s.radioRow, props.compact && { minHeight: 48 }, props.style, props.selected && s.radioRowSelected, pressed && s.pressed]}
    >
      <View style={[s.radioDot, props.selected && s.radioDotSelected]} />
      <Text numberOfLines={1} style={[s.radioLabel, props.compact && { fontSize: 15 }]}>{props.label}</Text>
      {props.children}
    </Pressable>
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
 * A screen's fixed header, the same height on every screen: a back or text
 * action, the title with what it belongs to named quietly above it, and
 * actions at the end. It shrinks as the page scrolls, its context fading
 * out while its title keeps the same size. A heading that is more
 * than text stands in for the title and styles its text with `s.screenTitle`.
 */
export function ScreenHeader(props: { title?: string; heading?: ReactNode; context?: string | undefined; start?: ReactNode; end?: ReactNode }) {
  const progress = useCompactProgress();

  return (
    <View style={[s.screenHeader, { minHeight: between(66, 52, progress), paddingTop: between(10, 4, progress) }]}>
      {props.start}
      <View style={[s.screenHeaderTitle, !props.start && s.screenHeaderInset]}>
        {props.context ? (
          <Text numberOfLines={1} style={[s.screenContext, { height: between(16, 0, progress), opacity: 1 - progress }]}>{props.context}</Text>
        ) : null}
        <View style={s.screenHeaderTitleContent}>
          {props.heading ?? (props.title ? (
            <Text accessibilityRole="header" numberOfLines={1} style={s.screenTitle}>
              {props.title}
            </Text>
          ) : null)}
        </View>
      </View>
      {props.end ? <View style={s.screenHeaderEnd}>{props.end}</View> : null}
    </View>
  );
}

/**
 * The space a screen's fixed header keeps below itself. It belongs to the
 * header, so a screen's content starts right below it at rest and scrolls out
 * of sight at that same edge.
 */
export const headerGap = 8;

type HeaderActionProps = { label: string; onPress: () => void; disabled?: boolean };

/** The back chevron in a screen header; its label names where it goes. */
export function BackButton(props: HeaderActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [s.navIcon, (pressed || props.disabled) && s.dim]}
    >
      <BackIcon />
    </Pressable>
  );
}

/** A text action in a screen header, such as Cancel, or the filled Save beside it. */
export function HeaderAction(props: HeaderActionProps & { text: string; danger?: boolean; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.headerAction,
        props.primary && s.headerPrimary,
        props.primary && props.disabled && s.headerPrimaryIdle,
        pressed && s.pressed,
        !props.primary && props.disabled && s.dim,
      ]}
    >
      <Text style={[s.headerActionText, props.primary && s.headerPrimaryText, props.danger && s.dangerText]}>{props.text}</Text>
    </Pressable>
  );
}

/** A centered empty state: a tinted icon, a short title, and one line of guidance. */
export function EmptyState(props: { icon: ReactNode; title: string; text?: string; tone?: 'action' | 'settled' }) {
  return (
    <View style={s.emptyState}>
      <View style={[s.emptyIcon, props.tone === 'settled' && s.emptyIconSettled]}>{props.icon}</View>
      <Text style={s.emptyTitle}>{props.title}</Text>
      {props.text ? <Text style={s.emptyText}>{props.text}</Text> : null}
    </View>
  );
}

/**
 * The screen's main action at the foot of the screen: a large blue button,
 * a greyed one with a spinner while it works.
 */
export function FooterButton(props: { children: ReactNode; onPress: () => void; disabled?: boolean; busy?: boolean; label?: string; icon?: ReactNode; floating?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled || props.busy), busy: Boolean(props.busy) }}
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.footerButton,
        props.floating && s.floatingButton,
        (props.disabled || props.busy) && s.footerButtonIdle,
        pressed && s.pressed,
      ]}
    >
      {props.busy ? <ActivityIndicator size="small" color={colors.actionInk} /> : props.icon}
      <Text style={s.footerButtonText}>{props.children}</Text>
    </Pressable>
  );
}

/** A small rounded label, such as Taken, To review, or You. */
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
 * A tinted message panel: amber for something to look at, orange for a
 * failure. It shows its message, or richer content such as a button.
 */
export function Notice(props: { message?: string; children?: ReactNode; tone: 'warning' | 'danger' | 'info'; icon?: ReactNode; role?: 'alert' | 'status' }) {
  const ink = props.tone === 'warning' ? colors.warningInk : props.tone === 'danger' ? colors.dangerInk : colors.soft;

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

/** A hairline between rows inside a card. */
const rule = {
  borderTopWidth: 1,
  borderColor: colors.rule,
} as const;

const caps = {
  color: colors.muted,
  fontFamily,
  fontSize: 13,
  fontWeight: '600',
  letterSpacing: 0.8,
  textTransform: 'uppercase',
} as const;

/** One title scale for screen headers, page titles, and dialogs. */
const viewTitle = { color: colors.ink, fontFamily: displayFamily, fontSize: 18, lineHeight: 24, fontWeight: '700' } as const;

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  wrap: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  /** App screens are one narrow column, like the phone app, on every device. */
  appWrap: { maxWidth: 560, paddingHorizontal: 16 },
  screenColumn: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 12 },
  /** Content rests right below the bar and scrolls out of sight at the same place. */
  screenHeaderBar: { paddingBottom: headerGap, backgroundColor: colors.background },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 66,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  screenHeaderTitle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  /** Without a back button the title lines up with the page's own text. */
  screenHeaderInset: { paddingLeft: 8 },
  screenHeaderEnd: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  screenHeaderTitleContent: { alignSelf: 'flex-start', maxWidth: '100%' },
  screenContext: { color: colors.muted, fontFamily, fontSize: 12, lineHeight: 16 },
  screenTitle: viewTitle,
  pageTitle: viewTitle,
  navIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12 },
  headerActionText: { color: colors.ink, fontFamily, fontSize: 15, fontWeight: '400' },
  headerPrimary: { backgroundColor: colors.action, paddingHorizontal: 18, borderRadius: 999 },
  headerPrimaryIdle: { backgroundColor: colors.actionBusy },
  headerPrimaryText: { color: colors.actionInk, fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingTop: 72, paddingBottom: 24, paddingHorizontal: 24, gap: 12 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconSettled: { borderRadius: 36, backgroundColor: colors.settledSoft },
  emptyTitle: { color: colors.ink, fontFamily: displayFamily, fontSize: 26, lineHeight: 31, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.muted, fontFamily, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 310 },
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
    fontFamily: displayFamily,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  beta: {
    color: colors.actionDark,
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    backgroundColor: colors.actionSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  main: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingTop: 4,
    gap: 16,
  },
  wide: { maxWidth: 1040 },
  eyebrow: caps,
  subtitle: { color: colors.muted, fontFamily, fontSize: 15, lineHeight: 22 },
  heading: viewTitle,
  body: { color: colors.ink, fontFamily, fontSize: 15, lineHeight: 22 },
  caption: { color: colors.muted, fontFamily, fontSize: 13, lineHeight: 18 },
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
  actions: { flexDirection: 'row', gap: 8 },
  groupCard: {
    gap: 14,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  /** A white card holding rows separated by hairlines. */
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  ruled: rule,
  prompt: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
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
    borderRadius: 12,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
  },
  growButton: { flex: 1 },
  buttonText: {
    color: colors.actionInk,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  smallButtonText: { fontSize: 14 },
  inkText: { color: colors.ink },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.field },
  quiet: { backgroundColor: 'transparent', paddingHorizontal: 6 },
  quietText: { color: colors.actionText },
  danger: { backgroundColor: 'transparent', paddingHorizontal: 6 },
  dangerText: { color: colors.owes },
  dark: { backgroundColor: colors.night },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  dim: { opacity: 0.45 },
  busyButton: { backgroundColor: colors.actionBusy },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.field,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.night, borderColor: colors.night },
  chipText: { color: colors.ink, fontFamily, fontSize: 14, fontWeight: '600' },
  chipTextSelected: { color: colors.surface },
  segment: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    boxShadow: '0 1px 3px rgba(16, 22, 29, 0.15)',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radioRowSelected: { borderWidth: 2, borderColor: colors.action, paddingHorizontal: 13 },
  radioDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.control },
  radioDotSelected: { borderWidth: 6, borderColor: colors.action },
  radioLabel: { flex: 1, color: colors.ink, fontFamily, fontSize: 17, fontWeight: '500' },
  field: { gap: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  label: {
    color: colors.ink,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 52,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: 12,
    color: colors.ink,
    fontFamily,
    fontSize: 17,
  },
  inputFocused: { borderWidth: 2, borderColor: colors.action, paddingHorizontal: 13 },
  /** A one-line text box in a form, such as an expense's description. */
  textInput: {
    height: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily,
    fontSize: 17,
  },
  /**
   * A large bare amount. Its padding gives the text and the focus outline
   * room, and the matching negative margin keeps the figure aligned with the
   * page.
   */
  amountInput: {
    flex: 1,
    minWidth: 0,
    height: 64,
    marginLeft: -12,
    paddingHorizontal: 12,
    borderRadius: 12,
    color: colors.ink,
    fontFamily: monoFamily,
    fontSize: 44,
    fontWeight: '600',
    letterSpacing: -0.8,
  },
  figureInput: {
    height: 64,
    fontFamily: monoFamily,
    fontSize: 30,
    fontWeight: '600',
  },
  /** A white field-height button beside an input, such as Paste or a currency. */
  fieldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.field,
    backgroundColor: colors.surface,
  },
  fieldButtonText: { color: colors.ink, fontFamily, fontSize: 15, fontWeight: '600' },
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
    borderColor: colors.actionText,
    borderRadius: 3,
  },
  copyFront: {
    position: 'absolute',
    top: 6,
    left: 7,
    width: 12,
    height: 14,
    borderWidth: 1.5,
    borderColor: colors.actionText,
    borderRadius: 3,
    backgroundColor: colors.surface,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.pale,
  },
  noticeWarning: { backgroundColor: colors.warning },
  noticeDanger: { backgroundColor: colors.danger },
  noticeText: { flex: 1, fontFamily, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  tag: {
    color: colors.soft,
    backgroundColor: colors.pale,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tagWarning: { color: colors.warningInk, backgroundColor: colors.warning, fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  tagAction: { color: colors.actionInk, backgroundColor: colors.action, fontWeight: '700' },
  name: { color: colors.ink, fontFamily, fontSize: 16, fontWeight: '500' },
  memberNameInput: {
    height: 40,
    minWidth: 0,
    marginLeft: -10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.field,
    borderRadius: 8,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily,
    fontSize: 16,
    fontWeight: '500',
  },
  presenceDot: { width: 10, height: 10, borderRadius: 5 },
  presenceOnline: { backgroundColor: colors.online },
  presenceOffline: { borderWidth: 2, borderColor: colors.muted },
  presenceUnclaimed: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.control },
  rowAction: { color: colors.actionText, fontFamily, fontSize: 14, fontWeight: '600' },
  skeleton: { backgroundColor: colors.track, borderRadius: 8 },
  skeletonLine: { width: '60%', height: 14 },
  skeletonShort: { width: '35%', height: 12 },
  banner: {
    backgroundColor: colors.warning,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    gap: 6,
  },
  chosen: { borderWidth: 2, borderColor: colors.action },
  amount: {
    color: colors.ink,
    fontFamily: monoFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(16, 22, 29, 0.45)',
    justifyContent: 'flex-end',
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  /** Wider screens show a drawer as a popup in the middle. */
  overlayCentered: { justifyContent: 'center', padding: 24 },
  drawerTitle: viewTitle,
  drawer: { maxHeight: '88%', paddingTop: 20, gap: 14 },
  popup: { maxWidth: 440, maxHeight: '80%', borderRadius: 24, paddingBottom: 24 },
  drawerClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 12,
  },
  footerBar: {
    backgroundColor: colors.background,
    paddingTop: 12,
    paddingBottom: 28,
  },
  footerBarRuled: { borderTopWidth: 1, borderColor: colors.border },
  footerInner: { gap: 12, paddingHorizontal: 16 },
  footerButton: {
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  floatingButton: { boxShadow: '0 6px 18px rgba(16, 22, 29, 0.18)' },
  footerButtonIdle: { backgroundColor: colors.actionBusy, boxShadow: 'none' },
  footerButtonText: { color: colors.actionInk, fontFamily, fontSize: 17, fontWeight: '600' },
  mobileWrap: { paddingHorizontal: 16 },
  mobileHeader: { minHeight: 56, paddingVertical: 6 },
  mobileMain: { paddingTop: 0, gap: 14 },
  hero: { paddingVertical: 56, gap: 22, maxWidth: 680 },
  mobileHero: { paddingVertical: 28, gap: 20 },
  mobileHeroTitle: { fontSize: 46, lineHeight: 50, letterSpacing: -1.4 },
  heroTitle: {
    fontFamily: displayFamily,
    fontSize: 68,
    lineHeight: 72,
    fontWeight: '700',
    letterSpacing: -2,
    color: colors.ink,
  },
  heroAccent: { color: colors.actionText },
});
