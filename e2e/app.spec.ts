import { expect, test, type Page, type Locator } from '@playwright/test';

/**
 * The real app in a browser against a local Worker: flows the action and
 * sync tests cannot see, such as rendering, focus, history, and realtime.
 */

function button(page: Page, name: string | RegExp) {
  return page.getByRole('button', { name, exact: !(name instanceof RegExp) });
}

function field(page: Page, name: string) {
  return page.getByRole('textbox', { name, exact: true });
}

function heading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true });
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A person's row in the balances, whatever they owe. */
function person(page: Page, name: string) {
  return button(page, new RegExp(`^${escaped(name)}( \\(you\\))?(, removed)?, .*\\. Show details$`));
}

/** The Activity bell, whatever its count. */
function bell(page: Page) {
  return button(page, /^Activity[,:]/);
}

/** Creates a group from the groups list and lands on its group screen. */
async function createGroup(page: Page, name: string, you: string): Promise<void> {
  await page.goto('/app');
  await button(page, /^(New group|Create a group)$/).click();
  await expect(button(page, 'Create group')).toBeDisabled();
  await field(page, 'Group name').fill(name);
  await field(page, 'Your name in this group').fill(you);
  await button(page, 'Create group').click();
  await expect(heading(page, name)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Balances' })).toBeVisible();
}

/** Adds a person in the last row of the balances; ending the typing saves it. They may land below the rows that fit. */
async function addMember(page: Page, name: string): Promise<void> {
  // Once not everyone fits, the Add a person line shows only with everyone listed.
  await expect(async () => {
    const showAll = page.getByRole('button', { name: /^Show all \d+ people$/ });

    if (await showAll.count()) await showAll.click();
    await expect(field(page, 'Add a person')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await field(page, 'Add a person').fill(name);
  await field(page, 'Add a person').press('Enter');
  await expect(page.getByRole('button', { name: new RegExp(`^${escaped(name)}, .*\\. Show details$`), includeHidden: true })).toBeAttached();
}

/** Chooses a currency from the currency drawer by searching for its code. */
async function chooseCurrency(page: Page, currency: string): Promise<void> {
  await button(page, /^Currency: .*\. Change currency$/).click();
  await field(page, 'Search currencies').fill(currency);
  await page.getByRole('radio', { name: new RegExp(`^${escaped(currency)}, `) }).click();
  await expect(page.getByRole('dialog', { name: 'Currency' })).toHaveCount(0);
}

/** Adds an expense from the group screen and returns to it. */
async function addExpense(page: Page, description: string, amount: string, currency?: string, payer?: string): Promise<void> {
  await button(page, 'Add expense').click();
  await expect(field(page, 'Amount')).toBeVisible();
  await field(page, 'Amount').fill(amount);

  if (currency) await chooseCurrency(page, currency);

  if (payer) {
    await button(page, /^Paid by .*Change payer$/).click();
    await page.getByRole('radio', { name: new RegExp(`^${escaped(payer)}( \\(you\\))?$`) }).click();
  }

  await field(page, 'Description').fill(description);
  await button(page, 'Save').click();
  await expect(button(page, new RegExp(`^Change ${escaped(description)} · `))).toBeVisible();
}

/** Reads the invite link from the Invite sheet and closes it. */
async function inviteLink(page: Page): Promise<string> {
  await button(page, 'Invite people').click();
  const sheet = page.getByRole('dialog', { name: 'Invite people' });
  const link = (await sheet.getByTestId('invite-link').textContent()) ?? '';
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  return link;
}

async function goOffline(page: Page, context: { setOffline: (offline: boolean) => Promise<void> }): Promise<void> {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}

async function goOnline(page: Page, context: { setOffline: (offline: boolean) => Promise<void> }): Promise<void> {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('creates a group, adds people inline, and manages a person from their details', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');
  await expect(button(page, 'Ana (you), no expenses yet. Show details')).toBeVisible();
  await addMember(page, 'Ben');
  await expect(field(page, 'Add a person')).toHaveValue('');

  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toBeVisible();
  await expect(page.getByText('Not taken on any device', { exact: true })).toBeVisible();
  await expect(page.getByText('No expenses yet', { exact: true })).toBeVisible();
  await expect(button(page, /^Settle up/)).toHaveCount(0);
  await button(page, 'Rename Ben').click();

  // The group label above the textbox must not pull Done above the field.
  for (const width of [375, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const [input, done] = await Promise.all([field(page, 'Name').boundingBox(), button(page, 'Done').boundingBox()]);

      return input && done ? { top: done.y - input.y, height: done.height - input.height } : null;
    }).toEqual({ top: 0, height: 0 });
  }

  await field(page, 'Name').fill('Benjamin');
  await button(page, 'Done').click();
  await expect(heading(page, 'Benjamin')).toBeVisible();

  // Choosing someone as you needs no confirmation.
  await button(page, 'I’m Benjamin').click();
  await expect(button(page, 'That’s you')).toBeDisabled();
  await button(page, 'Back to Trip').click();
  await expect(button(page, 'Benjamin (you), no expenses yet. Show details')).toBeVisible();

  // Removing is immediate; restoring a member is a separate manual action.
  await addMember(page, 'Cy');
  await person(page, 'Cy').click();
  await button(page, 'Remove Cy').click();
  await expect(heading(page, 'Trip')).toBeVisible();
  await expect(person(page, 'Cy')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toHaveText('Cy removed.');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await bell(page).click();
  await button(page, 'Restore member').click();
  await button(page, 'Back to Trip').click();
  await expect(person(page, 'Cy')).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('uses the same compact title size across app views', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Headers', 'Ana');
  await expect(heading(page, 'Headers')).toHaveCSS('font-size', '18px');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '20', 'EUR');
  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toHaveCSS('font-size', '18px');
  await button(page, 'Settle up, 1 payment').click();
  await expect(heading(page, 'Settle up')).toHaveCSS('font-size', '18px');
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Headers').click();
  await bell(page).click();
  await expect(heading(page, 'Activity')).toHaveCSS('font-size', '18px');
  await button(page, 'Back to Headers').click();
  await button(page, 'Group settings').click();
  await expect(heading(page, 'Group settings')).toHaveCSS('font-size', '18px');
  await page.screenshot({ path: testInfo.outputPath('settings-header.png') });
  await button(page, 'Back to group').click();
  await button(page, 'Headers. Switch group').click();
  await expect(page.getByText('splitnext', { exact: true })).toHaveCSS('font-size', '18px');
  await button(page, 'New group').click();
  await expect(heading(page, 'New group')).toHaveCSS('font-size', '18px');
  await button(page, 'Back to groups').click();
  await button(page, 'Join with an invite link').click();
  await expect(heading(page, 'Join a group')).toHaveCSS('font-size', '18px');
});

test('keeps the fixed theme and group-list branding when offline', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/app');
  await expect(page.getByTestId('splitnext-logo')).toBeVisible();
  await expect(page.locator('#splitnext-page')).toHaveCSS('background-color', 'rgb(242, 244, 246)');

  await button(page, /^(New group|Create a group)$/).click();
  await expect(page.getByTestId('splitnext-logo')).toHaveCount(0);
  await field(page, 'Group name').fill('Paper trip');
  await field(page, 'Your name in this group').fill('Ana');
  await button(page, 'Create group').click();
  await expect(heading(page, 'Paper trip')).toBeVisible();
  await expect(page.getByTestId('splitnext-logo')).toHaveCount(0);
  await button(page, 'Paper trip. Switch group').click();
  await expect(page.getByTestId('splitnext-logo')).toBeVisible();
  await expect(button(page, 'Copy diagnostics')).toHaveCount(0);
  await expect(button(page, 'Diagnostics copied')).toHaveCount(0);
  await button(page, 'Open Paper trip').click();

  // The shell must precache the fonts and icon, not depend on a CDN or
  // merely retain previously loaded files in the browser's memory.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(heading(page, 'Paper trip')).toBeVisible();
  await expect(button(page, /^Offline.*\. Connection details$/)).toBeVisible();
  await expect(page.getByTestId('splitnext-logo')).toHaveCount(0);
  await person(page, 'Ana').click();
  await expect(page.getByText('Offline · taken on 1 device', { exact: true })).toBeVisible();
  await button(page, 'Back to Paper trip').click();

  const appearance = await page.evaluate(async () => {
    const faces = [
      ...await document.fonts.load('600 16px "IBM Plex Sans"'),
      ...await document.fonts.load('600 16px "IBM Plex Mono"'),
      ...await document.fonts.load('700 16px "Bricolage Grotesque"'),
    ];

    const assets = await Promise.all(
      ['/assets/ibm-plex-sans.woff2', '/assets/ibm-plex-mono-500.woff2', '/assets/ibm-plex-mono-600.woff2', '/assets/bricolage-grotesque.woff2', '/icon.svg']
        .map(async (url) => (await fetch(url)).ok),
    );

    const loaded = (family: string) => faces.some((face) => face.family.replace(/"/g, '') === family && face.status === 'loaded');

    return { font: loaded('IBM Plex Sans') && loaded('IBM Plex Mono') && loaded('Bricolage Grotesque'), assets };
  });

  expect(appearance.font).toBe(true);
  expect(appearance.assets).toEqual([true, true, true, true, true]);
});

test('shows separate currency summaries offline and keeps people who still owe or are owed', async ({ page, context }) => {
  await createGroup(page, 'Currencies', 'Ana');
  await addMember(page, 'Ben');

  await button(page, 'Currencies. Switch group').click();
  await expect(page.getByText('Settled', { exact: true })).toBeVisible();
  await button(page, 'Open Currencies').click();
  await addExpense(page, 'Dinner', '60', 'EUR', 'Ana');
  await addExpense(page, 'Tickets', '40', 'USD', 'Ben');
  await expect(button(page, 'Ana (you), +30.00 EUR, −20.00 USD. Show details')).toBeVisible();

  await goOffline(page, context);
  await button(page, 'Currencies. Switch group').click();
  await expect(page.getByText('+30.00 EUR', { exact: true })).toBeVisible();
  await expect(page.getByText('−20.00 USD', { exact: true })).toBeVisible();
  await button(page, 'Open Currencies').click();
  await person(page, 'Ana').click();

  // Ana still has balances, so she cannot be hidden until settled.
  await expect(button(page, 'Hide Ana')).toBeDisabled();
  await expect(page.getByText('Settle up first to hide yourself.', { exact: true })).toBeVisible();
  await button(page, 'Back to Currencies').click();
});

test('emphasizes inviting in an empty group without moving the action', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'New trip', 'Ana');
  const invite = button(page, 'Invite people');
  const add = button(page, 'Add expense');

  await expect(invite).toHaveText('Invite people');
  await expect(invite).toHaveCSS('background-color', 'rgb(27, 95, 193)');
  await expect(invite.getByText('Invite people', { exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(add).toHaveCSS('background-color', 'rgb(230, 239, 252)');
  const before = await invite.boundingBox();

  await invite.click();
  await expect(page.getByRole('dialog', { name: 'Invite people' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('empty-group-invite.png') });
  await addExpense(page, 'Lunch', '20', 'EUR');
  await expect(invite).toHaveCSS('background-color', 'rgb(230, 239, 252)');
  await expect(add).toHaveCSS('background-color', 'rgb(27, 95, 193)');
  await expect.poll(async () => {
    const after = (await invite.boundingBox())!;

    return Math.max(...(['x', 'y', 'width', 'height'] as const).map((key) => Math.abs(after[key] - before![key])));
  }).toBeLessThanOrEqual(1);
  await expect(invite).toHaveText('Invite people');
  await page.screenshot({ path: testInfo.outputPath('active-group-invite.png') });
  await invite.click();
  await expect(page.getByRole('dialog', { name: 'Invite people' })).toBeVisible();
});

test('records, changes, and removes an expense with balances per currency', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');
  await addMember(page, 'Ben');
  await expect(page.getByText('No expenses yet', { exact: true })).toHaveCount(0);
  await expect(button(page, 'Add the first expense')).toHaveCount(0);
  const addButton = button(page, 'Add expense');
  await expect(addButton).toBeVisible();
  const addPosition = await addButton.boundingBox();

  expect(addPosition?.y).toBeGreaterThan((page.viewportSize()?.height ?? 0) * 0.75);
  await addButton.click();

  // A new expense starts in its amount.
  await expect(field(page, 'Amount')).toBeFocused();

  // The browser locale names the US, so the first expense suggests dollars.
  await expect(button(page, 'Currency: USD. Change currency')).toBeVisible();
  await field(page, 'Amount').fill('30');
  await expect(page.getByTestId('split-summary')).toHaveText('15.00 each · 2 people');
  await expect(field(page, 'Amount for Ben')).toHaveCount(0);
  await field(page, 'Description').fill('Dinner');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Dinner · 30.00 USD')).toBeVisible();
  await expect(addButton).toBeVisible();
  expect(await addButton.boundingBox()).toEqual(addPosition);
  await expect(button(page, 'Ana (you), +15.00 USD. Show details')).toBeVisible();
  await expect(button(page, 'Ben, −15.00 USD. Show details')).toBeVisible();

  await button(page, 'Change Dinner · 30.00 USD').click();
  await expect(field(page, 'Amount')).not.toBeFocused();
  await field(page, 'Amount').fill('40');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Dinner · 40.00 USD')).toBeVisible();

  // Ben owes, so he stays until settled.
  await person(page, 'Ben').click();
  await expect(button(page, 'Hide Ben')).toBeDisabled();
  await expect(page.getByText('Settle up first to hide Ben.', { exact: true })).toBeVisible();
  await button(page, 'Back to Trip').click();

  // Deleting happens from the expense's own screen, which returns to the group.
  await button(page, 'Change Dinner · 40.00 USD').click();
  await button(page, 'Delete Dinner · 40.00 USD').click();
  await expect(page.getByText('No expenses yet', { exact: true })).toHaveCount(0);
  await expect(addButton).toBeVisible();
  expect(await addButton.boundingBox()).toEqual(addPosition);
  await expect(button(page, 'Ana (you), no expenses yet. Show details')).toBeVisible();

  // Settled again, Ben can go; the removed expense still names him, so he is hidden for history.
  await person(page, 'Ben').click();
  await button(page, 'Hide Ben').click();
  await expect(page.getByTestId('toast')).toHaveText('Ben hidden.');
  await expect(person(page, 'Ben')).toHaveCount(0);
});

test('keeps the expense amount formatted while typing and accepts dots or commas', async ({ page }) => {
  await createGroup(page, 'Amounts', 'Ana');
  await button(page, 'Add expense').click();
  const amount = field(page, 'Amount');

  for (const [entered, formatted] of [['12', '12.00'], ['12.5', '12.50'], ['12,5', '12.50'], ['.5', '0.50'], ['0', '0.00']]) {
    await amount.fill(entered!);
    await expect(amount).toHaveValue(formatted!);
    await expect(amount).toBeFocused();
  }

  for (const invalid of ['abc', '-12', '1e3', '12..5', '1,234.56']) {
    await amount.fill('');
    await amount.fill(invalid);
    await expect(amount).toHaveValue('');
  }

  await amount.pressSequentially('12a3');
  await expect(amount).toHaveValue('123.00');
  await amount.pressSequentially(',5');
  await expect(amount).toHaveValue('123.50');
  await amount.pressSequentially('6');
  await expect(amount).toHaveValue('123.56');
  await amount.press('Backspace');
  await expect(amount).toHaveValue('123.50');
  await amount.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 2));
  await amount.pressSequentially('9');
  await expect(amount).toHaveValue('193.50');
  await field(page, 'Description').fill('Lunch');

  // Other currencies retain their own minor-unit precision.
  await chooseCurrency(page, 'JPY');
  await amount.fill('42');
  await field(page, 'Description').click();
  await expect(amount).toHaveValue('42');
  await chooseCurrency(page, 'KWD');
  await amount.fill('42,5');
  await field(page, 'Description').click();
  await expect(amount).toHaveValue('42.500');
  await chooseCurrency(page, 'EUR');
  await amount.fill('12,5');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Lunch · 12.50 EUR')).toBeVisible();
});

test('keeps zero-amount split rows simple and aligned, then restores their controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Zero amount', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'A person with a long name');
  await button(page, 'Add expense').click();

  for (const amount of ['', '0', '0.00']) {
    await field(page, 'Amount').fill(amount);
    await expect(button(page, /^(Increase|Decrease) share for /)).toHaveCount(0);
    await expect(button(page, /^Amount for /)).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(3);
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const checks = [];

    for (const name of ['Ana', 'Ben', 'A person with a long name']) {
      const label = await page.getByText(name, { exact: true }).boundingBox();
      const check = await page.getByRole('checkbox', { name: `${name} shares this expense`, exact: true }).boundingBox();

      expect(label).not.toBeNull();
      expect(check).not.toBeNull();
      expect(Math.abs(label!.y + label!.height / 2 - (check!.y + check!.height / 2))).toBeLessThanOrEqual(1);
      checks.push(check!.x);
    }

    expect(new Set(checks).size).toBe(1);
  }

  await page.screenshot({ path: testInfo.outputPath('zero-amount-split.png') });
  await field(page, 'Amount').fill('100');
  await expect(button(page, 'Increase share for Ana')).toBeVisible();
  await expect(page.getByText('Describe the expense.', { exact: true })).toHaveCount(0);
  await expect(button(page, /^Amount for Ana:/)).toBeVisible();
  await button(page, 'Increase share for Ana').click();
  await expect(button(page, 'Decrease share for Ana')).toBeVisible();
  await field(page, 'Amount').fill('0');
  await expect(button(page, /^(Increase|Decrease) share for /)).toHaveCount(0);
  await expect(button(page, /^Amount for /)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Ana shares this expense' })).toBeChecked();
  await field(page, 'Amount').fill('100');
  await expect(button(page, 'Decrease share for Ana')).toBeVisible();
  await expect(button(page, 'Amount for Ana: 50.00 USD. Change amount')).toBeVisible();
});

test('aligns split controls in columns for weighted, fixed, and excluded people', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Columns', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await addMember(page, 'Cy');
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('100');
  await button(page, 'Increase share for Ana').click();
  await button(page, /^Amount for Cy:/).click();
  await field(page, 'Amount for Cy').fill('10');
  await field(page, 'Amount for Cy').press('Enter');
  await page.getByRole('checkbox', { name: 'Benjamin Alexander shares this expense' }).click();

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const up = await button(page, 'Increase share for Ana').boundingBox();
    const amount = await button(page, /^Amount for Ana:/).boundingBox();
    const end = await button(page, 'Decrease share for Ana').boundingBox();

    expect((await button(page, 'Increase share for Cy').boundingBox())!.x).toBe(up!.x);
    expect((await button(page, /^Amount for Cy:/).boundingBox())!.x).toBe(amount!.x);
    expect((await button(page, /^Amount for Cy:/).boundingBox())!.width).toBe(amount!.width);
    expect((await button(page, 'Decrease share for Cy').boundingBox())!.x).toBe(end!.x);
    expect((await page.getByRole('checkbox', { name: 'Benjamin Alexander shares this expense' }).boundingBox())!.x).toBe(end!.x);
    expect((await page.getByText('Benjamin Alexander', { exact: true }).boundingBox())!.x).toBe((await page.getByText('Ana', { exact: true }).boundingBox())!.x);
  }

  await page.screenshot({ path: testInfo.outputPath('split-columns.png') });
});

test('mixes fixed amounts and weighted shares, preserves them offline, and clears a fixed amount back to shares', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createGroup(page, 'Mixed splits', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('100');

  // The currency drawer opens ready to search, with the common currencies first.
  await button(page, 'Currency: USD. Change currency').click();
  await expect(field(page, 'Search currencies')).toBeFocused();
  await expect(page.getByRole('radio').first()).toHaveAccessibleName('USD, US Dollar');
  await expect(page.getByRole('radio', { name: 'USD, US Dollar' })).toBeChecked();
  await field(page, 'Search currencies').fill('yen');
  await expect(page.getByRole('radio').first()).toHaveAccessibleName('JPY, Japanese Yen');
  await field(page, 'Search currencies').fill('EUR');
  await page.getByRole('radio', { name: 'EUR, Euro' }).click();
  await expect(button(page, 'Currency: EUR. Change currency')).toBeVisible();
  await field(page, 'Description').fill('Mixed dinner');
  const checkboxIcon = page.getByRole('checkbox', { name: 'Cy shares this expense' }).locator('svg');
  const checkboxFill = await checkboxIcon.evaluate((icon) => getComputedStyle(icon.parentElement!).backgroundColor);

  await expect(button(page, 'Increase share for Ana').locator('svg').locator('..')).toHaveCSS('background-color', checkboxFill);
  expect(await button(page, 'Increase share for Ana').locator('svg').getAttribute('stroke')).toBe(await checkboxIcon.getAttribute('stroke'));
  await button(page, 'Increase share for Ana').click();
  await expect(button(page, 'Decrease share for Ana').locator('svg').locator('..')).toHaveCSS('background-color', checkboxFill);
  expect(await button(page, 'Decrease share for Ana').locator('svg').getAttribute('stroke')).toBe(await checkboxIcon.getAttribute('stroke'));
  await button(page, 'Increase share for Ana').click();
  await button(page, 'Increase share for Ben').click();
  await expect(page.getByTestId('split-summary')).toHaveText('Custom split · 3 people');
  await expect(button(page, 'Amount for Ana: 50.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 33.33 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 16.67 EUR. Change amount')).toBeVisible();

  // Fix one person while the others retain their 3:2 weights.
  await button(page, /^Amount for Cy:/).click();
  await expect(field(page, 'Amount for Cy')).toBeFocused();
  await field(page, 'Amount for Cy').fill('101');
  await expect(button(page, 'Save')).toBeDisabled();
  await expect(page.getByText('The amounts add up to more than the total.', { exact: true })).toBeVisible();
  await field(page, 'Amount for Cy').fill('20');
  await field(page, 'Amount for Cy').press('Enter');
  await expect(button(page, 'Amount for Ana: 48.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 32.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 20.00 EUR, fixed. Change amount')).toBeVisible();
  await field(page, 'Amount').fill('130');
  await expect(button(page, 'Amount for Ana: 66.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 44.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 20.00 EUR, fixed. Change amount')).toBeVisible();
  await field(page, 'Amount').fill('100');

  await goOffline(page, context);
  await button(page, 'Save').click();
  await button(page, 'Change Mixed dinner · 100.00 EUR').click();
  await expect(button(page, 'Delete Mixed dinner · 100.00 EUR')).toBeVisible();
  await expect(button(page, 'Amount for Ana: 48.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 32.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 20.00 EUR, fixed. Change amount')).toBeVisible();

  // Editing only the occasion must keep both the fixed value and the weights.
  await field(page, 'Description').fill('Mixed dinner edited');
  await button(page, 'Save').click();
  await button(page, 'Change Mixed dinner edited · 100.00 EUR').click();
  await expect(button(page, 'Amount for Ana: 48.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 32.00 EUR. Change amount')).toBeVisible();
  await button(page, /^Amount for Cy:/).click();
  await field(page, 'Amount for Cy').fill('');
  await field(page, 'Amount for Cy').press('Enter');
  await expect(button(page, 'Amount for Ana: 50.00 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 33.33 EUR. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 16.67 EUR. Change amount')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await expect(button(page, /^Amount for Cy:/)).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await expect(button(page, 'Amount for Cy: 16.67 EUR. Change amount')).toBeVisible();
  await button(page, 'Cancel').click();
  await goOnline(page, context);
});

test('explains a balance and settles it with the fewest payments', async ({ page }) => {
  await createGroup(page, 'Settle', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');
  await addExpense(page, 'Dinner', '90', 'EUR');
  await addExpense(page, 'Taxi', '30', 'EUR', 'Ben');

  // You first, then whoever owes most: Cy owes 40, Ben 10.
  expect(await page.getByRole('button', { name: /Show details$/ }).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))).toEqual([
    'Ana (you), +50.00 EUR. Show details',
    'Cy, −40.00 EUR. Show details',
    'Ben, −10.00 EUR. Show details',
  ]);

  // Ben paid 30 and owes 40: the breakdown adds up to his balance.
  await person(page, 'Ben').click();
  await expect(page.getByText('Owes · EUR', { exact: true })).toBeVisible();
  await expect(button(page, 'Dinner, −30.00 EUR')).toBeVisible();
  await expect(button(page, 'Taxi, +20.00 EUR')).toBeVisible();
  await expect(page.getByText('−10.00 EUR', { exact: true })).toBeVisible();

  // Ben pays Ana directly; Cy's debt is a separate payment Ben is not part of.
  await button(page, 'Settle up, 1 payment').click();
  await expect(heading(page, 'Settle up')).toBeVisible();
  await button(page, 'Ben pays you 10.00 EUR. Record this payment').click();
  await expect(field(page, 'Amount')).toHaveValue('10.00');
  await button(page, 'Cancel').click();
  await expect(heading(page, 'Settle up')).toBeVisible();

  // A partial payment leaves the rest in the plan.
  await button(page, 'Ben pays you 10.00 EUR. Record this payment').click();
  await field(page, 'Amount').fill('4');
  await button(page, 'Record repayment').click();
  await expect(button(page, 'Ben pays you 6.00 EUR. Record this payment')).toBeVisible();
  await button(page, 'Ben pays you 6.00 EUR. Record this payment').click();
  await button(page, 'Record repayment').click();
  await expect(page.getByText('All settled up', { exact: true })).toBeVisible();
  await button(page, 'Back to Ben').click();
  await expect(button(page, /^Settle up/)).toHaveCount(0);
  await button(page, 'Back to Settle').click();
  await expect(button(page, 'Change repayment: Ben paid you back 4.00 EUR')).toBeVisible();
  await expect(button(page, 'Ben, 0.00 EUR. Show details')).toBeVisible();
  await expect(person(page, 'Ben').getByText('0.00 EUR', { exact: true })).toBeVisible();

  // Settled people sort before people in no expense yet.
  await addMember(page, 'Dee');
  expect(await page.getByRole('button', { name: /Show details$/ }).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))).toEqual([
    expect.stringMatching(/^Ana \(you\), /),
    expect.stringMatching(/^Cy, /),
    'Ben, 0.00 EUR. Show details',
    'Dee, no expenses yet. Show details',
  ]);
  await expect(person(page, 'Dee')).toHaveText('Dee');
  await person(page, 'Dee').click();
  await expect(page.getByText('No expenses yet', { exact: true })).toBeVisible();
  await button(page, 'Back to Settle').click();
  await person(page, 'Ben').click();
  await expect(page.getByText('Settled · EUR', { exact: true })).toBeVisible();
  await expect(page.getByText('0.00', { exact: true })).toBeVisible();

  // Settled people with expenses are hidden, not removed, and can come back.
  await button(page, 'Hide Ben').click();
  await expect(page.getByTestId('toast')).toHaveText('Ben hidden.');
  await expect(person(page, 'Ben')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await bell(page).click();
  await button(page, 'Restore member').click();
  await button(page, 'Back to Settle').click();
  await expect(person(page, 'Ben')).toBeVisible();
});

