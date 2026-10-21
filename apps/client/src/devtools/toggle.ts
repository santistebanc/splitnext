/**
 * `?devtools` (or `?devtools=1`) switches the panel on for this visit;
 * without it, or with `?devtools=0`, the panel stays off.
 */
export function resolveDevtools(search: string): boolean {
  const value = new URLSearchParams(search).get('devtools');

  return value !== null && !['0', 'off', 'false'].includes(value);
}
