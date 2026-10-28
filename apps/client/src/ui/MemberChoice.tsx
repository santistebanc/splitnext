import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { memberName } from '../model/expenses';
import { participantMarkers } from '../model/memberPresentation';
import { colors, s } from './components';
import { MemberIcon, type MemberListApp } from './MemberList';
import { Reveal } from './Reveal';
import { YouBadge } from './YouBadge';
import { fontFamily, withTransition } from './theme';

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

/** One member in an open choice, with presence and the you badge. */
function MemberChoiceRow(props: { app: MemberListApp; memberId: string; you: boolean; selected: boolean; onPress: () => void }) {
  const state = props.app.snapshot();
  const replica = state.group;
  const name = memberName(replica?.projected_snapshot, props.memberId);
  const participants = replica ? participantMarkers(replica, props.memberId, props.app.client.presence(replica.group_id), state.online && state.reachable) : [];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${name}${props.you ? ' (you)' : ''}`}
      accessibilityState={{ checked: props.selected }}
      aria-checked={props.selected}
      onPress={props.onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, marginHorizontal: -24, paddingHorizontal: 24, borderBottomWidth: 1, borderColor: colors.rule }, props.you && { backgroundColor: colors.youRow }, pressed && s.rowPressed]}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <MemberIcon participants={participants} size={6} />
        <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>{name}</Text>
        {props.you ? <YouBadge /> : null}
      </View>
      {props.selected ? <Text aria-hidden style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>✓</Text> : null}
    </Pressable>
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
      <Pressable
        ref={toggle}
        accessibilityRole="button"
        accessibilityLabel={`${props.label} ${props.value ? `${name}${props.value === props.you ? ' (you)' : ''}` : 'nobody yet'}. ${props.change}`}
        accessibilityState={{ expanded: showing, disabled: Boolean(props.disabled) }}
        disabled={props.disabled}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.rule }, pressed && s.pressed]}
      >
        <Text style={{ fontFamily, fontSize: 16, color: colors.muted }}>{props.label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{props.value ? name : 'Choose'}</Text>
          <Text style={withTransition({ fontSize: 14, color: colors.ink, transform: [{ rotate: showing ? '180deg' : '0deg' }] }, 'transform', 350)}>▾</Text>
        </View>
      </Pressable>
      <Reveal toggle={toggle} onOutsidePress={() => setOpen(false)}>
        {showing ? (
          <View role="radiogroup" aria-label={props.label}>
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
