import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { currencyOptions } from '../model/currency';
import { s } from './components';
import { Drawer } from './Drawer';
import { CheckIcon, ChevronDownIcon, SearchIcon } from './icons';
import { colors, fontFamily, monoFamily, radius } from './theme';

/** The currency beside an amount: a grey pill that opens the currencies to choose from. */
export function CurrencyPicker(props: { value: string; recent: string[]; onChange: (currency: string) => void; height?: number }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Currency: ${props.value || 'none'}. Change currency`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, height: props.height ?? 44, paddingHorizontal: 12, borderRadius: radius.small, backgroundColor: colors.track }, pressed && s.pressed]}
      >
        <Text style={{ minWidth: 36, fontFamily: monoFamily, fontSize: 16, fontWeight: '600', color: colors.ink }}>{props.value}</Text>
        <ChevronDownIcon size={14} color={colors.ink} strokeWidth={2.2} />
      </Pressable>
      {open ? (
        <CurrencyDrawer
          value={props.value}
          recent={props.recent}
          onClose={() => setOpen(false)}
          onChoose={(currency) => {
            setOpen(false);
            props.onChange(currency);
          }}
        />
      ) : null}
    </>
  );
}

/** A search, ready for typing, above the currencies: the group's and the common ones first. */
function CurrencyDrawer(props: { value: string; recent: string[]; onClose: () => void; onChoose: (currency: string) => void }) {
  const [query, setQuery] = useState('');
  const recent = props.recent.join();
  const options = useMemo(() => currencyOptions(props.recent, query), [recent, query]);

  return (
    <Drawer full title="Currency" onClose={props.onClose}>
      <View>
        <TextInput
          accessibilityLabel="Search currencies"
          autoFocus
          placeholder="Search by code or name"
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (options[0]) props.onChoose(options[0].code);
          }}
          style={{ height: 48, paddingLeft: 42, paddingRight: 14, borderRadius: radius.control, backgroundColor: colors.background, fontFamily, fontSize: 16, color: colors.ink }}
        />
        <View pointerEvents="none" style={{ position: 'absolute', left: 14, top: 15 }}>
          <SearchIcon color={colors.muted} />
        </View>
      </View>
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
        <View accessibilityRole="radiogroup" accessibilityLabel="Currency">
          {options.map((option, index) => {
            const selected = option.code === props.value;

            return (
              <Pressable
                key={option.code}
                accessibilityRole="radio"
                accessibilityLabel={`${option.code}, ${option.name}`}
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                onPress={() => props.onChoose(option.code)}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 4 }, index > 0 && s.ruled, pressed && s.rowPressed]}
              >
                <Text style={{ width: 44, fontFamily: monoFamily, fontSize: 15, fontWeight: '600', color: selected ? colors.action : colors.ink }}>{option.code}</Text>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontSize: 15, color: selected ? colors.action : colors.soft }}>{option.name}</Text>
                {selected ? <CheckIcon size={18} color={colors.action} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </View>
        {!options.length ? <Text style={[s.caption, { paddingVertical: 12 }]}>No currency matches “{query.trim()}”.</Text> : null}
      </ScrollView>
    </Drawer>
  );
}