test('keeps drawer titles and controls at the currency drawer scale', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Drawers', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  await button(page, 'Currency: USD. Change currency').click();
  const currency = page.getByRole('dialog', { name: 'Currency' });
  const referenceSize = await currency.getByText('US Dollar', { exact: true }).evaluate((text) => getComputedStyle(text).fontSize);
  const referenceHeight = (await currency.getByRole('radio', { name: 'USD, US Dollar', exact: true }).boundingBox())!.height;

  await expect(currency.getByRole('heading', { name: 'Currency', exact: true })).toHaveCSS('font-size', '18px');
  await currency.getByRole('radio', { name: 'USD, US Dollar', exact: true }).click();
  await button(page, 'Paid by Ana (you). Change payer').click();
  const payer = page.getByRole('dialog', { name: 'Paid by' });

  await expect(payer.getByText('Ben', { exact: true })).toHaveCSS('font-size', referenceSize);
  expect((await payer.getByRole('radio', { name: 'Ben', exact: true }).boundingBox())!.height).toBe(referenceHeight);
  await page.screenshot({ path: testInfo.outputPath('payer-drawer.png') });
  await payer.getByRole('button', { name: 'Close', exact: true }).click();
  await button(page, 'Cancel').click();
  await button(page, 'Invite people').click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });

  await expect(invite.getByRole('heading', { name: 'Invite people', exact: true })).toHaveCSS('font-size', '18px');
  await expect(invite.getByText('Replace link', { exact: true })).toHaveCSS('font-size', referenceSize);
  expect((await invite.getByRole('button', { name: 'Replace link', exact: true }).boundingBox())!.height).toBe(referenceHeight);
  await page.screenshot({ path: testInfo.outputPath('invite-drawer.png') });
  await invite.getByRole('button', { name: 'Close', exact: true }).click();
  await button(page, 'Group settings').click();
  await button(page, 'Leave group on this device').click();
  await expect(page.getByRole('dialog', { name: 'Leave this group?' }).getByRole('heading', { name: 'Leave this group?', exact: true })).toHaveCSS('font-size', '18px');
});

