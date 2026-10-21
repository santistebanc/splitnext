import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { addExpense, addMember, baseURL, bell, button, chooseCurrency, createGroup, field, heading, inviteLink, openGroup, out, person, phone, prepare, recordPlanned, setOffline, synced, toGroups, type StorageState } from './helpers';

/**
 * Every piece of UI that appears only under a condition: empty states,
 * offline and failure messages, warnings, review flags, and the like. Each
 * scenario brings the app into that condition and saves a screenshot with the
 * element spotlighted. A case that cannot be reached is saved as missing,
 * with the reason, so the page shows the gap instead of hiding it.
 */

type Area = 'App' | 'Welcome and groups' | 'New group' | 'Group screen' | 'Balances' | 'People' | 'Expense form' | 'Settling up' | 'Invite sheet' | 'Joining' | 'Activity' | 'Offline and sync';

type Spot = (page: Page, target: Locator, id: string, area: Area, element: string, when: string) => Promise<void>;

type Device = { context: BrowserContext; page: Page };

/** Saves spotlighted screenshots for one scenario, numbered after it so the page keeps their order. */
function catalog(scenario: number): Spot {
  let count = 0;

  return async (page, target, id, area, element, when) => {
    count += 1;
    let missing: string | null = null;

    await mkdir(`${out}cases`, { recursive: true });

    try {
      const found = target.first();

      await found.waitFor({ state: 'visible', timeout: 8000 });
      // Scroll only to something off screen, so a scrolled state such as a pinned heading stays.
      const shown = await found.boundingBox();

      if (!shown || shown.y < 0 || shown.y + shown.height > phone.height) await found.scrollIntoViewIfNeeded();
      // Let transitions settle before measuring.
      await page.waitForTimeout(450);
      const box = await found.boundingBox();

      if (!box) throw new Error('The element has no size on screen.');
      await page.evaluate((rect) => {
        const ring = document.createElement('div');
        const pad = 5;
        const top = Math.max(2, rect.y - pad);
        const bottom = Math.min(window.innerHeight - 2, rect.y + rect.height + pad);

        ring.id = 'sc-spot';
        Object.assign(ring.style, {
          position: 'fixed',
          left: `${Math.max(2, rect.x - pad)}px`,
          top: `${top}px`,
          width: `${Math.min(window.innerWidth - 4, rect.width + pad * 2)}px`,
          height: `${Math.max(8, bottom - top)}px`,
          borderRadius: '12px',
          boxShadow: '0 0 0 3px #f59e0b, 0 0 0 9999px rgba(16, 22, 29, 0.42)',
          pointerEvents: 'none',
          zIndex: '2147483647',
        });
        document.body.appendChild(ring);
      }, box);
      await page.screenshot({ path: `${out}cases/${id}.png`, animations: 'disabled' });
      await page.evaluate(() => document.getElementById('sc-spot')?.remove());
    } catch (cause) {
      missing = cause instanceof Error ? cause.message.split('\n')[0] ?? 'Not reached' : 'Not reached';
      console.warn(`Case ${id} not captured: ${missing}`);
      // What was on screen instead, to see why.
      await page.screenshot({ path: test.info().outputPath(`${id}-missing.png`) }).catch(() => undefined);
    }

    const meta = { id, area, element, when, order: scenario * 100 + count, missing };

    await writeFile(`${out}cases/${id}.json`, JSON.stringify(meta, null, 2));
  };
}

