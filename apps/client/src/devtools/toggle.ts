/** Remembers on this device whether the devtools panel is switched on. */
export const devtoolsKey = 'splitnext.devtools.v1';

export type DevtoolsSetting = {
  enabled: boolean;
  /** The value to remember on this device, or null to leave it unchanged. */
  remember: '1' | '0' | null;
};

/**
 * `?devtools` (or `?devtools=1`) switches the panel on and `?devtools=0`
 * switches it off; either choice is remembered. Without the parameter the
 * remembered choice applies, defaulting to off.
 */
export function resolveDevtools(
  search: string,
  stored: string | null,
): DevtoolsSetting {
  const value = new URLSearchParams(search).get('devtools');

  if (value === null) return { enabled: stored === '1', remember: null };

  const enabled = !['0', 'off', 'false'].includes(value);

  return { enabled, remember: enabled ? '1' : '0' };
}