test('renames the group, copies the invite link by tapping it, and replaces it after confirming', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createGroup(page, 'Trip', 'Ana');
  await expect(button(page, 'Rename group')).toHaveCount(0);
  await expect(button(page, 'Leave group on this device')).toHaveCount(0);
  await button(page, 'Group settings').click();
  await expect(heading(page, 'Group settings')).toBeVisible();
  await expect(field(page, 'Group name')).toHaveValue('Trip');
  await expect(button(page, 'Save group name')).toHaveCount(0);
  await expect(button(page, 'Leave group on this device')).toBeVisible();
  await field(page, 'Group name').fill('Lisbon');
  await button(page, 'Save group name').click();
  await expect(heading(page, 'Lisbon')).toBeVisible();

  await button(page, 'Invite people').click();
  const before = (await page.getByTestId('invite-link').textContent()) ?? '';

  // Tapping the link selects and copies it.
  await page.getByRole('dialog').getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(before);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(before);
  await page.getByRole('dialog').getByRole('button', { name: 'Replace link', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Replace invite link?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Replace link', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Invite people' })).toBeVisible();
  await expect(page.getByTestId('invite-link')).not.toHaveText(before);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('adds each name typed while earlier ones are still saving', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');

  // No waiting between names: each is added, none merged into the next or dropped.
  for (const name of ['Ben', 'Cy', 'Dana']) {
    await field(page, 'Add a person').fill(name);
    await field(page, 'Add a person').press('Enter');
  }

  for (const name of ['Ben', 'Cy', 'Dana']) await expect(person(page, name)).toBeVisible();
  await expect(page.getByRole('button', { name: /Show details$/ })).toHaveCount(4);
  await expect(field(page, 'Add a person')).toHaveValue('');
});