async function device(browser: Browser, setup: { storageState?: StorageState; init?: () => void; clipboard?: boolean } = {}): Promise<Device> {
  const settings: Parameters<Browser['newContext']>[0] = { baseURL, viewport: phone, deviceScaleFactor: 2 };

  if (setup.storageState) settings.storageState = setup.storageState;
  const context = await browser.newContext(settings);

  if (setup.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  if (setup.init) await context.addInitScript(setup.init);

  return { context, page: await context.newPage() };
}

function activityEntry(page: Page, text: string | RegExp) {
  return page.locator('[data-testid^="activity-"]').filter({ hasText: text });
}

/** Joins a group from its invite link as someone new, or as an existing name. */
async function join(page: Page, link: string, as: string, existing = false): Promise<void> {
  await page.goto(link);
  await expect(page.getByText(/Which one are you\?/)).toBeVisible();

  if (existing) {
    await page.getByRole('radio', { name: new RegExp(`^${as}`) }).first().click();
  } else {
    await page.getByRole('radio', { name: 'Someone else' }).click();
    await field(page, 'Your name').fill(as);
  }

  await button(page, `Join as ${as}`).click();
  await expect(button(page, new RegExp(`^${as} \\(you\\)`))).toBeVisible();
}

test('app shell', async ({ browser }) => {
  const spot = catalog(1);

  // Local storage never opens, so the placeholder stays.
  const waiting = await device(browser, {
    init: () => {
      Object.defineProperty(navigator.locks, 'request', { value: () => new Promise(() => undefined) });
    },
  });

  await waiting.page.goto('/app');
  await spot(waiting.page, waiting.page.getByLabel('Opening your groups…'), 'loading', 'App', 'Loading placeholder', 'Local storage is still opening: a skeleton shaped like the groups list.');
  await waiting.context.close();

  const broken = await device(browser, {
    init: () => {
      Object.defineProperty(window, 'indexedDB', { get: () => { throw new Error('storage_unavailable'); } });
    },
  });

  await broken.page.goto('/app');
  await spot(broken.page, broken.page.getByText('Let’s try that again').locator('..'), 'storage-failed', 'App', 'Storage failure', 'This device’s storage could not be opened: the reason, and Try again.');
  await broken.context.close();
});

test('welcome and a new group', async ({ browser }) => {
  const spot = catalog(2);
  const { context, page } = await device(browser);

  await page.goto('/app');
  await spot(page, button(page, 'Create a group').locator('../..'), 'welcome', 'Welcome and groups', 'Welcome', 'No group on this device yet: the logo, Create a group, and Join a group.');
  await button(page, 'Create a group').click();
  await spot(page, button(page, 'Create group'), 'create-disabled', 'New group', 'Create group, unavailable', 'Either name is still empty.');
  await field(page, 'Group name').fill('Lisbon');
  await field(page, 'Your name in this group').fill('Ana');

  await setOffline(context, page, true);
  await spot(page, page.getByText(/^Can’t create the group\. You’re offline\./), 'create-offline', 'New group', 'Can’t create offline', 'The device is offline; what was typed stays.');
  await setOffline(context, page, false);

  await page.route(/\/groups$/, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await button(page, 'Create group').click();
  await spot(page, page.getByRole('alert').filter({ hasText: /could not finish|can’t be reached/i }), 'create-failed', 'New group', 'Creating failed', 'The request failed: the reason, above the button.');
  await spot(page, page.getByText(/Splitnext can’t be reached/), 'create-unreachable', 'New group', 'Can’t reach splitnext', 'Online, but the server did not answer.');
  await spot(page, button(page, 'Try again'), 'create-retry', 'New group', 'Try again', 'After a failed attempt, the button offers to try again.');

  await page.unroute(/\/groups$/);
  await page.route(/\/groups$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue().catch(() => undefined);
  });
  await button(page, /^(Try again|Create group)$/).click();
  await spot(page, button(page, 'Creating…'), 'create-busy', 'New group', 'Creating…', 'While the group is being created.');
  await expect(heading(page, 'Lisbon')).toBeVisible({ timeout: 15_000 });
  await page.unroute(/\/groups$/);

  await spot(page, button(page, 'Add expense'), 'add-expense-empty', 'Group screen', 'Add expense', 'Before the first expense, the same Add expense button floats at the foot of the group screen.');
  await context.close();
});

test('balances and people', async ({ browser }) => {
  const spot = catalog(3);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Trip', 'Ana');
    await addMember(page, 'Ben');
    await addMember(page, 'Cy');
    await addExpense(page, 'Dinner', '90', 'EUR');
    await addExpense(page, 'Taxi', '30', 'USD', 'Ben');
  });

  const { context, page } = await device(browser, { storageState });

  await openGroup(page, 'Trip');
  await spot(page, person(page, 'Ana'), 'balance-you', 'Balances', 'Your row', 'Always first, tinted, with the You badge; one line per currency you owe or are owed.');
  await spot(page, person(page, 'Ben'), 'presence-unclaimed', 'Balances', 'Dashed ring', 'No device has joined as this person.');

  await person(page, 'Ben').click();
  await spot(page, page.getByText('Not taken on any device'), 'person-unclaimed', 'People', 'Not taken on any device', 'Nobody has joined as this person.');
  await spot(page, page.getByText(/^Owes · EUR/).locator('../..'), 'person-balances', 'People', 'Balance per currency', 'Owes or Gets back, one card per currency.');
  await spot(page, button(page, /^Settle up, \d+ payments?$/), 'person-settle', 'People', 'Settle up', 'The person is in at least one payment of the settle-up plan.');
  await spot(page, page.getByText('Settle up first to hide Ben.'), 'person-hide-blocked', 'People', 'Why Hide is unavailable', 'They still owe or are owed.');
  await spot(page, heading(page, 'EUR').locator('..'), 'person-breakdown', 'People', 'Breakdown', 'Their part of each expense and repayment, adding up to the balance.');
  await button(page, 'Rename Ben').click();
  await spot(page, field(page, 'Name').locator('../../..'), 'person-renaming', 'People', 'Renaming in place', 'The name becomes a field, with Done.');
  await field(page, 'Name').press('Escape');
  await button(page, 'Back to Trip').click();

  await person(page, 'Ana').click();
  await spot(page, button(page, 'That’s you'), 'person-you', 'People', 'That’s you', 'Shown instead of “I’m …” on your own page.');
  await spot(page, page.getByText('Settle up first to hide yourself.'), 'person-hide-yourself', 'People', 'Settle up first to hide yourself', 'Your own balance is not settled.');
  await button(page, 'Back to Trip').click();

  await addMember(page, 'Dee');
  await person(page, 'Dee').click();
  await spot(page, page.getByText('No expenses yet', { exact: true }), 'person-no-expenses', 'People', 'No expenses yet', 'In no expense or repayment, instead of a balance.');
  await spot(page, button(page, 'Remove Dee'), 'person-remove', 'People', 'Remove', 'Someone in no expense or repayment is removed outright; anyone else is hidden.');
  await button(page, 'Remove Dee').click();
  await spot(page, page.getByTestId('toast').locator('..'), 'toast-removed', 'Group screen', 'Removed, with Undo', 'Right after removing someone, for a few seconds.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await context.close();
});

