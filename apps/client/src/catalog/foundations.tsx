import { useState } from 'react';
import { View } from 'react-native';
import * as icons from '../design/icons';
import { BrandMark, Button, Row, Stack, Text, colors, durations, easeOut, fonts, layout, opacities, radii, rules, sizes, space, splitHues, strokes, typeScale, withTransition, type ColorName, type TypeVariant } from '../design';
import { Example, Gallery, Specimen, Usage, entriesOf, type DocPage } from './doc';

/** What each color is for; every color token must have one. */
const colorRoles = {
  background: 'The page, everything on it, and text on ink: nothing sits on a card.',
  ink: 'Text, icons, strong rules, and the main action’s black block.',
  muted: 'Secondary text, labels, and quiet actions.',
  faint: 'Placeholders, unchecked controls, resting underlines, idle actions’ text, a left group.',
  rule: 'Hairlines between rows, and an action that cannot be pressed yet.',
  tint: 'Your own row, a pressed row, a bar’s empty track, a neutral notice, the offline strip.',
  owed: 'Text of money someone gets back, and of everyone being square.',
  danger: 'Text of money someone owes, failures, and destructive actions.',
  dangerSurface: 'Behind a failure.',
  positive: 'Fills that mean good: money back in a bar, someone online, an action on ink.',
  alert: 'Fills that ask for attention: money owed in a bar, counts, new and review marks.',
} as const satisfies Record<ColorName, string>;

/** What each step of the type ramp is for; every step must have one. */
const typeRoles = {
  hero: 'The homepage’s headline.',
  heroCompact: 'The homepage’s headline on a phone.',
  title: 'A screen’s large title at rest; `titleStyle(progress)` shrinks it to 18 as the page scrolls.',
  heading: 'Dialog and drawer titles.',
  headline: 'A group’s name in the list, empty states, and sections of a long page.',
  large: 'Text typed into a form.',
  strong: 'What a row is about, such as a person or an expense, and button labels.',
  body: 'Sentences.',
  caption: 'A row’s second line, section labels, hints, notices, and small actions.',
  meta: 'Tags, timestamps, and the offline strip.',
  count: 'A count on a badge, and a check mark.',
  figure: 'Amounts in rows.',
  figureSmall: 'Amounts inside an Activity entry.',
} as const satisfies Record<TypeVariant, string>;

function Swatch(props: { color: string; name: string; detail: string }) {
  return (
    <Specimen name={props.name} detail={props.detail} width={150}>
      <View style={{ height: 48, backgroundColor: props.color, borderWidth: strokes.hairline, borderColor: colors.rule }} />
      <Text variant="figureSmall" tone="muted">{props.color}</Text>
    </Specimen>
  );
}

function ColorsPage() {
  return (
    <Stack gap={32}>
      <Usage code={"import { colors } from '../design';\n\n<View style={{ backgroundColor: colors.tint }} />\n<Text tone=\"muted\">…</Text>  // text takes a tone, not a color"} />
      <Example title="Palette" width={1000}>
        <Gallery>
          {entriesOf(colorRoles).map(([name, role]) => (
            <Swatch key={name} name={name} detail={role} color={colors[name]} />
          ))}
        </Gallery>
      </Example>
      <Example title="Split hues" note="One per person in an expense's split bar, in member order." width={1000}>
        <Gallery>
          {splitHues.map((hue, index) => <Swatch key={hue} name={`splitHues[${index}]`} detail="" color={hue} />)}
        </Gallery>
      </Example>
    </Stack>
  );
}

