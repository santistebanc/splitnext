import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { RadioRow, colors, s } from './components';
import { fontFamily } from './theme';

export type MemberDropdownProps = {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  fontSize: number;
  disabled?: boolean;
  onChange: (value: string) => void;
};

/** The native member menu; the web build uses the browser's select control. */
export function MemberDropdown(props: MemberDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = props.options.find((option) => option.value === props.value);

  return (
    <View style={{ minWidth: 0, flex: 1, zIndex: open ? 10 : 0 }}>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={props.label}
        accessibilityState={{ expanded: open, disabled: Boolean(props.disabled) }}
        accessibilityValue={{ text: selected?.label ?? 'Choose' }}
        disabled={props.disabled}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: colors.pale }, pressed && s.pressed]}
      >
        <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontSize: props.fontSize, fontWeight: '700', color: colors.ink }}>{selected?.label ?? 'Choose'}</Text>
        <Text style={{ fontFamily, fontSize: 14, color: colors.ink }}>▾</Text>
      </Pressable>
      {open && !props.disabled ? (
        <ScrollView style={{ position: 'absolute', top: '100%', left: 0, minWidth: 200, maxHeight: 280, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.rule }}>
          {props.options.map((option) => (
            <RadioRow key={option.value} label={option.label} selected={option.value === props.value} onPress={() => { props.onChange(option.value); setOpen(false); }} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
