import { useContext, useRef, useState, type ReactNode } from 'react';
import { View, type ViewInstance } from 'react-native';
import { Row, Text, Touchable, YouBadge, colors, durations, radii, rules, sizes, strokes, withTransition } from '../design';
import { memberName } from '../model/expenses';
import { MemberAvatar, type MemberListApp } from './MemberList';
import { CompactHeaderContext } from './pageScroll';
import { Reveal } from './Reveal';

export type MemberChoiceProps = {
  app: MemberListApp;
  /** Names the row and its list, as in "Paid by". */
  label: string;
  /** Ends the toggle's spoken label, as in "Change payer". */
  change: string;
  value: string;
  members: readonly string[];
  you: string | undefined;
  disabled?: boolean;
  onChange: (memberId: string) => void;
};

/** The end of a choice's row: the arrow on the closed choice and room for it in the list, so names above and below end in line. */
const markSlot = { width: 16, alignItems: 'center' } as const;

/**
 * A member's name in a choice, with the small "you" after yours as in the
 * balances, in a room `width` wide so names in a list start in line.
 */
function NameWithBadge(props: { name: string; you: boolean; width?: number | undefined; onLayout?: (width: number) => void }) {
  return (
    <Row
      gap={8}
      style={{ flexShrink: 1, minWidth: 0, width: props.width || undefined, alignSelf: props.onLayout ? 'flex-start' : undefined }}
      onLayout={props.onLayout ? (event) => props.onLayout?.(event.nativeEvent.layout.width) : undefined}
    >
      <Text variant="strong" numberOfLines={1} style={{ flexShrink: 1 }}>{props.name}</Text>
      {props.you ? <YouBadge /> : null}
    </Row>
  );
}

/**
 * A member's avatar and name in a choice. Yours sits on the tint that marks
 * your own row among the people, drawn just outside them so every name still
 * starts in line.
 */
function ChosenName(props: { you: boolean; children: ReactNode }) {
  return (
    <Row gap={8} style={{ flexShrink: 1, minWidth: 0 }}>
      {props.you ? <View pointerEvents="none" style={{ position: 'absolute', top: -5, bottom: -5, left: -5, right: -10, borderRadius: radii.round, backgroundColor: colors.tint }} /> : null}
      {props.children}
    </Row>
  );
}

/**
 * One member in an open choice, drawn like the closed choice above it: at the
 * row's end, their avatar and name. The chosen member is left out, being on
 * the closed choice already.
 */
function MemberChoiceRow(props: { app: MemberListApp; memberId: string; you: boolean; nameWidth: number; onPress: () => void }) {
  const replica = props.app.snapshot().group;
  const name = memberName(replica?.projected_snapshot, props.memberId);

  return (
    <Touchable
      accessibilityRole="radio"
      accessibilityLabel={`${name}${props.you ? ' (you)' : ''}`}
      accessibilityState={{ checked: false }}
      aria-checked={false}
      feedback="tint"
      onPress={props.onPress}
      style={[{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, minHeight: sizes.row }, rules.above]}
    >
      <ChosenName you={props.you}>
        {replica ? <MemberAvatar replica={replica} memberId={props.memberId} size="small" /> : null}
        <NameWithBadge name={name} you={props.you} width={props.nameWidth} />
      </ChosenName>
      <View style={markSlot} />
    </Touchable>
  );
}

/**
 * Scrolls the page just enough to show a closed choice again after a name
 * was picked further down its list, keeping it clear of the compact header
 * that the page scrolls under.
 */
function bringIntoView(target: ViewInstance | null, headerHeight: number): void {
  if (!(target instanceof HTMLElement)) return;
  const page = target.closest<HTMLElement>('#splitnext-page');

  if (!page) return;
  const box = target.getBoundingClientRect();
  const area = page.getBoundingClientRect();
  const top = area.top + headerHeight;

  if (box.top < top) page.scrollBy({ top: box.top - top, behavior: 'smooth' });
  else if (box.bottom > area.bottom) page.scrollBy({ top: box.bottom - area.bottom, behavior: 'smooth' });
}

/** A labelled member row that opens the names in place, as for who paid. */
export function MemberChoice(props: MemberChoiceProps) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<ViewInstance>(null);
  const replica = props.app.snapshot().group;
  const snapshot = replica?.projected_snapshot;
  const name = props.value ? memberName(snapshot, props.value) : '';
  const showing = open && !props.disabled;
  const headerHeight = useContext(CompactHeaderContext).height;
  // Every name (yours with its "you"), measured unseen, so each row's name takes the widest one's
  // room: the avatars then stand in one column, the names start in line,
  // and the closed choice sits exactly where its row in the list does.
  const [widths, setWidths] = useState<Record<string, number>>({});
  const nameWidth = Math.ceil(Math.max(0, ...props.members.map((memberId) => widths[memberId] ?? 0)));

  return (
    <View>
      <Touchable
        ref={toggle}
        accessibilityRole="button"
        accessibilityLabel={`${props.label} ${props.value ? `${name}${props.value === props.you ? ' (you)' : ''}` : 'nobody yet'}. ${props.change}`}
        accessibilityState={{ expanded: showing, disabled: Boolean(props.disabled) }}
        disabled={props.disabled}
        onPress={() => setOpen(!open)}
        style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: sizes.row }, rules.below]}
      >
        <Text variant="body" tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>{props.label}</Text>
        <Row gap={8} style={{ flexShrink: 1, minWidth: 0 }}>
          <ChosenName you={Boolean(props.value) && props.value === props.you}>
            {props.value && replica ? <MemberAvatar replica={replica} memberId={props.value} size="small" /> : null}
            {props.value
              ? <NameWithBadge name={name} you={props.value === props.you} width={nameWidth} />
              : <Text variant="strong" numberOfLines={1} style={{ flexShrink: 1 }}>Choose</Text>}
          </ChosenName>
          <View style={markSlot}>
            <Text variant="caption" tone="muted" style={withTransition({ transform: [{ rotate: showing ? '180deg' : '0deg' }] }, 'transform', durations.medium)}>▾</Text>
          </View>
        </Row>
      </Touchable>
      <View aria-hidden pointerEvents="none" style={{ position: 'absolute', opacity: 0, left: 0, right: 0, top: 0, overflow: 'hidden' }}>
        {props.members.map((memberId) => (
          <NameWithBadge
            key={memberId}
            name={memberName(snapshot, memberId)}
            you={memberId === props.you}
            onLayout={(width) => setWidths((current) => (current[memberId] === width ? current : { ...current, [memberId]: width }))}
          />
        ))}
      </View>
      <Reveal toggle={toggle} onOutsidePress={() => setOpen(false)}>
        {showing ? (
          // The first row's rule overlaps the toggle's, so they draw one line.
          <View role="radiogroup" aria-label={props.label} style={[{ marginTop: -strokes.hairline }, rules.below]}>
            {/* The chosen name is already on the closed choice above. */}
            {props.members.filter((memberId) => memberId !== props.value).map((memberId) => (
              <MemberChoiceRow
                key={memberId}
                app={props.app}
                memberId={memberId}
                you={memberId === props.you}
                nameWidth={nameWidth}
                onPress={() => {
                  setOpen(false);
                  props.onChange(memberId);
                  bringIntoView(toggle.current, headerHeight);
                }}
              />
            ))}
          </View>
        ) : null}
      </Reveal>
    </View>
  );
}