test('opens details as pages with Back, browser history, and keyboard focus', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');
  await field(page, 'Add a person').click();
  await expect(field(page, 'Add a person')).toBeFocused();
  await field(page, 'Add a person').fill('Ben');
  await field(page, 'Add a person').press('Enter');
  await expect(person(page, 'Ben')).toBeVisible();

  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toBeVisible();
  await page.goBack();
  await expect(heading(page, 'Trip')).toBeVisible();
  await page.goForward();
  await expect(heading(page, 'Ben')).toBeVisible();
  await button(page, 'Back to Trip').click();
  await expect(heading(page, 'Trip')).toBeVisible();

  await button(page, 'Group settings').click();
  await expect(heading(page, 'Group settings')).toBeVisible();
  await field(page, 'Group name').fill('Unsaved name');
  await button(page, 'Back to group').click();
  await expect(heading(page, 'Trip')).toBeVisible();
  await button(page, 'Group settings').click();
  await expect(field(page, 'Group name')).toHaveValue('Trip');
  await page.goBack();
  await expect(heading(page, 'Trip')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(heading(page, 'Group settings')).toBeVisible();
  await expect(field(page, 'Group name')).toHaveValue('Trip');
});

test('joins from a second device and shows changes on both through realtime', async ({ page, browser }) => {
  await createGroup(page, 'Trip', 'Ana');
  const link = await inviteLink(page);
  const visitor = await (await browser.newContext()).newPage();

  // Short links carry only a 12-character code after the fragment mark.
  expect(link).toMatch(/\/j#[A-Za-z0-9]{12}$/);
  await visitor.goto(link);
  await expect(visitor.getByText(/Which one are you\?/)).toBeVisible();
  await expect(visitor.getByText('Taken', { exact: true })).toBeVisible();
  const someoneElse = visitor.getByRole('radio', { name: 'Someone else', exact: true });

  await expect(someoneElse).toHaveCSS('border-top-style', 'dashed');
  await someoneElse.click();
  await expect(someoneElse).toBeChecked();
  await expect(field(visitor, 'Your name')).toBeFocused();
  await visitor.getByRole('radio', { name: /^Ana/ }).click();
  await expect(someoneElse).not.toBeChecked();
  await expect(field(visitor, 'Your name')).toHaveCount(0);
  await someoneElse.click();
  await field(visitor, 'Your name').fill('Dana');
  await button(visitor, 'Join as Dana').click();
  await expect(button(visitor, 'Dana (you), no expenses yet. Show details')).toBeVisible();
  await expect(person(page, 'Dana')).toBeVisible();
  await addMember(page, 'Eli');
  await expect(person(visitor, 'Eli')).toBeVisible();

  // The link opens the group directly for someone already in it.
  await visitor.goto(link);
  await expect(heading(visitor, 'Trip')).toBeVisible();
  await expect(visitor).toHaveURL(/\/app$/);
  await person(visitor, 'Ana').click();
  await button(visitor, 'I’m Ana').click();
  await expect(visitor.getByRole('status').filter({ hasText: 'Ana is already taken on another device. It’s now taken on this device too.' })).toBeVisible();
  await expect(visitor.getByText('Online · taken on 2 devices', { exact: true })).toBeVisible();
});

test('returns to the groups list while an invite check is still running', async ({ page, browser }) => {
  const creator = await (await browser.newContext()).newPage();

  await createGroup(creator, 'Trip', 'Ana');
  const link = await inviteLink(creator);

  await page.route('**/invites/preview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => undefined);
  });
  await page.goto(link);
  await expect(page.getByText('Checking…')).toBeVisible();
  await button(page, 'Back').click();
  await expect(button(page, 'Join a group')).toBeVisible({ timeout: 2000 });

  // The invite token leaves the address bar with the join page.
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(link);
  await expect(page.getByText(/Which one are you\?/)).toBeVisible();
});

