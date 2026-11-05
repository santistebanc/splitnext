import { useState } from 'react';
import { View } from 'react-native';
import {
  ArrowRightIcon, Avatar, BalanceBar, Button, CheckMark, Checkbox, Chip, CloseIcon, CountBadge, Divider, Dot, EmptyState, ErrorMessage, Field, IconButton, Input,
  ListRow, Notice, PencilIcon, RadioMark, RadioRow, Row, SectionHeading, SegmentedControl, Skeleton, Stack, Tag, Text, TextButton, Touchable,
  Tabs, ToggleChip, YouBadge, colors, rules, sizes,
} from '../design';
import { Example, Gallery, Props, Specimen, Usage, type DocPage } from './doc';

/** Records presses in the page itself, so an example shows it was hit. */
function usePresses() {
  const [last, setLast] = useState('Nothing pressed yet');

  return {
    note: <Text variant="caption" tone="muted">{last}</Text>,
    press: (what: string) => () => setLast(`Pressed ${what} at ${new Date().toLocaleTimeString()}`),
  };
}

function TextPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<Text variant="body" tone="muted">Paste the link someone sent you.</Text>\n<Text variant="body"><Text weight="bold">Ana</Text> added Dinner</Text>'} />
      <Example title="Nested text" note="Text inside text inherits its step and changes only what it names.">
        <Text variant="strong" weight="regular"><Text weight="bold">Ana</Text> added <Text weight="semibold">Dinner</Text> for 4 people</Text>
      </Example>
      <Example title="Alignment and underline">
        <Stack gap={8}>
          <Text variant="body" align="left">Left</Text>
          <Text variant="body" align="center">Centre</Text>
          <Text variant="body" align="right">Right</Text>
          <Text variant="caption" weight="semibold" underline>Underlined, as a text action</Text>
        </Stack>
      </Example>
      <Props rows={[
        ['variant?', 'TypeVariant', 'A step of the type ramp (see Typography). Left out only by text nested in another, which inherits.'],
        ['tone?', "'ink' | 'muted' | 'faint' | 'owed' | 'danger' | 'inverse' | 'positive'", 'What its color means; ink by default once a variant is set.'],
        ['weight?', "'regular' | 'medium' | 'semibold' | 'bold'", 'Overrides the step’s own weight.'],
        ['align?', "'left' | 'center' | 'right'", 'Text alignment.'],
        ['underline?', 'boolean', 'Underlined, as a text action is.'],
        ['color?', 'string', 'A color outside the tones, such as a balance’s from balanceColor().'],
        ['…', 'TextProps', 'Everything React Native’s Text takes, including ref, numberOfLines, and style.'],
      ]} />
    </Stack>
  );
}

function InputPage() {
  const [value, setValue] = useState('');

  return (
    <Stack gap={32}>
      <Usage code={'<Input variant="strong" placeholder="+ Add a person" value={name} onChangeText={setName} />'} />
      <Example title="Bare input" note="No label or underline of its own; give it the row's height and edges.">
        <View style={[rules.above, rules.below]}>
          <Input variant="strong" placeholder="+ Add a person" value={value} onChangeText={setValue} style={{ height: sizes.row }} />
        </View>
      </Example>
      <Props rows={[
        ['variant?', 'TypeVariant', 'The step its text is set in; large by default. It takes the step’s font without its line height.'],
        ['weight?', 'FontWeight', 'Overrides the step’s weight.'],
        ['…', 'TextInputProps', 'Everything React Native’s TextInput takes, including ref. The placeholder is colors.faint unless given.'],
      ]} />
    </Stack>
  );
}

function Box(props: { label: string }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.tint }}>
      <Text variant="caption">{props.label}</Text>
    </View>
  );
}

function LayoutPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<Stack gap={12} paddingY={12}>\n  <Row gap={8} justify="between">\n    <Text variant="strong">Ana</Text>\n    <Text variant="figure">+12.50</Text>\n  </Row>\n</Stack>'} />
      <Example title="Stack" note="A column, a spacing step apart.">
        <Stack gap={8}>
          <Box label="One" />
          <Box label="Two" />
          <Box label="Three" />
        </Stack>
      </Example>
      <Example title="Row" note="A line, centred across it unless aligned otherwise; fill takes the room left.">
        <Stack gap={12}>
          <Row gap={8}><Box label="One" /><Box label="Two" /><Box label="Three" /></Row>
          <Row gap={8} justify="between"><Box label="between" /><Box label="ends" /></Row>
          <Row gap={8}><Box label="fixed" /><Stack fill><Box label="fill" /></Stack><Box label="fixed" /></Row>
        </Stack>
      </Example>
      <Props rows={[
        ['gap?', 'Space', 'Space between children, from the spacing scale.'],
        ['padding?, paddingX?, paddingY?, paddingTop?, paddingBottom?', 'Space', 'Padding from the spacing scale; later ones win.'],
        ['align?', "'start' | 'center' | 'end' | 'stretch' | 'baseline'", 'Across the main axis. Row centres by default; Stack stretches.'],
        ['justify?', "'start' | 'center' | 'end' | 'between'", 'Along the main axis.'],
        ['fill?', 'boolean', 'Takes the room left in its parent, and may shrink below its content.'],
        ['wrap?', 'boolean', 'Wraps onto more lines.'],
        ['…', 'ViewProps', 'Everything a View takes, including ref, role, and style for what tokens do not cover.'],
      ]} />
    </Stack>
  );
}

function TouchablePage() {
  const { note, press } = usePresses();

  return (
    <Stack gap={32}>
      <Usage code={'<Touchable feedback="tint" onPress={open}>…</Touchable>\n<IconButton label="Rename group" onPress={rename}><PencilIcon size={18} /></IconButton>'} />
      <Example title="Feedback" note="Hold each down to see how it answers.">
        <Stack gap={12}>
          <Touchable onPress={press('fade')} style={{ padding: 14, backgroundColor: colors.tint }}><Text variant="body">fade (default)</Text></Touchable>
          <Touchable feedback="tint" onPress={press('tint')} style={[{ padding: 14 }, rules.above, rules.below]}><Text variant="body">tint, for a whole row</Text></Touchable>
          <Touchable feedback="none" onPress={press('none')} style={{ padding: 14, backgroundColor: colors.tint }}><Text variant="body">none</Text></Touchable>
          {note}
        </Stack>
      </Example>
      <Example title="IconButton" note="A 44-point square around an icon, named for assistive technology; it fades while disabled.">
        <Row gap={8}>
          <IconButton label="Rename" onPress={press('rename')}><PencilIcon size={18} /></IconButton>
          <IconButton label="Close" onPress={press('close')}><CloseIcon size={18} /></IconButton>
          <IconButton label="Disabled" disabled onPress={press('disabled')}><PencilIcon size={18} /></IconButton>
        </Row>
      </Example>
      <Props rows={[
        ['feedback?', "'fade' | 'tint' | 'none'", 'How it answers a press.'],
        ['dim?', 'boolean', 'Fades while disabled.'],
        ['label (IconButton)', 'string', 'Its accessible name.'],
        ['size? (IconButton)', 'number', 'Its square’s side; 44 by default.'],
        ['…', 'PressableProps', 'Everything a Pressable takes, with a plain style.'],
      ]} />
    </Stack>
  );
}