test('settling up', async ({ browser }) => {
  const spot = catalog(4);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Weekend', 'Ana');
    await addMember(page, 'Ben');
    await addMember(page, 'Cy');
    await addExpense(page, 'Dinner', '90', 'EUR');
    await addExpense(page, 'Taxi', '30', 'USD', 'Ben');
  });

  const { context, page } = await device(browser, { storageState });

  await openGroup(page, 'Weekend');
  await person(page, 'Ben').click();
  await button(page, /^Settle up, \d+ payments?$/).click();
  await spot(page, heading(page, 'USD').locator('..'), 'settle-currency', 'Settling up', 'A plan per currency', 'Balances in more than one currency are settled separately.');
  await spot(page, button(page, /^You pay Ben /), 'settle-you-pay', 'Settling up', 'A payment you make', 'You owe in the plan: “You → Ben”.');

  await button(page, /^Ben pays you 30\.00 EUR/).click();
  await spot(page, page.getByText(/^Full amount Ben owes/), 'repay-full', 'Settling up', 'The full planned amount', 'The amount matches what the plan says is owed.');
  await field(page, 'Amount').fill('12');
  await spot(page, page.getByText(/^Ben owes 30\.00 EUR/), 'repay-partial', 'Settling up', 'Part of a planned payment', 'The amount differs from the plan, which is named for comparison.');
  await button(page, 'Paid to you. Change').click();
  await spot(page, page.getByRole('radiogroup', { name: 'Paid to' }), 'repay-picker', 'Settling up', 'Choosing who was paid', 'After tapping a name in the sentence.');
  await page.getByRole('radio', { name: /^Cy/ }).click();
  await spot(page, page.getByText('Paid outside splitnext.', { exact: true }), 'repay-manual', 'Settling up', 'A payment outside the plan', 'Nobody in the plan owes this pair.');
  await button(page, 'Cancel').click();

  await recordPlanned(page, /^Ben pays you 30\.00 EUR/);
  await recordPlanned(page, /^You pay Ben 10\.00 USD/);
  await recordPlanned(page, /^Cy pays Ben 10\.00 USD/);
  await spot(page, page.getByText('All settled up', { exact: true }).locator('..'), 'settle-done', 'Settling up', 'All settled up', 'No payment involves this person any more.');
  await button(page, 'Record a different payment').click();
  await spot(page, heading(page, 'Earlier repayments').locator('..'), 'repay-earlier', 'Settling up', 'Earlier repayments', 'Repayments are already recorded in the group.');
  await button(page, 'Cancel').click();

  await button(page, 'Back to Ben').click();
  await spot(page, page.getByText('Settled · EUR', { exact: true }).locator('..'), 'person-settled', 'People', 'Settled', 'In expenses, with a numeric zero in each settled currency.');
  await button(page, 'Hide Ben').click();
  await spot(page, page.getByTestId('toast').locator('..'), 'toast-hidden', 'Group screen', 'Hidden, with Undo', 'Right after hiding someone settled who has history.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(person(page, 'Ben')).toBeVisible();

  await spot(page, person(page, 'Ben'), 'balance-settled', 'Balances', 'Settled person', 'A numeric zero in each currency with records; people with no expenses keep a blank amount.');
  await spot(page, button(page, /^Change repayment: Ben paid you back 30\.00 EUR/), 'row-repayment', 'Group screen', 'Repayment row', 'A recorded repayment, listed with the expenses in a quieter amount.');
  await button(page, /^Change repayment: Ben paid you back 30\.00 EUR/).click();
  await spot(page, button(page, /^Remove repayment/), 'repay-remove', 'Settling up', 'Remove repayment', 'Opening a recorded repayment to change it.');
  await context.close();
});

