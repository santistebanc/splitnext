export const viewNames = [
  'home',
  'person',
  'settle',
  'create',
  'join',
  'invite',
  'settings',
  'expense',
  'settlements',
  'activity',
  'rejoin',
] as const;

export type ViewName = (typeof viewNames)[number];

type ReadyWorkflow =
  | { view: 'home' | 'person' | 'settle' | 'invite' | 'settlements' | 'activity'; phase: 'ready' }
  | { view: 'create' | 'settings' | 'expense'; phase: 'editing' }
  | { view: 'join'; phase: 'link' }
  | { view: 'join' | 'rejoin'; phase: 'choosing' };

export type Workflow =
  | ReadyWorkflow
  | { view: 'join'; phase: 'checking'; requestId: number }
  | {
      view: ViewName;
      phase: 'creating' | 'joining' | 'saving';
      requestId: number;
      resume: ReadyWorkflow;
    };

export type Submission =
  | 'submitCreate'
  | 'createDirect'
  | 'submitJoin'
  | 'joinDirect'
  | 'saveSettings'
  | 'saveExpense';

export type WorkflowIntent =
  | Submission
  | 'navigate'
  | 'checkInvite'
  | 'createDraft'
  | 'settingsDraft'
  | 'expenseDraft'
  | 'joinLink'
  | 'joinName'
  | 'chooseMember'
  | 'clearPreview'
  | 'groupEditor'
  | 'draft';

export type WorkflowEvent =
  | { type: 'navigate'; view: ViewName; hasPreview: boolean }
  | {
      type: 'edit';
      intent: Exclude<WorkflowIntent, Submission | 'navigate' | 'checkInvite'>;
    }
  | { type: 'check'; requestId: number }
  | { type: 'start'; intent: Submission; requestId: number }
  | { type: 'preview' | 'opened' | 'succeeded' | 'failed'; requestId: number };

export type WorkflowBlocked = { error: string; reason: string };

type Transition =
  { allowed: true; next: Workflow } | ({ allowed: false } & WorkflowBlocked);

const submissionPhases = {
  submitCreate: 'creating',
  createDirect: 'creating',
  submitJoin: 'joining',
  joinDirect: 'joining',
  saveSettings: 'saving',
  saveExpense: 'saving',
} as const;

export function isSubmission(intent: WorkflowIntent | undefined): intent is Submission {
  return intent !== undefined && Object.hasOwn(submissionPhases, intent);
}

export function enterView(view: ViewName, hasPreview = false): ReadyWorkflow {
  switch (view) {
    case 'create':
    case 'settings':
    case 'expense':
      return { view, phase: 'editing' };
    case 'join':
      return { view, phase: hasPreview ? 'choosing' : 'link' };
    case 'rejoin':
      return { view, phase: 'choosing' };
    default:
      return { view, phase: 'ready' };
  }
}

function blocked(error: string, reason: string): Transition {
  return { allowed: false, error, reason };
}