function ButtonPage() {
  const { note, press } = usePresses();
  const [busy, setBusy] = useState(false);

  return (
    <Stack gap={32}>
      <Usage code={'<Button onPress={save}>Save</Button>\n<Button variant="secondary" grow onPress={cancel}>Cancel</Button>\n<Button busy={saving} onPress={save}>Save</Button>'} />
      <Example title="Variants" note="A black block for the main action; outlined for the second choice beside it.">
        <Stack gap={12}>
          <Row gap={12} align="stretch">
            <Button grow variant="secondary" onPress={press('Cancel')}>Cancel</Button>
            <Button grow onPress={press('Leave')}>Leave</Button>
          </Row>
          {note}
        </Stack>
      </Example>
      <Example title="Sizes">
        <Stack gap={12} align="start">
          <Row gap={12}><Button size="compact" onPress={press('compact')}>Record</Button><Button size="compact" variant="secondary" onPress={press('compact')}>Undo</Button><Button size="compact" variant="secondary" label="Open" icon={<ArrowRightIcon size={16} />} onPress={press('icon')} /><Text variant="caption" tone="muted">compact · inside a row or beside a field</Text></Row>
          <Row gap={12}><Button onPress={press('regular')}>Rejoin group</Button><Text variant="caption" tone="muted">regular · on its own, or stretched at a screen’s foot</Text></Row>
        </Stack>
      </Example>
      <Example title="At a screen's foot" note="The one main action, stretched to the column. Press it to see it busy.">
        <Button busy={busy} onPress={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>{busy ? 'Saving…' : 'Save'}</Button>
      </Example>
      <Example title="Disabled">
        <Row gap={12}>
          <Button disabled onPress={press('disabled')}>Save</Button>
          <Button disabled variant="secondary" onPress={press('disabled')}>Cancel</Button>
        </Row>
      </Example>
      <Props rows={[
        ['children?', 'string', 'Its label; without one it is a square around its icon, named by label.'],
        ['onPress', '() => void', 'What it does.'],
        ['variant?', "'primary' | 'secondary'", 'A black block, or outlined in ink.'],
        ['size?', "'regular' | 'compact'", '48 or 32 high; a compact one’s hit area reaches 44.'],
        ['disabled?, busy?', 'boolean', 'Idle while it cannot be pressed; busy also shows a spinner on a regular one.'],
        ['grow?', 'boolean', 'Shares a row’s width with the buttons beside it.'],
        ['label?', 'string', 'Its accessible name, when its text alone would not do.'],
        ['icon?', 'ReactNode', 'Before the label.'],
        ['expanded?', 'boolean', 'For a button that shows or hides more below it.'],
        ['ref?, style?, hitSlop?', '', 'Passed to the pressable.'],
      ]} />
    </Stack>
  );
}

function TextButtonPage() {
  const { note, press } = usePresses();

  return (
    <Stack gap={32}>
      <Usage code={'<TextButton size="small" onPress={rejoin}>Rejoin</TextButton>\n<TextButton tone="danger" onPress={leave}>Leave group</TextButton>'} />
      <Example title="Text actions" note="A full-height touch target around a line of text.">
        <Stack gap={4} align="start">
          <TextButton onPress={press('Join with a link')}>Join with a link</TextButton>
          <TextButton size="small" onPress={press('Change link')}>Change link</TextButton>
          <TextButton tone="muted" underline={false} onPress={press('Cancel')}>Cancel</TextButton>
          <TextButton tone="danger" onPress={press('Leave group')}>Leave group</TextButton>
          <TextButton disabled onPress={press('disabled')}>Disabled</TextButton>
          {note}
        </Stack>
      </Example>
      <Props rows={[
        ['children', 'string', 'Its text.'],
        ['onPress', '() => void', 'What it does.'],
        ['size?', "'regular' | 'small'", 'The strong or caption step.'],
        ['tone?', "'ink' | 'muted' | 'danger'", 'Its color.'],
        ['underline?', 'boolean', 'Underlined unless it is danger; header actions turn it off.'],
        ['disabled?, label?, expanded?, ref?, style?, hitSlop?', '', 'As on Button.'],
      ]} />
    </Stack>
  );
}

function FieldPage() {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');

  return (
    <Stack gap={32}>
      <Usage code={'<Field label="Group name" placeholder="Lisbon trip" value={name} onChangeText={setName} />'} />
      <Example title="Floating label" note="The label rises on focus or once there is text.">
        <Field label="Group name" placeholder="Lisbon trip" value={name} onChangeText={setName} />
      </Example>
      <Example title="Hint, error, and an action at its end">
        <Stack gap={24}>
          <Field label="Your name in this group" hint="Shown to everyone in the group." value="Ana" />
          <Field label="Invite link" error="That isn’t a splitnext invite link." value="https://example.com" />
          <Field label="Invite link" value={link} onChangeText={setLink} trailing={<Button size="compact" onPress={() => setLink('https://splitnext.online/j/abc123')}>Paste</Button>} />
          <Field label="Read only" value="Can’t change this" editable={false} />
        </Stack>
      </Example>
      <Props rows={[
        ['label', 'string', 'Its name, floating above it once raised.'],
        ['hideLabel?', 'boolean', 'Shows the placeholder instead, for a field named by what is around it.'],
        ['hint?, error?', 'string', 'A line under it; an error turns the line and underline orange.'],
        ['trailing?', 'ReactNode', 'An action at its end, such as Paste.'],
        ['displayValue?', 'ReactNode', 'A read layer over the input, such as a two-line title with an ellipsis.'],
        ['inputRef?', 'Ref<TextInput>', 'Reaches the input, as to focus it.'],
        ['figure?', 'boolean', 'A large monospaced figure.'],
        ['…', 'TextInputProps', 'Everything a TextInput takes; editable={false} shows it read only.'],
      ]} />
    </Stack>
  );
}

function ChoicesPage() {
  const [person, setPerson] = useState('ana');
  const [shares, setShares] = useState(true);
  const [kind, setKind] = useState<'expense' | 'repayment'>('expense');
  const { note, press } = usePresses();

  return (
    <Stack gap={32}>
      <Usage code={'<RadioRow label="Ana" selected={chosen === ana} onPress={() => choose(ana)}><Tag>Taken</Tag></RadioRow>\n<Checkbox label="Ana shares this expense" checked={included} onPress={toggle} />\n<SegmentedControl label="Entry type" options={kinds} value={kind} onChange={setKind} />'} />
      <Example title="RadioRow" note="One of several, ruled above; anything after the label sits at its end.">
        <View style={rules.below}>
          <RadioRow label="Ana" selected={person === 'ana'} onPress={() => setPerson('ana')} />
          <RadioRow label="Ben" selected={person === 'ben'} onPress={() => setPerson('ben')}><Tag>Taken</Tag></RadioRow>
          <RadioRow label="Chloe" disabled selected={false} onPress={() => setPerson('chloe')} />
        </View>
      </Example>
      <Example title="Checkbox" note="A box with a full touch target; CheckMark is the box alone.">
        <Row gap={16}>
          <Checkbox label="Shares this expense" checked={shares} onPress={() => setShares(!shares)} />
          <CheckMark checked />
          <CheckMark checked={false} />
          <RadioMark selected />
          <RadioMark selected={false} />
        </Row>
      </Example>
      <Example title="SegmentedControl" note="Options joined edge to edge, like tabs.">
        <Row>
          <SegmentedControl label="Entry type" options={[{ value: 'expense', text: 'Expense' }, { value: 'repayment', text: 'Payment' }]} value={kind} onChange={setKind} />
        </Row>
      </Example>
      <Example title="Chip" note="A quiet suggestion to tap.">
        <Stack gap={8}>
          <Row gap={8} wrap>
            {['Ana', 'Annie', 'A.'].map((name) => <Chip key={name} text={name} label={`Use ${name}`} onPress={press(name)} />)}
          </Row>
          {note}
        </Stack>
      </Example>
      <Props rows={[
        ['RadioRow: label, selected, onPress', 'string, boolean, () => void', 'The choice, whether it is chosen, and choosing it.'],
        ['RadioRow: disabled?, accessibilityLabel?, children?, style?', '', 'A choice that cannot be made fades; children follow the label.'],
        ['Checkbox: checked, label, onPress, disabled?, style?', '', 'A ticked box fades while it cannot change; style sizes its touch target.'],
        ['SegmentedControl: label, options, value, onChange, disabled?', 'SegmentedOption<Value>[]', 'Each option is { value, text }.'],
        ['Chip: text, label?, onPress', '', 'Its text, accessible name, and what it does.'],
      ]} />
    </Stack>
  );
}

function FeedbackPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<ErrorMessage message={save.error} />\n<Notice tone="info" role="status" message="Ben is already taken on another device." />\n<EmptyState title="No groups yet" text="Start a group for a trip." />'} />
      <Example title="Notice" note="Info for something to know, danger for a failure; ErrorMessage is a danger notice that shows nothing without a message.">
        <Stack gap={12}>
          <Notice tone="info" message="Ben is already taken on another device. You can still continue as Ben." />
          <ErrorMessage message="You’re offline. Connect to finish this step. Nothing you typed was lost." />
        </Stack>
      </Example>
      <Example title="EmptyState">
        <Stack gap={16}>
          <EmptyState title="No groups yet" text="Start a group for a trip or a shared home, or join one with an invite link." />
          <EmptyState tone="settled" title="Everyone is settled up" />
        </Stack>
      </Example>
      <Example title="Skeleton" note="Grey blocks standing in for what is still loading.">
        <Stack gap={12}>
          <Skeleton width="60%" height={16} />
          <Skeleton width="35%" height={12} />
        </Stack>
      </Example>
      <Props rows={[
        ['Notice: tone, message?, children?, icon?, role?', "'info' | 'danger'", 'Its color and icon; role="alert" or "status" announces it.'],
        ['ErrorMessage: message', 'string | null', 'A failure, or nothing.'],
        ['EmptyState: title, text?, tone?', "tone: 'settled'", 'A quiet state, ruled above; settled shows a green check.'],
        ['Skeleton: width, height, radius?', 'DimensionValue, number', 'Its size.'],
      ]} />
    </Stack>
  );
}

function MarksPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<Tag tone="warning">new</Tag>\n<YouBadge />\n<CountBadge count={3} />\n<Dot color={colors.positive} />'} />
      <Example title="Tag and YouBadge">
        <Row gap={16}>
          <Text variant="strong">Ben</Text><Tag>Taken</Tag>
          <Tag tone="warning">new</Tag>
          <Text variant="strong">Ana</Text><YouBadge />
        </Row>
      </Example>
      <Example title="CountBadge and Dot" note="Dots mark presence: filled online, a ring offline, dashed when no device has the name. Orange marks what needs review.">
        <Gallery>
          <Specimen name="CountBadge" width={100}><CountBadge count={3} /></Specimen>
          <Specimen name="online" width={80}><Dot color={colors.positive} size={9} /></Specimen>
          <Specimen name="offline" width={80}><Dot color={colors.muted} size={9} outline="solid" /></Specimen>
          <Specimen name="not taken" width={80}><Dot color={colors.faint} size={9} outline="dashed" /></Specimen>
          <Specimen name="review" width={80}><Dot color={colors.alert} label="Needs review" /></Specimen>
        </Gallery>
      </Example>
      <Props rows={[
        ['Tag: children, tone?', "'neutral' | 'warning'", 'A small label beside a name; YouBadge is the “you” tag.'],
        ['CountBadge: count, testID?', 'number', 'A round count ringed in the page color.'],
        ['Dot: color, size?, outline?, label?', "outline: 'solid' | 'dashed'", 'Filled, or a ring; a label makes it an image to assistive technology.'],
      ]} />
    </Stack>
  );
}

function AvatarPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<Avatar name="Léa-Marie Dubois" tint={3} online />'} />
      <Example title="Sizes and tints" note="Two initials at most; each person keeps the tint of their place in the group. The dot marks someone online.">
        <Gallery>
          <Specimen name="small" width={80}><Avatar name="Cy" tint={2} size="small" /></Specimen>
          <Specimen name="regular" width={80}><Avatar name="Benedikt Schwarzenberger-Hohenlohe" tint={1} /></Specimen>
          <Specimen name="online" width={80}><Avatar name="Nguyễn Thị Minh Khai" tint={4} online /></Specimen>
          <Specimen name="large" width={100}><Avatar name="Léa-Marie Dubois" tint={3} size="large" online /></Specimen>
        </Gallery>
      </Example>
      <Props rows={[
        ['Avatar: name, tint, size?, online?', "size: 'small' | 'regular' | 'large'", 'Initials on a soft fill; hidden from assistive technology beside the name it stands for.'],
      ]} />
    </Stack>
  );
}

function TabsPage() {
  const [tab, setTab] = useState<'people' | 'expenses'>('people');
  const [mine, setMine] = useState(true);

  return (
    <Stack gap={32}>
      <Usage code={"<Tabs label=\"Group\" value={tab} onChange={setTab} options={[{ value: 'people', text: 'People', count: 14 }, { value: 'expenses', text: 'Expenses', count: 126 }]} />"} />
      <Example title="Tabs">
        <Tabs label="Group" value={tab} onChange={setTab} options={[{ value: 'people', text: 'People', count: 14 }, { value: 'expenses', text: 'Expenses', count: 126 }]} />
      </Example>
      <Example title="ToggleChip" note="A filter, filled while on.">
        <Row gap={8}><ToggleChip text="Involves you" selected={mine} onPress={() => setMine(!mine)} /><ToggleChip text="Paid by you" selected={false} onPress={() => undefined} /></Row>
      </Example>
      <Props rows={[
        ['Tabs: label, options, value, onChange', '{ value, text, count? }[]', 'Sections of one screen; the chosen one is underlined.'],
        ['ToggleChip: text, selected, onPress, label?', 'boolean', 'A filter that is on or off.'],
      ]} />
    </Stack>
  );
}

