import { SegmentedControl } from '../design';
import { useActionCall } from './useActionCall';

type EntryKind = 'expense' | 'repayment';

const kinds = [
  { value: 'expense', text: 'Expense' },
  { value: 'repayment', text: 'Payment' },
] as const;

/** Expense or Payment for a new entry, switching in place like tabs; hidden when changing a recorded one. */
export function EntrySwitch(props: { kind: EntryKind }) {
  const swap = useActionCall();
  const other = props.kind === 'expense' ? 'repayment' : 'expense';

  if (!swap.can('switchEntryKind', { kind: other })) return null;

  return (
    <SegmentedControl
      label="Entry type"
      options={kinds}
      value={props.kind}
      disabled={swap.busy}
      onChange={(kind) => { void swap.call('switchEntryKind', { kind }); }}
      style={{ marginRight: 12 }}
    />
  );
}
