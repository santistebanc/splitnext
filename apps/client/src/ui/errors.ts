import { useRef, useState } from 'react';

/** Runs one async step at a time, with its progress and its failure as a message. */
export function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    if (running.current) return;

    running.current = true;

    setBusy(true);
    setError(null);

    try {
      await action();
    } catch (cause) {
      const error =
        cause instanceof Error ? cause : new Error('request_failed');

      setError(errorMessage(error));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, error, run };
}

export function errorMessage(error: Error): string {
  switch (error.message) {
    case 'client_offline':
      return 'You’re offline. Connect to finish this step. Nothing you typed was lost.';
    case 'group_unavailable_offline':
      return 'This group is not saved on this device yet. Go online to open it.';
    case 'invite_invalid':
    case 'invite_required':
      return 'This invitation is not valid. Ask someone in the group for a new link.';
    case 'invite_replaced':
      return 'This invitation has been replaced. Ask for the current link.';
    case 'unauthorized':
      return 'This installation can no longer connect. Ask for an invite on a new installation.';
    case 'member_removed':
      return 'That member has been removed. Choose another member or add a new name.';
    case 'storage_unavailable':
      return 'Changes could not be saved on this device. Free some storage and try again.';
    case 'invalid_response':
    case 'invalid_json_response':
      return 'The server returned an unreadable reply. Your saved changes are retained. Try again.';
    case 'confirmation_context_changed':
      return 'The selected group changed. Request confirmation again.';
    case 'corrupt_document':
      return 'The saved data on this device could not be read. It has been kept intact.';
    case 'upgrade_requires_connection':
      return 'Connect once to update your saved groups. Your entries are still here.';
    case 'invalid_input':
      return 'Check what you entered and try again.';
    case 'workflow_busy':
      return 'Please wait for the current step to finish.';
    case 'no_open_group':
      return 'Open a group first.';
    default:
      return 'We could not finish that. Your entries are still here. Check your connection and try again.';
  }
}
