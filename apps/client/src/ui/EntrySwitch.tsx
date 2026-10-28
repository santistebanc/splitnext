import { Pressable, Text, View } from 'react-native';
import { colors, s } from './components';
import { fontFamily } from './theme';
import { useActionCall } from './useActionCall';

type EntryKind = 'expense' | 'repayment';

const kinds = [
  { kind: 'expense', text: 'Expense' },
  { kind: 'repayment', text: 'Payment' },
] as const;

/** Expense or Payment for a new entry, switching in place like tabs; hidden when changing a recorded one. */
export function EntrySwitch(props: { kind: EntryKind }) {
  const swap = useActionCall();
  const other = props.kind === 'expense' ? 'repayment' : 'expense';

  if (!swap.can('switchEntryKind', { kind: other })) return null;

  return (
    <View role="radiogroup" aria-label="Entry type" style={{ flexDirection: 'row', marginRight: 12 }}>
      {kinds.map((entry, index) => {
        const selected = entry.kind === props.kind;

        return (
          <Pressable
            key={entry.kind}
            accessibilityRole="radio"
            accessibilityLabel={entry.text}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            disabled={swap.busy}
            onPress={() => { if (!selected) void swap.call('switchEntryKind', { kind: entry.kind }); }}
            style={({ pressed }) => [
              { height: 34, minWidth: 84, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.ink },
              index > 0 && { marginLeft: -1.5 },
              selected && { backgroundColor: colors.ink },
              pressed && s.pressed,
            ]}
          >
            <Text numberOfLines={1} style={{ fontFamily, fontSize: 14, fontWeight: '600', color: selected ? colors.actionInk : colors.ink }}>{entry.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
