import type { MemberDropdownProps } from './MemberDropdown';
import { colors, fontFamily } from './theme';

/** Browser and mobile OS member picker, with native keyboard and touch support. */
export function MemberDropdown(props: MemberDropdownProps) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <select
        aria-label={props.label}
        title={props.options.find((option) => option.value === props.value)?.label}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        style={{ appearance: 'none', width: '100%', minWidth: 0, minHeight: 44, padding: '8px 24px 8px 8px', border: 0, borderRadius: 0, outlineOffset: 3, background: colors.pale, color: colors.ink, fontFamily, fontSize: props.fontSize, fontWeight: 700, lineHeight: 1.2, textOverflow: 'ellipsis', cursor: 'pointer' }}
      >
        {!props.value ? <option value="" disabled>Choose</option> : null}
        {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span aria-hidden style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontFamily, fontSize: 14, color: colors.ink }}>▾</span>
    </div>
  );
}
