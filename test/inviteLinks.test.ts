import { describe, expect, it } from 'vitest';
import { createIdentifier } from '../src/domain/ids';
import { createInviteToken, formatInviteLink, inviteTokenSchema, parseInviteLink } from '../src/domain/invites';

/**
 * New invite links carry only a 12-character code after `#`; links made
 * before keep their group id and 43-character token and still work (ADR 0024).
 */

const legacyToken = 'a'.repeat(43);

describe('invite links', () => {
  it('creates short codes of letters and digits', () => {
    const codes = Array.from({ length: 200 }, createInviteToken);

    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(codes.join('')).size).toBeGreaterThan(50);
  });

  it('puts a code alone in a short link and reads it back without a group', () => {
    const code = createInviteToken();
    const link = formatInviteLink('https://splitnext.app/', createIdentifier(), code);

    expect(link).toBe(`https://splitnext.app/j#${code}`);
    expect(parseInviteLink(link)).toEqual({ group_id: null, token: code });
    expect(parseInviteLink(`https://splitnext.app/j/#${code}`)).toEqual({ group_id: null, token: code });
  });

  it('keeps links made with earlier tokens working', () => {
    const groupId = createIdentifier();
    const link = formatInviteLink('https://splitnext.app', groupId, legacyToken);

    expect(inviteTokenSchema.safeParse(legacyToken).success).toBe(true);
    expect(link).toBe(`https://splitnext.app/join/${groupId}#${legacyToken}`);
    expect(parseInviteLink(link)).toEqual({ group_id: groupId, token: legacyToken });
  });

  it('rejects links that are not invites', () => {
    expect(parseInviteLink(`https://splitnext.app/j#${legacyToken}`)).toBeNull();
    expect(parseInviteLink('https://splitnext.app/j#short')).toBeNull();
    expect(parseInviteLink('https://splitnext.app/j')).toBeNull();
    expect(parseInviteLink(`https://splitnext.app/app#${createInviteToken()}`)).toBeNull();
    expect(parseInviteLink('not a link')).toBeNull();
  });
});
