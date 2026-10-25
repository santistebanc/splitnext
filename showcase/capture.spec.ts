import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { addExpense, addMember, baseURL, bell, button, createGroup, field, heading, inviteLink, out, person, phone, prepare, renameGroup, synced, toGroups, type StorageState } from './helpers';

/**
 * Drives the real app through each flow, recording a video per flow and a
 * screenshot at key moments, the video's poster and thumbnails to jump to
 * them. `build.mjs` turns the results in `out/` into the showcase page.
 */

/** The flows in the order the page lists them. */
const flows = {
  start: { order: 1, title: 'Getting started', summary: 'A fresh install opens on the welcome screen. Create a group, then add people right in the balances.' },
  expenses: { order: 2, title: 'Recording expenses', summary: 'Enter an amount, pick who paid, and split it equally, by shares, or by exact amounts, in any currency.' },
  people: { order: 3, title: 'People in a group', summary: 'Open someone to see how their balance adds up, rename them, or remove someone who has no records.' },
  settle: { order: 4, title: 'Settling up', summary: 'The plan shows the fewest payments. Record a planned payment in full or in part, then change it later.' },
  invite: { order: 5, title: 'Renaming and inviting', summary: 'Rename the group, copy its invite link, and replace the link when it has gone too far.' },
  join: { order: 6, title: 'Joining from an invite', summary: 'A second device opens the link, sees who is already in the group, and joins as someone new.' },
  realtime: { order: 7, title: 'Live changes and the bell', summary: 'Changes from another device arrive live. The bell counts them without pop-ups until you have seen them.' },
  history: { order: 8, title: 'Activity, restore, and undo', summary: 'Every change is listed in Activity, where a removed expense can be restored and most changes undone.' },
  offline: { order: 9, title: 'Working offline', summary: 'Without a connection everything keeps working. Changes wait on the device and sync when it is back.' },
  leave: { order: 10, title: 'Leaving and rejoining', summary: 'Your groups list shows your balance in each. Leave a group on this device, then rejoin it as yourself.' },
  big: { order: 11, title: 'A big group', summary: 'With many people the balances show who fits above the first expenses, shrink as you scroll, and expand on request.' },
} as const;

type FlowId = keyof typeof flows;

type Step = { at: number; text: string };

type Recording = { flow: FlowId; page: Page; context: BrowserContext; started: number; steps: Step[]; shots: number };

