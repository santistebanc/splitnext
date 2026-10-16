import type { InvitePreview } from '@splitnext/client';
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
  'join.link',
  'join.name',
  'member.name',
] as const;

export type DraftField = (typeof draftFields)[number];

export type MemberEdit = {
  memberId: string | null;
  name: string;
  expectedName: string;
};

type UiContext = {
  navigation: { revision: number; mode: 'push' | 'replace' | 'restore' };
  create: { name: string; yourName: string };
  settings: { name: string; expectedName: string };
  join: {
    link: string;
    name: string;
    chosen: string | null;
    preview: InvitePreview | null;
    token: string | null;
  };
  memberEdit: MemberEdit | null;
  showLeftGroups: boolean;
  showNoticeSummary: boolean;
  copiedInviteId: string | null;
  confirmation: { id: string; name: string; message: string } | null;
};

export type UiState = UiContext & Workflow;

function groupIsOpen(app: AppState): boolean {
  return Boolean(app.group?.projected_snapshot && !app.group.hidden);
}

/** Whether the group a view shows is there: panels need it open, rejoining needs it left. */
export function viewFits(view: ViewName, app: AppState): boolean {
  switch (view) {
    case 'settings':
    case 'invite':
      return groupIsOpen(app);
    case 'notices':
      return Boolean(app.group?.projected_snapshot);
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
  private confirmRun: (() => Promise<void>) | null = null;

  constructor(
    private readApp: () => AppState,
    private readName: () => string | null,
    initialLink = '',
  ) {
    const name = readApp().group?.projected_snapshot?.group.name ?? '';
    this.context = {
      navigation: { revision: 0, mode: 'replace' },
      create: { name: '', yourName: readName() ?? '' },
      settings: { name, expectedName: name },
      join: {
        link: initialLink,
        name: readName() ?? '',
        chosen: null,
        preview: null,
        token: null,
      },
      memberEdit: null,
      showLeftGroups: false,
      showNoticeSummary: true,
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
      Pick<UiContext, 'showLeftGroups' | 'showNoticeSummary' | 'copiedInviteId'>
    >,
  ): void {
    this.patch(patch);
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

  show(view: ViewName, mode: UiState['navigation']['mode'] = 'push'): void {
    const patch: Partial<UiContext> = {
      navigation: { revision: this.state.navigation.revision + 1, mode },
      confirmation: null,
      memberEdit: null,
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
   * Leaves a view whose group went away, such as settings for a group left
   * meanwhile in this tab or another, for the groups list in its place. A
   * running step finishes first and is checked again when it fails.
   */
  fitToApp(): void {
    const app = this.readApp();

    if (this.state.memberEdit && !groupIsOpen(app)) this.patch({ memberEdit: null });

    if ('requestId' in this.workflow || viewFits(this.state.view, app)) return;
    this.show('home', 'replace');
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

    this.move(
      { type: 'succeeded', requestId },
      {
        navigation: {
          revision: this.state.navigation.revision + 1,
          mode: 'push',
        },
        memberEdit: null,
        confirmation: null,
      },
    );
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
