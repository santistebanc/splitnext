import { z } from 'zod';
import type { JsonValue } from '@splitnext/client';
import type { ActionDescription } from '../model/actions';
import { sourceOptions, valueSourceSchema, type ValueSource, type InputState } from '../model/actionInputs';

export type FormState = InputState;

/** The subset of an action's JSON Schema a form needs to render inputs. */
export type SchemaNode = {
  type?: string | undefined;
  description?: string | undefined;
  properties?: Record<string, SchemaNode> | undefined;
  required?: string[] | undefined;
  oneOf?: SchemaNode[] | undefined;
  enum?: string[] | undefined;
  const?: string | undefined;
  choices?: ValueSource | undefined;
  suggestions?: ValueSource | undefined;
};

const schemaNodeSchema: z.ZodType<SchemaNode> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), schemaNodeSchema).optional(),
    required: z.array(z.string()).optional(),
    oneOf: z.array(schemaNodeSchema).optional(),
    enum: z.array(z.string()).optional(),
    const: z.string().optional(),
    choices: valueSourceSchema.optional(),
    suggestions: valueSourceSchema.optional(),
  }),
);

/** Reads a JSON Schema published by `describe()`; unknown keywords are ignored. */
export function parseSchema(schema: ActionDescription['inputSchema']) {
  return schemaNodeSchema.parse(schema);
}

type FieldBase = {
  /** Dotted path into the input, such as `as.memberId`. */
  path: string;
  label: string;
  description: string | null;
  optional: boolean;
};

/** One input of an action, with the control that suits its values. */
export type FormField =
  | (FieldBase & {
      kind: 'text';
      /** Values to offer, and whether the value must be one of them. */
      source: ValueSource | null;
      strict: boolean;
    })
  | (FieldBase & { kind: 'select'; options: string[] })
  | (FieldBase & { kind: 'boolean' })
  | (FieldBase & { kind: 'number' })
  | (FieldBase & {
      kind: 'variant';
      discriminator: string;
      variants: { value: string; fields: FormField[] }[];
    });

/** Turns an object schema into fields, one per property. */
export function formFields(schema: SchemaNode, prefix = ''): FormField[] {
  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties ?? {}).map(([key, node]) =>
    fieldFor(node, `${prefix}${key}`, key, !required.has(key)),
  );
}

function fieldFor(
  node: SchemaNode,
  path: string,
  key: string,
  optional: boolean,
): FormField {
  const base = {
    path,
    label: key,
    description: node.description ?? null,
    optional,
  };

  const variants = node.oneOf ?? [];
  const discriminator = variants[0] && constKey(variants[0]);

  if (discriminator)
    return {
      ...base,
      kind: 'variant',
      discriminator,
      variants: variants.map((variant) => ({
        value: variant.properties?.[discriminator]?.const ?? '',
        fields: formFields(
          {
            ...variant,
            properties: Object.fromEntries(
              Object.entries(variant.properties ?? {}).filter(
                ([name]) => name !== discriminator,
              ),
            ),
          },
          `${path}.`,
        ),
      })),
    };

  if (node.enum) return { ...base, kind: 'select', options: node.enum };

  if (node.type === 'boolean') return { ...base, kind: 'boolean' };

  if (node.type === 'number' || node.type === 'integer')
    return { ...base, kind: 'number' };

  return {
    ...base,
    kind: 'text',
    source: node.choices ?? node.suggestions ?? null,
    strict: Boolean(node.choices),
  };
}

/** The property every variant fixes to a constant, such as `kind`. */
function constKey(variant: SchemaNode): string | null {
  return (
    Object.entries(variant.properties ?? {}).find(
      ([, node]) => node.const !== undefined,
    )?.[0] ?? null
  );
}

/** What the person entered, by field path. */
export type FormValues = Record<string, string | boolean>;

/**
 * The action input for the entered values, before the action validates it.
 * Empty optional fields are omitted; empty required ones stay, so the action
 * reports them.
 */
export function buildInput(fields: FormField[], values: FormValues) {
  return Object.fromEntries(fields.flatMap((field) => entryFor(field, values)));
}

function entryFor(field: FormField, values: FormValues): [string, JsonValue][] {
  const key = field.path.split('.').at(-1) ?? field.path;
  const value = values[field.path];

  switch (field.kind) {
    case 'variant': {
      const chosen =
        field.variants.find(
          (variant) =>
            variant.value === values[`${field.path}.${field.discriminator}`],
        ) ?? field.variants[0];

      return chosen
        ? [
            [
              key,
              {
                [field.discriminator]: chosen.value,
                ...buildInput(chosen.fields, values),
              },
            ],
          ]
        : [];
    }

    case 'boolean':
      return value === undefined && field.optional
        ? []
        : [[key, value === true]];

    case 'number': {
      const text = textOf(value);

      if (text.trim()) return [[key, Number(text)]];

      return field.optional ? [] : [[key, Number.NaN]];
    }

    default: {
      const text = textOf(value);

      if (text !== '') return [[key, text]];

      return field.optional ? [] : [[key, '']];
    }
  }
}

function textOf(value: string | boolean | undefined): string {
  return value === undefined || value === true || value === false ? '' : value;
}

const exampleObjectSchema = z.record(z.string(), z.json());

const exampleScalarSchema = z.union([z.string(), z.number()]);

/** Reads a value at a dotted path of an example input, for placeholders. */
export function exampleAt(example: JsonValue, path: string): string | null {
  let current: JsonValue | undefined = example;

  for (const key of path.split('.')) {
    const parsed = exampleObjectSchema.safeParse(current);

    if (!parsed.success) return null;

    current = parsed.data[key];
  }

  const scalar = exampleScalarSchema.safeParse(current);

  return scalar.success ? String(scalar.data) : null;
}

/**
 * Starting values: each dropdown on its first option (including the first
 * choice from app state) and every other field empty, so examples show as
 * placeholders rather than values that may not exist here.
 */
export function initialValues(
  fields: FormField[],
  state: FormState,
  origin: string,
): FormValues {
  return Object.fromEntries(
    fields.flatMap((field): [string, string | boolean][] => {
      switch (field.kind) {
        case 'select':
          return field.optional || !field.options[0]
            ? []
            : [[field.path, field.options[0]]];

        case 'variant': {
          const first = field.variants[0];

          return first
            ? [
                [`${field.path}.${field.discriminator}`, first.value],
                ...Object.entries(
                  initialValues(
                    field.variants.flatMap((variant) => variant.fields),
                    state,
                    origin,
                  ),
                ),
              ]
            : [];
        }

        case 'text': {
          const first =
            field.strict && field.source
              ? sourceOptions(field.source, state, origin)[0]
              : undefined;

          return first && !field.optional ? [[field.path, first.value]] : [];
        }

        default:
          return [];
      }
    }),
  );
}
