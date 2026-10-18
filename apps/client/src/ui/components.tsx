import { useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export const colors = {
  background: '#f5f6f2',
  surface: '#ffffff',
  ink: '#20372f',
  // At least 4.5:1 against background, pale, amber, and surface for small text.
  muted: '#5d6f66',
  green: '#246b56',
  pale: '#e9f1eb',
  border: '#dde5de',
  amber: '#fff2d5',
  red: '#a43b38',
};

type ButtonProps = {
  children: ReactNode;
  onPress: () => void;
  secondary?: boolean;
  quiet?: boolean;
  danger?: boolean;
  disabled?: boolean;
  label?: string;
  grow?: boolean;
};

export function Button(props: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.button,
        props.grow && s.growButton,
        props.secondary && s.secondary,
        props.quiet && s.quiet,
        props.danger && s.danger,
        (pressed || props.disabled) && s.dim,
      ]}
    >
      <Text
        style={[
          s.buttonText,
          (props.secondary || props.quiet) && s.secondaryText,
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
};

type ChoiceProps = {
  children: ReactNode;
  selected: boolean;
  onPress: () => void;
};

export function Choice(props: ChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      aria-checked={props.selected}
      onPress={props.onPress}
      style={[s.button, s.option, !props.selected && s.secondary]}
    >
      <Text style={[s.buttonText, !props.selected && s.secondaryText]}>
        {props.children}
      </Text>
    </Pressable>
  );
}

export function Field(props: FieldProps) {
  const { label, hideLabel, hint, trailing, inputRef, ...input } = props;

  const control = (
    <TextInput
      {...input}
      ref={inputRef}
      accessibilityLabel={label}
      placeholderTextColor={colors.muted}
      style={[s.input, Boolean(trailing) && s.inputWithAction]}
    />
  );

  return (
    <View style={s.field}>
      {!hideLabel ? <Text style={s.label}>{label}</Text> : null}
      {trailing ? (
        <View style={s.fieldWithAction}>
          {control}
          {trailing}
        </View>
      ) : (
        control
      )}
      {hint ? <Text style={s.caption}>{hint}</Text> : null}
    </View>
  );
}

type ErrorProps = { message: string | null };

