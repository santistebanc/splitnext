import { expect, test, type Page } from '@playwright/test';

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

/**
 * Text whose letters reach past the box that clips it, such as a one-line
 * title cutting off descenders: each text's ink, from the font's own metrics,
 * against its nearest clipping box. A line box's height does not show this.
 */
function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d')!;
    const clips = (node: Element) => getComputedStyle(node).overflow !== 'visible';
    const found: string[] = [];

    for (const element of document.querySelectorAll('body *')) {
      const text = [...element.childNodes].flatMap((node) => (node.nodeType === Node.TEXT_NODE ? [node.textContent] : [])).join('').trim();
      const style = getComputedStyle(element);
      let clipper: Element | null = element;

      while (clipper && !clips(clipper)) clipper = clipper.parentElement;

      if (!text || style.visibility === 'hidden' || !clipper || clipper.id === 'splitnext-page' || clipper === document.body) continue;
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const metrics = canvas.measureText(text);
      const content = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
      const line = style.lineHeight === 'normal' ? content : parseFloat(style.lineHeight);
      const box = element.getBoundingClientRect();
      const edge = clipper.getBoundingClientRect();
      const baseline = box.top + (line - content) / 2 + metrics.fontBoundingBoxAscent;
      const lastBaseline = baseline + (Math.max(1, Math.round(box.height / line)) - 1) * line;
      const cut = Math.max(edge.top - (baseline - metrics.actualBoundingBoxAscent), lastBaseline + metrics.actualBoundingBoxDescent - edge.bottom);

      if (cut > 0.5) found.push(`${text} (${style.fontSize} on ${line}px) loses ${cut.toFixed(1)}px`);
    }

    return found;
  });
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

/** Adds a person in the last row of the balances; ending the typing saves it. */
async function addMember(page: Page, name: string): Promise<void> {
  await field(page, 'Add a person').fill(name);
  await field(page, 'Add a person').press('Enter');
  await expect(page.getByRole('button', { name: new RegExp(`^${escaped(name)}, .*\\. Show details$`), includeHidden: true })).toBeAttached();
}

/** Adds an expense from the group screen and returns to it. */
async function addExpense(page: Page, description: string, amount: string, payer?: string): Promise<void> {
  await button(page, 'Add expense').click();
  await expect(field(page, 'Amount')).toBeVisible();
  await field(page, 'Amount').fill(amount);

  if (payer) {
    await button(page, /^Paid by .*Change payer$/).click();
    await page.getByRole('radio', { name: new RegExp(`^${escaped(payer)}( \\(you\\))?$`) }).click();
  }

  await field(page, 'Description').fill(description);
  await button(page, 'Save').click();
  await expect(button(page, new RegExp(`^Change ${escaped(description)} · `))).toBeVisible();
}