/** A cursor that follows the mouse and pulses on press, and a caption, for the videos only. */
function installOverlay(): void {
  const install = () => {
    if (document.getElementById('sc-cursor')) return;
    const style = document.createElement('style');

    style.textContent = `
      #sc-cursor { position: fixed; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%; background: rgba(15, 23, 42, 0.28); border: 2px solid rgba(255, 255, 255, 0.95); box-shadow: 0 1px 6px rgba(15, 23, 42, 0.35); pointer-events: none; z-index: 2147483647; opacity: 0; transition: opacity 200ms; }
      #sc-cursor.tap { animation: sc-tap 420ms ease-out; }
      @keyframes sc-tap { 0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.55); background: rgba(37, 99, 235, 0.55); } 100% { box-shadow: 0 0 0 18px rgba(37, 99, 235, 0); } }
      #sc-caption { position: fixed; left: 50%; bottom: 96px; transform: translate(-50%, 8px); max-width: 340px; padding: 9px 14px; border-radius: 12px; background: rgba(15, 23, 42, 0.86); color: #fff; font: 600 14px/1.35 system-ui, sans-serif; text-align: center; pointer-events: none; z-index: 2147483646; opacity: 0; transition: opacity 220ms, transform 220ms; }
      #sc-caption[data-on="1"] { opacity: 1; transform: translate(-50%, 0); }
    `;
    const cursor = document.createElement('div');
    const caption = document.createElement('div');

    cursor.id = 'sc-cursor';
    caption.id = 'sc-caption';
    document.head.appendChild(style);
    document.body.appendChild(cursor);
    document.body.appendChild(caption);
    window.addEventListener('mousemove', (event: MouseEvent) => {
      cursor.style.opacity = '1';
      cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    }, true);
    window.addEventListener('mousedown', () => {
      cursor.classList.remove('tap');
      void cursor.offsetWidth;
      cursor.classList.add('tap');
    }, true);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

const hideOverlay = '#sc-cursor, #sc-caption { display: none !important; }';

// Recording.

async function record(browser: Browser, flow: FlowId, options: { storageState?: StorageState; clipboard?: boolean } = {}): Promise<Recording> {
  const settings: Parameters<Browser['newContext']>[0] = { baseURL, viewport: phone, deviceScaleFactor: 2, recordVideo: { dir: test.info().outputPath('video'), size: phone } };

  if (options.storageState) settings.storageState = options.storageState;
  const context = await browser.newContext(settings);

  if (options.clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(installOverlay);
  const page = await context.newPage();

  return { flow, page, context, started: Date.now(), steps: [], shots: 0 };
}

function elapsed(rec: Recording): number {
  return Math.max(0, (Date.now() - rec.started) / 1000);
}

async function pause(rec: Recording, ms = 500): Promise<void> {
  await rec.page.waitForTimeout(ms);
}

/** Marks a step in the video's timeline and shows it as a caption. */
async function step(rec: Recording, text: string): Promise<void> {
  rec.steps.push({ at: elapsed(rec), text });

  await rec.page.evaluate((caption) => {
    const element = document.getElementById('sc-caption');

    if (!element) return;
    element.textContent = caption;
    element.dataset.on = caption ? '1' : '';
  }, text);
  await pause(rec, 700);
}

/** Moves the cursor visibly onto a target, then presses it. */
async function tap(rec: Recording, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();

  if (box) {
    await rec.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
    await pause(rec, 200);
  }

  await target.click();
  await pause(rec, 450);
}

async function typeInto(rec: Recording, target: Locator, text: string): Promise<void> {
  await tap(rec, target);
  await target.fill('');
  await target.pressSequentially(text, { delay: 55 });
  await pause(rec, 300);
}

/** Saves a screenshot of the current state as a thumbnail linked to this moment of the flow's video. */
async function shot(rec: Recording, id: string, title: string): Promise<void> {
  // Let screen transitions and the keyboard settle.
  await rec.page.waitForTimeout(500);
  await mkdir(`${out}screens`, { recursive: true });
  await rec.page.screenshot({ path: `${out}screens/${id}.png`, style: hideOverlay, animations: 'disabled' });
  rec.shots += 1;
  const meta = { id, title, flow: rec.flow, order: flows[rec.flow].order * 100 + rec.shots, at: elapsed(rec) };

  await writeFile(`${out}screens/${id}.json`, JSON.stringify(meta, null, 2));
  await pause(rec, 400);
}

/** Ends the flow and saves its video and timeline. */
async function finish(rec: Recording): Promise<void> {
  await step(rec, '');
  await pause(rec, 1200);
  const video = rec.page.video();

  await rec.context.close();

  if (!video) return;
  await mkdir(`${out}videos`, { recursive: true });
  await mkdir(`${out}flows`, { recursive: true });
  await video.saveAs(`${out}videos/${rec.flow}.webm`);
  await video.delete();
  const meta = { id: rec.flow, ...flows[rec.flow], video: `videos/${rec.flow}.webm`, steps: rec.steps.filter((entry) => entry.text) };

  await writeFile(`${out}flows/${rec.flow}.json`, JSON.stringify(meta, null, 2));
}

/** Opens the app on a group, whether it reopens there or on the groups list. */
async function landOn(rec: Recording, name: string): Promise<void> {
  const page = rec.page;
  const open = button(page, `Open ${name}`);

  await page.goto('/app');
  await expect(heading(page, name).or(open)).toBeVisible();

  if (await open.isVisible()) await open.click();
  await expect(heading(page, name)).toBeVisible();
  await pause(rec, 600);
}

async function setOnline(rec: Recording, online: boolean): Promise<void> {
  await rec.context.setOffline(!online);
  await rec.page.evaluate((event) => window.dispatchEvent(new Event(event)), online ? 'online' : 'offline');
}

test('getting started', async ({ browser }) => {
  const rec = await record(browser, 'start');
  const page = rec.page;

  await page.goto('/app');
  await expect(button(page, 'Create a group')).toBeVisible();
  await pause(rec, 600);
  await step(rec, 'A fresh install opens on the welcome screen');
  await shot(rec, 'welcome', 'Welcome');

  await step(rec, 'Create a group');
  await tap(rec, button(page, 'Create a group'));
  await expect(field(page, 'Group name')).toBeVisible();
  await shot(rec, 'create-empty', 'New group');
  await typeInto(rec, field(page, 'Group name'), 'Lisbon trip');
  await typeInto(rec, field(page, 'Your name in this group'), 'Ana');
  await shot(rec, 'create-filled', 'New group, filled in');
  await tap(rec, button(page, 'Create group'));
  await expect(heading(page, 'Lisbon trip')).toBeVisible();

  await step(rec, 'The new group, with just you in it');
  await shot(rec, 'group-new', 'A new group');

  await step(rec, 'Add people right in the balances');

  for (const name of ['Ben', 'Cy', 'Dana']) {
    await typeInto(rec, field(page, 'Add a person'), name);
    await field(page, 'Add a person').press('Enter');
    await expect(person(page, name)).toBeVisible();
    await pause(rec, 300);
  }

  await shot(rec, 'group-people', 'People added');
  await finish(rec);
});

test('recording expenses', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Lisbon trip', 'Ana');
    await addMember(page, 'Ben');
    await addMember(page, 'Cy');
  });

  const rec = await record(browser, 'expenses', { storageState });
  const page = rec.page;

  await landOn(rec, 'Lisbon trip');
  await step(rec, 'Add expense');
  await tap(rec, button(page, 'Add expense'));
  await expect(field(page, 'Amount')).toBeFocused();
  await shot(rec, 'expense-new', 'New expense');
  await typeInto(rec, field(page, 'Amount'), '90');
  await typeInto(rec, field(page, 'Description'), 'Dinner at Taberna');
  await shot(rec, 'expense-equal', 'Split equally');

  await step(rec, 'Choose who paid');
  await tap(rec, button(page, /^Paid by .*Change payer$/));
  await shot(rec, 'expense-payer', 'Choosing who paid');
  await tap(rec, page.getByRole('radio', { name: /^Ben$/ }));

  await step(rec, 'Split by shares');
  await tap(rec, button(page, 'Increase share for Cy'));
  await shot(rec, 'expense-shares', 'Split by shares');

  await step(rec, 'Fix one amount alongside the shares');
  await tap(rec, button(page, /^Amount for Ben:/));
  await typeInto(rec, field(page, 'Amount for Ben'), '20');
  await field(page, 'Amount for Ben').press('Enter');
  await shot(rec, 'expense-amounts', 'Fixed amount and shares');

  await step(rec, 'Back to an equal split, and save');
  await tap(rec, button(page, /^Amount for Ben:/));
  await typeInto(rec, field(page, 'Amount for Ben'), '');
  await field(page, 'Amount for Ben').press('Enter');
  await tap(rec, button(page, 'Decrease share for Cy'));
  await tap(rec, button(page, 'Save'));
  await expect(button(page, 'Change Dinner at Taberna · 90.00 USD')).toBeVisible();
  await shot(rec, 'group-expense', 'Balances and expenses');

  await step(rec, 'Add an expense in another currency');
  await tap(rec, button(page, 'Add expense'));
  await typeInto(rec, field(page, 'Amount'), '240');
  await tap(rec, button(page, /^Currency: .*\. Change currency$/));
  await typeInto(rec, field(page, 'Search currencies'), 'EUR');
  await tap(rec, page.getByRole('radio', { name: 'EUR, Euro' }));
  await typeInto(rec, field(page, 'Description'), 'Hotel');
  await tap(rec, button(page, 'Save'));
  await expect(button(page, 'Change Hotel · 240.00 EUR')).toBeVisible();
  await shot(rec, 'group-currencies', 'Several currencies');

  await step(rec, 'Open an expense to change it');
  await tap(rec, button(page, 'Change Dinner at Taberna · 90.00 USD'));
  await shot(rec, 'expense-edit', 'Changing an expense');
  await typeInto(rec, field(page, 'Amount'), '96');
  await tap(rec, button(page, 'Save'));
  await expect(button(page, 'Change Dinner at Taberna · 96.00 USD')).toBeVisible();
  await pause(rec, 800);
  await finish(rec);
});

