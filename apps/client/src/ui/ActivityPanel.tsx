import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { reversibleEffect, undoProblem, undoExplanation, type ClientReplicaState } from '@splitnext/client';
import { describeActivity, newActivity, visibleActivity, type ActivityKind } from '../model/activity';
import { reviewDetail, reviewTitle } from '../model/notices';
import { ErrorMessage, colors, s } from './components';
import { GridIcon, InfoIcon, PersonIcon, ReceiptIcon, RepayIcon, UndoIcon, WarningIcon } from './icons';
import type { MemberListApp } from './MemberList';
import { BackHeader } from './PersonView';
import { StickyTop } from './StickyTop';
import { displayFamily, fontFamily } from './theme';
import { useActionCall, useUiState } from './useActionCall';

type Event = ClientReplicaState['activity'][number];

/** The day an entry belongs to: "Today", "Yesterday", a weekday this week, or a date. */
function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';

  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60_000) return date.toLocaleDateString(undefined, { weekday: 'long' });

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** When it happened within its day: "Just now", "5m ago", "2h ago" today, a clock time before. */
function timeLabel(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);

  if (date.toDateString() === new Date().toDateString()) {
    if (minutes < 1) return 'Just now';

    if (minutes < 60) return `${minutes}m ago`;

    return `${Math.floor(minutes / 60)}h ago`;
  }

  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Activity's header: back to the group, the title, and Mark all seen while anything is new. */
export function ActivityHeader(props: { app: MemberListApp }) {
  const seen = useActionCall();
  const name = props.app.snapshot().group?.projected_snapshot?.group.name ?? '';

  return (
    <BackHeader
      context={name}
      title="Activity"
      error={seen.error}
      end={seen.can('markActivitySeen') ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { void seen.call('markActivitySeen', {}); }}
          style={({ pressed }) => [{ height: 44, paddingHorizontal: 10, justifyContent: 'center' }, pressed && s.dim]}
        >
          <Text style={{ fontFamily, fontSize: 14, fontWeight: '600', color: colors.action }}>Mark all seen</Text>
        </Pressable>
      ) : undefined}
    />
  );
}

const tones: Record<ActivityKind, { background: string; ink: string; icon: (color: string) => ReactNode }> = {
  expense: { background: colors.actionSoft, ink: colors.actionDark, icon: (color) => <ReceiptIcon size={18} color={color} /> },
  repayment: { background: colors.settledSoft, ink: colors.settled, icon: (color) => <RepayIcon color={color} /> },
  people: { background: colors.peopleSoft, ink: colors.peopleInk, icon: (color) => <PersonIcon size={18} color={color} /> },
  group: { background: colors.pale, ink: colors.soft, icon: (color) => <GridIcon size={18} color={color} /> },
};

/** A white action button inside an entry, with its icon. */
function EntryAction(props: { text: string; label: string; disabled: boolean; onPress: () => void; primary?: boolean; icon?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, minWidth: 44, paddingHorizontal: 14, borderRadius: 10 },
        props.primary ? { backgroundColor: colors.action } : { borderWidth: 1, borderColor: colors.field, backgroundColor: colors.surface },
        (pressed || props.disabled) && s.dim,
      ]}
    >
      {props.icon ? <UndoIcon /> : null}
      <Text style={{ fontFamily, fontSize: 14, fontWeight: '600', color: props.primary ? colors.actionInk : colors.ink }}>{props.text}</Text>
    </Pressable>
  );
}

/**
 * A section's title, such as Today: it stays at the top of the page while its
 * entries scroll under it, until the next section's title takes its place.
 */
function DayHeading(props: { children: ReactNode; color?: string }) {
  return (
    <StickyTop>
      <View style={{ backgroundColor: colors.background }}>
        <Text accessibilityRole="header" style={{ paddingTop: 10, paddingBottom: 8, paddingHorizontal: 4, fontFamily, fontSize: 15, fontWeight: '600', color: props.color ?? colors.ink }}>
          {props.children}
        </Text>
      </View>
    </StickyTop>
  );
}