/** Reads the invite link, opened in place under the group's name, and closes it. */
async function inviteLink(page: Page): Promise<string> {
  await button(page, 'Invite people').click();
  const panel = page.getByRole('region', { name: 'Invite people' });
  const shown = (await panel.getByTestId('invite-link').textContent()) ?? '';
  await button(page, 'Invite people').click();
  await expect(panel).toHaveCount(0);

  // The panel shows the link without its scheme.
  expect(shown).not.toMatch(/^https?:/);

  return `${new URL(page.url()).protocol}//${shown}`;
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
  // Renaming edits the large name in place and saves on Enter.
  await button(page, 'Rename Ben').click();
  await field(page, 'Name').fill('Benjamin');
  await field(page, 'Name').press('Enter');
  await expect(heading(page, 'Benjamin')).toBeVisible();

  // This is me sits at the end of the line saying whether the name is taken.
  const claim = (await button(page, 'I’m Benjamin').boundingBox())!;
  const presence = (await page.getByText('Not taken on any device', { exact: true }).boundingBox())!;

  expect(Math.abs(claim.y + claim.height / 2 - (presence.y + presence.height / 2))).toBeLessThanOrEqual(2);
  expect(claim.x).toBeGreaterThan(presence.x + presence.width);

  // Choosing someone as you needs no confirmation.
  await button(page, 'I’m Benjamin').click();
  await expect(button(page, 'I’m Benjamin')).toHaveCount(0);
  await expect(page.getByText('you', { exact: true })).toBeVisible();
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

test('removes someone no expense names with the X on their row', async ({ page }) => {
  await createGroup(page, 'Rows', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');

  // Before any expense, everyone has the X; afterwards only Cy, whom it leaves out.
  await expect(button(page, 'Remove Ben')).toBeVisible();
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('20');
  await field(page, 'Description').fill('Lunch');
  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await button(page, 'Save').click();
  await expect(button(page, 'Remove Ana')).toHaveCount(0);
  await expect(button(page, 'Remove Ben')).toHaveCount(0);

  // The X sits at the end of Cy's row and removes Cy at once, without opening the details.
  const row = (await person(page, 'Cy').boundingBox())!;
  const x = (await button(page, 'Remove Cy').boundingBox())!;

  expect(x.x).toBeGreaterThanOrEqual(row.x + row.width - 1);
  expect(Math.abs(x.y + x.height / 2 - (row.y + row.height / 2))).toBeLessThanOrEqual(1);
  await button(page, 'Remove Cy').click();
  await expect(person(page, 'Cy')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toHaveText('Cy removed.');
  await expect(heading(page, 'Rows')).toBeVisible();
});

test('uses one large title on every screen and opens the join field in place', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Headers', 'Ana');
  await expect(heading(page, 'Headers')).toHaveCSS('font-size', '42px');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '20');
  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toHaveCSS('font-size', '42px');
  await button(page, 'Settle up, 1 payment').click();
  await expect(heading(page, 'Settle up')).toHaveCSS('font-size', '42px');
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Headers').click();
  await bell(page).click();
  await expect(heading(page, 'Activity')).toHaveCSS('font-size', '42px');
  await button(page, 'Back to Headers').click();
  await button(page, 'Back to groups').click();
  // The groups list shows the mark, about as tall as a title, instead of one.
  await expect(page.getByText('Your groups', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('splitnext-logo')).toHaveAttribute('height', '44');
  await button(page, 'New group').click();
  await expect(heading(page, 'New group')).toHaveCSS('font-size', '42px');
  await button(page, 'Back to groups').click();

  // Join opens a link field directly under itself, above the mark; a link that
  // is not an invite says so there.
  await button(page, 'Join with an invite link').click();
  const join = (await button(page, 'Join with an invite link').boundingBox())!;
  const linkField = (await field(page, 'Invite link').boundingBox())!;
  const mark = (await page.getByTestId('splitnext-logo').boundingBox())!;

  expect(linkField.y).toBeGreaterThanOrEqual(join.y + join.height - 1);
  expect(linkField.y - (join.y + join.height)).toBeLessThan(24);
  expect(mark.y).toBeGreaterThan(linkField.y + linkField.height);
  await field(page, 'Invite link').fill('not a link');
  await button(page, 'Open').click();
  await expect(page.getByText('That isn’t a splitnext invite link.', { exact: true })).toBeVisible();
});

test('keeps the fixed theme and group-list branding when offline', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/app');
  await expect(page.locator('#splitnext-page')).toHaveCSS('background-color', 'rgb(246, 245, 241)');
  await expect(button(page, 'New group')).toHaveCSS('background-color', 'rgb(20, 20, 19)');

  await button(page, /^(New group|Create a group)$/).click();
  await field(page, 'Group name').fill('Paper trip');
  await field(page, 'Your name in this group').fill('Ana');
  await button(page, 'Create group').click();
  await expect(heading(page, 'Paper trip')).toBeVisible();
  await button(page, 'Back to groups').click();
  await expect(heading(page, 'Your groups')).toBeVisible();
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
  await person(page, 'Ana').click();
  await expect(page.getByText('Offline · taken on 1 device', { exact: true })).toBeVisible();
  await button(page, 'Back to Paper trip').click();

  const appearance = await page.evaluate(async () => {
    const faces = [
      ...await document.fonts.load('600 16px "Instrument Sans"'),
      ...await document.fonts.load('500 16px "Geist Mono"'),
    ];

    const assets = await Promise.all(
      ['/assets/instrument-sans.woff2', '/assets/geist-mono.woff2', '/icon.svg']
        .map(async (url) => (await fetch(url)).ok),
    );

    const loaded = (family: string) => faces.some((face) => face.family.replace(/"/g, '') === family && face.status === 'loaded');

    return { font: loaded('Instrument Sans') && loaded('Geist Mono'), assets };
  });

  expect(appearance.font).toBe(true);
  expect(appearance.assets).toEqual([true, true, true]);
});

test('shows balance summaries offline and keeps people who still owe or are owed', async ({ page, context }) => {
  await createGroup(page, 'Summaries', 'Ana');
  await addMember(page, 'Ben');

  await button(page, 'Back to groups').click();
  await expect(page.getByText('settled', { exact: true })).toBeVisible();
  await button(page, 'Open Summaries').click();
  await addExpense(page, 'Dinner', '60', 'Ana');
  await addExpense(page, 'Tickets', '40', 'Ben');
  await expect(button(page, 'Ana (you), +10.00. Show details')).toBeVisible();

  await goOffline(page, context);
  await button(page, 'Back to groups').click();
  await expect(page.getByText('+10.00', { exact: true })).toBeVisible();
  await button(page, 'Open Summaries').click();
  await person(page, 'Ana').click();

  // Expenses name Ana, so her details offer no Remove and no explanation.
  await expect(button(page, 'Remove Ana')).toHaveCount(0);
  await expect(page.getByText(/^Settle up first/)).toHaveCount(0);
  await button(page, 'Back to Summaries').click();
});

test('shows each balance as a bar and your balance on the groups list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Bars', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '20');
  const add = button(page, 'Add expense');

  // Add expense is the screen's one black action, full width at its foot.
  await expect(add).toHaveCSS('background-color', 'rgb(20, 20, 19)');
  const box = (await add.boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  expect(box.y + box.height).toBeGreaterThan(760 - 60);
  await expect(button(page, 'Ana (you), +10.00. Show details')).toBeVisible();
  await expect(button(page, 'Ben, −10.00. Show details')).toBeVisible();

  await button(page, 'Back to groups').click();
  await expect(page.getByText('+10.00', { exact: true })).toBeVisible();
  await expect(page.getByText('2 people · You’re Ana', { exact: true })).toBeVisible();
});

test('records, changes, and removes an expense with plain-number balances', async ({ page }) => {
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

  // Amounts are plain numbers: there is no currency to choose.
  await expect(button(page, /Change currency$/)).toHaveCount(0);
  await field(page, 'Amount').fill('30');
  await expect(page.getByTestId('split-summary')).toHaveText('15.00 each');
  await expect(field(page, 'Amount for Ben')).toHaveCount(0);
  await field(page, 'Description').fill('Dinner');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Dinner · 30.00')).toBeVisible();
  await expect(addButton).toBeVisible();
  expect(await addButton.boundingBox()).toEqual(addPosition);
  await expect(button(page, 'Ana (you), +15.00. Show details')).toBeVisible();
  await expect(button(page, 'Ben, −15.00. Show details')).toBeVisible();

  await button(page, 'Change Dinner · 30.00').click();
  await expect(field(page, 'Amount')).not.toBeFocused();
  await field(page, 'Amount').fill('40');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Dinner · 40.00')).toBeVisible();

  // An expense names Ben, so he cannot be removed.
  await person(page, 'Ben').click();
  await expect(button(page, 'Remove Ben')).toHaveCount(0);
  await expect(page.getByText(/^Settle up first/)).toHaveCount(0);
  await button(page, 'Back to Trip').click();

  // Deleting happens from the expense's own screen, which returns to the group.
  await button(page, 'Change Dinner · 40.00').click();
  await button(page, 'Delete Dinner · 40.00').click();
  await expect(page.getByText('No expenses yet', { exact: true })).toHaveCount(0);
  await expect(addButton).toBeVisible();
  expect(await addButton.boundingBox()).toEqual(addPosition);
  await expect(button(page, 'Ana (you), no expenses yet. Show details')).toBeVisible();

  // Settled again, Ben still stays: the removed expense names him, and only
  // someone no expense or repayment names can be removed.
  await person(page, 'Ben').click();
  await expect(button(page, 'Remove Ben')).toHaveCount(0);
  await expect(button(page, 'Hide Ben')).toHaveCount(0);
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

  await amount.fill('12,5');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Lunch · 12.50')).toBeVisible();
});

test('keeps split rows aligned without an amount, then shows each share', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Zero amount', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'A person with a long name');
  await button(page, 'Add expense').click();

  // Without an amount, each row shows only its checkbox.
  for (const amount of ['', '0', '0.00']) {
    await field(page, 'Amount').fill(amount);
    await expect(button(page, /^Amount for /)).toHaveCount(0);
    await expect(button(page, /^(Increase|Decrease) share for /)).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(3);
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const checks = [];

    for (const name of ['Ana', 'Ben', 'A person with a long name']) {
      const check = await page.getByRole('checkbox', { name: `${name} shares this expense`, exact: true }).boundingBox();

      expect(check).not.toBeNull();
      checks.push(check!.x);
    }

    expect(new Set(checks).size).toBe(1);
  }

  await page.screenshot({ path: testInfo.outputPath('zero-amount-split.png') });
  await field(page, 'Amount').fill('90');
  await expect(page.getByText('Describe the expense.', { exact: true })).toHaveCount(0);
  await expect(button(page, 'Amount for Ana: 30.00. Change amount')).toBeVisible();
  await button(page, 'Increase share for Ana').click();
  await expect(button(page, 'Amount for Ana: 45.00. Change amount')).toBeVisible();
  await expect(page.getByTestId('split-summary')).toHaveText('3 people');

  // Clearing the amount hides + and − again, even for Ana's second share, and
  // a valid amount brings them back.
  await field(page, 'Amount').fill('0');
  await expect(button(page, /^(Increase|Decrease) share for /)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Ana shares this expense' })).toBeChecked();
  await field(page, 'Amount').fill('90');
  await expect(button(page, 'Decrease share for Ana')).toBeVisible();
  // There is no Split equally link; taking Ana's extra share away evens it out.
  await expect(button(page, 'Split equally')).toHaveCount(0);
  await button(page, 'Decrease share for Ana').click();
  await expect(button(page, 'Amount for Ana: 30.00. Change amount')).toBeVisible();
  await expect(page.getByTestId('split-summary')).toHaveText('30.00 each');
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

  const center = async (target: ReturnType<typeof button>) => {
    const box = (await target.boundingBox())!;

    return box.x + box.width / 2;
  };

  // Above one share or with a fixed amount, the checkbox at the end becomes −.
  await expect(page.getByRole('checkbox', { name: 'Ana shares this expense' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Cy shares this expense' })).toHaveCount(0);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const amount = (await button(page, /^Amount for Ana:/).boundingBox())!;
    const fixed = (await field(page, 'Amount for Cy').boundingBox())!;
    const end = await center(button(page, 'Decrease share for Ana'));

    expect(Math.abs(fixed.x + fixed.width - (amount.x + amount.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(await center(button(page, 'Decrease share for Cy')) - end)).toBeLessThanOrEqual(1);
    expect(Math.abs(await center(page.getByRole('checkbox', { name: 'Benjamin Alexander shares this expense' })) - end)).toBeLessThanOrEqual(1);
    // + sits before the amount, and only where it changes the split: Ana alone
    // divides the rest, so another share would change nothing.
    expect(await center(button(page, 'Increase share for Cy'))).toBeLessThan(fixed.x);
    await expect(button(page, 'Increase share for Ana')).toHaveCount(0);
    await expect(button(page, 'Increase share for Benjamin Alexander')).toHaveCount(0);
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

  await field(page, 'Description').fill('Mixed dinner');
  await expect(button(page, 'Decrease share for Ana')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Ana shares this expense' })).toBeChecked();
  await button(page, 'Increase share for Ana').click();
  await expect(button(page, 'Decrease share for Ana')).toBeEnabled();
  await button(page, 'Increase share for Ana').click();
  await button(page, 'Increase share for Ben').click();
  await expect(page.getByTestId('split-summary')).toHaveText('3 people');
  await expect(button(page, 'Amount for Ana: 50.00. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 33.33. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 16.67. Change amount')).toBeVisible();

  // Fix one person while the others retain their 3:2 weights.
  await button(page, /^Amount for Cy:/).click();
  await expect(field(page, 'Amount for Cy')).toBeFocused();
  // Its shown share is selected, so typing replaces it.
  await page.keyboard.type('101');
  await expect(field(page, 'Amount for Cy')).toHaveValue('101.00');
  await expect(button(page, 'Save')).toBeDisabled();
  await expect(page.getByText('The amounts add up to more than the total.', { exact: true })).toBeVisible();
  // The fixed amount is formatted like the expense's own: two decimals, a comma read as the point.
  await field(page, 'Amount for Cy').fill('12,5');
  await expect(field(page, 'Amount for Cy')).toHaveValue('12.50');
  await field(page, 'Amount for Cy').fill('20');
  await field(page, 'Amount for Cy').press('Enter');
  await expect(button(page, 'Amount for Ana: 48.00. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 32.00. Change amount')).toBeVisible();
  await expect(field(page, 'Amount for Cy')).toHaveValue('20.00');
  await field(page, 'Amount').fill('130');
  await expect(button(page, 'Amount for Ana: 66.00. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 44.00. Change amount')).toBeVisible();
  await expect(field(page, 'Amount for Cy')).toHaveValue('20.00');
  await field(page, 'Amount').fill('100');

  await goOffline(page, context);
  await button(page, 'Save').click();
  await button(page, 'Change Mixed dinner · 100.00').click();
  await expect(button(page, 'Delete Mixed dinner · 100.00')).toBeVisible();
  await expect(button(page, 'Amount for Ana: 48.00. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 32.00. Change amount')).toBeVisible();
  await expect(field(page, 'Amount for Cy')).toHaveValue('20.00');

  // Editing only the occasion must keep both the fixed value and the weights.
  await field(page, 'Description').fill('Mixed dinner edited');
  await button(page, 'Save').click();
  await button(page, 'Change Mixed dinner edited · 100.00').click();
  await expect(button(page, 'Amount for Ana: 48.00. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 32.00. Change amount')).toBeVisible();
  await field(page, 'Amount for Cy').fill('');
  await field(page, 'Amount for Cy').press('Enter');
  await expect(button(page, 'Amount for Ana: 50.00. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Ben: 33.33. Change amount')).toBeVisible();
  await expect(button(page, 'Amount for Cy: 16.67. Change amount')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await expect(button(page, /^Amount for Cy:/)).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await expect(button(page, 'Amount for Cy: 16.67. Change amount')).toBeVisible();
  await button(page, 'Cancel').click();
  await goOnline(page, context);
});

test('explains a balance and settles it with the fewest payments', async ({ page }) => {
  await createGroup(page, 'Settle', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');
  await addExpense(page, 'Dinner', '90');
  await addExpense(page, 'Taxi', '30', 'Ben');

  // You first, then whoever owes most: Cy owes 40, Ben 10.
  expect(await page.getByRole('button', { name: /Show details$/ }).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))).toEqual([
    'Ana (you), +50.00. Show details',
    'Cy, −40.00. Show details',
    'Ben, −10.00. Show details',
  ]);

  // Ben paid 30 and owes 40: the breakdown adds up to his balance.
  await person(page, 'Ben').click();
  await expect(page.getByText('Owes', { exact: true })).toBeVisible();
  await expect(button(page, 'Dinner, −30.00')).toBeVisible();
  await expect(button(page, 'Taxi, +20.00')).toBeVisible();
  // The balance card and the breakdown's Balance row show the same total.
  await expect(page.getByText('−10.00', { exact: true })).toHaveCount(2);

  // Ben pays Ana directly; Cy's debt is a separate payment Ben is not part of.
  await button(page, 'Settle up, 1 payment').click();
  await expect(heading(page, 'Settle up')).toBeVisible();
  await expect(button(page, 'Ben pays you 10.00. Record this payment')).toBeVisible();

  // A different payment opens the form with what is owed; a partial one leaves the rest in the plan.
  await button(page, 'Record a different payment').click();
  await expect(field(page, 'Amount')).toHaveValue('10.00');
  await field(page, 'Amount').fill('4');
  await button(page, 'Record repayment').click();
  await expect(button(page, 'Ben pays you 6.00. Record this payment')).toBeVisible();

  // Record records a planned payment at once.
  await button(page, 'Ben pays you 6.00. Record this payment').click();
  await expect(page.getByText('✓ Settled', { exact: true })).toBeVisible();
  await button(page, 'Back to Ben').click();
  await expect(button(page, /^Settle up/)).toHaveCount(0);
  await button(page, 'Back to Settle').click();
  await expect(button(page, 'Change repayment: Ben paid you back 4.00')).toBeVisible();
  await expect(button(page, 'Ben, 0.00. Show details')).toBeVisible();
  await expect(person(page, 'Ben').getByText('0.00', { exact: true })).toBeVisible();

  // Settled people sort before people in no expense yet.
  await addMember(page, 'Dee');
  expect(await page.getByRole('button', { name: /Show details$/ }).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))).toEqual([
    expect.stringMatching(/^Ana \(you\), /),
    expect.stringMatching(/^Cy, /),
    'Ben, 0.00. Show details',
    'Dee, no expenses yet. Show details',
  ]);
  await expect(person(page, 'Dee')).toHaveText('Dee');
  await person(page, 'Dee').click();
  await expect(page.getByText('No expenses yet', { exact: true })).toBeVisible();
  await button(page, 'Back to Settle').click();
  await person(page, 'Ben').click();
  await expect(page.getByText('Settled', { exact: true })).toBeVisible();
  await expect(page.getByText('0.00', { exact: true })).toHaveCount(2);

  // Settled people whose expenses name them stay, without Remove.
  await expect(button(page, 'Remove Ben')).toHaveCount(0);
  await expect(button(page, 'Hide Ben')).toHaveCount(0);
});

test('opens who paid in place and keeps the choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Payers', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  await button(page, 'Paid by Ana (you). Change payer').click();
  const payers = page.getByRole('radiogroup', { name: 'Paid by' });

  await expect(payers).toBeVisible();
  await expect(payers.getByRole('radio', { name: 'Ana', exact: true })).toBeChecked();
  await payers.getByRole('radio', { name: 'Ben', exact: true }).click();
  await expect(payers).toHaveCount(0);
  await expect(button(page, 'Paid by Ben. Change payer')).toBeVisible();
});

test('renames the group in place, copies the invite link, and replaces it after confirming', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createGroup(page, 'Trip', 'Ana');
  await button(page, 'Rename group').click();
  await field(page, 'Group name').fill('Lisbon');
  await field(page, 'Group name').press('Enter');
  await expect(heading(page, 'Lisbon')).toBeVisible();

  // The link opens in place under the name.
  await button(page, 'Invite people').click();
  const panel = page.getByRole('region', { name: 'Invite people' });
  const before = (await panel.getByTestId('invite-link').textContent()) ?? '';

  // One row: the link, with Replace as an icon at its right; there is no Copy link button.
  const linkBox = (await panel.getByTestId('invite-link').boundingBox())!;
  const replaceBox = (await panel.getByRole('button', { name: 'Replace link', exact: true }).boundingBox())!;

  expect(replaceBox.x).toBeGreaterThan(linkBox.x + linkBox.width);
  expect(Math.abs(replaceBox.y + replaceBox.height / 2 - (linkBox.y + linkBox.height / 2))).toBeLessThanOrEqual(2);
  expect(replaceBox.width).toBeLessThanOrEqual(44);
  await expect(panel.getByText('Copy link', { exact: true })).toHaveCount(0);

  // Tapping the link itself highlights and copies it.
  await panel.getByTestId('invite-link').click();
  await expect(panel.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  await expect(panel.getByText('✓ Copied', { exact: true })).toBeVisible();
  // The panel shows the link without its scheme; the copy keeps it, so it opens when tapped.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://${before}`);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(before);

  // Replacing asks first, in the same place.
  await panel.getByRole('button', { name: 'Replace link', exact: true }).click();
  await expect(panel.getByText('The old link will stop working. Everyone already in the group keeps their access.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(panel.getByTestId('invite-link')).not.toHaveText(before);
  await button(page, 'Invite people').click();
  await expect(panel).toHaveCount(0);
});

test('adds each name typed while earlier ones are still saving', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');

  // Enter clears the field and keeps it focused, so names can be typed one
  // after another without waiting: each is added, none merged or dropped.
  const add = field(page, 'Add a person');

  await add.click();

  for (const name of ['Ben', 'Cy', 'Dana']) {
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(add).toBeFocused();
    await expect(add).toHaveValue('');
  }

  for (const name of ['Ben', 'Cy', 'Dana']) await expect(person(page, name)).toBeVisible();
  await expect(page.getByRole('button', { name: /Show details$/ })).toHaveCount(4);

  // Enter on the empty field finishes.
  await page.keyboard.press('Enter');
  await expect(add).not.toBeFocused();
  await expect(button(page, 'Add expense')).toBeEnabled();
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

  // The invite opens in place as its own history entry, so Back closes it.
  await button(page, 'Invite people').click();
  await expect(page.getByRole('region', { name: 'Invite people' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Invite people' })).toHaveCount(0);
  await expect(heading(page, 'Trip')).toBeVisible();
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

  await someoneElse.click();
  await expect(someoneElse).toBeChecked();
  await visitor.getByRole('radio', { name: /^Ana/ }).click();
  await expect(someoneElse).not.toBeChecked();

  // Typing a new name chooses Someone else.
  await field(visitor, 'Your name').fill('Dana');
  await expect(someoneElse).toBeChecked();
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
  await expect(button(page, 'Join with an invite link')).toBeVisible({ timeout: 2000 });

  // The invite token leaves the address bar with the join page.
  await expect(page).toHaveURL(/\/app$/);

  // The link as the invite panel shows it, without its scheme, opens the invite too.
  await page.unroute('**/invites/preview');
  await button(page, 'Join with an invite link').click();
  await field(page, 'Invite link').fill(link.replace(/^https?:\/\//, ''));
  await button(page, 'Open').click();
  await expect(page.getByText(/Which one are you\?/)).toBeVisible();
});

test('keeps offline edits pending and delivers them on reconnect', async ({ page, context }) => {
  await createGroup(page, 'Trip', 'Ana');
  await addMember(page, 'Ben');
  const headerTop = (await button(page, 'Back to groups').boundingBox())!.y;

  await goOffline(page, context);
  await expect(button(page, 'Offline. Connection details')).toBeVisible();
  const strip = button(page, /Connection details$/);
  const stripBounds = (await strip.boundingBox())!;

  expect(stripBounds.y).toBe(0);
  expect(stripBounds.height).toBeLessThanOrEqual(32);
  expect(Math.abs((await button(page, 'Back to groups').boundingBox())!.y - headerTop - stripBounds.height)).toBeLessThanOrEqual(1);
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
  await button(page, 'Back to groups').click();
  await expect(button(page, 'Offline · 1 change saved here. Connection details')).toBeVisible();
  await expect(strip).toHaveText('Offline · 1 change saved here');
  await button(page, 'Offline · 1 change saved here. Connection details').click();
  await expect(page.getByRole('dialog', { name: 'Connection' })).toBeVisible();
  await expect(button(page, 'Retry')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await button(page, 'Open Trip').click();
  await expect(strip).toHaveText('Offline · 1 change saved here');
  await goOnline(page, context);
  await expect(button(page, /Connection details$/)).toHaveCount(0, { timeout: 15_000 });
  await expect(person(page, 'Benjamin')).toBeVisible();
});

test('puts server connection failures and retry in the header details', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Connection test', 'Ana');
  const headerTop = (await button(page, 'Back to groups').boundingBox())!.y;
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
  expect(Math.abs((await button(page, 'Back to groups').boundingBox())!.y - headerTop - stripBounds.height)).toBeLessThanOrEqual(1);
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

test('leaves from the groups list after confirming and rejoins as an existing member', async ({ page }) => {
  await createGroup(page, 'Lisbon', 'Ana');
  await button(page, 'Back to groups').click();
  await button(page, 'Leave Lisbon').click();
  await expect(page.getByText('Leave Lisbon on this device? You can rejoin it later.', { exact: true })).toBeVisible();
  await button(page, 'Cancel').click();
  await expect(page.getByText(/^Leave Lisbon on this device/)).toHaveCount(0);
  await button(page, 'Leave Lisbon').click();
  await button(page, 'Leave').click();
  await button(page, 'Show 1 group you left').click();
  await button(page, 'Rejoin Lisbon').click();
  await page.getByRole('radio', { name: /^Ana/ }).click();
  await button(page, 'Rejoin as Ana').click();
  await expect(field(page, 'Add a person')).toBeVisible();
});

test('records planned and other repayments offline', async ({ page, context }) => {
  await createGroup(page, 'Repayments', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await addExpense(page, 'Dinner', '60');
  await page.setViewportSize({ width: 390, height: 844 });
  await person(page, 'Benjamin Alexander').click();
  await goOffline(page, context);
  await button(page, 'Settle up, 1 payment').click();
  await expect(button(page, 'Benjamin Alexander pays you 30.00. Record this payment')).toBeVisible();
  await button(page, 'Record a different payment').click();
  await expect(field(page, 'Amount')).toHaveValue('30.00');
  await field(page, 'Amount').fill('10');
  await button(page, 'Record repayment').click();
  await expect(button(page, 'Benjamin Alexander pays you 20.00. Record this payment')).toBeVisible();
  expect(await page.locator('#splitnext-page').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await button(page, 'Record a different payment').click();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 10.00')).toBeVisible();
  await field(page, 'Amount').fill('5');
  await button(page, 'Record repayment').click();
  await expect(button(page, 'Benjamin Alexander pays you 15.00. Record this payment')).toBeVisible();
  await page.reload();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 10.00')).toBeVisible();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 5.00')).toBeVisible();
  await goOnline(page, context);
  await expect(page.getByText(/saved here/)).toHaveCount(0);
});

test('edits and removes a repayment offline', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Repayment changes', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '24');
  await person(page, 'Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await button(page, 'Ben pays you 12.00. Record this payment').click();
  await expect(page.getByText('✓ Settled', { exact: true })).toBeVisible();
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Repayment changes').click();

  await goOffline(page, context);
  await button(page, 'Change repayment: Ben paid you back 12.00').click();
  await field(page, 'Amount').fill('15');
  await button(page, 'Save repayment').click();
  await expect(button(page, 'Change repayment: Ben paid you back 15.00')).toBeVisible();
  await expect(button(page, 'Ben, +3.00. Show details')).toBeVisible();
  await button(page, 'Change repayment: Ben paid you back 15.00').click();
  const remove = button(page, 'Delete');
  const save = button(page, 'Save repayment');

  await expect(remove).toBeVisible();
  const removeBox = (await remove.boundingBox())!;
  const saveBox = (await save.boundingBox())!;

  await expect(remove).toHaveText('Delete');
  await expect(button(page, /^Remove repayment/)).toHaveCount(0);
  // Delete sits in the header above the form; Save is the action at its foot.
  expect(removeBox.y + removeBox.height).toBeLessThan((await field(page, 'Amount').boundingBox())!.y);
  expect(saveBox.y).toBeGreaterThan((await field(page, 'Amount').boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath('repayment-header.png') });
  await remove.click();
  await expect(heading(page, 'Repayment changes')).toBeVisible();
  await expect(button(page, /^Change repayment:/)).toHaveCount(0);
  await expect(button(page, 'Ben, −12.00. Show details')).toBeVisible();
});

test('reads Activity offline and restores a removed expense', async ({ page, context }) => {
  await createGroup(page, 'History', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Dinner', '24');
  await button(page, 'Change Dinner · 24.00').click();
  await button(page, 'Delete Dinner · 24.00').click();
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
  await expect(button(page, 'Change Dinner · 24.00')).toBeVisible();
});

test('undoes a money change and then reverses that undo through Activity', async ({ page }) => {
  await createGroup(page, 'Money undo', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '24');
  await person(page, 'Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await button(page, 'Ben pays you 12.00. Record this payment').click();
  await expect(page.getByText('✓ Settled', { exact: true })).toBeVisible();
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
  await expect(button(page, 'Change repayment: Ben paid you back 12.00')).toBeVisible();
});

test('keeps member actions out of Undo while group rename remains reversible', async ({ page }) => {
  await createGroup(page, 'Original name', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Rename group').click();
  await field(page, 'Group name').fill('New name');
  await field(page, 'Group name').press('Enter');
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
  await addExpense(visitor, 'Fresh dinner', '20');

  await expect(button(page, 'Change Fresh dinner · 20.00')).toBeVisible();
  await expect(bell(page)).toHaveAccessibleName('Activity: 2 new updates');
  await expect(page.getByTestId('activity-count')).toHaveText('2');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(bell(visitor)).toHaveAccessibleName('Activity, no new updates');

  await bell(page).click();
  await expect(page.getByText('new', { exact: true })).toHaveCount(2);
  await button(page, 'Mark all seen').click();
  await expect(page.getByText('new', { exact: true })).toHaveCount(0);
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
    await expect(amount).toHaveCSS('height', '60px');

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

    await expect(amount).toHaveCSS('height', '60px');
  }
});

test('shrinks the large title as the page scrolls and grows it back at the top', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await createGroup(page, 'Long trip', 'Ana');

  for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran']) await addMember(page, name);

  for (const name of ['Cabin', 'Train', 'Groceries', 'Boat', 'Lunch', 'Taxi']) await addExpense(page, name, '60');

  const scroller = page.locator('#splitnext-page');
  const title = heading(page, 'Long trip');

  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await expect(title).toHaveCSS('font-size', '42px');
  await scroller.evaluate((node) => { node.scrollTop = 200; });
  await expect(title).toHaveCSS('font-size', '22px');
  await expect(button(page, 'Add expense')).toBeInViewport();

  // The page is the only scroll area.
  const scrollAreas = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((node) =>
    ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight ? [node.id || node.tagName] : []));

  expect(scrollAreas).toEqual(['splitnext-page']);
  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await expect(title).toHaveCSS('font-size', '42px');
});

test('morphs between screens and leaves nothing behind', async ({ page }) => {
  await createGroup(page, 'Morphing', 'Ana');
  await button(page, 'Back to groups').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const watching = page.evaluate(() => new Promise<{ copies: number; pages: number }[]>((resolve) => {
    const start = performance.now();
    const samples: { copies: number; pages: number }[] = [];

    (function frame() {
      samples.push({ copies: document.querySelectorAll('[data-copied-page]').length, pages: document.querySelectorAll('#splitnext-page').length });

      if (performance.now() - start < 1200) requestAnimationFrame(frame);
      else resolve(samples);
    })();
  }));

  await button(page, 'Open Morphing').click();
  const samples = await watching;

  // The old screen plays out over the new one, then goes, and the page id stays unique.
  expect(samples.some((sample) => sample.copies === 1)).toBe(true);
  expect(samples.every((sample) => sample.pages === 1)).toBe(true);
  expect(samples.at(-1)?.copies).toBe(0);
  await expect(heading(page, 'Morphing')).toBeVisible();
});

test('never cuts off the tops or tails of letters in titles and names', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Magalyjoqh trip', 'Pippy');
  await addMember(page, 'Jaqy Gypsy');
  await addExpense(page, 'Groceries jqyp', '90');

  const screens: [string, () => Promise<void>][] = [
    ['group screen', async () => {}],
    ['person', () => person(page, 'Jaqy Gypsy').click()],
    ['settle up', () => button(page, /^Settle up/).click()],
    ['activity', async () => { await page.goBack(); await page.goBack(); await bell(page).click(); }],
    ['expense form', async () => { await button(page, /^Back to /).click(); await button(page, /^Change Groceries jqyp/).click(); }],
    ['groups list', async () => { await button(page, 'Cancel').click(); await button(page, 'Back to groups').click(); }],
    ['new group', () => button(page, 'New group').click()],
  ];

  for (const [screen, open] of screens) {
    await open();
    await page.waitForTimeout(300);
    expect(await clippedText(page), screen).toEqual([]);
  }
});

test('keeps a cut-off name cut off while it flies to its title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Long names', 'Ana');
  await addMember(page, 'Maximiliano Fernández-Castellanos de la Vega y Montenegro');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Every frame: each visible flying copy of the name, whether it still clips with an ellipsis, and its width.
  const watching = page.evaluate(() => new Promise<{ ellipsis: boolean; width: number }[]>((resolve) => {
    const start = performance.now();
    const frames: { ellipsis: boolean; width: number }[] = [];

    (function frame() {
      for (const node of document.querySelectorAll('[aria-hidden] *')) {
        const style = getComputedStyle(node);

        if (node.childElementCount || !node.textContent?.startsWith('Maximiliano') || Number(style.opacity) < 0.05) continue;
        frames.push({ ellipsis: style.textOverflow === 'ellipsis' && style.overflow === 'hidden', width: node.getBoundingClientRect().width });
      }

      if (performance.now() - start < 700) requestAnimationFrame(frame);
      else resolve(frames);
    })();
  }));

  await person(page, 'Maximiliano Fernández-Castellanos de la Vega y Montenegro').click();
  const frames = await watching;
  const widths = new Set(frames.map((frame) => Math.round(frame.width)));

  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter((frame) => !frame.ellipsis)).toEqual([]);
  // The copy's room changes on the way rather than jumping at the end.
  expect(widths.size).toBeGreaterThan(4);
});

test('closes panels in place without the content returning at the end', async ({ page }) => {
  await createGroup(page, 'Panels', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const payer = page.getByRole('button', { name: /^Paid by / });

  await payer.click();
  await expect(page.getByRole('radio')).toHaveCount(2);
  await page.waitForTimeout(500);

  // Every frame of closing, until well after the movement ends.
  const watching = page.evaluate(() => new Promise<{ height: number; content: number }[]>((resolve) => {
    let panel = document.querySelector<HTMLElement>('[role="radiogroup"]');

    while (panel && getComputedStyle(panel).overflow !== 'hidden') panel = panel.parentElement;
    const samples: { height: number; content: number }[] = [];
    const start = performance.now();

    (function frame() {
      samples.push({ height: panel!.getBoundingClientRect().height, content: panel!.childElementCount });

      if (performance.now() - start < 900) requestAnimationFrame(frame);
      else resolve(samples);
    })();
  }));

  await payer.click();
  const samples = await watching;
  const growth = samples.slice(1).map((sample, index) => sample.height - samples[index]!.height);

  expect(Math.max(...growth), JSON.stringify(samples)).toBeLessThanOrEqual(0);
  expect(samples.at(-1)).toEqual({ height: 0, content: 0 });

  // Opening again before it has finished closing leaves it open.
  await payer.click();
  await page.waitForTimeout(500);
  await payer.click();
  await page.waitForTimeout(80);
  await payer.click();
  await page.waitForTimeout(600);
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /^Ben/ })).toBeVisible();
});