test('expense form', async ({ browser }) => {
  const spot = catalog(5);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Trip', 'Ana');
    await addMember(page, 'Ben');
    await addMember(page, 'Cy');
  });

  const { context, page } = await device(browser, { storageState });
  const summary = page.getByTestId('split-summary');

  await openGroup(page, 'Trip');
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('30');
  await spot(page, page.getByText('Describe the expense.'), 'expense-describe', 'Expense form', 'Describe the expense', 'Something is typed but there is no description yet.');
  await spot(page, button(page, 'Save'), 'expense-save-disabled', 'Expense form', 'Save, unavailable', 'Until the expense is complete.');
  await field(page, 'Description').fill('Dinner');
  await button(page, /^Currency: .*\. Change currency$/).click();
  await field(page, 'Search currencies').fill('eu');
  await spot(page, page.getByRole('dialog', { name: 'Currency' }), 'expense-currency', 'Expense form', 'Choosing a currency', 'The search is ready to type in; the group’s and the common currencies come first.');
  await page.getByRole('radio', { name: 'EUR, Euro' }).click();
  await field(page, 'Amount').fill('');
  await spot(page, page.getByText(/^Enter an amount in EUR/), 'expense-amount', 'Expense form', 'Enter an amount', 'The amount is empty or not a number.');
  await field(page, 'Amount').fill('30');

  await button(page, /^Paid by .*Change payer$/).click();
  await spot(page, page.getByRole('radiogroup', { name: 'Paid by' }), 'expense-payer', 'Expense form', 'Choosing who paid', 'After tapping the payer.');
  await page.getByRole('radio', { name: 'Ana', exact: true }).click();

  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await spot(page, page.getByRole('checkbox', { name: 'Cy shares this expense' }).locator('..'), 'expense-excluded', 'Expense form', 'Left out of the split', 'Unticked: greyed, with no share.');
  await page.getByRole('checkbox', { name: 'Ana shares this expense' }).click();
  await spot(page, page.getByRole('checkbox', { name: 'Ben shares this expense' }), 'expense-last-person', 'Expense form', 'One person keeps the remainder', 'The last share cannot be excluded.');

  for (const name of ['Ana', 'Cy']) await page.getByRole('checkbox', { name: `${name} shares this expense` }).click();
  await button(page, 'Increase share for Ana').click();
  await spot(page, button(page, 'Decrease share for Ana').locator('..'), 'expense-stepper', 'Expense form', 'Shares per person', 'The arrows adjust a person’s shares, and the amounts update immediately.');
  await spot(page, summary, 'expense-custom', 'Expense form', 'Custom split', 'Shares differ, or someone has a fixed amount.');

  await button(page, /^Amount for Ben:/).click();
  await spot(page, field(page, 'Amount for Ben'), 'expense-amount-field', 'Expense form', 'Fix an amount', 'Tap a person’s amount to fix it, keeping the others’ shares.');
  await field(page, 'Amount for Ben').fill('abc');
  await spot(page, page.getByText(/^Enter each amount in EUR/), 'expense-each-amount', 'Expense form', 'Enter each amount', 'A person’s amount is not a number.');
  await field(page, 'Amount for Ben').fill('20');
  await field(page, 'Amount for Ben').press('Enter');
  await button(page, /^Amount for Cy:/).click();
  await field(page, 'Amount for Cy').fill('20');
  await spot(page, page.getByText('The amounts add up to more than the total.'), 'expense-over', 'Expense form', 'More than the total', 'The amounts typed add up to more than the expense.');
  await field(page, 'Amount for Cy').fill('');
  await field(page, 'Amount for Cy').press('Enter');
  await button(page, /^Amount for Ben:/).click();
  await field(page, 'Amount for Ben').fill('');
  await field(page, 'Amount for Ben').press('Enter');

  // Clearing the fixed amounts returns the split to equal shares.
  await expect(summary).toHaveText(/each · 3 people$/);
  await button(page, 'Save').click();
  await button(page, /^Change Dinner · /).click();
  await spot(page, button(page, /^Delete Dinner/), 'expense-remove', 'Expense form', 'Delete', 'Opening a recorded expense to change it.');
  await context.close();
});

test('offline and unreachable', async ({ browser }) => {
  const spot = catalog(6);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Trip', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Lunch', '24', 'EUR');
  });

  const { context, page } = await device(browser, { storageState });

  await openGroup(page, 'Trip');
  await setOffline(context, page, true);
  await spot(page, page.getByRole('status').filter({ hasText: /^Offline/ }), 'sync-offline', 'Offline and sync', 'Offline', 'Under the group name while the device is offline.');
  await person(page, 'Ben').click();
  await button(page, 'Rename Ben').click();
  await field(page, 'Name').fill('Benjamin');
  await field(page, 'Name').press('Enter');
  await button(page, 'Back to Trip').click();
  await spot(page, page.getByRole('status').filter({ hasText: /saved here/ }), 'sync-pending', 'Offline and sync', 'Changes saved here', 'Offline with changes waiting to be sent.');
  await person(page, 'Ana').click();
  await spot(page, page.getByText(/^Offline · taken on/), 'person-offline-you', 'People', 'Offline presence', 'Your own page while this device is offline.');
  await button(page, 'Back to Trip').click();
  await button(page, 'Invite people').click();
  await spot(page, page.getByText('Connect to replace the link.'), 'invite-offline', 'Invite sheet', 'Connect to replace the link', 'Offline: Replace link is unavailable.');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  await button(page, 'Trip. Switch group').click();
  await spot(page, page.getByText('1 change waiting'), 'groups-waiting', 'Welcome and groups', 'Changes waiting', 'A group card with changes not sent yet.');
  await spot(page, page.getByRole('status').filter({ hasText: /^Offline/ }), 'groups-offline', 'Offline and sync', 'Offline, on the groups list', 'The same status line above the list.');
  await button(page, 'Join with an invite link').click();
  await spot(page, page.getByText('You’re offline. Connect to open the link.'), 'join-link-offline', 'Joining', 'Offline, before a link', 'Opening a link needs a connection.');
  await button(page, 'Back').click();
  await setOffline(context, page, false);
  await synced(page);
  await button(page, 'Open Trip').click();

  // The server stops answering while the device stays online.
  await page.route(/\/groups\/[^/]+\/sync/, (route) => route.abort());
  await page.routeWebSocket(/realtime/, (socket) => socket.close());
  await person(page, 'Benjamin').click();
  await button(page, 'Rename Benjamin').click();
  await field(page, 'Name').fill('Ben');
  await field(page, 'Name').press('Enter');
  await button(page, 'Back to Trip').click();
  await spot(page, page.getByRole('status').filter({ hasText: /^Can’t reach splitnext/ }), 'sync-unreachable', 'Offline and sync', 'Can’t reach splitnext, with Retry', 'Online, but the server does not answer.');

  await page.unroute(/\/groups\/[^/]+\/sync/);
  await page.route(/\/groups\/[^/]+\/sync/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' }));
  await page.getByRole('status').getByRole('button', { name: 'Retry' }).click();
  await spot(page, page.getByRole('alert').first(), 'sync-error', 'App', 'A failed sync', 'The server answered with something unreadable: the reason, above the screen.');
  await page.unroute(/\/groups\/[^/]+\/sync/);
  await context.close();
});