function StructurePage() {
  const { note, press } = usePresses();

  return (
    <Stack gap={32}>
      <Usage code={'<View style={rules.below}>\n  <ListRow label="Change Dinner" onPress={open}>…</ListRow>\n</View>\n<SectionHeading title="Today" />\n<Divider strong />'} />
      <Example title="ListRow" note="A pressable row ruled above; a list closes with rules.below.">
        <Stack gap={8}>
          <View style={rules.below}>
            {[['Dinner', 'Ana paid · 4 people', '84.00'], ['Taxi', 'You paid · 2 people', '18.40']].map(([title, meta, amount]) => (
              <ListRow key={title} label={`Change ${title}`} onPress={press(title ?? '')}>
                <Stack fill gap={8}>
                  <Text variant="large" weight="semibold">{title}</Text>
                  <Text variant="caption" tone="muted">{meta}</Text>
                </Stack>
                <Text variant="figure">{amount}</Text>
              </ListRow>
            ))}
          </View>
          {note}
        </Stack>
      </Example>
      <Example title="SectionHeading and Divider">
        <Stack gap={12}>
          <SectionHeading title="Today" end={<TextButton size="small" onPress={press('Clear')}>Clear</TextButton>} />
          <Divider />
          <Divider strong />
        </Stack>
      </Example>
      <Example title="rules" note="Edges a view is ruled along, rather than boxed in.">
        <Stack gap={12}>
          {(['above', 'below', 'inkAbove', 'inkBelow'] as const).map((edge) => (
            <View key={edge} style={[{ padding: 10 }, rules[edge]]}><Text variant="figureSmall">rules.{edge}</Text></View>
          ))}
        </Stack>
      </Example>
      <Props rows={[
        ['ListRow: label, onPress, disabled?, style?, children', '', 'A row button; children lay out in a line.'],
        ['SectionHeading: title, end?, onPress?, color?', '', 'A section’s title with an action at its end.'],
        ['Divider: strong?', 'boolean', 'A hairline, or an ink line.'],
      ]} />
    </Stack>
  );
}