test('people in a group', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Lisbon trip', 'Ana');
    await addMember(page, 'Ben');
    await addMember(page, 'Cy');
    await addExpense(page, 'Dinner', '90', 'EUR');
  });

  const rec = await record(browser, 'people', { storageState });
  const page = rec.page;

  await landOn(rec, 'Lisbon trip');
  await step(rec, 'Open someone to see how their balance adds up');
  await tap(rec, person(page, 'Ben'));
  await expect(heading(page, 'Ben')).toBeVisible();
  await shot(rec, 'person-owes', 'Someone who owes');

  await step(rec, 'Rename them in place');
  await tap(rec, button(page, 'Rename Ben'));
  await typeInto(rec, field(page, 'Name'), 'Benjamin');
  await shot(rec, 'person-rename', 'Renaming someone');
  await field(page, 'Name').press('Enter');
  await expect(heading(page, 'Benjamin')).toBeVisible();
  await pause(rec, 600);
  await tap(rec, button(page, 'Back to Lisbon trip'));

  await step(rec, 'Your own balance');
  await tap(rec, person(page, 'Ana'));
  await expect(heading(page, 'Ana')).toBeVisible();
  await shot(rec, 'person-you', 'You');
  await tap(rec, button(page, 'Back to Lisbon trip'));

  await step(rec, 'Add someone new');
  await typeInto(rec, field(page, 'Add a person'), 'Eli');
  await field(page, 'Add a person').press('Enter');
  await tap(rec, person(page, 'Eli'));
  await expect(heading(page, 'Eli')).toBeVisible();
  await shot(rec, 'person-new', 'Someone in no expense yet');

  await step(rec, 'Remove someone with no records');
  await tap(rec, button(page, 'Remove Eli'));
  await expect(page.getByTestId('toast')).toHaveText('Eli removed.');
  await shot(rec, 'toast-removed', 'Person removed');
  await expect(person(page, 'Eli')).toHaveCount(0);
  await pause(rec, 800);
  await finish(rec);
});