test('invite sheet', async ({ browser }) => {
  const spot = catalog(7);

  // A device that can share links.
  const sharing = await device(browser, {
    clipboard: true,
    init: () => {
      Object.defineProperty(navigator, 'share', { value: () => Promise.resolve() });
    },
  });

  const page = sharing.page;

  await createGroup(page, 'Lisbon', 'Ana');
  await button(page, 'Invite people').click();
  const sheet = page.getByRole('dialog', { name: 'Invite people' });

  await spot(page, sheet.getByRole('button', { name: 'Share link' }), 'invite-share', 'Invite sheet', 'Share', 'The device can share links, as phones can.');
  await spot(page, sheet.getByText('Tap the link to copy it'), 'invite-tap', 'Invite sheet', 'Tap the link to copy it', 'The device can copy to the clipboard.');
  await sheet.getByRole('button', { name: 'Copy link' }).click();
  await spot(page, sheet.getByText('Copied', { exact: true }).locator('../..'), 'invite-copied', 'Invite sheet', 'Copied', 'Right after copying: the link is outlined in blue.');
  await sheet.getByRole('button', { name: 'Replace link', exact: true }).click();
  await spot(page, page.getByRole('dialog', { name: 'Replace invite link?' }), 'invite-replace', 'Invite sheet', 'Replace the link?', 'Asked in the same sheet, because the old link stops working.');
  await sharing.context.close();

  const plain = await device(browser, {
    init: () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
    },
  });

  await createGroup(plain.page, 'Porto', 'Ana');
  await button(plain.page, 'Invite people').click();
  await spot(plain.page, plain.page.getByText('Select the link to copy it'), 'invite-select', 'Invite sheet', 'Select the link to copy it', 'The browser offers no clipboard, so copying is by hand.');
  await plain.context.close();
});

