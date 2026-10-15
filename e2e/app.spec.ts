import { expect, test, type Page } from '@playwright/test';

/**
 * The real app in a browser against a local Worker: flows the action and
 * sync tests cannot see, such as rendering, focus, history, and realtime.
 */

function button(page: Page, name: string | RegExp) {
  return page.getByRole('button', { name, exact: !(name instanceof RegExp) });
}

function field(page: Page, name: string) {
  return page.getByRole('textbox', { name });
}

async function createGroup(page: Page, name: string, you: string): Promise<void> {
  await page.goto('/app');
  await button(page, '+ Create group').click();
  await expect(button(page, 'Create group')).toBeDisabled();
  await field(page, 'Group name').fill(name);
  await field(page, 'Your name').fill(you);
  await button(page, 'Create group').click();
  await expect(page.getByText('Members')).toBeVisible();
}

async function addMember(page: Page, name: string): Promise<void> {
  await button(page, '+ Add member').click();
  await field(page, 'Member name').fill(name);
  await field(page, 'Member name').press('Enter');
  await expect(button(page, `Edit ${name}`)).toBeVisible();
}

async function inviteLink(page: Page): Promise<string> {
  await button(page, /invite/i).first().click();
  const link = await field(page, 'Invite link').inputValue();

  await button(page, 'Done').click();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

  return link;
}

test('creates a group and manages its members', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Edit Ben').click();
  await field(page, 'Member name').fill('Benjamin');
  await field(page, 'Member name').press('Enter');
  await expect(button(page, 'Edit Benjamin')).toBeVisible();

  // Navigation waits for member saves and becomes available again after them.
  await expect(button(page, 'Groups')).toBeEnabled();
  await button(page, /^This is me: Benjamin/).click();
  await expect(button(page, /^You: Benjamin/)).toBeVisible();
  await addMember(page, 'Cy');
  await button(page, 'Remove Cy').click();
  await expect(button(page, 'Edit Cy')).toHaveCount(0);
});

test('renames the group and replaces the invite link after confirming', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');
  await button(page, 'Group settings').click();
  await field(page, 'Group name').fill('Lisbon');
  await button(page, 'Save group name').click();
  await expect(page.getByRole('heading', { name: 'Lisbon' })).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

  await button(page, /invite/i).first().click();
  const before = await field(page, 'Invite link').inputValue();

  await button(page, 'New link').click();
  await button(page, 'Replace link').click();
  await expect(field(page, 'Invite link')).not.toHaveValue(before);
});

test('joins from a second device and shows changes on both through realtime', async ({ page, browser }) => {
  await createGroup(page, 'Trip', 'Ana');
  const link = await inviteLink(page);
  const visitor = await (await browser.newContext()).newPage();

  await visitor.goto(link);
  await expect(visitor.getByText('Who are you?')).toBeVisible();
  await visitor.getByRole('radio', { name: '+ I’m someone new' }).click();
  await field(visitor, 'Your name').fill('Dana');
  await button(visitor, 'Join group').click();
  await expect(button(visitor, 'Edit Dana')).toBeVisible();
  await expect(button(page, 'Edit Dana')).toBeVisible();
  await addMember(page, 'Eli');
  await expect(button(visitor, 'Edit Eli')).toBeVisible();
});

test('returns to the groups list while an invite check is still running', async ({ page, browser }) => {
  const creator = await (await browser.newContext()).newPage();

  await createGroup(creator, 'Trip', 'Ana');
  const link = await inviteLink(creator);

  await page.route('**/invite/preview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => undefined);
  });
  await page.goto(link);
  await expect(page.getByText('Checking…')).toBeVisible();
  await button(page, '← Back').click();
  await expect(page.getByText('Start a group')).toBeVisible({ timeout: 2000 });

  // The invite token leaves the address bar with the join page.
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(link);
  await expect(page.getByText('Who are you?')).toBeVisible();
});

test('keeps offline edits pending and delivers them on reconnect', async ({ page, context }) => {
  await createGroup(page, 'Trip', 'Ana');
  await addMember(page, 'Ben');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await button(page, 'Edit Ben').click();
  await field(page, 'Member name').fill('Benjamin');
  await field(page, 'Member name').press('Enter');
  await expect(page.getByText('Offline · 1 pending')).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/pending/)).toHaveCount(0, { timeout: 15_000 });
  await expect(button(page, 'Edit Benjamin')).toBeVisible();
});

test('leaves after confirming and rejoins as an existing member', async ({ page }) => {
  await createGroup(page, 'Lisbon', 'Ana');
  await button(page, 'Group settings').click();
  await button(page, 'Leave group').click();
  await button(page, 'Confirm leave').click();
  await button(page, /^Show left groups/).click();
  await button(page, 'Rejoin Lisbon').click();
  await page.getByRole('radio', { name: /^Ana/ }).click();
  await button(page, 'Rejoin group').click();
  await expect(button(page, '+ Add member')).toBeVisible();
});
