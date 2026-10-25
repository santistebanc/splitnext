import { repaymentMembers, type InvitePreview } from '@splitnext/client';
import { draftForExpense, type ExpenseDraft } from './expenses';
import type { AppState } from './controller';
import {
  enterView,
  transition,
  type Workflow,
  type WorkflowEvent,
  type Submission,
  type ViewName,
} from './workflow';

export { viewNames, type ViewName } from './workflow';

export const draftFields = [
  'create.name',
  'create.yourName',
  'settings.name',
  'expense.description',
  'expense.amount',
  'expense.currency',
  'join.link',
  'join.name',
  'member.name',
  'repayment.amount',
  'repayment.currency',
] as const;

/** The group screen and the views that open over it, each returning to the view below. */
export const groupViews = ['home', 'person', 'settle', 'invite', 'settings', 'expense', 'settlements', 'activity'] as const satisfies readonly ViewName[];

export type GroupView = (typeof groupViews)[number];

export function isGroupView(view: ViewName): view is GroupView {
  return groupViews.some((entry) => entry === view);
}

export type DraftField = (typeof draftFields)[number];

export type MemberEdit = {
  memberId: string | null;
  name: string;
  expectedName: string;
};

/** A member just taken out of the group: hidden when expenses or repayments name them, removed otherwise. */
export type Removal = { id: number; memberId: string; name: string; hidden: boolean };

/** Where this installation keeps how far it has seen each group’s Activity. */
export type SeenStorage = {
  read(): Record<string, number>;
  write(seen: Record<string, number>): void;
};

type UiContext = {
  /** The group views below the current one, which Back and Cancel return to in turn. */
  trail: GroupView[];
  /** The member whose details or settle-up plan is open. */
  person: string | null;
  /** Whether the balances panel above the expenses is expanded. */
  balancesExpanded: boolean;
  /** The last Activity sequence marked seen in each group on this installation. */
  activitySeen: Record<string, number>;
  removal: Removal | null;
  navigation: { revision: number; mode: 'push' | 'replace' | 'restore' };
  create: { name: string; yourName: string };
  settings: { name: string; expectedName: string };
  expense: ExpenseDraft;
  repayment: { from: string; to: string; amount: string; currency: string; settlementId: string | null; expectedVersion: number | null; manual: boolean };
  join: {
    link: string;
    name: string;
    chosen: string | null;
    preview: InvitePreview | null;
    token: string | null;
  };
  memberEdit: MemberEdit | null;
  showLeftGroups: boolean;
  copiedInviteId: string | null;
  confirmation: { id: string; name: string; message: string } | null;
};

export type UiState = UiContext & Workflow;

function groupIsOpen(app: AppState): boolean {
  return Boolean(app.group?.projected_snapshot && !app.group.hidden);
}

/** Whether a member has details to show: current, or removed while their balances are still open. */
export function personFits(app: AppState, memberId: string | null | undefined): boolean {
  return Boolean(memberId && groupIsOpen(app) && repaymentMembers(app.group?.projected_snapshot).some((member) => member.id === memberId));
}

/** Whether the group a view shows is there: panels need it open, rejoining needs it left. */
export function viewFits(view: ViewName, app: AppState, person: string | null = null): boolean {
  switch (view) {
    case 'person':
    case 'settle':
      return personFits(app, person);
    case 'settings':
    case 'expense':
    case 'settlements':
    case 'activity':
    case 'invite':
      return groupIsOpen(app);
    case 'rejoin':
      return Boolean(app.group?.hidden);
    default:
      return true;
  }
}

/** Local screen state shared by every action caller, independent of replicas. */
export class AppUiState {
  private state: UiState;
  private context: UiContext;
  private workflow: Workflow;
  private listeners = new Set<() => void>();
  private confirmationSequence = 0;
  private requestSequence = 0;
  private removalSequence = 0;
  private confirmRun: (() => Promise<void>) | null = null;