test('joining', async ({ browser }) => {
  const spot = catalog(8);
  const host = await device(browser);

  await createGroup(host.page, 'Lisbon', 'Ana');
  await addMember(host.page, 'Ben');
  await addMember(host.page, 'Ben');
  const old = await inviteLink(host.page);

  await button(host.page, 'Invite people').click();
  await host.page.getByRole('dialog').getByRole('button', { name: 'Replace link', exact: true }).click();
  await host.page.getByRole('dialog', { name: 'Replace invite link?' }).getByRole('button', { name: 'Replace link', exact: true }).click();
  await expect(host.page.getByTestId('invite-link')).not.toHaveText(old);
  const link = (await host.page.getByTestId('invite-link').textContent()) ?? '';

  await host.page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  const { context, page } = await device(browser);

  await page.goto(old);
  await spot(page, page.getByText('This invite link doesn’t work').locator('..'), 'join-broken', 'Joining', 'This invite link doesn’t work', 'The link was replaced or is not valid: a broken-link icon, and a field for a different link.');

  await page.route('**/invites/preview', (route) => route.abort());
  await page.goto(link);
  await spot(page, page.getByRole('alert'), 'join-check-failed', 'Joining', 'Checking failed', 'The invite could not be checked, for a reason other than the link.');
  await page.unroute('**/invites/preview');

  await page.route('**/invites/preview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue().catch(() => undefined);
  });
  // The same link again would only change the hash, so load the app first.
  await page.goto('/app');
  await page.goto(link);
  await spot(page, button(page, 'Checking…'), 'join-checking', 'Joining', 'Checking…', 'While the invite is looked up.');
  await expect(page.getByText(/Which one are you\?/)).toBeVisible({ timeout: 15_000 });
  await page.unroute('**/invites/preview');
  await spot(page, page.getByText('Taken', { exact: true }).first().locator('../..'), 'join-in-use-tag', 'Joining', 'Taken', 'Another device has joined as this name; such names sort last.');
  await spot(page, page.getByRole('radiogroup', { name: 'Names' }), 'join-repeated', 'Joining', 'Repeated names', 'Two people share a name, so each gets a number.');
  await page.getByRole('radio', { name: 'Ana, taken', exact: true }).click();
  await spot(page, page.getByText(/^Ana is already taken on another device/), 'join-in-use', 'Joining', 'A taken name', 'Choosing a name taken on another device.');
  await page.getByRole('radio', { name: 'Someone else' }).click();
  await spot(page, field(page, 'Your name'), 'join-new-name', 'Joining', 'Your name', 'Choosing “Someone else”.');
  await field(page, 'Your name').fill('Dana');

  await setOffline(context, page, true);
  await spot(page, page.getByText('You’re offline. Connect to join.'), 'join-offline', 'Joining', 'Offline, before joining', 'Joining needs a connection.');
  await setOffline(context, page, false);

  await page.route(/\/groups\/[^/]+\/join/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue().catch(() => undefined);
  });
  await button(page, 'Join as Dana').click();
  await spot(page, button(page, 'Joining…'), 'join-busy', 'Joining', 'Joining…', 'While joining.');
  await expect(button(page, 'Dana (you), no expenses yet. Show details')).toBeVisible({ timeout: 15_000 });
  await page.unroute(/\/groups\/[^/]+\/join/);

  await button(page, 'Group settings').click();
  await field(page, 'Group name').fill('Lisbon trip');
  await spot(page, button(page, 'Save group name'), 'settings-save', 'Group screen', 'Save group name', 'Group settings, once the name differs from the current one.');
  await field(page, 'Group name').fill('Lisbon');
  await button(page, 'Leave group on this device').click();
  await spot(page, page.getByRole('dialog', { name: 'Leave this group?' }), 'leave-confirm', 'Group screen', 'Leave this group?', 'After tapping Leave group in Group settings.');
  await page.getByRole('dialog').getByRole('button', { name: 'Leave group', exact: true }).click();
  await spot(page, page.getByText('No groups yet', { exact: true }).locator('..'), 'groups-only-left', 'Welcome and groups', 'No groups yet', 'Every group on this device was left, so the list is empty but the welcome screen does not return.');
  await spot(page, button(page, 'Show 1 group you left'), 'groups-left-toggle', 'Welcome and groups', 'Groups you left, folded', 'There are groups this device left.');
  await button(page, 'Show 1 group you left').click();
  await spot(page, button(page, 'Rejoin Lisbon'), 'groups-left-card', 'Welcome and groups', 'A group you left', 'Shown with Rejoin, on a grey card.');
  await button(page, 'Rejoin Lisbon').click();
  await spot(page, page.getByText('Welcome back to').locator('../..'), 'join-rejoin', 'Joining', 'Welcome back', 'Rejoining a group this device left: no Change link.');
  await context.close();
  await host.context.close();
});