function TypePage() {
  return (
    <Stack gap={32}>
      <Usage code={'<Text variant="body">Sentences.</Text>\n<Text variant="caption" tone="muted">A note.</Text>\n<Text variant="figure" color={balanceColor(amount)}>+12.50</Text>\n\n// Nested text inherits its step and changes only what it names:\n<Text variant="body"><Text weight="semibold">Ana</Text> paid</Text>'} />
      <Example title="Type ramp" width={1000}>
        <Stack gap={4}>
          {entriesOf(typeRoles).map(([name, role]) => {
            const step = typeScale[name];

            return (
              <Row key={name} gap={24} paddingY={12} align="start" wrap style={rules.above}>
                <Stack gap={2} style={{ width: 200 }}>
                  <Text variant="figureSmall">{name}</Text>
                  <Text variant="caption" tone="muted">{`${step.fontSize}/${step.lineHeight} · ${step.fontWeight} · ${step.fontFamily}`}</Text>
                  <Text variant="caption" tone="muted">{role}</Text>
                </Stack>
                <Text variant={name} numberOfLines={1} style={{ flex: 1, minWidth: 240 }}>
                  {step.fontFamily === fonts.mono ? '1,234.50' : 'Lisbon weekend'}
                </Text>
              </Row>
            );
          })}
        </Stack>
      </Example>
      <Example title="Tones" note="A text's color says what it means. `color` takes any other, such as a balance's.">
        <Gallery>
          {(['ink', 'muted', 'faint', 'owed', 'danger'] as const).map((tone) => <Text key={tone} variant="body" tone={tone}>{tone}</Text>)}
          <View style={{ flexDirection: 'row', gap: 12, backgroundColor: colors.ink, paddingHorizontal: 8 }}>
            <Text variant="body" tone="inverse">inverse</Text>
            <Text variant="body" tone="positive">positive</Text>
          </View>
        </Gallery>
      </Example>
    </Stack>
  );
}

function SpacingPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<Stack gap={12} paddingY={12}>…</Stack>\n<Row gap={8} justify="between">…</Row>\n\n// gap and padding props accept only steps of `space`.'} />
      <Example title="Spacing scale" note="On a 4-point grid, with 2 for text set tight; layout primitives accept nothing else.">
        <Stack gap={8}>
          {space.map((step) => (
            <Row key={step} gap={16}>
              <Text variant="figureSmall" style={{ width: 32 }}>{step}</Text>
              <View style={{ width: step * 4, height: 12, backgroundColor: colors.positive }} />
            </Row>
          ))}
        </Stack>
      </Example>
    </Stack>
  );
}

function Table(props: { rows: readonly (readonly [string, string | number, string])[] }) {
  return (
    <View style={rules.below}>
      {props.rows.map(([name, value, role]) => (
        <Row key={name} gap={16} paddingY={12} align="start" style={rules.above}>
          <Text variant="figureSmall" style={{ width: 150 }}>{name}</Text>
          <Text variant="figureSmall" tone="muted" style={{ width: 90 }}>{String(value)}</Text>
          <Text variant="caption" style={{ flex: 1 }}>{role}</Text>
        </Row>
      ))}
    </View>
  );
}

function SizesPage() {
  return (
    <Stack gap={32}>
      <Example title="sizes" note="Heights and widths controls and rows share.">
        <Table rows={[
          ['touch', sizes.touch, 'The smallest thing a finger can reliably hit: icon buttons, header rows, fields.'],
          ['control', sizes.control, 'A button.'],
          ['row', sizes.row, 'One row of a list, whatever it holds.'],
          ['compact', sizes.compact, 'Something small inside a row or a header, such as Undo or a segmented control; the offline strip.'],
        ]} />
      </Example>
      <Example title="strokes" note="Line widths. Rules separate; nothing sits on a card.">
        <Stack gap={16}>
          {entriesOf(strokes).map(([name, width]) => (
            <Row key={name} gap={16}>
              <Text variant="figureSmall" style={{ width: 150 }}>{`${name} · ${width}`}</Text>
              <View style={{ flex: 1, height: width, backgroundColor: colors.ink }} />
            </Row>
          ))}
        </Stack>
      </Example>
      <Example title="radii, opacities, layout">
        <Table rows={[
          ['radii.round', radii.round, 'Everything is square; only dots, radio marks, and counts are round.'],
          ['opacities.pressed', opacities.pressed, 'Anything pressable while held down.'],
          ['opacities.disabled', opacities.disabled, 'Anything that cannot be used right now.'],
          ['layout.column', layout.column, 'App screens: one phone-wide column on every device.'],
          ['layout.gutter', layout.gutter, 'Between the column’s edge and its content.'],
          ['layout.page', layout.page, 'Public pages, such as the homepage.'],
          ['layout.prose', layout.prose, 'A public page’s readable text.'],
          ['layout.dialog', layout.dialog, 'A dialog on a wide screen.'],
        ]} />
      </Example>
    </Stack>
  );
}