test('settling up', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Weekend', 'Ana');
    await addMember(page, 'Ben');
    await addMember(page, 'Cy');
    await addExpense(page, 'Dinner', '90', 'EUR');
    await addExpense(page, 'Taxi', '30', 'EUR', 'Ben');
  });

  const rec = await record(browser, 'settle', { storageState });
  const page = rec.page;

  await landOn(rec, 'Weekend');
  await step(rec, 'You first, then whoever owes most');
  await shot(rec, 'group-balances', 'Balances in order');

  await step(rec, 'Open Ben and settle up');
  await tap(rec, person(page, 'Ben'));
  await tap(rec, button(page, 'Settle up, 1 payment'));
  await expect(heading(page, 'Settle up')).toBeVisible();
  await shot(rec, 'settle-plan', 'Settle up');

  await step(rec, 'Record a planned payment');
  await tap(rec, button(page, 'Ben pays you 10.00 EUR. Record this payment'));
  await expect(field(page, 'Amount')).toHaveValue('10.00');
  await shot(rec, 'repayment-form', 'Recording a repayment');

  await step(rec, 'Pay part of it');
  await typeInto(rec, field(page, 'Amount'), '4');
  await tap(rec, button(page, 'Record repayment'));
  await expect(button(page, 'Ben pays you 6.00 EUR. Record this payment')).toBeVisible();
  await shot(rec, 'settle-partial', 'After a partial payment');

  await step(rec, 'A payment outside the plan');
  await tap(rec, button(page, 'Record a different payment'));
  await shot(rec, 'repayment-other', 'Any other payment');
  await tap(rec, button(page, 'Cancel'));
  await expect(heading(page, 'Settle up')).toBeVisible();

  await step(rec, 'Record the rest');
  await tap(rec, button(page, 'Ben pays you 6.00 EUR. Record this payment'));
  await tap(rec, button(page, 'Record repayment'));
  await expect(page.getByText('All settled up', { exact: true })).toBeVisible();
  await shot(rec, 'settle-done', 'All settled up');

  await tap(rec, button(page, 'Back to Ben'));
  await shot(rec, 'person-settled', 'Someone settled');
  await tap(rec, button(page, 'Back to Weekend'));

  await step(rec, 'Repayments sit with the expenses');
  await expect(button(page, 'Change repayment: Ben paid you back 4.00 EUR')).toBeVisible();
  await shot(rec, 'group-repayments', 'Repayments in the list');

  await step(rec, 'Open a repayment to change it');
  await tap(rec, button(page, 'Change repayment: Ben paid you back 4.00 EUR'));
  await shot(rec, 'repayment-edit', 'Changing a repayment');
  await tap(rec, button(page, 'Cancel'));
  await expect(heading(page, 'Weekend')).toBeVisible();
  await finish(rec);
});

