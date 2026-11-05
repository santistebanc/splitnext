import { useRef, useState } from 'react';
import { View } from 'react-native';
import { RadioRow, Row, Text, Touchable, YouBadge, durations, rules, sizes, strokes, withTransition } from '../design';
import { memberName } from '../model/expenses';
import type { MemberListApp } from './MemberList';
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

/** One member in an open choice: the same radio row as choosing who you are when joining. */
function MemberChoiceRow(props: { app: MemberListApp; memberId: string; you: boolean; selected: boolean; onPress: () => void }) {
  const name = memberName(props.app.snapshot().group?.projected_snapshot, props.memberId);

  return (
    <RadioRow label={name} accessibilityLabel={`${name}${props.you ? ' (you)' : ''}`} selected={props.selected} onPress={props.onPress}>
      {props.you ? <YouBadge /> : null}
    </RadioRow>
  );
}

/** A labelled member row that opens the names in place, as for who paid. */
export function MemberChoice(props: MemberChoiceProps) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<View>(null);
  const snapshot = props.app.snapshot().group?.projected_snapshot;
  const name = props.value ? memberName(snapshot, props.value) : '';
  const showing = open && !props.disabled;

  return (
    <View>
      <Touchable
        ref={toggle}
        accessibilityRole="button"
        accessibilityLabel={`${props.label} ${props.value ? `${name}${props.value === props.you ? ' (you)' : ''}` : 'nobody yet'}. ${props.change}`}
        accessibilityState={{ expanded: showing, disabled: Boolean(props.disabled) }}
        disabled={props.disabled}
        onPress={() => setOpen(!open)}
        style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: sizes.row }, rules.below]}
      >
        <Text variant="body" tone="muted">{props.label}</Text>
        <Row gap={8}>
          <Text variant="strong">{props.value ? name : 'Choose'}</Text>
          <Text variant="caption" tone="muted" style={withTransition({ transform: [{ rotate: showing ? '180deg' : '0deg' }] }, 'transform', durations.medium)}>▾</Text>
        </Row>
      </Touchable>
      <Reveal toggle={toggle} onOutsidePress={() => setOpen(false)}>
        {showing ? (
          // The first row's rule overlaps the toggle's, so they draw one line.
          <View role="radiogroup" aria-label={props.label} style={[{ marginTop: -strokes.hairline }, rules.below]}>
            {props.members.map((memberId) => (
              <MemberChoiceRow
                key={memberId}
                app={props.app}
                memberId={memberId}
                you={memberId === props.you}
                selected={props.value === memberId}
                onPress={() => {
                  setOpen(false);
                  props.onChange(memberId);
                }}
              />
            ))}
          </View>
        ) : null}
      </Reveal>
    </View>
  );
}