/** Changes from this device that could not be applied, each resolved here with Apply again or Dismiss. */
function NeedsReview(props: { replica: ClientReplicaState }) {
  const action = useActionCall();
  // The notice last acted on, so a failure appears beside that notice.
  const [target, setTarget] = useState<string | null>(null);
  const notices = props.replica.notices;

  function act(commandId: string, name: 'retryNotice' | 'dismissNotice'): void {
    setTarget(commandId);
    void action.call(name, { commandId });
  }

  if (!notices.length) return null;

  return (
    <View role="region" aria-label="Needs your review" style={{ paddingBottom: 8 }}>
      <DayHeading color={colors.owes}>Needs your review · {notices.length}</DayHeading>
      <View style={{ borderRadius: 16, borderWidth: 2, borderColor: colors.warningEdge, backgroundColor: colors.surface, overflow: 'hidden' }}>
        {notices.map((notice, index) => {
          const commandId = notice.command.command_id;

          return (
            <View key={commandId} style={[{ gap: 10, paddingVertical: 14, paddingLeft: 12, paddingRight: 16 }, index > 0 && s.ruled]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View aria-hidden style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center' }}>
                  <WarningIcon color={colors.owes} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={{ fontFamily, fontSize: 15, lineHeight: 20, color: colors.ink }}>
                    <Text style={{ fontWeight: '600' }}>{reviewTitle(notice)}</Text> wasn’t applied
                  </Text>
                  <Text style={{ fontFamily, fontSize: 13, lineHeight: 19, color: colors.soft }}>{reviewDetail(notice)}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 44 }}>
                <EntryAction primary text="Apply again" label="Apply again" disabled={!action.can('retryNotice', { commandId })} onPress={() => act(commandId, 'retryNotice')} />
                <EntryAction text="Dismiss" label="Dismiss" disabled={!action.can('dismissNotice', { commandId })} onPress={() => act(commandId, 'dismissNotice')} />
              </View>
              {target === commandId ? <ErrorMessage message={action.error} /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The group's Activity: changes waiting for review first, then one
 * chronological list grouped by day, with new changes from others marked and
 * Undo or Restore where they are safe.
 */
export function ActivityPanel(props: { replica: ClientReplicaState }) {
  const action = useActionCall();
  const load = useActionCall();
  const seen = useUiState().activitySeen[props.replica.group_id];
  const snapshot = props.replica.projected_snapshot;
  const events = visibleActivity(props.replica.activity).toReversed();
  const fresh = new Set(newActivity(props.replica, seen).map((event) => event.id));
  useEffect(() => { void load.call('refreshActivity', {}); }, [props.replica.group_id, props.replica.revision]);

  const days: { label: string; events: Event[] }[] = [];

  for (const event of events) {
    const label = dayLabel(new Date(event.occurred_at));
    const last = days.at(-1);

    if (last?.label === label) last.events.push(event);
    else days.push({ label, events: [event] });
  }

  return (
    <View style={{ gap: 6, paddingBottom: 32 }}>
      <NeedsReview replica={props.replica} />
      {load.busy && !events.length ? <Text role="status" style={s.caption}>Loading Activity…</Text> : null}
      {!load.busy && !events.length ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 80, paddingHorizontal: 24 }}>
          <Text style={{ fontFamily: displayFamily, fontWeight: '700', fontSize: 22, color: colors.ink }}>Nothing here yet</Text>
          <Text style={{ fontFamily, fontSize: 15, color: colors.muted, textAlign: 'center' }}>Changes people make in this group show up here.</Text>
        </View>
      ) : null}
      <ErrorMessage message={load.error ?? action.error} />
      {days.map((day) => (
        <View key={day.label} style={{ paddingBottom: 8 }}>
          <DayHeading>{day.label}</DayHeading>
          <View style={{ borderRadius: 16, backgroundColor: colors.surface, overflow: 'hidden' }}>
            {day.events.map((event, index) => {
              const entry = describeActivity(event, props.replica);
              const tone = tones[entry.kind];
              const isNew = fresh.has(event.id);
              const label = `${entry.who} ${entry.what}`;
              const change = event.change.action;
              const removal = change === 'expense.removed' || change === 'settlement.removed' || change === 'member.removed';

              const restorable =
                (change === 'expense.removed' && snapshot?.expenses.some((item) => item.id === event.target.id && item.status === 'removed')) ||
                (change === 'settlement.removed' && snapshot?.settlements.some((item) => item.id === event.target.id && item.status === 'removed')) ||
                (change === 'member.removed' && snapshot?.members.some((item) => item.id === event.target.id && item.status !== 'active'));

              const reversible = !removal && Boolean(reversibleEffect(event) && snapshot);
              const problem = reversible && snapshot ? undoProblem(snapshot, event, props.replica.activity) : null;

              return (
                <View key={event.id} testID={`activity-${event.id}`} style={[{ gap: 10, paddingVertical: 14, paddingLeft: 12, paddingRight: 16 }, isNew && { backgroundColor: colors.fresh }, index > 0 && s.ruled]}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                    <View aria-hidden style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: tone.background, alignItems: 'center', justifyContent: 'center' }}>
                      {tone.icon(tone.ink)}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text style={{ fontFamily, fontSize: 15, lineHeight: 20, color: colors.ink }}>
                        <Text style={{ fontWeight: '600' }}>{entry.who}</Text> {entry.what}
                      </Text>
                      {entry.detail ? <Text style={{ fontFamily, fontSize: 13, color: colors.muted }}>{entry.detail}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6, paddingTop: 2 }}>
                      <Text style={{ fontFamily, fontSize: 12, color: colors.muted }}>{timeLabel(new Date(event.occurred_at))}</Text>
                      {isNew ? <Text style={{ fontFamily, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.action, color: colors.actionInk }}>New</Text> : null}
                    </View>
                  </View>
                  {reversible && !problem ? (
                    <View style={{ flexDirection: 'row', paddingLeft: 44 }}>
                      <EntryAction icon text="Undo" label={`Undo: ${label}`} disabled={!action.can('undoChange', { eventId: event.id })} onPress={() => { void action.call('undoChange', { eventId: event.id }); }} />
                    </View>
                  ) : null}
                  {restorable ? (
                    <View style={{ flexDirection: 'row', paddingLeft: 44 }}>
                      {change === 'expense.removed' ? <EntryAction icon text="Restore" label="Restore expense" disabled={!action.can('restoreExpense', { expenseId: event.target.id })} onPress={() => { void action.call('restoreExpense', { expenseId: event.target.id }); }} /> : null}
                      {change === 'settlement.removed' ? <EntryAction icon text="Restore" label="Restore repayment" disabled={!action.can('restoreSettlement', { settlementId: event.target.id })} onPress={() => { void action.call('restoreSettlement', { settlementId: event.target.id }); }} /> : null}
                      {change === 'member.removed' ? <EntryAction icon text="Restore" label="Restore member" disabled={!action.can('restoreMember', { memberId: event.target.id })} onPress={() => { void action.call('restoreMember', { memberId: event.target.id }); }} /> : null}
                    </View>
                  ) : null}
                  {problem ? (
                    <View style={{ marginLeft: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.background }}>
                      <InfoIcon color={colors.soft} />
                      <Text style={{ flex: 1, fontFamily, fontSize: 13, lineHeight: 18, color: colors.soft }}>{undoExplanation(problem)}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
