import { activeMembers, joinedParticipants, preferredMember } from '@splitnext/client';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Outcome } from '../model/actions';
import { actionGroups, type ActionGroup } from '../model/actions';
import type { LoggedDispatch, LoggedEvent } from '../model/diagnosticsLog';
import { Button, TextButton, colors, opacities, strokes, textStyle } from '../design';
import { useActions, useUiState } from '../ui/useActionCall';
import { useCompactLayout } from '../ui/useVisibleViewport';
import { ActionForm } from './ActionForm';
import { devtoolsAllowed } from './available';
import { browseActions } from './catalog';
import {
  buildInput,
  formFields,
  initialValues,
  parseSchema,
  type FormValues,
} from './form';
import { resolveDevtools } from './toggle';
import { DevtoolsOverlay } from './DevtoolsOverlay';

type Tab = 'actions' | 'map' | 'log' | 'state';

type Printable = Parameters<typeof JSON.stringify>[0];

/**
 * A development panel inside the app: call any app action against the real
 * group, watch every dispatch from any caller, and inspect the state the
 * action layer sees. Rendered only in builds where devtools are available.
 */
export function Devtools() {
  const enabled = useDevtoolsEnabled();
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // The dispatcher collects from the start, so the log explains what happened before opening.
  const log = useSyncExternalStore(actions.diagnostics.subscribe, actions.diagnostics.snapshot, actions.diagnostics.snapshot);

  if (!enabled) return null;

  return (
    <DevtoolsOverlay close={close}>
      {open ? (
        <DevtoolsPanel log={log.dispatches} diagnostics={log.events} clearLog={actions.diagnostics.clear} close={close} />
      ) : null}
      {!open ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open devtools"
          pointerEvents="auto"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [ds.launcher, pressed && s.dim]}
        >
          <Text style={ds.launcherText}>{'</>'}</Text>
        </Pressable>
      ) : null}
    </DevtoolsOverlay>
  );
}

/**
 * Reads `?devtools` after mounting, off by default.
 * Only when switched on does it ask whether this build may show devtools, so
 * ordinary visits make no extra request.
 */
function useDevtoolsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (resolveDevtools(window.location.search))
      void devtoolsAllowed().then((allowed) => {
        if (mounted) setEnabled(allowed);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return enabled;
}

type PanelProps = {
  log: LoggedDispatch[];
  diagnostics: LoggedEvent[];
  clearLog: () => void;
  close: () => void;
};

function DevtoolsPanel(props: PanelProps) {
  const compact = useCompactLayout();
  const [tab, setTab] = useState<Tab>('actions');

  return (
    <View
      accessibilityLabel="Devtools"
      pointerEvents="auto"
      style={[ds.panel, compact ? ds.panelCompact : ds.panelWide]}
    >
      <View style={ds.header}>
        <View accessibilityRole="tablist" style={ds.tabs}>
          {(['actions', 'map', 'log', 'state'] as const).map((name) => (
            <Pressable
              key={name}
              accessibilityRole="tab"
              aria-selected={tab === name}
              onPress={() => setTab(name)}
              style={[ds.tab, tab === name && ds.tabSelected]}
            >
              <Text style={[ds.tabText, tab === name && ds.tabTextSelected]}>
                {name === 'log'
                  ? `Log · ${props.log.length}`
                  : capitalize(name)}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextButton underline={false} label="Close devtools" onPress={props.close} style={{ paddingHorizontal: 14 }}>
          ×
        </TextButton>
      </View>
      <ScrollView contentContainerStyle={ds.body}>
        {tab === 'actions' ? (
          <ActionsTab />
        ) : tab === 'map' ? (
          <MapTab />
        ) : tab === 'log' ? (
          <LogTab log={props.log} diagnostics={props.diagnostics} clear={props.clearLog} />
        ) : (
          <StateTab />
        )}
      </ScrollView>
    </View>
  );
}

function ActionsTab() {
  const actions = useActions();
  useUiState();
  const described = actions.describe();
  const [group, setGroup] = useState<ActionGroup>(actionGroups[0]);

  const state = actions.state();
  const origin = window.location.origin;

  const [selected, setSelected] = useState(
    () => browseActions(described, { group })[0]?.name ?? '',
  );

  const action = described.find((entry) => entry.name === selected);

  const fields = useMemo(
    () => (action ? formFields(parseSchema(action.inputSchema)) : []),
    [action?.name],
  );

  const [values, setValues] = useState<FormValues>(() =>
    initialValues(fields, state, origin),
  );

  const [outcome, setOutcome] = useState<Outcome<Printable> | null>(null);
  const [running, setRunning] = useState(false);
  const input = buildInput(fields, values);
  const availability = action ? actions.availability(action.name, input) : null;

  const confirmationAvailability =
    outcome?.status === 'needs_confirmation'
      ? actions.availability('confirmAction', {
          requestId: outcome.requestId ?? '',
        })
      : null;

  const shown = browseActions(described, { group });
  const selectedVisible = shown.some((entry) => entry.name === selected);
  const firstShown = shown[0]?.name;

  useEffect(() => {
    if (!selectedVisible && firstShown) choose(firstShown);
  }, [selectedVisible, firstShown]);

  function choose(name: string): void {
    const next = described.find((entry) => entry.name === name);

    setSelected(name);
    setValues(
      next
        ? initialValues(
            formFields(parseSchema(next.inputSchema)),
            state,
            origin,
          )
        : {},
    );
    setOutcome(null);
  }

  async function run(confirmed: boolean): Promise<void> {
    setRunning(true);

    try {
      setOutcome(
        confirmed &&
          outcome?.status === 'needs_confirmation' &&
          outcome.requestId
          ? await actions.dispatch(
              'confirmAction',
              { requestId: outcome.requestId },
              { origin: 'devtools' },
            )
          : await actions.dispatchJson(selected, input, { origin: 'devtools' }),
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={ds.section}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Action groups"
        style={ds.groupTabs}
        contentContainerStyle={ds.groupTabsContent}
      >
        {actionGroups.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            aria-pressed={group === name}
            onPress={() => {
              setGroup(name);

              const first = browseActions(described, {
                group: name,
              })[0];

              if (first) choose(first.name);
            }}
            style={[ds.groupTab, group === name && ds.groupTabSelected]}
          >
            <Text
              style={[
                ds.groupTabText,
                group === name && ds.groupTabTextSelected,
              ]}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={ds.chips}>
        {shown.map((entry) => (
          <Pressable
            key={entry.name}
            accessibilityRole="radio"
            aria-checked={entry.name === selected}
            accessibilityLabel={
              entry.availability.available
                ? entry.name
                : `${entry.name}: ${entry.availability.reason}`
            }
            onPress={() => choose(entry.name)}
            style={[
              ds.chip,
              entry.name === selected && s.chosen,
              !entry.availability.available && ds.unavailable,
            ]}
          >
            <Text style={ds.mono}>{entry.name}</Text>
          </Pressable>
        ))}
      </View>
      {!shown.length ? (
        <Text style={s.caption}>No actions available.</Text>
      ) : null}
      {action && shown.some((entry) => entry.name === action.name) ? (
        <>
          <Text style={s.body}>{action.description}</Text>
          <Text style={s.caption}>
            {[
              action.requires.length
                ? `Requires ${action.requires.join(', ')}`
                : null,
              action.confirms ? 'May ask for confirmation' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'No preconditions'}
          </Text>
          <ActionForm
            fields={fields}
            values={values}
            onChange={(path, value) => {
              setValues((current) => ({ ...current, [path]: value }));
              setOutcome(null);
            }}
            state={state}
            origin={origin}
            example={action.example}
          />
          <Text style={ds.previewLabel}>Sends</Text>
          <Text selectable style={ds.code}>
            {format(input)}
          </Text>
          <Button
            disabled={running || !availability?.available}
            onPress={() => {
              void run(false);
            }}
          >
            {running ? 'Running…' : `Dispatch ${action.name}`}
          </Button>
          {availability && !availability.available ? (
            <Text aria-live="polite" style={s.caption}>
              {availability.reason}
            </Text>
          ) : null}
        </>
      ) : null}
      {outcome?.status === 'needs_confirmation' ? (
        <View style={s.banner}>
          <Text style={s.body}>{outcome.message}</Text>
          <View style={s.row}>
            <TextButton
              onPress={() => {
                if (outcome.requestId)
                  void actions.dispatch(
                    'cancelConfirmation',
                    { requestId: outcome.requestId },
                    { origin: 'devtools' },
                  );
                setOutcome(null);
              }}
            >
              Cancel
            </TextButton>
            <Button
              disabled={running || !confirmationAvailability?.available}
              onPress={() => {
                void run(true);
              }}
            >
              Approve
            </Button>
          </View>
          {confirmationAvailability && !confirmationAvailability.available ? (
            <Text aria-live="polite" style={s.caption}>
              {confirmationAvailability.reason}
            </Text>
          ) : null}
        </View>
      ) : outcome ? (
        <Text
          selectable
          style={[ds.code, outcome.status === 'failed' && ds.failed]}
        >
          {format(outcome)}
        </Text>
      ) : null}
    </View>
  );
}

/** A live map generated by the catalog and workflow evaluator. */
function MapTab() {
  const actions = useActions();
  useUiState();
  const map = actions.stateActionMap();

  return (
    <View style={ds.section}>
      <Text style={s.heading}>State / actions map</Text>
      <Text style={ds.mono}>{map.current.view} / {map.current.phase}</Text>
      {map.completions.map((edge) => (
        <Text key={edge.event} style={s.caption}>{edge.event} → {edge.view} / {edge.phase}</Text>
      ))}
      {map.executions.map((entry) => (
        <View key={entry.id} style={ds.logEntry}>
          <Text style={ds.mono}>Running: {entry.name}</Text>
          <Text style={s.caption}>{entry.origin}{entry.resources.length ? ` · ${entry.resources.join(', ')}` : ''}</Text>
        </View>
      ))}
      {map.actions.map((action) => {
        const effect = action.workflowEffect;
        const inputs = formFields(parseSchema(action.inputSchema)).map((field) => `${field.path}${field.optional ? '?' : ''}`);

        return (
          <View key={action.name} style={ds.logEntry}>
            <Text style={ds.mono}>{action.name}</Text>
            <Text style={s.caption}>{action.description}</Text>
            <Text style={[s.caption, !action.availability.available && ds.failed]}>
              {action.availability.available ? 'Available with valid input' : action.availability.reason}
            </Text>
            <Text style={s.caption}>
              {action.group}{action.requires.length ? ` · Requires ${action.requires.join(', ')}` : ''}
            </Text>
            {effect ? <Text style={s.caption}>{action.workflow} → {effect.kind === 'phase' ? `${effect.view} / ${effect.phase}` : 'navigation destination'}</Text> : null}
            {inputs.length ? <Text style={s.caption}>Input: {inputs.join(', ')}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function LogTab(props: { log: LoggedDispatch[]; diagnostics: LoggedEvent[]; clear: () => void }) {
  return (
    <View style={ds.section}>
      <View style={s.between}>
        <Text style={s.caption}>
          Every dispatch, from clicks, devtools, or navigation.
        </Text>
        {props.log.length || props.diagnostics.length ? (
          <TextButton onPress={props.clear}>Clear</TextButton>
        ) : null}
      </View>
      {props.log.map((entry) => (
        <View key={entry.invocationId} style={ds.logEntry}>
          <Text style={ds.mono}>
            {entry.name}{' '}
            <Text
              style={
                entry.status === 'failed'
                  ? ds.failed
                  : entry.status === 'needs_confirmation'
                    ? ds.pending
                    : ds.done
              }
            >
              {entry.status}
            </Text>
          </Text>
          <Text style={s.caption}>
            {[new Date(entry.time).toLocaleTimeString(), entry.origin, `${entry.durationMs}ms`, entry.detail]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text style={ds.mono}>{entry.invocationId}</Text>
          <Text style={s.caption}>{entry.before.view}/{entry.before.phase} → {entry.after.view}/{entry.after.phase}</Text>
          {entry.parentInvocationId ? <Text style={s.caption}>Confirmed from {entry.parentInvocationId}</Text> : null}
        </View>
      ))}
      {props.diagnostics.length ? <Text style={s.label}>Commands and requests</Text> : null}
      {props.diagnostics.map((event, index) => (
        <View key={index} style={ds.logEntry}>
          <Text style={ds.mono}>{event.kind === 'command_queued' ? `Queued ${event.command_id}` : `${event.operation} ${event.kind} ${event.request_id}`}</Text>
          <Text style={s.caption}>{event.kind === 'command_queued' ? `Action ${event.invocation_id ?? 'background'}${event.retry_of ? `; retry of ${event.retry_of}` : ''}` : `Actions ${event.invocation_ids.join(', ') || 'background'}; commands ${event.command_ids.join(', ') || 'none'}`}</Text>
          {event.kind === 'response' ? <Text style={s.caption}>{event.duration_ms}ms; {event.outcomes.map((outcome) => `${outcome.command_id}: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}`).join('; ') || 'complete'}</Text> : null}
          {event.kind === 'failure' ? <Text style={ds.failed}>{event.error_kind}: {event.error}; {event.duration_ms}ms</Text> : null}
        </View>
      ))}
      {!props.log.length ? (
        <Text style={s.caption}>Nothing dispatched yet.</Text>
      ) : null}
    </View>
  );
}

function StateTab() {
  const ui = useUiState();
  const state = useActions().state();
  const group = state.group;
  const snapshot = group?.projected_snapshot;
  const self = group?.session?.identity.id;

  const you = preferredMember(snapshot, self)?.id;

  return (
    <View style={ds.section}>
      <Text selectable style={ds.code}>
        {format({
          executions: state.executions,
          online: state.online,
          reachable: state.reachable,
          ui: {
            view: ui.view,
            phase: ui.phase,
            requestId: 'requestId' in ui ? ui.requestId : null,
            create: ui.create,
            settings: ui.settings,
            join: {
              name: ui.join.name,
              chosen: ui.join.chosen,
              preview: ui.join.preview,
              hasLink: Boolean(ui.join.link),
            },
            memberEdit: ui.memberEdit,
            showLeftGroups: ui.showLeftGroups,
            trail: ui.trail,
            person: ui.person,
            balancesExpanded: ui.balancesExpanded,
            removal: ui.removal,
            copiedInviteId: ui.copiedInviteId,
            confirmation: ui.confirmation,
          },
          groups: state.groups.map(
            (entry) =>
              `${entry.name} (${entry.status}${entry.pending_commands ? `, ${entry.pending_commands} pending` : ''})`,
          ),
          open: snapshot
            ? {
                id: group.group_id,
                name: snapshot.group.name,
                revision: group.revision,
                left: group.hidden,
                members: activeMembers(snapshot).map(
                    (member) =>
                      `${member.display_name}${member.id === you ? ' (you)' : ''} [${member.id}]`,
                  ),
                participants: joinedParticipants(snapshot).map((grant) => grant.actor_handle),
                outbox: group.outbox.length,
                notices: group.notices.length,
              }
            : null,
        })}
      </Text>
    </View>
  );
}

function format(value: Printable): string {
  return JSON.stringify(value, null, 2);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The app's own text steps and blocks the devtools borrow. */
const s = StyleSheet.create({
  caption: { ...textStyle('caption', 'muted') },
  body: { ...textStyle('body') },
  heading: { ...textStyle('heading') },
  label: { ...textStyle('caption', 'muted'), fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  chosen: { borderWidth: strokes.ink, borderColor: colors.ink },
  dim: { opacity: opacities.disabled },
  banner: { backgroundColor: colors.tint, paddingVertical: 12, paddingHorizontal: 14, borderLeftWidth: strokes.marker, borderColor: colors.alert, gap: 6 },
});

const ds = StyleSheet.create({
  launcher: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  launcherText: { ...textStyle('caption', 'inverse'), fontWeight: '600' },
  panel: {
    position: 'absolute',
    zIndex: 20,
    backgroundColor: colors.background,
    borderColor: colors.rule,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  panelWide: { top: 0, right: 0, bottom: 0, width: 400, borderLeftWidth: 1 },
  panelCompact: {
    left: 0,
    right: 0,
    bottom: 0,
    height: '65%',
    borderTopWidth: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    borderBottomWidth: 1,
    borderColor: colors.rule,
  },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 12 },
  tabSelected: { borderBottomWidth: 2, borderColor: colors.positive },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  tabTextSelected: { color: colors.ink },
  body: { padding: 12 },
  section: { gap: 10 },
  previewLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  groupTabs: { flexGrow: 0, borderBottomWidth: 1, borderColor: colors.rule },
  groupTabsContent: { gap: 8 },
  groupTab: {
    minHeight: 40,
    paddingHorizontal: 6,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderColor: 'transparent',
  },
  groupTabSelected: { borderColor: colors.positive },
  groupTabText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  groupTabTextSelected: { color: colors.positive, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: 4,
  },
  unavailable: { opacity: 0.45 },
  mono: { color: colors.ink, fontSize: 12, fontFamily: 'monospace' },
  code: {
    color: colors.ink,
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: colors.background,
    borderRadius: 4,
    padding: 10,
  },
  failed: { color: colors.danger },
  pending: { color: colors.danger },
  done: { color: colors.positive },
  logEntry: {
    gap: 2,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: colors.rule,
  },
});