test('renaming and inviting', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Lisbon', 'Ana');
    await addMember(page, 'Ben');
  });

  const rec = await record(browser, 'invite', { storageState, clipboard: true });
  const page = rec.page;

  await landOn(rec, 'Lisbon');
  await step(rec, 'Rename the group');
  await tap(rec, button(page, 'Group settings'));
  await expect(heading(page, 'Group settings')).toBeVisible();
  await typeInto(rec, field(page, 'Group name'), 'Lisbon & Porto');
  await shot(rec, 'rename-group', 'Renaming the group');
  await tap(rec, button(page, 'Save group name'));
  await expect(heading(page, 'Lisbon & Porto')).toBeVisible();

  await step(rec, 'Invite people with a link');
  await tap(rec, button(page, 'Invite people'));
  const sheet = page.getByRole('dialog', { name: 'Invite people' });

  await expect(sheet).toBeVisible();
  await shot(rec, 'invite-sheet', 'Invite people');

  await step(rec, 'Tap the link to copy it');
  await tap(rec, sheet.getByRole('button', { name: 'Copy link', exact: true }));
  await expect(sheet.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  await shot(rec, 'invite-copied', 'Link copied');

  await step(rec, 'Replace a link that went too far');
  await tap(rec, sheet.getByRole('button', { name: 'Replace link', exact: true }));
  const confirm = page.getByRole('dialog', { name: 'Replace invite link?' });

  await expect(confirm).toBeVisible();
  await shot(rec, 'invite-replace', 'Replace the link?');
  await tap(rec, confirm.getByRole('button', { name: 'Replace link', exact: true }));
  await expect(sheet).toBeVisible();
  await pause(rec, 800);
  await tap(rec, sheet.getByRole('button', { name: 'Close', exact: true }));
  await finish(rec);
});

test('joining from an invite', async ({ browser }) => {
  let link = '';

  await prepare(browser, async (page) => {
    await createGroup(page, 'Lisbon', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Dinner', '60', 'EUR');
    link = await inviteLink(page);
  });

  const rec = await record(browser, 'join');
  const page = rec.page;

  await page.goto('/app');
  await expect(button(page, 'Join a group')).toBeVisible();
  await step(rec, 'Join from the welcome screen');
  await tap(rec, button(page, 'Join a group'));
  await expect(field(page, 'Invite link')).toBeVisible();
  await shot(rec, 'join-empty', 'Join with a link');

  await step(rec, 'Something that is not an invite');
  await typeInto(rec, field(page, 'Invite link'), 'https://example.com/hello');
  await pause(rec, 600);
  await shot(rec, 'join-invalid', 'Not an invite link');
  await tap(rec, button(page, 'Back'));

  // Slow the invite check so its state shows.
  await page.route('**/invites/preview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => undefined);
  });
  await step(rec, 'Open the invite link');
  await page.goto(link);
  await expect(page.getByText('Checking…')).toBeVisible();
  await shot(rec, 'join-checking', 'Checking the link');
  await expect(page.getByText(/Which one are you\?/)).toBeVisible();
  await shot(rec, 'join-names', 'Which one are you?');

  await step(rec, 'A name taken on another device');
  await tap(rec, page.getByRole('radio', { name: 'Ana, taken', exact: true }));
  await expect(page.getByText(/Ana is already taken on another device/)).toBeVisible();
  await shot(rec, 'join-in-use', 'A taken name');

  await step(rec, 'Join as someone new');
  await tap(rec, page.getByRole('radio', { name: 'Someone else' }));
  await typeInto(rec, field(page, 'Your name'), 'Dana');
  await shot(rec, 'join-new', 'Joining as someone new');
  await tap(rec, button(page, 'Join as Dana'));
  await expect(button(page, 'Dana (you), no expenses yet. Show details')).toBeVisible();
  await step(rec, 'In the group, as Dana');
  await shot(rec, 'group-joined', 'Just joined');
  await finish(rec);
});