test('two devices: presence, conflicts, and removal', async ({ browser }) => {
  const spot = catalog(9);
  const host = await device(browser);
  const page = host.page;

  await createGroup(page, 'Shared', 'Ana');
  await addMember(page, 'Cy');
  await addMember(page, 'Eli');
  await addExpense(page, 'Dinner', '30', 'EUR');
  // In no expense yet, so the other device can remove her outright.
  await addMember(page, 'Fay');
  const link = await inviteLink(page);

  const other = await device(browser);

  await join(other.page, link, 'Ben');

  // A third device joins as Eli and leaves, so Eli is offline.
  const third = await device(browser);

  await join(third.page, link, 'Eli', true);
  await third.context.close();

  await expect(person(page, 'Ben')).toBeVisible();
  await spot(page, person(page, 'Ben'), 'presence-online', 'Balances', 'Filled dot', 'A device that joined as this person is online now.');
  await spot(page, person(page, 'Eli'), 'presence-offline', 'Balances', 'Ring', 'Devices joined as this person, none online now.');
  await person(page, 'Ben').click();
  await spot(page, page.getByText(/^Online · taken on 1 device/), 'person-online', 'People', 'Online presence', 'A device with this name taken is online.');
  await button(page, 'I’m Ben').click();
  await spot(page, page.getByText(/Ben is already taken on/), 'person-claim-shared', 'People', 'Shared with another device', 'Choosing a name taken on another device.');
  await button(page, 'Back to Shared').click();
  await person(page, 'Ana').click();
  await button(page, 'I’m Ana').click();
  await button(page, 'Back to Shared').click();

  // Conflicting changes: this device changes things offline while the other changes the same things.
  await setOffline(host.context, page, true);
  await person(page, 'Eli').click();
  await spot(page, page.getByText(/^Joined · taken on/), 'person-joined', 'People', 'Joined', 'Offline, so whether their device is online is unknown.');
  await button(page, 'Back to Shared').click();
  await person(page, 'Cy').click();
  await button(page, 'Rename Cy').click();
  await field(page, 'Name').fill('Cyrus');
  await field(page, 'Name').press('Enter');
  await button(page, 'Back to Shared').click();
  await button(page, /^Change Dinner · /).click();
  await field(page, 'Amount').fill('36');
  await button(page, 'Save').click();
  // Shared with Fay, whom the other device is about to remove, but not with Ben, so Ben can be removed later.
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('12');
  await chooseCurrency(page, 'EUR');
  await field(page, 'Description').fill('Snacks');
  await page.getByRole('checkbox', { name: 'Ben shares this expense' }).click();
  await button(page, 'Save').click();
  await expect(button(page, /^Change Snacks · /)).toBeVisible();

  await other.page.getByRole('button', { name: /^Cy, / }).click();
  await button(other.page, 'Rename Cy').click();
  await field(other.page, 'Name').fill('Cyril');
  await field(other.page, 'Name').press('Enter');
  await button(other.page, 'Back to Shared').click();
  await button(other.page, /^Change Dinner · /).click();
  await field(other.page, 'Amount').fill('42');
  await button(other.page, 'Save').click();
  await other.page.getByRole('button', { name: /^Fay, / }).click();
  await button(other.page, 'Remove Fay').click();
  await expect(other.page.getByTestId('toast')).toBeVisible();

  await setOffline(host.context, page, false);
  await expect(bell(page)).toHaveAccessibleName(/to review/, { timeout: 15_000 });
  await spot(page, bell(page), 'bell-review', 'Group screen', 'Bell count', 'New changes from others, plus changes of yours to review.');
  await spot(page, page.getByRole('img', { name: 'Needs review' }).first().locator('../../..'), 'row-review', 'Group screen', 'Needs-review dot', 'A change of yours to this expense was not applied.');
  await spot(page, page.getByRole('button', { name: /^Fay, removed/ }), 'balance-removed', 'Balances', 'Removed, still owing', 'Removed by another device, but still in a balance.');
  await page.getByRole('button', { name: /^Fay, removed/ }).click();
  await spot(page, page.getByText('Removed · still in balances until settled'), 'person-removed', 'People', 'Removed, still in balances', 'Instead of presence, for a removed person with a balance.');
  await spot(page, button(page, 'Restore Fay'), 'person-restore', 'People', 'Restore', 'In place of Rename, I’m, and Remove, for a removed person.');
  await page.goBack();

  await bell(page).click();
  await spot(page, page.getByRole('region', { name: 'Needs your review' }), 'activity-review', 'Activity', 'Needs your review', 'Changes from this device that were not applied, each with Apply again and Dismiss.');
  await spot(page, activityEntry(page, 'New'), 'activity-new', 'Activity', 'New', 'Changes from others since you last marked them seen, tinted blue.');
  await spot(page, button(page, 'Mark all seen'), 'activity-mark-seen', 'Activity', 'Mark all seen', 'Anything is new.');
  await button(page, /^Back to /).click();
  await button(page, /\. Switch group$/).click();
  await spot(page, page.getByText('A change needs review'), 'groups-review', 'Welcome and groups', 'A change needs review', 'On the card of a group with changes to review.');

  // The host removes the other device’s person, so that device has nobody to be.
  await button(page, /^Open /).first().click();
  await person(page, 'Ben').click();
  await button(page, 'Remove Ben').click();
  await expect(other.page.getByText('Tap your name to choose who you are.')).toBeVisible({ timeout: 15_000 });
  await spot(other.page, other.page.getByText('Tap your name to choose who you are.'), 'balance-choose-you', 'Balances', 'Choose who you are', 'Nobody in the group is you on this device.');
  await button(other.page, /\. Switch group$/).click();
  await spot(other.page, other.page.getByText('Choose who you are', { exact: true }), 'groups-choose-you', 'Welcome and groups', 'Choose who you are', 'On the card of a group where this device has no name.');
  await other.context.close();
  await host.context.close();
});