/** Only workflow facts live here; group, input, connection and device guards stay in the catalog. */
export function transition(
  workflow: Workflow,
  event: WorkflowEvent,
): Transition {
  if (
    event.type === 'preview' ||
    event.type === 'opened' ||
    event.type === 'succeeded' ||
    event.type === 'failed'
  ) {
    if (!('requestId' in workflow) || workflow.requestId !== event.requestId)
      return { allowed: true, next: workflow };

    if (workflow.phase === 'checking') {
      if (event.type === 'preview')
        return { allowed: true, next: { view: 'join', phase: 'choosing' } };

      if (event.type === 'opened')
        return { allowed: true, next: enterView('home') };

      if (event.type === 'failed')
        return { allowed: true, next: { view: 'join', phase: 'link' } };
    } else {
      if (event.type === 'succeeded')
        return { allowed: true, next: enterView('home') };

      if (event.type === 'failed')
        return { allowed: true, next: workflow.resume };
    }

    return blocked(
      'workflow_transition_invalid',
      'This request cannot finish this step.',
    );
  }

  if (
    workflow.phase === 'creating' ||
    workflow.phase === 'joining' ||
    workflow.phase === 'saving'
  )
    return blocked('workflow_busy', 'Wait for the current step to finish.');

  if (event.type === 'navigate')
    return { allowed: true, next: enterView(event.view, event.hasPreview) };

  if (event.type === 'edit') {
    const intent = event.intent;

    if (intent === 'joinLink' && workflow.view === 'join')
      return { allowed: true, next: { view: 'join', phase: 'link' } };

    if (
      intent === 'draft' &&
      ['create', 'settings', 'expense', 'join', 'rejoin', 'home', 'person', 'settle', 'invite', 'activity', 'settlements'].includes(workflow.view)
    )
      return { allowed: true, next: workflow };

    if (workflow.phase === 'checking')
      return blocked('workflow_busy', 'Wait for the invite check to finish.');

    if (
      intent === 'clearPreview' &&
      workflow.view === 'join' &&
      workflow.phase === 'choosing'
    )
      return { allowed: true, next: { view: 'join', phase: 'link' } };

    if (intent === 'chooseMember' || intent === 'joinName') {
      if (
        (workflow.view === 'join' || workflow.view === 'rejoin') &&
        workflow.phase === 'choosing'
      )
        return { allowed: true, next: workflow };

      return blocked('join_choice_required', 'Check an invite link first.');
    }

    if (
      (intent === 'createDraft' && workflow.view === 'create') ||
      (intent === 'settingsDraft' && workflow.view === 'settings') ||
      (intent === 'expenseDraft' && workflow.view === 'expense') ||
      (intent === 'groupEditor' && (workflow.view === 'home' || workflow.view === 'person'))
    )
      return { allowed: true, next: workflow };

    return blocked('form_not_open', 'Open the corresponding form first.');
  }

  if (workflow.phase === 'checking')
    return blocked('workflow_busy', 'Wait for the invite check to finish.');

  if (event.type === 'check')
    return {
      allowed: true,
      next: { view: 'join', phase: 'checking', requestId: event.requestId },
    };

  if (event.type === 'start') {
    if (event.intent === 'submitCreate' && workflow.view !== 'create')
      return blocked('form_not_open', 'Open the create form first.');

    if (event.intent === 'saveSettings' && workflow.view !== 'settings')
      return blocked('form_not_open', 'Open settings first.');

    if (event.intent === 'saveExpense' && workflow.view !== 'expense')
      return blocked('form_not_open', 'Open an expense first.');

    if (event.intent === 'submitJoin') {
      if (workflow.view !== 'join' && workflow.view !== 'rejoin')
        return blocked('join_not_open', 'Open the join form first.');

      if (workflow.phase !== 'choosing')
        return blocked('join_choice_required', 'Check an invite link first.');
    }

    // Copy only the workflow, never the draft context held alongside it.
    const resume = enterView(workflow.view, workflow.phase === 'choosing');

    return {
      allowed: true,
      next: {
        view: workflow.view,
        phase: submissionPhases[event.intent],
        requestId: event.requestId,
        resume,
      },
    };
  }

  return blocked(
    'workflow_transition_invalid',
    'This transition is not supported.',
  );
}

/** The same event is evaluated for guards and state/action inspection. */
export function intentEvent(intent: WorkflowIntent): WorkflowEvent {
  switch (intent) {
    case 'navigate':
      return { type: 'navigate', view: 'home', hasPreview: false };
    case 'checkInvite':
      return { type: 'check', requestId: 0 };
    case 'submitCreate':
    case 'createDirect':
    case 'submitJoin':
    case 'joinDirect':
    case 'saveSettings':
    case 'saveExpense':
      return { type: 'start', intent, requestId: 0 };
    default:
      return { type: 'edit', intent };
  }
}

/** Preflight evaluates the same transition as execution, without mutating state. */
export function workflowGuard(workflow: Workflow, intent: WorkflowIntent): WorkflowBlocked | null {
  const result = transition(workflow, intentEvent(intent));

  return result.allowed ? null : { error: result.error, reason: result.reason };
}

/** Immediate workflow effects; navigation destinations depend on the action/input. */
export function workflowEffect(workflow: Workflow, intent: WorkflowIntent) {
  const result = transition(workflow, intentEvent(intent));

  if (!result.allowed) return null;

  return intent === 'navigate' ? { kind: 'navigation' as const } : { kind: 'phase' as const, view: result.next.view, phase: result.next.phase };
}

/** Completion edges come directly from the transition function. */
export function workflowCompletions(workflow: Workflow) {
  if (!('requestId' in workflow)) return [];

  const events = ['preview', 'opened', 'succeeded', 'failed'] as const;

  return events.flatMap((type) => {
    const result = transition(workflow, { type, requestId: workflow.requestId });

    return result.allowed && result.next !== workflow ? [{ event: type, view: result.next.view, phase: result.next.phase }] : [];
  });
}