  constructor(
    private readApp: () => AppState,
    private readName: () => string | null,
    initialLink = '',
    private seenStorage: SeenStorage | null = null,
  ) {
    const name = readApp().group?.projected_snapshot?.group.name ?? '';
    this.context = {
      trail: [],
      person: null,
      balancesExpanded: false,
      activitySeen: seenStorage?.read() ?? {},
      removal: null,
      navigation: { revision: 0, mode: 'replace' },
      create: { name: '', yourName: readName() ?? '' },
      settings: { name, expectedName: name },
      expense: draftForExpense(null, null, 'EUR'),
      repayment: { from: '', to: '', amount: '', currency: 'EUR', settlementId: null, expectedVersion: null, manual: false },
      join: {
        link: initialLink,
        name: readName() ?? '',
        chosen: null,
        preview: null,
        token: null,
      },
      memberEdit: null,
      showLeftGroups: false,
      copiedInviteId: null,
      confirmation: null,
    };
    this.workflow = enterView(initialLink ? 'join' : 'home');
    this.state = { ...this.context, ...this.workflow };
  }

  snapshot = (): UiState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  private patch(patch: Partial<UiContext>): void {
    this.context = { ...this.context, ...patch };
    this.state = { ...this.context, ...this.workflow };

    for (const listener of this.listeners) listener();
  }

  update(
    patch: Partial<
      Pick<UiContext, 'showLeftGroups' | 'copiedInviteId' | 'balancesExpanded' | 'removal'>
    >,
  ): void {
    this.patch(patch);
  }

  /** Marks a group's Activity seen up to a sequence; later items from others count as new. */
  markActivitySeen(groupId: string, sequence: number): void {
    if ((this.state.activitySeen[groupId] ?? -1) >= sequence) return;
    const activitySeen = { ...this.state.activitySeen, [groupId]: sequence };

    this.seenStorage?.write(activitySeen);
    this.patch({ activitySeen });
  }

  /** Remembers a member removed here for the brief removal notification. */
  removed(memberId: string, name: string, hidden: boolean): void {
    this.patch({ removal: { id: ++this.removalSequence, memberId, name, hidden } });
  }

  private move(event: WorkflowEvent, patch: Partial<UiContext> = {}): boolean {
    const result = transition(this.workflow, event);

    if (!result.allowed) throw new Error(result.error);

    if (result.next === this.workflow && Object.keys(patch).length === 0)
      return false;
    this.workflow = result.next;
    this.patch(patch);

    return true;
  }

  /**
   * The views below a view opened from the current one. Opening the group
   * screen or a view already below returns to it; anything else stacks on top.
   */
  private trailTo(view: ViewName): GroupView[] {
    const current = this.state.view;

    if (!isGroupView(view) || view === 'home' || !isGroupView(current)) return [];

    const below = this.state.trail.indexOf(view);

    if (below >= 0) return this.state.trail.slice(0, below);

    if (current === view) return this.state.trail;

    // The invite sheet sits over the group screen; whatever opens from it does too.
    return current === 'invite' ? this.state.trail : [...this.state.trail, current];
  }

  show(view: ViewName, mode: UiState['navigation']['mode'] = 'push', options: { person?: string | null; trail?: GroupView[] } = {}): void {
    const patch: Partial<UiContext> = {
      navigation: { revision: this.state.navigation.revision + 1, mode },
      confirmation: null,
      memberEdit: null,
      trail: options.trail ?? this.trailTo(view),
      person: options.person !== undefined ? options.person : view === 'home' ? null : this.state.person,
    };

    if (view === 'create')
      patch.create = { name: '', yourName: this.readName() ?? '' };

    if (view === 'settings') {
      const name = this.readApp().group?.projected_snapshot?.group.name ?? '';
      patch.settings = { name, expectedName: name };
    }

    this.move(
      { type: 'navigate', view, hasPreview: Boolean(this.state.join.preview) },
      patch,
    );
    this.confirmRun = null;
  }

  /** Returns to the view below the current one, or the group screen when it no longer fits. */
  back(mode: UiState['navigation']['mode'] = 'push'): void {
    const trail = [...this.state.trail];
    const target = trail.pop() ?? 'home';

    if (viewFits(target, this.readApp(), this.state.person)) this.show(target, mode, { trail });
    else this.show('home', mode);
  }