function BalanceBarPage() {
  return (
    <Stack gap={32}>
      <Usage code={'<BalanceBar track amount={-1250} max={2400} />'} />
      <Example title="With a track" note="Owing grows left in orange, getting back grows right in green, as a share of the largest balance beside it.">
        <Stack gap={16}>
          {[-2400, -800, 0, 1200, 2400].map((amount) => (
            <Row key={amount} gap={12}>
              <Text variant="figureSmall" style={{ width: 60 }}>{amount}</Text>
              <View style={{ flex: 1 }}><BalanceBar track amount={amount} max={2400} /></View>
            </Row>
          ))}
        </Stack>
      </Example>
      <Example title="In a row of people" note="Without a track, the strip sits on an ink line running the row's height.">
        <Stack>
          {[-900, 300, 600].map((amount) => (
            <Row key={amount} gap={8} style={[{ height: 52 }, rules.above]}>
              <Text variant="strong" style={{ width: 80 }}>{amount < 0 ? 'Ben' : amount < 500 ? 'Chloe' : 'Ana'}</Text>
              <View style={{ flex: 1, alignSelf: 'stretch' }}><BalanceBar amount={amount} max={900} /></View>
              <Text variant="figure" style={{ width: 70, textAlign: 'right' }}>{amount}</Text>
            </Row>
          ))}
        </Stack>
      </Example>
      <Props rows={[
        ['amount, max', 'number', 'The balance, and the largest shown beside it.'],
        ['track?', 'boolean', 'A short strip on a track, rather than in a row.'],
        ['height?', 'number', 'The strip’s height.'],
        ['stripRef?', 'Ref<View>', 'Reaches the strip, as to fly it between screens.'],
      ]} />
    </Stack>
  );
}

export const componentPages: DocPage[] = [
  { id: 'text', section: 'Components', title: 'Text', summary: 'All text in the app: a step of the type ramp in a tone.', source: 'design/Text.tsx', render: () => <TextPage /> },
  { id: 'input', section: 'Components', title: 'Input', summary: 'A bare text input in a step of the type ramp.', source: 'design/Text.tsx', render: () => <InputPage /> },
  { id: 'layout', section: 'Components', title: 'Stack and Row', summary: 'Columns and lines spaced by the spacing scale.', source: 'design/layout.tsx', render: () => <LayoutPage /> },
  { id: 'touchable', section: 'Components', title: 'Touchable and IconButton', summary: 'Anything pressable that is not a labelled button.', source: 'design/layout.tsx', render: () => <TouchablePage /> },
  { id: 'button', section: 'Components', title: 'Button', summary: 'A square action: a black block for the main one, outlined for the second.', source: 'design/Button.tsx', render: () => <ButtonPage /> },
  { id: 'text-button', section: 'Components', title: 'TextButton', summary: 'A text action with a full-height touch target.', source: 'design/Button.tsx', render: () => <TextButtonPage /> },
  { id: 'field', section: 'Components', title: 'Field', summary: 'The labelled, underlined text field.', source: 'design/Field.tsx', render: () => <FieldPage /> },
  { id: 'choices', section: 'Components', title: 'Choices', summary: 'Radio rows, checkboxes, segmented controls, and chips.', source: 'design/controls.tsx', render: () => <ChoicesPage /> },
  { id: 'feedback', section: 'Components', title: 'Notices and empty states', summary: 'Messages, failures, empty lists, and loading.', source: 'design/feedback.tsx', render: () => <FeedbackPage /> },
  { id: 'marks', section: 'Components', title: 'Tags, badges, and dots', summary: 'Small marks beside names and icons.', source: 'design/feedback.tsx', render: () => <MarksPage /> },
  { id: 'avatar', section: 'Components', title: 'Avatar', summary: 'A person as initials on their tint, with an online dot.', source: 'design/Avatar.tsx', render: () => <AvatarPage /> },
  { id: 'tabs', section: 'Components', title: 'Tabs and filters', summary: 'Sections of one screen, and filters that are on or off.', source: 'design/controls.tsx', render: () => <TabsPage /> },
  { id: 'structure', section: 'Components', title: 'Rows and rules', summary: 'List rows, section headings, and the rules between them.', source: 'design/structure.tsx', render: () => <StructurePage /> },
  { id: 'balance-bar', section: 'Components', title: 'BalanceBar', summary: 'A balance as two halves meeting at an ink line.', source: 'design/structure.tsx', render: () => <BalanceBarPage /> },
];