function MotionPage() {
  const [on, setOn] = useState(false);

  return (
    <Stack gap={32}>
      <Usage code={"withTransition({ opacity: open ? 1 : 0 }, 'opacity', durations.medium)"} />
      <Example title="Durations" note={`Every movement eases with ${easeOut}: quick to start, long to settle. Press Play to run each.`}>
        <Stack gap={16}>
          <Row>
            <Button size="compact" variant="secondary" onPress={() => setOn(!on)}>Play</Button>
          </Row>
          {entriesOf(durations).map(([name, ms]) => (
            <Row key={name} gap={16}>
              <Text variant="figureSmall" style={{ width: 120 }}>{`${name} · ${ms}`}</Text>
              <View style={{ flex: 1, height: 10, backgroundColor: colors.tint }}>
                <View style={withTransition({ height: '100%', width: on ? '100%' : '0%', backgroundColor: colors.ink }, 'width', ms)} />
              </View>
            </Row>
          ))}
        </Stack>
      </Example>
    </Stack>
  );
}

function IconsPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<PencilIcon size={18} />\n<CloseIcon size={16} color={colors.muted} />'} />
      <Example title="Icons" note="Stroked 24-unit outlines, in ink unless given a color." width={1000}>
        <Gallery>
          {Object.entries(icons).map(([name, Icon]) => (
            <Specimen key={name} name={name.replace(/Icon$/, '')} width={96}>
              <View style={{ height: 40, justifyContent: 'center' }}>
                <Icon size={24} />
              </View>
            </Specimen>
          ))}
        </Gallery>
      </Example>
      <Example title="BrandMark" note="The split-S of the favicon; it stands beside the name on the groups list.">
        <Gallery>
          {[22, 34, 64].map((size) => (
            <Specimen key={size} name={`size ${size}`} width={80}>
              <BrandMark size={size} />
            </Specimen>
          ))}
        </Gallery>
      </Example>
    </Stack>
  );
}

export const foundationPages: DocPage[] = [
  { id: 'colors', section: 'Foundations', title: 'Colors', summary: 'One fixed light palette, named for what each color does.', source: 'design/tokens.ts · colors', render: () => <ColorsPage /> },
  { id: 'typography', section: 'Foundations', title: 'Typography', summary: 'The type ramp and tones every text is set in.', source: 'design/tokens.ts · typeScale', render: () => <TypePage /> },
  { id: 'spacing', section: 'Foundations', title: 'Spacing', summary: 'The steps gaps and padding take.', source: 'design/tokens.ts · space', render: () => <SpacingPage /> },
  { id: 'sizes', section: 'Foundations', title: 'Sizes and lines', summary: 'Control heights, line widths, opacities, and the column’s widths.', source: 'design/tokens.ts · sizes, strokes, layout', render: () => <SizesPage /> },
  { id: 'motion', section: 'Foundations', title: 'Motion', summary: 'One easing and a few durations.', source: 'design/tokens.ts · durations', render: () => <MotionPage /> },
  { id: 'icons', section: 'Foundations', title: 'Icons and mark', summary: 'Outline icons and the brand mark.', source: 'design/icons.tsx, design/BrandMark.tsx', render: () => <IconsPage /> },
];