  /** Opens the expense editor on a new expense, or on one to change. */
  showExpense(expenseId: string | null, currency: string): void {
    const snapshot = this.readApp().group?.projected_snapshot ?? null;
    const expense = snapshot?.expenses.find((entry) => entry.id === expenseId && entry.status === 'active') ?? null;

    if (expenseId && !expense) throw new Error('expense_not_found');
    this.move(
      { type: 'navigate', view: 'expense', hasPreview: false },
      {
        navigation: { revision: this.state.navigation.revision + 1, mode: 'push' },
        confirmation: null,
        memberEdit: null,
        trail: this.trailTo('expense'),
        expense: draftForExpense(snapshot, expense, currency, this.readApp().group?.session?.identity.id),
      },
    );
    this.confirmRun = null;
  }

  /** Changes how the open expense is paid or split, without saving it. */
  changeExpense(change: (draft: ExpenseDraft) => Partial<ExpenseDraft>): void {
    this.move({ type: 'edit', intent: 'expenseDraft' });
    this.patch({ expense: { ...this.state.expense, ...change(this.state.expense) } });
  }

  changeRepayment(patch: Partial<UiContext['repayment']>): void {
    this.move({ type: 'edit', intent: 'draft' });
    this.patch({ repayment: { ...this.state.repayment, ...patch } });
  }

  showJoin(link = '', rejoining = false): void {
    this.move(
      {
        type: 'navigate',
        view: rejoining ? 'rejoin' : 'join',
        hasPreview: false,
      },
      {
        navigation: {
          revision: this.state.navigation.revision + 1,
          mode: 'push',
        },
        confirmation: null,
        memberEdit: null,
        trail: [],
        person: null,
        join: {
          link,
          name: this.readName() ?? '',
          chosen: null,
          preview: null,
          token: null,
        },
      },
    );
    this.confirmRun = null;
  }

  /**
   * Shows a view once a step that took a while has finished, unless the
   * person moved on since `revision` or another step running now will
   * decide the view.
   */
  showAfter(revision: number, view: ViewName): void {
    if (this.state.navigation.revision === revision && !('requestId' in this.workflow)) this.show(view);
  }

  /**
   * Leaves a view whose group or person went away, such as settings for a
   * group left meanwhile in this tab or another, for the view below it. A
   * running step finishes first and is checked again when it fails.
   */
  fitToApp(): void {
    const app = this.readApp();

    if (this.state.memberEdit && !groupIsOpen(app)) this.patch({ memberEdit: null });

    if ('requestId' in this.workflow || viewFits(this.state.view, app, this.state.person)) return;

    if (groupIsOpen(app) && isGroupView(this.state.view)) this.back('replace');
    else this.show('home', 'replace');
  }

  changeDraft(field: DraftField, value: string): void {
    switch (field) {
      case 'create.name':
        this.move({ type: 'edit', intent: 'createDraft' });
        this.patch({ create: { ...this.state.create, name: value } });
        break;
      case 'create.yourName':
        this.move({ type: 'edit', intent: 'createDraft' });
        this.patch({ create: { ...this.state.create, yourName: value } });
        break;
      case 'settings.name':
        this.move({ type: 'edit', intent: 'settingsDraft' });
        this.patch({ settings: { ...this.state.settings, name: value } });
        break;
      case 'expense.description':
        this.changeExpense(() => ({ description: value }));
        break;
      case 'expense.amount':
        this.changeExpense(() => ({ amount: value }));
        break;
      case 'expense.currency':
        this.changeExpense(() => ({ currency: value.trim().toUpperCase() }));
        break;
      case 'repayment.amount':
        this.changeRepayment({ amount: value });
        break;
      case 'repayment.currency':
        this.changeRepayment({ currency: value.trim().toUpperCase() });
        break;
      case 'join.name':
        this.move({ type: 'edit', intent: 'joinName' });
        this.patch({ join: { ...this.state.join, name: value } });
        break;
      case 'join.link':
        this.move(
          { type: 'edit', intent: 'joinLink' },
          {
            join: {
              ...this.state.join,
              link: value,
              chosen: null,
              preview: null,
              token: null,
            },
          },
        );
        break;
      case 'member.name': {
        if (!this.state.memberEdit) throw new Error('no_member_edit');
        this.move({ type: 'edit', intent: 'groupEditor' });
        this.patch({ memberEdit: { ...this.state.memberEdit, name: value } });
        break;
      }
    }
  }

