import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { reversibleEffect, undoProblem, undoExplanation, type ClientReplicaState } from '@splitnext/client';
import { describeActivity, newActivity, visibleActivity } from '../model/activity';
import { reviewDetail, reviewTitle } from '../model/notices';
import { BackHeader } from './BackHeader';
import { EmptyState, ErrorMessage, Notice, SectionHeading, Tag, colors, s } from './components';
import { InfoIcon } from './icons';
import type { MemberListApp } from './MemberList';
import { StickyTop } from './StickyTop';
import { fontFamily, monoFamily } from './theme';
import { dayLabel, timeLabel } from './relativeTime';
import { useActionCall, useUiState } from './useActionCall';

type Event = ClientReplicaState['activity'][number];

/** Activity's header: back to the group and the title. */
export function ActivityHeader(props: { app: MemberListApp }) {
  const name = props.app.snapshot().group?.projected_snapshot?.group.name ?? '';

  return (
    <BackHeader
      context={name}
      title="Activity"
      morph="activity"
      scrollRule={false}
    />
  );
}

/**
 * A compact action at the end of an entry, outlined unless it is the entry's
 * main one. Its touch area reaches past its edge to a full target.
 */
function EntryAction(props: { text: string; label: string; disabled: boolean; onPress: () => void; primary?: boolean; icon?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={props.onPress}
      style={({ pressed }) => [
        { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.ink, backgroundColor: props.primary ? colors.action : 'transparent' },
        pressed && !props.disabled && s.pressed,
        props.disabled && (props.primary ? s.busyButton : s.dim),
      ]}
    >
      <Text style={{ fontFamily, fontSize: 13, fontWeight: '600', color: props.primary ? (props.disabled ? colors.actionBusyInk : colors.actionInk) : colors.ink }}>
        {props.text}
      </Text>
    </Pressable>
  );
}

/**
 * A section's title, such as Today: it stays at the top of the page while its
 * entries scroll under it, until the next section's title takes its place.
 */
function DayHeading(props: { title: string; color?: string }) {
  const [pinned, setPinned] = useState(false);

  return (
    <StickyTop onPinnedChange={setPinned}>
      <View style={{ paddingTop: 8, paddingBottom: 4, backgroundColor: colors.background, boxShadow: pinned ? '0 1px 0 rgba(20, 20, 19, 0.14)' : 'none' }}>
        <SectionHeading title={props.title} {...(props.color !== undefined && { color: props.color })} />
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
      <DayHeading color={colors.owes} title={`Needs your review · ${notices.length}`} />
      <View style={s.listCard}>
        {notices.map((notice) => {
          const commandId = notice.command.command_id;

          return (
            <View key={commandId} style={[{ gap: 10, paddingVertical: 14, paddingLeft: 16 }, s.ruled, { borderLeftWidth: 4, borderLeftColor: colors.alert }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={{ fontFamily, fontSize: 15, lineHeight: 20, color: colors.ink }}>
                    <Text style={{ fontWeight: '600' }}>{reviewTitle(notice)}</Text> wasn’t applied
                  </Text>
                  <Text style={{ fontFamily, fontSize: 13, lineHeight: 19, color: colors.soft }}>{reviewDetail(notice)}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
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
  const markSeen = useActionCall();
  // Visiting Activity sees everything in it, but what was new on arrival keeps
  // its new tag for the visit; so does whatever arrives while it is open.
  const seen = useUiState().activitySeen[props.replica.group_id];
  const [seenOnArrival] = useState(seen);
  const snapshot = props.replica.projected_snapshot;
  const events = visibleActivity(props.replica.activity).toReversed();
  const fresh = new Set(newActivity(props.replica, seenOnArrival).map((event) => event.id));
  useEffect(() => { void load.call('refreshActivity', {}); }, [props.replica.group_id, props.replica.revision]);
  useEffect(() => {
    if (markSeen.can('markActivitySeen')) void markSeen.call('markActivitySeen', {});
  }, [props.replica.group_id, props.replica.activity.length]);

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
        <EmptyState
          title="Nothing here yet"
          text="Changes people make in this group show up here."
        />
      ) : null}
      <ErrorMessage message={load.error ?? action.error} />
      {days.map((day) => (
        <View key={day.label} style={{ paddingBottom: 8 }}>
          <DayHeading title={day.label} />
          <View style={s.listCard}>
            {day.events.map((event) => {
              const entry = describeActivity(event, props.replica);
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
                <View key={event.id} testID={`activity-${event.id}`} style={[{ flexDirection: 'row', gap: 12, paddingVertical: 14 }, s.ruled]}>
                  <View aria-hidden style={{ width: 4, backgroundColor: isNew ? colors.alert : 'transparent' }} />
                  <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                      <Text style={{ fontFamily, fontSize: 16, lineHeight: 21, color: colors.ink }}>
                        <Text style={{ fontWeight: '700' }}>{entry.who}</Text> {entry.what}
                      </Text>
                      {entry.detail ? <Text style={{ fontFamily: monoFamily, fontSize: 13, fontWeight: '500', color: colors.muted }}>{entry.detail}</Text> : null}
                    </View>
                    {/* The time, then whether it is new, then Undo or Restore, in one column at the end. */}
                    <View style={{ alignItems: 'flex-end', gap: 8, paddingTop: 2 }}>
                      <Text style={{ fontFamily, fontSize: 12, color: colors.muted }}>{timeLabel(new Date(event.occurred_at))}</Text>
                      {isNew ? <Tag tone="warning">new</Tag> : null}
                      {reversible && !problem ? (
                        <EntryAction icon text="Undo" label={`Undo: ${label}`} disabled={!action.can('undoChange', { eventId: event.id })} onPress={() => { void action.call('undoChange', { eventId: event.id }); }} />
                      ) : null}
                      {restorable && change === 'expense.removed' ? <EntryAction icon text="Restore" label="Restore expense" disabled={!action.can('restoreExpense', { expenseId: event.target.id })} onPress={() => { void action.call('restoreExpense', { expenseId: event.target.id }); }} /> : null}
                      {restorable && change === 'settlement.removed' ? <EntryAction icon text="Restore" label="Restore repayment" disabled={!action.can('restoreSettlement', { settlementId: event.target.id })} onPress={() => { void action.call('restoreSettlement', { settlementId: event.target.id }); }} /> : null}
                      {restorable && change === 'member.removed' ? <EntryAction icon text="Restore" label="Restore member" disabled={!action.can('restoreMember', { memberId: event.target.id })} onPress={() => { void action.call('restoreMember', { memberId: event.target.id }); }} /> : null}
                    </View>
                  </View>
                  {/* A later change simply leaves no Undo; only other reasons are explained. */}
                  {problem && problem !== 'undo_changed' ? <Notice tone="info" icon={<InfoIcon color={colors.soft} />} message={undoExplanation(problem)} /> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
