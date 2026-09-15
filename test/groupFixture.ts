import { exports } from 'cloudflare:workers';
import type { Group } from '../src/groupObject';
import type { Member } from '../src/member';

export type CreateGroupResponse = {
  access_token: string;
  group: Group;
  member: Member;
};

export function postGroup(body: {
  name: string;
  currency_label: string;
  device_user_id: string;
  creator_display_name: string;
}) {
  return exports.default.fetch('https://splitnext.test/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function createGroup(
  overrides: Partial<{
    name: string;
    currency_label: string;
    device_user_id: string;
    creator_display_name: string;
  }> = {},
) {
  const body = {
    name: 'Berlin flat',
    currency_label: 'EUR',
    device_user_id: crypto.randomUUID(),
    creator_display_name: 'Santi',
    ...overrides,
  };

  const response = await postGroup(body);

  // SAFETY: This response is produced by the typed POST /groups route under test.
  const created = (await response.json()) as CreateGroupResponse;

  return { body, created, response };
}