test('activity', async ({ browser }) => {
  const spot = catalog(10);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'History', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Lunch', '24', 'EUR');
    await addExpense(page, 'Taxi', '18', 'EUR');
    // In no expense, so she can be removed rather than hidden.
    await addMember(page, 'Dee');
    await person(page, 'Ben').click();
    await button(page, /^Settle up, \d+ payments?$/).click();
    await recordPlanned(page, /^Ben pays you /);
    await button(page, 'Back to Ben').click();
    await button(page, 'Back to History').click();
    await button(page, /^Change repayment: /).click();
    await button(page, /^Remove repayment/).click();
    await expect(heading(page, 'History')).toBeVisible();
    await button(page, 'Change Taxi · 18.00 EUR').click();
    await button(page, 'Delete Taxi · 18.00 EUR').click();
    await person(page, 'Dee').click();
    await button(page, 'Remove Dee').click();
    await button(page, 'Group settings').click();
    await field(page, 'Group name').fill('Porto');
    await button(page, 'Save group name').click();
    await expect(heading(page, 'Porto')).toBeVisible();
  });

  const { context, page } = await device(browser, { storageState });

  await openGroup(page, 'Porto');
  await bell(page).click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await spot(page, page.getByText(/^All caught up/), 'activity-caught-up', 'Activity', 'All caught up', 'Every change from this device was applied.');
  await spot(page, activityEntry(page, 'You renamed the group').first(), 'activity-group', 'Activity', 'Group change', 'Grey grid icon: the group itself changed.');
  await spot(page, button(page, 'Undo: You renamed the group'), 'activity-undo', 'Activity', 'Undo', 'The change can be reversed safely.');
  await spot(page, activityEntry(page, 'You removed Dee').first(), 'activity-people', 'Activity', 'People change', 'Purple person icon: someone was added, renamed, or removed.');
  await spot(page, button(page, 'Restore member'), 'activity-restore-member', 'Activity', 'Restore member', 'The removed person is still removed.');
  await spot(page, activityEntry(page, 'You removed Taxi').first(), 'activity-expense', 'Activity', 'Expense change', 'Blue receipt icon: an expense was added, changed, or removed.');
  await spot(page, button(page, 'Restore expense'), 'activity-restore-expense', 'Activity', 'Restore expense', 'The removed expense is still removed.');
  await spot(page, activityEntry(page, /removed a repayment/).first(), 'activity-repayment', 'Activity', 'Repayment change', 'Green icon: a repayment was recorded, changed, or removed.');
  await spot(page, button(page, 'Restore repayment'), 'activity-restore-repayment', 'Activity', 'Restore repayment', 'The removed repayment is still removed.');
  await spot(page, page.getByText(/Undo would overwrite a later change|cannot be removed by undoing/).first().locator('..'), 'activity-undo-blocked', 'Activity', 'Why Undo is unavailable', 'Undoing would overwrite a later change, or the person has history.');

  // Later in the day, and then the next day. A frozen clock would stop the
  // screens' fade-in, so screens appear without it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date(Date.now() + 7 * 60_000));
  await button(page, 'Back to Porto').click();
  await bell(page).click();
  await spot(page, page.getByText(/^\d+m ago$/).first(), 'activity-minutes', 'Activity', 'Minutes ago', 'Today’s entries count minutes, then hours.');
  const day = 24 * 3_600_000;

  const days: [number, Locator, string, string, string][] = [
    [day, heading(page, 'Yesterday'), 'activity-yesterday', 'Yesterday', 'Entries from the day before, with clock times.'],
    [3 * day, page.getByRole('heading', { name: /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/ }), 'activity-weekday', 'A weekday', 'Entries from earlier this week.'],
    [10 * day, page.getByRole('heading', { name: /^[A-Z][a-z]{2} \d{1,2}$/ }), 'activity-date', 'A date', 'Entries older than a week.'],
  ];

  for (const [later, target, id, element, when] of days) {
    await page.clock.setFixedTime(new Date(Date.now() + later));
    await button(page, 'Back to Porto').click();
    await bell(page).click();
    await spot(page, target, id, 'Activity', element, when);
  }

  await context.close();
});

test('groups list', async ({ browser }) => {
  const spot = catalog(11);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Porto', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Lunch', '30', 'EUR', 'Ben');
    await createGroup(page, 'Madrid', 'Ana');
    await addMember(page, 'Cy');
    await addExpense(page, 'Tapas', '48', 'EUR');
    await addExpense(page, 'Museum', '20', 'USD');
    await createGroup(page, 'Lisbon', 'Ana');
    await addMember(page, 'Dana');
  });

  const { context, page } = await device(browser, { storageState, clipboard: true });

  await toGroups(page);
  await spot(page, button(page, 'Open Madrid'), 'groups-owed', 'Welcome and groups', 'Owed, per currency', 'Your balance in the group, one line per currency, blue when you get money back.');
  await spot(page, button(page, 'Open Porto'), 'groups-owes', 'Welcome and groups', 'Owing', 'Orange when you owe.');
  await spot(page, button(page, 'Open Lisbon'), 'groups-settled', 'Welcome and groups', 'Settled', 'Nothing owed either way.');
  await context.close();
});

test('a long balances list', async ({ browser }) => {
  const spot = catalog(12);

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Long trip', 'Ana');

    for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran', 'Gus', 'Hana', 'Ida', 'Jo', 'Kai', 'Lea', 'Max']) await addMember(page, name);

    for (const name of ['Cabin', 'Train', 'Groceries', 'Boat', 'Lunch', 'Taxi']) await addExpense(page, name, '60', 'EUR');
  });

  const { context, page } = await device(browser, { storageState });
  const scroller = page.locator('#splitnext-page');

  await openGroup(page, 'Long trip');
  await spot(page, button(page, /^Show all \d+ people$/), 'balances-more', 'Balances', 'More people', 'Not everyone fits above the first expenses: tap to show everyone.');
  await button(page, /^Show all \d+ people$/).click();
  await spot(page, button(page, 'Show fewer people'), 'balances-fewer', 'Balances', 'Show fewer', 'Everyone is listed.');
  await button(page, 'Show fewer people').click();
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await spot(page, heading(page, 'Balances').first().locator('../..'), 'balances-pinned', 'Balances', 'Pinned heading', 'Scrolled down: the balances shrink to their heading, pinned above the expenses.');
  await context.close();
});