test('live changes and the bell', async ({ browser }) => {
  let link = '';

  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Shared', 'Ana');
    await addMember(page, 'Ben');
    link = await inviteLink(page);
  });

  // The other device stays off camera.
  const other = await browser.newContext({ baseURL, viewport: phone });
  const visitor = await other.newPage();

  await visitor.goto(link);
  await visitor.getByRole('radio', { name: /^Ben/ }).click();
  await button(visitor, 'Join as Ben').click();
  await expect(heading(visitor, 'Shared')).toBeVisible();

  const rec = await record(browser, 'realtime', { storageState });
  const page = rec.page;

  await landOn(rec, 'Shared');
  await step(rec, 'Ben adds an expense on their phone');
  await addExpense(visitor, 'Fresh dinner', '20', 'EUR');
  await expect(button(page, 'Change Fresh dinner · 20.00 EUR')).toBeVisible();
  await pause(rec, 800);
  await shot(rec, 'realtime', 'A live change');

  await step(rec, 'The bell opens Activity');
  await tap(rec, bell(page));
  await expect(heading(page, 'Activity')).toBeVisible();
  await shot(rec, 'activity-new', 'New updates');

  await step(rec, 'Mark them seen');
  await tap(rec, button(page, 'Mark all seen'));
  await expect(page.getByText('New', { exact: true })).toHaveCount(0);
  await shot(rec, 'activity-seen', 'All seen');
  await tap(rec, button(page, 'Back to Shared'));
  await finish(rec);
  await other.close();
});

test('activity, restore, and undo', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Trip', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Lunch', '24', 'EUR');
    await addExpense(page, 'Dinner', '40', 'EUR');
    await renameGroup(page, 'Porto weekend');
  });

  const rec = await record(browser, 'history', { storageState });
  const page = rec.page;

  await landOn(rec, 'Porto weekend');
  await step(rec, 'Remove an expense');
  await tap(rec, button(page, 'Change Dinner · 40.00 EUR'));
  await tap(rec, button(page, 'Delete Dinner · 40.00 EUR'));
  await expect(button(page, 'Change Dinner · 40.00 EUR')).toHaveCount(0);

  await step(rec, 'Activity lists every change');
  await tap(rec, bell(page));
  await expect(heading(page, 'Activity')).toBeVisible();
  await shot(rec, 'activity', 'Activity');

  await step(rec, 'Restore the removed expense');
  await tap(rec, button(page, 'Restore expense'));
  await shot(rec, 'activity-restored', 'Expense restored');

  await step(rec, 'Undo the rename');
  await tap(rec, button(page, 'Undo: You renamed the group'));
  await expect(page.getByText('You undid a change', { exact: true })).toBeVisible();
  await shot(rec, 'activity-undone', 'A change undone');
  await tap(rec, button(page, /^Back to /));
  await expect(heading(page, 'Trip')).toBeVisible();
  await expect(button(page, 'Change Dinner · 40.00 EUR')).toBeVisible();
  await pause(rec, 800);
  await finish(rec);
});

