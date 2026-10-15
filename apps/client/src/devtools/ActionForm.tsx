import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { JsonValue } from '@splitnext/client';
import { colors, s } from '../ui/components';
import { sourceOptions, type ValueOption } from '../model/actionInputs';
import {
  exampleAt,
  type FormField,
  type FormState,
  type FormValues,
} from './form';

type ActionFormProps = {
  fields: FormField[];
  values: FormValues;
  onChange: (path: string, value: string | boolean) => void;
  state: FormState;
  origin: string;
  example: JsonValue;
};

/** Inputs generated from an action's schema, one control per field. */
export function ActionForm(props: ActionFormProps) {
  if (!props.fields.length)
    return <Text style={s.caption}>This action takes no input.</Text>;

  return (
    <View style={fs.form}>
      {props.fields.map((field) => (
        <FieldControl key={field.path} field={field} {...props} />
      ))}
    </View>
  );
}

type FieldControlProps = Omit<ActionFormProps, 'fields'> & { field: FormField };

function FieldControl(props: FieldControlProps) {
  const field = props.field;
  const value = props.values[field.path];

  const text =
    value === undefined || value === true || value === false ? '' : value;

  const placeholder = exampleAt(props.example, field.path) ?? '';

  const control = (() => {
    switch (field.kind) {
      case 'boolean':
        return (
          <Switch
            accessibilityLabel={field.label}
            value={value === true}
            onValueChange={(next) => props.onChange(field.path, next)}
          />
        );

      case 'number':
        return (
          <TextInput
            accessibilityLabel={field.label}
            inputMode="decimal"
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={(next) => props.onChange(field.path, next)}
            style={fs.input}
          />
        );

      case 'select':
        return (
          <Dropdown
            label={field.label}
            options={field.options.map((option) => ({
              value: option,
              label: option,
            }))}
            value={text}
            optional={field.optional}
            onChange={(next) => props.onChange(field.path, next)}
          />
        );

      case 'variant': {
        const kindPath = `${field.path}.${field.discriminator}`;
        const kindValue = props.values[kindPath];

        const chosen =
          field.variants.find((variant) => variant.value === kindValue) ??
          field.variants[0];

        return (
          <View style={fs.variant}>
            <FieldControl
              {...props}
              field={{
                kind: 'select',
                path: kindPath,
                label: field.discriminator,
                description: null,
                optional: false,
                options: field.variants.map((variant) => variant.value),
              }}
            />
            {chosen?.fields.map((child) => (
              <FieldControl key={child.path} {...props} field={child} />
            ))}
          </View>
        );
      }

      case 'text': {
        const options = field.source
          ? sourceOptions(field.source, props.state, props.origin)
          : [];

        if (field.strict)
          return (
            <Dropdown
              label={field.label}
              options={options}
              value={text}
              optional={field.optional}
              empty={`No ${field.source ?? 'values'} available`}
              onChange={(next) => props.onChange(field.path, next)}
            />
          );

        return (
          <Combobox
            label={field.label}
            options={options}
            value={text}
            placeholder={placeholder}
            onChange={(next) => props.onChange(field.path, next)}
          />
        );
      }
    }
  })();

  return (
    <View style={fs.field}>
      <View style={fs.labelRow}>
        <Text style={fs.label}>{field.label}</Text>
        {field.optional ? <Text style={fs.tag}>optional</Text> : null}
      </View>
      {control}
      {field.description ? (
        <Text style={s.caption}>{field.description}</Text>
      ) : null}
    </View>
  );
}

type DropdownProps = {
  label: string;
  options: ValueOption[];
  value: string;
  optional: boolean;
  empty?: string;
  onChange: (value: string) => void;
};

/** A closed list: pick exactly one of the options (or none, if optional). */
function Dropdown(props: DropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = props.options.find((option) => option.value === props.value);

  const choices = props.optional
    ? [{ value: '', label: '(none)' }, ...props.options]
    : props.options;

  if (!props.options.length)
    return (
      <Text style={[fs.input, fs.disabled]}>{props.empty ?? 'No options'}</Text>
    );

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}: ${selected?.label ?? 'none'}`}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={[fs.input, fs.dropdown]}
      >
        <Text style={fs.value} numberOfLines={1}>
          {selected?.label ?? (props.optional ? '(none)' : 'Choose…')}
        </Text>
        <Text style={fs.caret}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View accessibilityRole="menu" style={fs.menu}>
          {choices.map((option) => (
            <Pressable
              key={option.value || '(none)'}
              accessibilityRole="menuitem"
              aria-checked={option.value === props.value}
              onPress={() => {
                props.onChange(option.value);
                setOpen(false);
              }}
              style={[fs.item, option.value === props.value && s.chosen]}
            >
              <Text style={fs.value}>{option.label}</Text>
              {option.value !== option.label && option.value ? (
                <Text style={fs.hint} numberOfLines={1}>
                  {option.value}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type ComboboxProps = {
  label: string;
  options: ValueOption[];
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

/** Free text, with matching suggestions from app state offered below it. */
function Combobox(props: ComboboxProps) {
  const [focused, setFocused] = useState(false);
  const query = props.value.trim().toLowerCase();

  const matches = props.options.filter(
    (option) =>
      option.value !== props.value &&
      (!query ||
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query)),
  );

  const known = props.options.find((option) => option.value === props.value);

  return (
    <View>
      <TextInput
        accessibilityLabel={props.label}
        placeholder={props.placeholder}
        placeholderTextColor={colors.muted}
        value={props.value}
        onChangeText={props.onChange}
        onFocus={() => setFocused(true)}
        // Leave time for a suggestion press to land before hiding the list.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        autoCapitalize="none"
        autoCorrect={false}
        style={fs.input}
      />
      {known && known.label !== known.value ? (
        <Text style={fs.hint}>{known.label}</Text>
      ) : null}
      {focused && matches.length ? (
        <View accessibilityRole="menu" style={fs.menu}>
          {matches.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="menuitem"
              onPress={() => props.onChange(option.value)}
              style={fs.item}
            >
              <Text style={fs.value}>{option.label}</Text>
              {option.value !== option.label ? (
                <Text style={fs.hint} numberOfLines={1}>
                  {option.value}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const fs = StyleSheet.create({
  form: { gap: 12 },
  field: { gap: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  tag: {
    color: colors.muted,
    fontSize: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    paddingHorizontal: 4,
  },
  input: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 14,
  },
  disabled: { color: colors.muted, backgroundColor: colors.background },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  value: { color: colors.ink, fontSize: 14, flexShrink: 1 },
  caret: { color: colors.muted, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 11, fontFamily: 'monospace' },
  menu: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  item: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 1,
  },
  variant: {
    gap: 10,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderColor: colors.border,
  },
});
