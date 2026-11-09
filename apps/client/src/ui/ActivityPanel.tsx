import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { reversibleEffect, undoProblem, type ClientReplicaState } from '@splitnext/client';
import { Button, EmptyState, ErrorMessage, Row, SectionHeading, Stack, Tag, Text, colors, fonts, hairlineShadow, rules, strokes } from '../design';
import { activityTarget, describeActivity, newActivity, visibleActivity } from '../model/activity';
import { reviewDetail, reviewTitle } from '../model/notices';
import { BackHeader } from './BackHeader';
import type { MemberListApp } from './MemberList';
import { StickyTop } from './StickyTop';
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

/** A compact action at the end of an entry, outlined unless it is the entry's main one. */
function EntryAction(props: { text: string; label: string; disabled: boolean; onPress: () => void; primary?: boolean }) {
  return (
    <Button size="compact" variant={props.primary ? 'primary' : 'secondary'} label={props.label} disabled={props.disabled} onPress={props.onPress}>
      {props.text}
    </Button>
  );
}

/** The mark at an entry's start: orange while it is new or needs review, room for one otherwise. */
function EntryMarker(props: { on: boolean }) {
  return <View aria-hidden style={{ width: strokes.marker, backgroundColor: props.on ? colors.alert : 'transparent' }} />;
}

/**
 * A section's title, such as Today: it stays at the top of the page while its
 * entries scroll under it, until the next section's title takes its place.
 */
function DayHeading(props: { title: string; color?: string }) {
  const [pinned, setPinned] = useState(false);

  return (
    <StickyTop onPinnedChange={setPinned}>
      <View style={{ paddingTop: 8, paddingBottom: 4, backgroundColor: colors.background, boxShadow: hairlineShadow(pinned ? 1 : 0) }}>
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
      <DayHeading color={colors.danger} title={`Needs your review · ${notices.length}`} />
      <View style={rules.below}>
        {notices.map((notice) => {
          const commandId = notice.command.command_id;

          return (
            <Row key={commandId} gap={12} paddingY={12} align="stretch" style={rules.above}>
              <EntryMarker on />
              <Stack fill gap={12}>
                <Stack gap={4}>
                  <Text variant="body">
                    <Text weight="semibold">{reviewTitle(notice)}</Text> wasn’t applied
                  </Text>
                  <Text variant="caption" tone="muted">{reviewDetail(notice)}</Text>
                </Stack>
                <Row gap={8} justify="end">
                  <EntryAction primary text="Apply again" label="Apply again" disabled={!action.can('retryNotice', { commandId })} onPress={() => act(commandId, 'retryNotice')} />
                  <EntryAction text="Dismiss" label="Dismiss" disabled={!action.can('dismissNotice', { commandId })} onPress={() => act(commandId, 'dismissNotice')} />
                </Row>
                {target === commandId ? <ErrorMessage message={action.error} /> : null}
              </Stack>
            </Row>
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
    <Stack gap={8} paddingBottom={32}>
      <NeedsReview replica={props.replica} />
      {load.busy && !events.length ? <Text role="status" variant="caption" tone="muted">Loading Activity…</Text> : null}
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
          <View style={rules.below}>
            {day.events.map((event) => {
              const entry = describeActivity(event, props.replica);
              const isNew = fresh.has(event.id);
              const target = activityTarget(event);
              const label = `${entry.who} ${entry.what}`;
              const change = event.change.action;
              const removal = change === 'expense.removed' || change === 'settlement.removed' || change === 'member.removed';

              const restorable =
                (change === 'expense.removed' && snapshot?.expenses.some((item) => item.id === event.target.id && item.status === 'removed')) ||
                (change === 'settlement.removed' && snapshot?.settlements.some((item) => item.id === event.target.id && item.status === 'removed')) ||
                (change === 'member.removed' && snapshot?.members.some((item) => item.id === event.target.id && item.status !== 'active'));

              const reversible = !removal && Boolean(reversibleEffect(event) && snapshot);
              const problem = reversible && snapshot ? undoProblem(snapshot, event, props.replica.activity) : null;
              const undoable = reversible && !problem;
              const opens = Boolean(target && action.can(target.name, target.input));
              const last = entry.whatSegments.at(-1);
              const linked = opens && last?.reference ? last : null;
              const words = linked ? entry.whatSegments.slice(0, -1) : entry.whatSegments;
              const open = () => { if (target) void action.call(target.name, target.input); };

              return (
                <Row key={event.id} testID={`activity-${event.id}`} gap={12} paddingY={12} align="stretch" style={rules.above}>
                  <EntryMarker on={isNew} />
                  <Row fill gap={12} align="start">
                    <Stack fill gap={8}>
                      <Text variant="body">
                        <Text weight="bold">{entry.who}</Text> {words.map((part, index) => <Text key={index} weight={part.reference ? 'semibold' : undefined}>{part.text}</Text>)}
                        {/*
                          * The name the entry ends on, and the arrow after it, open what it names.
                          * The arrow is the button; the name stays plain text so it wraps like the rest of the line.
                          */}
                        {opens && target ? (
                          <Text weight={linked ? 'semibold' : undefined} onPress={open} style={{ cursor: 'pointer' }}>
                            {linked ? <Text>{linked.text}</Text> : null}
                            {/* A no-break space keeps the arrow on the name's last line. */}
                            {' '}
                            <Text accessibilityRole="button" accessibilityLabel={target.label + ': ' + label} onPress={open} weight="regular">→</Text>
                          </Text>
                        ) : null}
                      </Text>
                      {entry.detail ? (
                        <Text variant="figureSmall" tone="muted">
                          {/* What the change named, such as an expense, reads as a name rather than a figure. */}
                          {entry.detailSegments.map((part, index) => part.reference ? <Text key={index} tone="ink" weight="semibold" style={{ fontFamily: fonts.body }}>{part.text}</Text> : <Text key={index}>{part.text}</Text>)}
                        </Text>
                      ) : null}
                    </Stack>
                    {/* The time, then whether it is new, then Undo or Restore. */}
                    <Stack gap={8} align="end" paddingTop={2}>
                      <Text variant="meta" tone="muted" weight="regular">{timeLabel(new Date(event.occurred_at))}</Text>
                      {isNew ? <Tag tone="warning">new</Tag> : null}
                      {undoable || restorable ? (
                        <Row gap={8} align="center">
                          {undoable ? (
                            <EntryAction text="Undo" label={`Undo: ${label}`} disabled={!action.can('undoChange', { eventId: event.id })} onPress={() => { void action.call('undoChange', { eventId: event.id }); }} />
                          ) : null}
                          {restorable && change === 'expense.removed' ? <EntryAction text="Restore" label="Restore expense" disabled={!action.can('restoreExpense', { expenseId: event.target.id })} onPress={() => { void action.call('restoreExpense', { expenseId: event.target.id }); }} /> : null}
                          {restorable && change === 'settlement.removed' ? <EntryAction text="Restore" label="Restore repayment" disabled={!action.can('restoreSettlement', { settlementId: event.target.id })} onPress={() => { void action.call('restoreSettlement', { settlementId: event.target.id }); }} /> : null}
                          {restorable && change === 'member.removed' ? <EntryAction text="Restore" label="Restore member" disabled={!action.can('restoreMember', { memberId: event.target.id })} onPress={() => { void action.call('restoreMember', { memberId: event.target.id }); }} /> : null}
                        </Row>
                      ) : null}
                    </Stack>
                  </Row>
                </Row>
              );
            })}
          </View>
        </View>
      ))}
    </Stack>
  );
}