test('working offline', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Trip', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Lunch', '24', 'EUR');
  });

  const rec = await record(browser, 'offline', { storageState });
  const page = rec.page;

  await landOn(rec, 'Trip');
  await step(rec, 'The connection drops');
  await setOnline(rec, false);
  await expect(button(page, /^Offline.*Connection details$/)).toBeVisible();
  await shot(rec, 'offline', 'Offline');
  await step(rec, 'Open connection details');
  await tap(rec, button(page, /^Offline.*Connection details$/));
  await shot(rec, 'offline-details', 'Connection details');
  await tap(rec, page.getByRole('dialog', { name: 'Connection' }).getByRole('button', { name: 'Close', exact: true }));

  await step(rec, 'Keep making changes');
  await tap(rec, person(page, 'Ben'));
  await tap(rec, button(page, 'Rename Ben'));
  await typeInto(rec, field(page, 'Name'), 'Benjamin');
  await field(page, 'Name').press('Enter');
  await expect(heading(page, 'Benjamin')).toBeVisible();
  await tap(rec, button(page, 'Back to Trip'));
  await expect(page.getByText('Offline · 1 change saved here', { exact: true })).toBeVisible();
  await shot(rec, 'offline-pending', 'Changes waiting');

  await step(rec, 'The groups list shows what is waiting');
  await tap(rec, button(page, 'Trip. Switch group'));
  await shot(rec, 'groups-offline', 'Groups list, offline');

  await step(rec, 'Back online, the changes sync');
  await setOnline(rec, true);
  await synced(page);
  await pause(rec, 800);
  await tap(rec, button(page, 'Open Trip'));
  await expect(person(page, 'Benjamin')).toBeVisible();
  await finish(rec);
});

test('leaving and rejoining', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Porto', 'Ana');
    await addMember(page, 'Ben');
    await addExpense(page, 'Lunch', '30', 'EUR', 'Ben');
    await createGroup(page, 'Madrid', 'Ana');
    await addMember(page, 'Cy');
    await addExpense(page, 'Tapas', '48', 'EUR');
    await createGroup(page, 'Lisbon', 'Ana');
    await addMember(page, 'Dana');
  });

  const rec = await record(browser, 'leave', { storageState });
  const page = rec.page;

  await toGroups(page);
  await step(rec, 'Your groups, with your balance in each');
  await shot(rec, 'groups-list', 'Your groups');

  await step(rec, 'Leave a group on this device');
  await tap(rec, button(page, 'Open Lisbon'));
  await tap(rec, button(page, 'Group settings'));
  await tap(rec, button(page, 'Leave group on this device'));
  await shot(rec, 'leave-confirm', 'Leave the group?');
  await tap(rec, page.getByRole('dialog').getByRole('button', { name: 'Leave group', exact: true }));

  await step(rec, 'Groups you left stay within reach');
  await tap(rec, button(page, 'Show 1 group you left'));
  await shot(rec, 'groups-left', 'Groups you left');

  await step(rec, 'Rejoin as yourself');
  await tap(rec, button(page, 'Rejoin Lisbon'));
  await expect(page.getByRole('radio', { name: /^Ana/ })).toBeVisible();
  await shot(rec, 'rejoin', 'Rejoining');
  await tap(rec, page.getByRole('radio', { name: /^Ana/ }));
  await tap(rec, button(page, 'Rejoin as Ana'));
  await expect(heading(page, 'Lisbon')).toBeVisible();
  await pause(rec, 800);
  await finish(rec);
});

test('a big group', async ({ browser }) => {
  const storageState = await prepare(browser, async (page) => {
    await createGroup(page, 'Long trip', 'Ana');

    for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran', 'Gus', 'Hana', 'Ida', 'Jo', 'Kai', 'Lea', 'Max']) await addMember(page, name);

    for (const name of ['Cabin', 'Train', 'Groceries', 'Boat', 'Lunch', 'Taxi', 'Bakery', 'Museum', 'Dinner']) await addExpense(page, name, '60', 'EUR');
  });

  const rec = await record(browser, 'big', { storageState });
  const page = rec.page;
  const showAll = button(page, /^Show all \d+ people$/);

  await landOn(rec, 'Long trip');
  await page.locator('#splitnext-page').evaluate((node) => { node.scrollTop = 0; });
  await step(rec, 'Only who fits above the first expenses');
  await shot(rec, 'balances-collapsed', 'Many people');

  await step(rec, 'Scrolling shrinks the balances');
  await rec.page.mouse.move(195, 600, { steps: 10 });

  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, 70);
    await pause(rec, 160);
  }

  await shot(rec, 'balances-scrolled', 'Scrolled down');

  await step(rec, 'Tap the heading to go back up');
  await tap(rec, heading(page, 'Balances').first());
  await pause(rec, 600);

  await step(rec, 'Show everyone');
  await tap(rec, showAll);
  await shot(rec, 'balances-all', 'Everyone shown');
  await tap(rec, button(page, 'Show fewer people'));
  await finish(rec);
});