export function ErrorMessage(props: ErrorProps) {
  return props.message ? (
    <Text accessibilityRole="alert" style={s.error}>
      {props.message}
    </Text>
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
      return 'Connect to the internet to finish this step. Your entries are still here.';
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

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  wrap: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  appWrap: { maxWidth: 720 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 8,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46 },
  brandMark: {
    backgroundColor: colors.green,
    color: '#ffffff',
    width: 30,
    height: 30,
    borderRadius: 5,
    fontSize: 23,
    lineHeight: 29,
    textAlign: 'center',
    fontWeight: '600',
  },
  brandText: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.7,
  },
  beta: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    backgroundColor: colors.pale,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 2,
  },
  main: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingTop: 8,
    gap: 14,
  },
  wide: { maxWidth: 1040 },
  eyebrow: {
    color: colors.green,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '600',
  },
  title: {
    fontSize: 38,
    lineHeight: 44,
    color: colors.ink,
    fontWeight: '600',
    letterSpacing: -1.4,
  },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  heading: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  body: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 20 },
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
  groupHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  groupTitle: { flex: 1, minWidth: 0, gap: 4 },
  card: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  listCard: { padding: 12, gap: 0 },
  peopleCard: { gap: 8 },
  memberRow: {
    gap: 6,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  memberLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  editableMemberName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  memberName: { flexShrink: 1, minWidth: 0, lineHeight: 22 },
  memberNameInput: {
    height: 44,
    minWidth: 0,
    margin: 0,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    backgroundColor: colors.surface,
    lineHeight: 22,
  },
  memberActionsButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberSelectButton: {
    width: 44,
    minHeight: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberSelectIcon: { width: 32, height: 32, position: 'relative' },
  memberFigure: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  memberSelectHead: {
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderRadius: 5,
    borderColor: colors.muted,
  },
  memberSelectBody: {
    width: 24,
    height: 14,
    borderWidth: 1.5,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    borderColor: colors.muted,
  },
  memberSelectJoined: { backgroundColor: colors.ink, borderColor: colors.ink },
  memberFigureYou: {
    backgroundColor: colors.pale,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  memberSelectYou: { backgroundColor: colors.green, borderColor: colors.green },
  memberSelectYouHead: { width: 12, height: 12, borderRadius: 6 },
  memberSelectYouBody: {
    width: 26,
    height: 16,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  memberPresence: {
    position: 'absolute',
    left: 26,
    bottom: -2,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 2,
    alignItems: 'flex-end',
    overflow: 'visible',
  },
  participantMore: {
    position: 'absolute',
    left: -8,
    bottom: -2,
    minWidth: 20,
    height: 14,
    paddingHorizontal: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.muted,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantMoreLabel: {
    fontSize: 9,
    lineHeight: 10,
    fontWeight: '700',
    color: colors.ink,
    includeFontPadding: false,
  },
  presenceMarker: {
    width: 12,
    height: 12,
    flexShrink: 0,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceMarkerYou: {
    width: 30,
    height: 16,
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  presenceRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  presenceRingOnline: { borderColor: colors.green },
  presenceDot: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  presenceDotOnline: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  presenceDotOffline: { backgroundColor: colors.muted, opacity: 0.4 },
  inlineActions: { flexDirection: 'row', alignItems: 'center' },
  prompt: {
    padding: 20,
    backgroundColor: colors.pale,
    borderRadius: 6,
    gap: 8,
  },
  divider: { height: 1, backgroundColor: colors.border },
  button: {
    minWidth: 44,
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  growButton: { flex: 1 },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  option: { minWidth: 44, paddingHorizontal: 12 },
  secondary: { backgroundColor: colors.pale },
  secondaryText: { color: colors.green },
  quiet: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  danger: { backgroundColor: '#fbefec' },
  dangerText: { color: colors.red },
  dim: { opacity: 0.5 },
  field: { gap: 8 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    color: colors.ink,
    fontSize: 16,
  },
  fieldWithAction: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  inputWithAction: { flex: 1, minWidth: 0, borderWidth: 0 },
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
    borderColor: colors.green,
    borderRadius: 2,
  },
  copyFront: {
    position: 'absolute',
    top: 6,
    left: 7,
    width: 12,
    height: 14,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 2,
    backgroundColor: colors.surface,
  },
  copiedIcon: { color: colors.green, fontSize: 21 },
  error: { color: colors.red, fontSize: 14, lineHeight: 22 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: colors.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.green, fontWeight: '600', fontSize: 18 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  personText: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: colors.ink, fontSize: 16, fontWeight: '500' },
  chevron: { color: colors.muted, fontSize: 24, lineHeight: 24 },
  rowAction: { color: colors.green, fontSize: 14, fontWeight: '600' },
  avatarLeft: { backgroundColor: colors.border },
  errorBanner: { backgroundColor: '#fbefec' },
  skeleton: { backgroundColor: colors.border, borderRadius: 4 },
  skeletonTitle: { width: 220, height: 36 },
  skeletonLine: { width: '60%', height: 14 },
  skeletonShort: { width: '35%', height: 12 },
  badge: {
    color: colors.green,
    backgroundColor: colors.pale,
    fontSize: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  banner: {
    backgroundColor: colors.amber,
    padding: 12,
    borderRadius: 6,
    gap: 6,
  },
  choice: {
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    gap: 5,
  },
  chosen: { borderColor: colors.green, backgroundColor: colors.pale },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingVertical: 6,
  },
  amount: { color: colors.ink, fontSize: 16, fontWeight: '500', fontVariant: ['tabular-nums'] },
  owed: { color: colors.green },
  wrapRow: { flexWrap: 'wrap' },
  currencyField: { width: 96 },
  splitInput: { width: 104, minHeight: 44, paddingVertical: 8, textAlign: 'right' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: colors.green },
  checkMark: { color: colors.surface, fontSize: 14, fontWeight: '700', lineHeight: 16 },
  choiceInUse: { opacity: 0.75 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20,40,30,0.3)',
    justifyContent: 'center',
    padding: 16,
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 20,
    gap: 14,
  },
  mobileWrap: { paddingHorizontal: 16 },
  mobileHeader: { paddingVertical: 8 },
  mobileMain: { paddingTop: 4, gap: 12 },
  mobileTitle: { fontSize: 30, lineHeight: 36, letterSpacing: -1 },
  mobileOverlay: { justifyContent: 'flex-end', padding: 8 },
  mobileSheet: { padding: 16, maxHeight: '92%' },
  hero: { paddingVertical: 48, gap: 24, maxWidth: 660 },
  mobileHero: { paddingVertical: 24, gap: 20 },
  mobileHeroTitle: { fontSize: 38, lineHeight: 44, letterSpacing: -1.4 },
  heroTitle: {
    fontSize: 56,
    lineHeight: 62,
    fontWeight: '600',
    letterSpacing: -2.6,
    color: colors.ink,
  },
});
