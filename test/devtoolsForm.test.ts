import { describe, expect, it } from 'vitest';
import { describeActions } from '../apps/client/src/model/actions';
import { sourceOptions } from '../apps/client/src/model/actionInputs';
import {
  buildInput,
  formFields,
  initialValues,
  parseSchema,
} from '../apps/client/src/devtools/form';
import {
  fixtureState,
  scenarioReplica,
} from '../apps/client/src/workbench/memberListFixture';

function fieldsOf(name: string) {
  const action = describeActions().find((entry) => entry.name === name);

  if (!action) throw new Error(`missing ${name}`);

  return formFields(parseSchema(action.inputSchema));
}

const state = fixtureState(
  'online',
  scenarioReplica({
    members: ['Ana', 'Ben'],
    you: 'Ana',
    others: [],
    presence: 'realtime',
    othersOnline: true,
    connection: 'online',
  }),
);

describe('devtools action form', () => {
  it('picks a control for each kind of field', () => {
    expect(fieldsOf('joinGroup')).toMatchObject([
      { path: 'groupId', kind: 'text', source: 'group', strict: false },
      {
        path: 'as',
        kind: 'variant',
        discriminator: 'kind',
        variants: [
          {
            value: 'existing',
            fields: [{ path: 'as.memberId', kind: 'text', source: 'member' }],
          },
          { value: 'new', fields: [{ path: 'as.name', kind: 'text' }] },
        ],
      },
      { path: 'token', kind: 'text', optional: true, source: null },
    ]);
    expect(fieldsOf('removeMember')).toMatchObject([
      {
        path: 'memberId',
        kind: 'text',
        source: 'preferredMember',
        strict: true,
      },
    ]);
  });

  it('offers app state as labelled options', () => {
    expect(sourceOptions('member', state, 'https://app.test')).toEqual([
      { value: 'member-1______________', label: 'Ana (you)' },
      { value: 'member-2______________', label: 'Ben' },
    ]);
    expect(sourceOptions('inviteLink', state, 'https://app.test')).toEqual([
      {
        value: `https://app.test/join/${state.group?.group_id}#${'w'.repeat(43)}`,
        label: 'Workbench trip invite link',
      },
    ]);
  });

  it('starts dropdowns on their first option and leaves text empty', () => {
    expect(initialValues(fieldsOf('removeMember'), state, '')).toEqual({
      memberId: 'member-2______________',
    });
    expect(initialValues(fieldsOf('joinGroup'), state, '')).toEqual({
      'as.kind': 'existing',
    });
  });

  it('defaults selecting you to another member while retaining the current choice', () => {
    expect(sourceOptions('preferredMember', state, '')).toEqual([
      { value: 'member-2______________', label: 'Ben' },
      { value: 'member-1______________', label: 'Ana (you)' },
    ]);
    expect(initialValues(fieldsOf('setPreferredMember'), state, '')).toEqual({
      memberId: 'member-2______________',
    });
  });

  it('builds the input for the chosen variant and omits empty optionals', () => {
    const fields = fieldsOf('joinGroup');

    expect(
      buildInput(fields, {
        groupId: 'group-1_______________',
        'as.kind': 'new',
        'as.memberId': 'member-2______________',
        'as.name': 'Dev',
        token: '',
      }),
    ).toEqual({ groupId: 'group-1_______________', as: { kind: 'new', name: 'Dev' } });
    expect(buildInput(fieldsOf('createMember'), {})).toEqual({ name: '' });
  });
});
