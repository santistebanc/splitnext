import { Hono } from 'hono';
import { html } from 'hono/html';
import { inviteTokenSchema } from '../inviteDirectory';
import { groupIdParameterSchema } from './groupRequest';

/** Minimal browser form for exercising invite redemption without a product UI. */
export const joinRoutes = new Hono<{ Bindings: Env }>().get(
  '/join/:groupId/:inviteToken',
  (context) => {
    const groupId = groupIdParameterSchema.safeParse(context.req.param('groupId'));

    const inviteToken = inviteTokenSchema.safeParse(
      context.req.param('inviteToken'),
    );

    if (!groupId.success || !inviteToken.success) {
      return context.json({ error: 'invalid_request' }, 400);
    }

    return context.html(
      html`<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Join Splitnext group</title>
          </head>
          <body>
            <main>
              <h1 id="group-title">Join group</h1>
              <p>This development form exercises the invite-redemption API.</p>
              <p id="context-status">Loading invite…</p>
              <form id="join-form" hidden>
                <label>
                  Member
                  <select name="member_id">
                    <option value="">Create a new member</option>
                  </select>
                </label>
                <label id="new-member-field">
                  Display name
                  <input name="display_name" required maxlength="100" />
                </label>
                <label>
                  Device ID
                  <input name="device_user_id" required maxlength="128" />
                </label>
                <button type="submit">Join</button>
              </form>
              <pre id="result" aria-live="polite"></pre>
            </main>
            <script type="module">
              const form = document.querySelector('#join-form');
              const groupTitle = document.querySelector('#group-title');
              const contextStatus = document.querySelector('#context-status');
              const memberInput = form.elements.namedItem('member_id');
              const nameInput = form.elements.namedItem('display_name');
              const newMemberField = document.querySelector('#new-member-field');
              const deviceInput = form.elements.namedItem('device_user_id');
              const result = document.querySelector('#result');
              const inviteToken = '${inviteToken.data}';

              deviceInput.value = crypto.randomUUID();

              const contextResponse = await fetch(
                '/groups/${groupId.data}/invite-context',
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ invite_token: inviteToken }),
                },
              );
              const inviteContext = await contextResponse.json();

              if (contextResponse.ok) {
                groupTitle.textContent = 'Join ' + inviteContext.group.name;
                contextStatus.textContent = 'Choose your name or create a new member.';

                for (const member of inviteContext.claimable_members) {
                  const option = document.createElement('option');

                  option.value = member.id;
                  option.textContent = member.display_name;
                  memberInput.append(option);
                }

                form.hidden = false;
              } else {
                contextStatus.textContent = JSON.stringify(inviteContext);
              }

              memberInput.addEventListener('change', () => {
                const creating = memberInput.value === '';

                newMemberField.hidden = !creating;
                nameInput.disabled = !creating;
                nameInput.required = creating;
              });

              form.addEventListener('submit', async (event) => {
                event.preventDefault();
                result.textContent = 'Submitting…';

                const fields = new FormData(form);
                const memberId = fields.get('member_id');
                const response = await fetch(
                  '/groups/${groupId.data}/invite-redemptions',
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      invite_token: inviteToken,
                      device_user_id: fields.get('device_user_id'),
                      member: memberId
                        ? { kind: 'existing', member_id: memberId }
                        : {
                            kind: 'new',
                            display_name: fields.get('display_name'),
                          },
                    }),
                  },
                );
                const body = await response.json();

                result.textContent = JSON.stringify(
                  { status: response.status, body },
                  null,
                  2,
                );
              });
            </script>
          </body>
        </html>`,
    );
  },
);