  beginMemberEdit(memberId: string | null): void {
    this.move({ type: 'edit', intent: 'groupEditor' });

    const member = this.readApp().group?.projected_snapshot?.members.find(
      (entry) => entry.id === memberId && entry.status === 'active',
    );

    if (memberId && !member) throw new Error('member_not_found');
    this.patch({
      memberEdit: {
        memberId,
        name: member?.display_name ?? '',
        expectedName: member?.display_name ?? '',
      },
    });
  }

  finishMemberEdit(edit?: MemberEdit): void {
    if (!edit || this.state.memberEdit === edit)
      this.patch({ memberEdit: null });
  }

  startInviteCheck(link: string): number {
    if (this.state.view !== 'join') this.showJoin(link);
    else if (this.state.join.link !== link) this.changeDraft('join.link', link);

    const requestId = ++this.requestSequence;
    this.move(
      { type: 'check', requestId },
      {
        join: { ...this.state.join, preview: null, token: null, chosen: null },
      },
    );

    return requestId;
  }

  inviteCheckIsCurrent(check: number): boolean {
    return this.state.phase === 'checking' && this.state.requestId === check;
  }

  clearInvitePreview(): void {
    this.move(
      { type: 'edit', intent: 'clearPreview' },
      {
        join: { ...this.state.join, preview: null, token: null, chosen: null },
      },
    );
  }

  checkedInvite(
    link: string,
    token: string,
    preview: InvitePreview,
    check: number,
  ): void {
    if (!this.inviteCheckIsCurrent(check)) return;
    this.move(
      { type: 'preview', requestId: check },
      {
        join: { ...this.state.join, link, preview, token, chosen: null },
      },
    );
  }

  chooseJoinMember(chosen: string): void {
    this.move({ type: 'edit', intent: 'chooseMember' });
    this.patch({ join: { ...this.state.join, chosen } });
  }

  failedInvite(check: number): void {
    this.move({ type: 'failed', requestId: check });
  }

  openedInvite(check: number): void {
    if (this.inviteCheckIsCurrent(check))
      this.move(
        { type: 'opened', requestId: check },
        {
          navigation: {
            revision: this.state.navigation.revision + 1,
            mode: 'push',
          },
          memberEdit: null,
          trail: [],
          person: null,
        },
      );
  }

  async perform<T>(intent: Submission, work: () => Promise<T>): Promise<T> {
    const requestId = ++this.requestSequence;
    this.move({ type: 'start', intent, requestId });
    let result: T;

    try {
      result = await work();
    } catch (cause) {
      this.move({ type: 'failed', requestId });
      this.fitToApp();
      throw cause;
    }

    // Saving a form returns to the view it was opened from; creating or
    // joining opens the group screen.
    const returns = intent === 'saveSettings' || intent === 'saveExpense';
    const trail = returns ? [...this.state.trail] : [];
    const target = trail.pop() ?? 'home';

    this.move(
      { type: 'succeeded', requestId },
      {
        navigation: {
          revision: this.state.navigation.revision + 1,
          mode: 'push',
        },
        memberEdit: null,
        confirmation: null,
        trail: [],
        person: returns ? this.state.person : null,
      },
    );

    if (target !== 'home') {
      if (viewFits(target, this.readApp(), this.state.person)) this.show(target, 'replace', { trail });
      else this.show('home', 'replace');
    }

    this.confirmRun = null;

    return result;
  }

  requestConfirmation(
    name: string,
    message: string,
    run: () => Promise<void>,
  ): string {
    const id = `confirmation-${++this.confirmationSequence}`;
    this.confirmRun = run;
    this.patch({ confirmation: { id, name, message } });

    return id;
  }

  cancelConfirmation(requestId: string): void {
    if (this.state.confirmation?.id !== requestId)
      throw new Error('confirmation_not_found');
    this.confirmRun = null;
    this.patch({ confirmation: null });
  }

  async confirm(requestId: string): Promise<void> {
    if (this.state.confirmation?.id !== requestId || !this.confirmRun)
      throw new Error('confirmation_not_found');
    const run = this.confirmRun;
    this.cancelConfirmation(requestId);

    return run();
  }
}