test('keeps offline edits pending and delivers them on reconnect', async ({ page, context }) => {
  await createGroup(page, 'Trip', 'Ana');
  await addMember(page, 'Ben');
  const headerTop = (await button(page, 'Trip. Switch group').boundingBox())!.y;

  await goOffline(page, context);
  await expect(button(page, 'Offline. Connection details')).toBeVisible();
  const strip = button(page, /Connection details$/);
  const stripBounds = (await strip.boundingBox())!;

  expect(stripBounds.y).toBe(0);
  expect(stripBounds.height).toBeLessThanOrEqual(32);
  expect(Math.abs((await button(page, 'Trip. Switch group').boundingBox())!.y - headerTop - stripBounds.height)).toBeLessThanOrEqual(1);
  await expect(strip).toHaveText('Offline');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await button(page, 'Add expense').click();
  await expect(field(page, 'Amount')).toBeVisible();
  await expect(strip).toHaveText('Offline');
  expect((await strip.boundingBox())!.y).toBe(0);
  await button(page, 'Cancel').click();
  await person(page, 'Ben').click();
  await expect(strip).toHaveText('Offline');
  await button(page, 'Rename Ben').click();
  await field(page, 'Name').fill('Benjamin');
  await field(page, 'Name').press('Enter');
  await expect(heading(page, 'Benjamin')).toBeVisible();
  await button(page, 'Back to Trip').click();
  await button(page, 'Offline · 1 change saved here. Connection details').click();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Connection' }).getByText('Offline · 1 change saved here', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await button(page, 'Trip. Switch group').click();
  await expect(button(page, 'Offline · 1 change saved here. Connection details')).toBeVisible();
  await expect(strip).toHaveText('Offline · 1 change saved here');
  await button(page, 'Offline · 1 change saved here. Connection details').click();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeVisible();
  await expect(button(page, 'Retry')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await button(page, 'Open Trip').click();
  await button(page, 'Group settings').click();
  await expect(strip).toHaveText('Offline · 1 change saved here');
  await button(page, 'Back to group').click();
  await goOnline(page, context);
  await expect(button(page, /Connection details$/)).toHaveCount(0, { timeout: 15_000 });
  await expect(person(page, 'Benjamin')).toBeVisible();
});

test('puts server connection failures and retry in the header details', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Connection test', 'Ana');
  const headerTop = (await button(page, 'Connection test. Switch group').boundingBox())!.y;
  let attempts = 0;

  await page.route('**/identity/groups', async (route) => {
    attempts++;
    await route.abort();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(button(page, 'Can’t reach splitnext. Connection details')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const strip = button(page, /Connection details$/);

  await expect(strip).toHaveText('Can’t reach splitnext');
  const stripBounds = (await strip.boundingBox())!;

  expect(stripBounds.y).toBe(0);
  expect(stripBounds.height).toBeLessThanOrEqual(32);
  expect(Math.abs((await button(page, 'Connection test. Switch group').boundingBox())!.y - headerTop - stripBounds.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('connection-header.png') });
  await button(page, 'Can’t reach splitnext. Connection details').click();
  const dialog = page.getByRole('dialog', { name: 'Connection' });

  await expect(dialog.getByText('Can’t reach splitnext', { exact: true })).toBeVisible();
  const beforeRetry = attempts;

  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => attempts).toBeGreaterThan(beforeRetry);
  await page.unroute('**/identity/groups');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(button(page, /Connection details$/)).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // An HTTP/server failure is not silently hidden as a connection issue.
  await page.route('**/identity/groups', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'internal_error' }) }));
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('leaves after confirming and rejoins as an existing member', async ({ page }) => {
  await createGroup(page, 'Lisbon', 'Ana');
  await button(page, 'Group settings').click();
  await button(page, 'Leave group on this device').click();
  await expect(page.getByRole('dialog', { name: 'Leave this group?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(heading(page, 'Group settings')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await button(page, 'Leave group on this device').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave group', exact: true }).click();
  await button(page, 'Show 1 group you left').click();
  await button(page, 'Rejoin Lisbon').click();
  await page.getByRole('radio', { name: /^Ana/ }).click();
  await button(page, 'Rejoin as Ana').click();
  await expect(field(page, 'Add a person')).toBeVisible();
});

test('records planned and other repayments offline', async ({ page, context }) => {
  await createGroup(page, 'Repayments', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await addExpense(page, 'Dinner', '60', 'EUR');
  await page.setViewportSize({ width: 390, height: 844 });
  await person(page, 'Benjamin Alexander').click();
  await goOffline(page, context);
  await button(page, 'Settle up, 1 payment').click();
  await button(page, 'Benjamin Alexander pays you 30.00 EUR. Record this payment').click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by', exact: true })).toHaveCount(0);
  await field(page, 'Amount').fill('10');
  await button(page, 'Record repayment').click();
  await expect(button(page, 'Benjamin Alexander pays you 20.00 EUR. Record this payment')).toBeVisible();
  expect(await page.locator('#splitnext-page').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await button(page, 'Record a different payment').click();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you 10.00 EUR')).toBeVisible();
  await field(page, 'Amount').fill('5');
  await button(page, 'Record repayment').click();
  await expect(button(page, 'Benjamin Alexander pays you 15.00 EUR. Record this payment')).toBeVisible();
  await page.reload();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 10.00 EUR')).toBeVisible();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 5.00 EUR')).toBeVisible();
  await goOnline(page, context);
  await expect(page.getByText(/saved here/)).toHaveCount(0);
});

test('edits and removes a repayment offline', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Repayment changes', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '24', 'EUR');
  await person(page, 'Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await button(page, 'Ben pays you 12.00 EUR. Record this payment').click();
  await expect(button(page, 'Delete')).toHaveCount(0);
  await button(page, 'Record repayment').click();
  await expect(page.getByText('All settled up', { exact: true })).toBeVisible();
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Repayment changes').click();

  await goOffline(page, context);
  await button(page, 'Change repayment: Ben paid you back 12.00 EUR').click();
  await field(page, 'Amount').fill('15');
  await button(page, 'Save repayment').click();
  await expect(button(page, 'Change repayment: Ben paid you back 15.00 EUR')).toBeVisible();
  await expect(button(page, 'Ben, +3.00 EUR. Show details')).toBeVisible();
  await button(page, 'Change repayment: Ben paid you back 15.00 EUR').click();
  const remove = button(page, 'Delete');
  const save = button(page, 'Save repayment');

  await expect(remove).toBeVisible();
  const removeBox = (await remove.boundingBox())!;
  const saveBox = (await save.boundingBox())!;

  await expect(remove).toHaveText('Delete');
  await expect(button(page, /^Remove repayment/)).toHaveCount(0);
  expect(Math.abs(removeBox.y + removeBox.height / 2 - (saveBox.y + saveBox.height / 2))).toBeLessThanOrEqual(1);
  expect(removeBox.y + removeBox.height).toBeLessThan((await field(page, 'Amount').boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath('repayment-header.png') });
  await remove.click();
  await expect(heading(page, 'Repayment changes')).toBeVisible();
  await expect(button(page, /^Change repayment:/)).toHaveCount(0);
  await expect(button(page, 'Ben, −12.00 EUR. Show details')).toBeVisible();
});

test('reads Activity offline and restores a removed expense', async ({ page, context }) => {
  await createGroup(page, 'History', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Dinner', '24', 'EUR');
  await button(page, 'Change Dinner · 24.00 EUR').click();
  await button(page, 'Delete Dinner · 24.00 EUR').click();
  await bell(page).click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await expect(page.getByText('All caught up. Every change from this device is in.')).toHaveCount(0);
  await expect(page.getByText('You created the group', { exact: true })).toBeVisible();
  await expect(page.getByText('You removed Dinner', { exact: true })).toBeVisible();
  await expect(page.getByText(/changed who they are/)).toHaveCount(0);
  await goOffline(page, context);
  await page.reload();
  await bell(page).click();
  await expect(page.getByText('You removed Dinner', { exact: true })).toBeVisible();
  await button(page, 'Restore expense').click();
  await button(page, 'Back to History').click();
  await expect(button(page, 'Change Dinner · 24.00 EUR')).toBeVisible();
});

test('undoes a money change and then reverses that undo through Activity', async ({ page }) => {
  await createGroup(page, 'Money undo', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '24', 'EUR');
  await person(page, 'Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await button(page, 'Ben pays you 12.00 EUR. Record this payment').click();
  await button(page, 'Record repayment').click();
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Money undo').click();
  await bell(page).click();
  await button(page, 'Undo: You recorded a repayment').click();
  await expect(page.getByText('You undid a change', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo: You recorded a repayment', disabled: false })).toHaveCount(0);
  await button(page, 'Undo: You undid a change').click();

  // Two undo entries, the newer one naming the undo it reverses in its detail.
  await expect(page.getByText('You undid a change', { exact: true })).toHaveCount(3);
  await button(page, 'Back to Money undo').click();
  await expect(button(page, 'Change repayment: Ben paid you back 12.00 EUR')).toBeVisible();
});

test('keeps member actions out of Undo while group rename remains reversible', async ({ page }) => {
  await createGroup(page, 'Original name', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Group settings').click();
  await field(page, 'Group name').fill('New name');
  await button(page, 'Save group name').click();
  await expect(heading(page, 'New name')).toBeVisible();
  await bell(page).click();
  await button(page, 'Undo: You renamed the group').click();
  await expect(page.getByText('You undid a change', { exact: true })).toBeVisible();
  await expect(button(page, 'Undo: You added Ben')).toHaveCount(0);
  await expect(page.getByText('You undid a change', { exact: true })).toHaveCount(1);
  await expect(button(page, 'Undo: You created the group')).toHaveCount(0);
  await button(page, 'Back to Original name').click();
  await expect(heading(page, 'Original name')).toBeVisible();
  await expect(person(page, 'Ben')).toBeVisible();
});

test('counts changes from others on the bell without pop-ups and marks them seen', async ({ page, browser }) => {
  await createGroup(page, 'Shared', 'Ana');
  await addMember(page, 'Ben');
  const link = await inviteLink(page);
  await expect(bell(page)).toHaveAccessibleName('Activity, no new updates');

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(link);
  await visitor.getByRole('radio', { name: 'Ana, taken', exact: true }).click();
  await expect(visitor.getByText('Ana is already taken on another device. You can still continue as Ana.')).toBeVisible();
  await button(visitor, 'Join as Ana').click();
  await expect(heading(visitor, 'Shared')).toBeVisible();
  await addExpense(visitor, 'Fresh dinner', '20', 'EUR');

  await expect(button(page, 'Change Fresh dinner · 20.00 EUR')).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Activity: 2 new updates');
  await expect(page.getByTestId('activity-count')).toHaveText('2');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(bell(visitor)).toHaveAccessibleName('Activity, no new updates');

  await bell(page).click();
  await expect(page.getByText('New', { exact: true })).toHaveCount(2);
  await button(page, 'Mark all seen').click();
  await expect(page.getByText('New', { exact: true })).toHaveCount(0);
  await expect(button(page, 'Mark all seen')).toHaveCount(0);
  await button(page, 'Back to Shared').click();
  await expect(bell(page)).toHaveAccessibleName('Activity, no new updates');
  await visitorContext.close();
});

test('keeps the expense header steady at the bottom of the split list', async ({ page }) => {
  await createGroup(page, 'Steady form', 'Ana');

  for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran', 'Gus']) await addMember(page, name);

  await button(page, 'Add expense').click();
  const amount = field(page, 'Amount');
  const scroller = page.locator('#splitnext-page');

  const scenarios = [
    ...[500, 540, 560, 580, 600, 620, 640, 660, 740].map((height) => ({ height, focused: false, reduced: false })),
    { height: 540, focused: true, reduced: false },
    { height: 540, focused: false, reduced: true },
  ];

  for (const scenario of scenarios) {
    const { height, focused, reduced } = scenario;

    await page.setViewportSize({ width: 390, height });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });

    if (focused) await amount.focus();
    else await amount.evaluate((input) => input.blur());

    await scroller.evaluate((node) => { node.scrollTop = 0; });
    await expect(amount).toHaveCSS('height', '64px');

    const box = (await scroller.boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const collecting = page.evaluate(() => new Promise<{ elapsed: number; top: number; header: number }[]>((resolve) => {
      const scroller = document.getElementById('splitnext-page')!;
      const start = performance.now();
      const samples: { elapsed: number; top: number; header: number }[] = [];

      (function frame() {
        const elapsed = performance.now() - start;

        samples.push({ elapsed, top: scroller.scrollTop, header: scroller.getBoundingClientRect().top });

        if (elapsed < 1500) requestAnimationFrame(frame);
        else resolve(samples);
      })();
    }));

    // Repeated real wheel input catches reflow at the bottom during collapse;
    // jumping once and sampling only after it settles missed this feedback loop.
    for (let step = 0; step < 8; step++) {
      await page.mouse.wheel(0, 25);
      await page.waitForTimeout(50);
    }

    const samples = await collecting;
    const reversals = samples.slice(1).map((sample, index) => sample.header - samples[index]!.header);
    const settled = samples.filter((sample) => sample.elapsed > 900);
    const headers = settled.map((sample) => sample.header);
    const positions = settled.map((sample) => sample.top);
    const detail = JSON.stringify({ scenario, reversal: Math.max(...reversals), settled });

    expect(Math.max(...reversals), detail).toBeLessThanOrEqual(1);
    expect(Math.max(...headers) - Math.min(...headers), detail).toBeLessThanOrEqual(1);
    expect(Math.max(...positions) - Math.min(...positions), detail).toBeLessThanOrEqual(1);

    for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -25);

    await expect(amount).toHaveCSS('height', '64px');
  }
});

test('shows as many balances as leave room for two expenses, shrinks them to your row on scroll, and shows all on request', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await createGroup(page, 'Long trip', 'Ana');
  const titleHeight = (await heading(page, 'Long trip').boundingBox())!.height;

  for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran', 'Gus', 'Hana', 'Ida']) await addMember(page, name);

  // Adding the later people listed everyone; show fewer again.
  await button(page, 'Show fewer people').click();

  for (const name of ['Cabin', 'Train', 'Groceries', 'Boat', 'Lunch', 'Taxi', 'Bakery', 'Museum', 'Dinner']) await addExpense(page, name, '60', 'EUR');

  const scroller = page.locator('#splitnext-page');
  // Where something sits in the page's scroll area: the header above it shrinks as the page scrolls,
  // through fractional heights, so positions are compared to within a pixel.
  const inPage = async (target: Locator) => ((await target.boundingBox())?.y ?? 0) - ((await scroller.boundingBox())?.y ?? 0);
  const off = async (target: Locator, expected: number) => Math.abs(await inPage(target) - expected);

  // Returning from the expense form restores the page's earlier position, so scroll up until it stays.
  await expect.poll(async () => {
    await scroller.evaluate((node) => { node.scrollTop = 0; });

    return scroller.evaluate((node) => node.scrollTop);
  }).toBe(0);

  // Not everyone fits above the first two expenses, so the default offers the rest.
  const showAll = button(page, 'Show all 9 people');
  await expect(showAll).toBeVisible();
  // Adding a person waits until everyone shows.
  await expect(field(page, 'Add a person')).toHaveCount(0);
  await expect(button(page, 'Change Dinner · 60.00 EUR')).toBeInViewport();
  await expect(button(page, 'Change Museum · 60.00 EUR')).toBeInViewport();

  // Ending at a whole person must not reserve the unused part of the viewport.
  // Expenses follow the disclosure with just the normal section spacing.
  const expensesGap = async () => {
    const more = await showAll.boundingBox();
    const expenses = await heading(page, 'Expenses').boundingBox();

    return more && expenses ? expenses.y - (more.y + more.height) : Number.POSITIVE_INFINITY;
  };

  await expect.poll(expensesGap).toBeLessThanOrEqual(24);
  await page.screenshot({ path: testInfo.outputPath('mobile-top.png') });

  // The page is the only scroll area: the pinned balances belong to it.
  const scrollAreas = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((node) =>
    ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight ? [node.id || node.tagName] : []));

  expect(scrollAreas).toEqual(['splitnext-page']);

  // Scrolling shrinks the balances with the expenses right below, cutting from the bottom
  // (the empty base below the card, then people) until only the heading is pinned.
  const balancesHeading = heading(page, 'Balances');
  const rows = page.getByRole('button', { name: /Show details$/ });
  const shown = await rows.count();
  const top = await inPage(button(page, 'Change Dinner · 60.00 EUR'));
  await scroller.evaluate((node) => { node.scrollTop = 20; });
  await expect.poll(() => off(button(page, 'Change Dinner · 60.00 EUR'), top - 20)).toBeLessThanOrEqual(1);

  // Past the empty base, the people are cut, and the floating “···” button rides the card's cut edge.
  await expect.poll(async () => {
    await scroller.evaluate((node) => { node.scrollTop += 8; });

    return rows.count();
  }, { intervals: [50] }).toBe(shown - 1);
  await expect(showAll).toBeAttached();
  const before = await inPage(showAll);
  await scroller.evaluate((node) => { node.scrollTop += 10; });
  await expect.poll(() => off(showAll, before - 10)).toBeLessThanOrEqual(1);

  // Tapping it jumps back up, without a smooth scroll, and lists everyone, ending with Show fewer.
  // It is tapped where it shows: it rides the edge of the pinned section, and scrolling it into
  // view first, as a locator click does, can scroll the page to the section's place in the flow.
  const riding = await showAll.boundingBox();
  await page.mouse.click((riding?.x ?? 0) + (riding?.width ?? 0) / 2, (riding?.y ?? 0) + (riding?.height ?? 0) / 2);
  await expect(button(page, 'Show fewer people')).toBeVisible();
  expect(await scroller.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(person(page, 'Ida')).toBeInViewport();

  // Small scrolls must not show the pinned heading over a second flowing copy.
  for (const scrollTop of [1, 12, 24, 80, 0]) {
    await scroller.evaluate((node, top) => { node.scrollTop = top; }, scrollTop);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(scrollTop);
    await expect(heading(page, 'Balances')).toHaveCount(1);
    await expect(button(page, 'Invite people')).toHaveCount(1);
    await expect(heading(page, 'Balances')).toBeInViewport();
  }

  await scroller.evaluate((node) => { node.scrollTop = 12; });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(12);
  await page.screenshot({ path: testInfo.outputPath('mobile-expanded-scrolled.png') });

  // Showing fewer from further down closes the card while scrolling back up: “···” glides to where it rests, without a jump.
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  // Let the preceding scroll's compact-header motion settle before measuring the close.
  await page.evaluate(() => new Promise<void>((resolve) => {
    let previous: number | undefined;
    let stable = 0;

    (function frame() {
      const top = document.querySelector('[aria-label="Show fewer people"]')?.getBoundingClientRect().top;

      stable = top === previous ? stable + 1 : 0;
      previous = top;

      if (stable >= 3) resolve();
      else requestAnimationFrame(frame);
    })();
  }));

  const path = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const more = () => document.querySelector<HTMLElement>('[aria-label="Show fewer people"], [aria-label^="Show all"]');
    const tops: number[] = [];
    const start = performance.now();

    const page = document.getElementById('splitnext-page');

    more()?.click();
    (function frame() {
      tops.push((more()?.getBoundingClientRect().top ?? Number.NaN) - (page?.getBoundingClientRect().top ?? 0));

      if (performance.now() - start < 800) requestAnimationFrame(frame);
      else resolve(tops);
    })();
  }));

  await expect(showAll).toBeVisible();
  expect(await scroller.evaluate((node) => node.scrollTop)).toBe(0);
  expect(Math.abs((path.at(-1) ?? 0) - await inPage(showAll))).toBeLessThan(1);

  // One way, with no frame covering more than a fifth of the distance.
  const steps = path.slice(1).map((top, index) => top - (path[index] ?? top));
  const distance = (path.at(-1) ?? 0) - (path[0] ?? 0);

  for (const step of steps) {
    expect(step * Math.sign(distance)).toBeGreaterThan(-1);
    expect(Math.abs(step)).toBeLessThan(Math.max(30, Math.abs(distance) / 5));
  }

  await scroller.evaluate((node) => { node.scrollTop = 110; });
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(rows).toHaveCount(0);
  await expect(balancesHeading).toBeInViewport();
  expect((await heading(page, 'Long trip').boundingBox())!.height).toBe(titleHeight);
  await expect(button(page, 'Invite people')).toBeInViewport();
  await expect(heading(page, 'Expenses')).toBeInViewport();
  await expect.poll(async () => {
    const bounds = await button(page, 'Add expense').boundingBox();

    return Boolean(bounds && bounds.y + bounds.height <= 640);
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-scrolled.png') });

  // Tapping the pinned heading scrolls smoothly back to the top, where the default returns.
  await balancesHeading.click();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(showAll).toBeInViewport();

  // Tapping the Expenses heading scrolls the expenses up under the pinned Balances heading.
  await heading(page, 'Expenses').click();
  await expect(rows).toHaveCount(0);
  await expect.poll(async () => {
    const balancesBox = await balancesHeading.boundingBox();
    const expensesBox = await heading(page, 'Expenses').boundingBox();

    return Boolean(balancesBox && expensesBox && expensesBox.y > balancesBox.y && expensesBox.y - (balancesBox.y + balancesBox.height) < 30);
  }).toBe(true);

  // The first expense sits right under the pinned Expenses heading.
  await expect.poll(async () => {
    const expensesBox = await heading(page, 'Expenses').boundingBox();
    const firstBox = await button(page, 'Change Dinner · 60.00 EUR').boundingBox();

    return Boolean(expensesBox && firstBox && Math.abs(firstBox.y - (expensesBox.y + expensesBox.height)) <= 8);
  }).toBe(true);
  await balancesHeading.click();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);

  // Show all lists everyone in the page under the pinned heading, and Show fewer goes back.
  // Click the visible sticky control without locator auto-scrolling its flow spacer.
  await expect(showAll).toBeInViewport();
  const resting = (await showAll.boundingBox())!;

  await page.mouse.click(resting.x + resting.width / 2, resting.y + resting.height / 2);
  await expect(person(page, 'Gus')).toBeVisible();
  await expect(button(page, 'Show fewer people')).toBeVisible();
  await expect(field(page, 'Add a person')).toBeVisible();
  await heading(page, 'Expenses').click({ position: { x: 20, y: 8 } });
  await expect.poll(async () => {
    const expensesBox = await heading(page, 'Expenses').boundingBox();
    const firstBox = await button(page, 'Change Dinner · 60.00 EUR').boundingBox();

    return Boolean(expensesBox && firstBox && Math.abs(firstBox.y - (expensesBox.y + expensesBox.height)) <= 8);
  }).toBe(true);
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(balancesHeading.first()).toBeInViewport();
  await balancesHeading.first().click();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);

  // Showing fewer from further down scrolls back to the top.
  await button(page, 'Show fewer people').evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await button(page, 'Show fewer people').click();
  await expect(showAll).toBeVisible();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await scroller.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(expensesGap).toBeLessThanOrEqual(24);

  // The gap follows the card rather than growing with the available viewport.
  for (const viewport of [{ width: 390, height: 760 }, { width: 320, height: 640 }, { width: 1100, height: 700 }]) {
    await page.setViewportSize(viewport);
    await expect(showAll).toBeVisible();
    await expect.poll(expensesGap).toBeLessThanOrEqual(24);
  }
});
