import type { ReactNode } from 'react';

/** One editable input in the workbench's controls panel. */
export type Control =
  | { kind: 'text'; default: string; hint?: string }
  | { kind: 'boolean'; default: boolean; hint?: string }
  | {
      kind: 'select';
      options: readonly string[];
      default: string;
      hint?: string;
    }
  | {
      kind: 'number';
      default: number;
      min: number;
      max: number;
      step?: number;
      hint?: string;
    };

export type Controls = Record<string, Control>;

export type ControlValue = string | number | boolean;

export type ControlValues = Record<string, ControlValue>;

type ValueOf<C extends Control> = C extends { kind: 'boolean' }
  ? boolean
  : C extends { kind: 'number' }
    ? number
    : C extends { kind: 'select'; options: readonly (infer Option)[] }
      ? Option
      : string;

export type Values<C extends Controls> = { [Name in keyof C]: ValueOf<C[Name]> };

/** Records a callback the previewed component fired, such as a press. */
export type Log = (event: string, detail?: string) => void;

/** A named, searchable example of a component under editable controls. */
export type Story = {
  id: string;
  group: string;
  title: string;
  description: string;
  controls: Controls;
  render(values: ControlValues, log: Log): ReactNode;
};

type StoryDefinition<C extends Controls> = Omit<Story, 'controls' | 'render'> & {
  controls: C;
  render(values: Values<C>, log: Log): ReactNode;
};

export function defineStory<const C extends Controls>(
  definition: StoryDefinition<C>,
): Story {
  return {
    ...definition,
    render: (values, log) =>
      // SAFETY: the workbench only renders values seeded from these controls'
      // defaults and edited by inputs of each control's own kind.
      definition.render(values as Values<C>, log),
  };
}

export function defaultValues(controls: Controls): ControlValues {
  return Object.fromEntries(
    Object.entries(controls).map(([name, control]) => [name, control.default]),
  );
}

/** Matches every whitespace-separated term against a story's searchable text. */
export function searchStories(stories: Story[], query: string): Story[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return stories.filter((story) => {
    const text = [
      story.group,
      story.title,
      story.description,
      ...Object.keys(story.controls),
    ]
      .join(' ')
      .toLowerCase();

    return terms.every((term) => text.includes(term));
  });
}

/** Splits a comma-separated control into trimmed, non-empty names. */
export function listValue(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
