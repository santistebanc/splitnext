import { expect, test, type Locator, type Page } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';

test('device lab runs the real two-device offline and recovery acceptance scenario', async () => {
  test.setTimeout(400_000);
  const result = await promisify(execFile)(process.execPath, ['lab/acceptance.mjs'], { timeout: 380_000 });

  expect(result.stdout).toContain('Lab acceptance (browser) passed');
});

test('device lab runs the same acceptance scenario with in-page devices in a headless host', async () => {
  test.setTimeout(400_000);

  const result = await promisify(execFile)(process.execPath, ['lab/acceptance.mjs'], {
    timeout: 380_000,
    env: { ...process.env, LAB_ACCEPT_KIND: 'inpage', LAB_TEST_WORKER_PORT: '8837', LAB_TEST_LAB_PORT: '8836' },
  });

  expect(result.stdout).toContain('Lab acceptance (inpage) passed');
});

test('device lab frontend shows in-page devices live in its own page, each in its own frame', async ({ page, request }) => {
  test.setTimeout(120_000);
  const base = 'http://127.0.0.1:8846';
  const child = spawn(process.execPath, ['lab/server.mjs', `--env=inpage-${Date.now()}`, '--port=8846', '--workerPort=8847'], { windowsHide: true, stdio: 'ignore' });
  const call = (operation: string, input = {}) => request.post(`${base}/api`, { data: { operation, input } });

  try {
    await expect.poll(async () => {
      try { return (await (await call('status')).json()).initialized === true; } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
    await page.goto(base);
    await expect(page.locator('#hosting')).toContainText('Hosting in-page devices in this page');
    await page.getByRole('button', { name: 'Add device', exact: true }).click();
    await expect(page.locator('.device .slot iframe[data-lab-device]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Add device', exact: true }).click();
    await expect(page.locator('.device .slot iframe[data-lab-device]')).toHaveCount(2);

    // A panel docking beside another can move its frame out of its slot for a moment.
    const slotted = () => page.locator('.device .slot iframe[data-lab-device]').evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-lab-device') ?? ''));

    await expect.poll(async () => (await slotted()).length).toBe(2);
    const ids = await slotted();
    const [id = '', otherId = ''] = ids;

    // Playwright places clicks inside a frame under CSS zoom wrongly; a person's clicks land.
    for (const each of ids) await page.getByLabel(`Zoom for ${each}`).selectOption('1');
    const device = page.locator(`.device[data-device="${id}"]`);
    const other = page.locator(`.device[data-device="${otherId}"]`);
    const live = page.frameLocator(`iframe[data-lab-device="${id}"]`);
    const otherLive = page.frameLocator(`iframe[data-lab-device="${otherId}"]`);

    await live.getByRole('button', { name: 'New group' }).click();
    await expect(live.getByRole('button', { name: 'Back to groups' })).toBeVisible();
    await expect(otherLive.getByRole('button', { name: 'Back to groups' })).toHaveCount(0);
    await expect(otherLive.getByRole('button', { name: 'New group' })).toBeVisible();
    await expect(device.locator('.insp-overview')).toContainText('View: create');
    await expect(other.locator('.insp-overview')).toContainText('View: home');

    // Each frame is the device's own window, at its screen size.
    await expect.poll(() => page.locator(`iframe[data-lab-device="${id}"]`).evaluate((frame: HTMLIFrameElement) => frame.contentWindow?.innerWidth)).toBe(390);

    await device.getByRole('button', { name: `Network for ${id}` }).click();
    await expect(device.locator('.insp-overview')).toContainText('Offline');
    await expect(other.locator('.insp-overview')).toContainText('Online');
    const groupName = live.getByRole('textbox', { name: 'Group name', exact: true });

    await groupName.fill('Draft before reorder');
    await groupName.evaluate((node) => { node.setAttribute('data-reorder-probe', 'same-node'); });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    const inspector = device.getByRole('separator', { name: 'Resize inspector', exact: true });
    // The inspector sits right of its separator, so ArrowLeft widens it.
    const inspectorWidth = String(Number(await inspector.getAttribute('aria-valuenow')) + 10);

    await inspector.press('ArrowLeft');
    await expect(inspector).toHaveAttribute('aria-valuenow', inspectorWidth);
    await inspector.press('Enter');
    await expect(device.getByRole('button', { name: /Toggle inspector/ })).toHaveAttribute('aria-expanded', 'false');
    await device.getByRole('button', { name: /Toggle inspector/ }).click();
    // Dragging the device's tab onto the right edge of the other device's section puts it there.
    const tab = page.getByRole('tab', { name: new RegExp(id) });
    const from = await tab.boundingBox();
    const target = await other.boundingBox();

    await page.mouse.move(from!.x + 20, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target!.x + target!.width - 10, target!.y + target!.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.device').last()).toHaveAttribute('data-device', id);
    const divider = page.getByRole('separator', { name: 'Resize sections' }).last();
    const width = Number(await divider.getAttribute('aria-valuenow'));

    await divider.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', String(width + 16));
    // Moving the panel moved its frame without reloading it.
    await expect(groupName).toHaveAttribute('data-reorder-probe', 'same-node');
    await expect(groupName).toHaveValue('Draft before reorder');
    await groupName.fill('Draft after reorder');
    await live.getByRole('textbox', { name: 'Your name in this group', exact: true }).fill('Ana');
    await device.getByRole('button', { name: `Network for ${id}` }).click();
    await live.getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(live.getByRole('button', { name: 'Invite people' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.device').last()).toHaveAttribute('data-device', id);
    await expect(page.getByRole('separator', { name: 'Resize sections' }).last()).toHaveAttribute('aria-valuenow', String(width + 16));
    await expect(device.getByRole('separator', { name: 'Resize inspector', exact: true })).toHaveAttribute('aria-valuenow', inspectorWidth);
    await expect(live.getByRole('button', { name: 'Invite people' })).toBeVisible();
    await device.getByRole('button', { name: /Toggle inspector/ }).click();
    await page.reload();
    await expect(device.getByRole('button', { name: /Toggle inspector/ })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: '.wrangler/lab-inpage-ui.png', fullPage: true });
  } finally {
    await call('shutdown').catch(() => undefined);

    if (child.exitCode === null) await once(child, 'exit');
  }
});

test('device lab frontend controls its actual installations and shows inspector state', async ({ page, request }) => {
  test.setTimeout(120_000);
  const base = 'http://127.0.0.1:8826';
  const child = spawn(process.execPath, ['lab/server.mjs', `--env=browser-${Date.now()}`, '--port=8826', '--workerPort=8827'], { windowsHide: true, stdio: 'ignore' });
  const call = (operation: string, input = {}) => request.post(`${base}/api`, { data: { operation, input } });

  try {
    await expect.poll(async () => {
      try { return (await (await call('status')).json()).initialized === true; } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
    await page.goto(base);
    await expect(page.getByRole('heading', { name: 'Splitnext / Device lab' })).toBeVisible();
    await page.getByLabel('Device kind').selectOption('browser');
    await page.getByRole('button', { name: 'Add device', exact: true }).click();
    await expect(page.locator('.device')).toHaveCount(1);
    await expect.poll(() => page.locator('.screen').evaluate((image) => image instanceof HTMLImageElement && image.naturalWidth === 390)).toBe(true);
    // New group sits at (192, 744) on the 390 × 780 screen, drawn here at whatever zoom fits.
    const drawn = await page.locator('.screen').boundingBox();

    await page.locator('.screen').click({ position: { x: (drawn!.width * 192) / 390, y: (drawn!.height * 744) / 780 } });
    await expect(page.locator('.device .insp-overview')).toContainText('View: create');
    await page.locator('.screen').press('L');
    await expect(page.locator('.device .insp-overview')).toContainText('name: "L"');
    const overview = page.locator('.device .insp-overview');
    const network = page.getByRole('button', { name: /^Network for / });

    await network.click();
    await expect(overview).toContainText('Offline');
    await page.getByRole('button', { name: /^Reload for / }).click();
    await expect(page.locator('#server-panel [role=alert]')).toBeHidden();
    await network.click();
    await expect(overview).toContainText('Online');
    await page.getByRole('button', { name: 'Unavailable', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Unavailable');
    await expect(overview).toContainText('Online');
    await page.getByRole('button', { name: 'Available', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Available');
    // Every lab operation is a form; device fields offer the devices that exist.
    await page.getByRole('tab', { name: 'Operations' }).click();
    await page.getByPlaceholder('Find an operation…').fill('reload device');
    await page.locator('#operations-panel .insp-action-head', { hasText: /^Reload device/ }).click();
    await expect(page.locator('#operations-panel .insp-action[data-open] select').first()).toContainText('(browser)');
    await page.screenshot({ path: '.wrangler/lab-ui.png', fullPage: true });
  } finally {
    await call('shutdown').catch(() => undefined);

    if (child.exitCode === null) await once(child, 'exit');
  }
});

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
      const insetTop = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
      const insetBottom = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
      const baseline = box.top + insetTop + (line - content) / 2 + metrics.fontBoundingBoxAscent;
      const lastBaseline = baseline + (Math.max(1, Math.round((box.height - insetTop - insetBottom) / line)) - 1) * line;
      const cut = Math.max(edge.top - (baseline - metrics.actualBoundingBoxAscent), lastBaseline + metrics.actualBoundingBoxDescent - edge.bottom);

      if (cut > 0.5) found.push(`${text} (${style.fontSize} on ${line}px) loses ${cut.toFixed(1)}px`);
    }

    return found;
  });
}

/** Opens one of the group screen's tabs, People or Expenses, unless it is already open. */
async function showTab(page: Page, name: 'People' | 'Expenses'): Promise<void> {
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}\\b`) });

  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Geometry checks compare settled screens; motion tests sample the movement separately. */
async function motionSettled(page: Page): Promise<void> {
  await expect(page.locator('[data-copied-page]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
}

/** Unfolds an expense's split while it is equal between everyone, to change it person by person. */
async function openSplit(page: Page): Promise<void> {
  const folded = button(page, /^Split equally between everyone, .*Change split$/);

  if (await folded.count()) await folded.click();
  await expect(folded).toHaveCount(0);
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
  await motionSettled(page);
}

/**
 * Adds a person in the last row of the balances, then finishes with Enter on
 * the emptied field, so the rest of the screen is no longer dimmed behind it.
 */
async function addMember(page: Page, name: string): Promise<void> {
  await showTab(page, 'People');
  await field(page, 'Add a person').fill(name);
  await field(page, 'Add a person').press('Enter');
  await expect(page.getByRole('button', { name: new RegExp(`^${escaped(name)}, .*\\. Show details$`), includeHidden: true })).toBeAttached();
  await field(page, 'Add a person').press('Enter');
  await expect(page.getByTestId('edit-cover')).toHaveCount(0);
  await motionSettled(page);
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
  // A new expense returns to the expenses, where it leads the list; the balances are one tab over.
  await expect(button(page, new RegExp(`^Change ${escaped(description)} · `))).toBeVisible();
  await showTab(page, 'People');
  await motionSettled(page);
}

/** Opens a new payment from the group screen: Add expense, then its Payment tab. */
async function openPayment(page: Page): Promise<void> {
  await button(page, 'Add expense').click();
  await page.getByRole('radiogroup', { name: 'Entry type' }).getByRole('radio', { name: 'Payment', exact: true }).click();
  await expect(button(page, /^Paid to .*Change recipient$/)).toBeVisible();
}

/** Records a payment from the group screen, choosing who paid and who was paid by name. */
async function addPayment(page: Page, from: string, to: string, amount: string): Promise<void> {
  await openPayment(page);
  await field(page, 'Amount').fill(amount);
  await button(page, /^Paid by .*Change payer$/).click();
  await page.getByRole('radio', { name: new RegExp(`^${escaped(from)}( \\(you\\))?$`) }).click();
  await button(page, /^Paid to .*Change recipient$/).click();
  await page.getByRole('radio', { name: new RegExp(`^${escaped(to)}( \\(you\\))?$`) }).click();
  await button(page, 'Save').click();
  await expect(button(page, 'Add expense')).toBeVisible();
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

  // Someone else's details offer no way to become them; that is leaving and rejoining as them.
  await expect(button(page, /^I’m /)).toHaveCount(0);
  await expect(page.getByText('This is me')).toHaveCount(0);
  await button(page, 'Back to Trip').click();
  await expect(button(page, 'Ana (you), no expenses yet. Show details')).toBeVisible();

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

test('opens the invite link right under the group name, with the tabs close below it', async ({ page }) => {
  await createGroup(page, 'Invite spacing', 'Ana');

  for (const width of [320, 1100]) {
    await page.setViewportSize({ width, height: 650 });
    const invite = button(page, 'Invite people');
    const title = (await heading(page, 'Invite spacing').boundingBox())!;

    await invite.click();
    const panel = page.getByRole('region', { name: 'Invite people' });
    const line = (await panel.getByRole('button', { name: 'Copy link' }).locator('..').boundingBox())!;
    const tabs = (await page.getByRole('tablist', { name: 'Group' }).boundingBox())!;

    expect(line.y - title.y - title.height).toBeLessThanOrEqual(24);
    // Only the quiet line for you sits between the link and the tabs.
    expect(tabs.y - line.y - line.height).toBeLessThanOrEqual(80);
    await invite.click();
    await expect(panel).toHaveCount(0);
  }
});

test('collapses the invite dropdown when scrolling down', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await createGroup(page, 'Scrolling invite', 'Ana');

  for (let index = 0; index < 8; index++) await addExpense(page, `Item ${index}`, '20');

  // The expenses are long enough to scroll.
  await showTab(page, 'Expenses');
  await button(page, 'Invite people').click();
  const panel = page.getByRole('region', { name: 'Invite people' });

  await expect(panel).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const scroller = page.locator('#splitnext-page');
  const box = (await scroller.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 40);
  await expect(panel).toHaveCount(0);
  await expect(heading(page, 'Scrolling invite')).toBeVisible();
  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await button(page, 'Invite people').click();
  await expect(panel).toBeVisible();
});

test('removes someone no expense names from their details, never from the balances', async ({ page }) => {
  await createGroup(page, 'Rows', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');

  // Rows in the balances only open people; you never have Remove, in the balances or your details.
  await expect(button(page, /^Remove /)).toHaveCount(0);
  await button(page, 'Ana (you), no expenses yet. Show details').click();
  await expect(heading(page, 'Ana')).toBeVisible();
  await expect(button(page, 'Remove Ana')).toHaveCount(0);
  await button(page, 'Back to Rows').click();
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('20');
  await field(page, 'Description').fill('Lunch');
  await openSplit(page);
  await page.getByRole('checkbox', { name: 'Cy shares this expense' }).click();
  await button(page, 'Save').click();
  await showTab(page, 'People');

  // Ben is in the lunch, so his details offer no Remove; Cy, left out of it, can still go.
  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toBeVisible();
  await expect(button(page, 'Remove Ben')).toHaveCount(0);
  await button(page, 'Back to Rows').click();
  await person(page, 'Cy').click();
  await button(page, 'Remove Cy').click();
  await expect(page.getByTestId('toast')).toHaveText('Cy removed.');
  await expect(heading(page, 'Rows')).toBeVisible();
  await expect(person(page, 'Cy')).toHaveCount(0);
});

test('uses one large title on every screen and opens the join field in place', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Headers', 'Ana');
  await expect(heading(page, 'Headers')).toHaveCSS('font-size', '32px');
  await addMember(page, 'Ben');
  await addExpense(page, 'Lunch', '20');
  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toHaveCSS('font-size', '32px');
  await button(page, 'Settle up, 1 payment').click();
  await expect(page.getByRole('region', { name: 'Settle up' })).toBeVisible();
  await expect(heading(page, 'Ben')).toHaveCSS('font-size', '32px');
  await button(page, 'Back to Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await page.mouse.click(195, 40);
  await expect(page.getByRole('region', { name: 'Settle up' })).toHaveCount(0);
  await expect(heading(page, 'Ben')).toBeVisible();
  await button(page, 'Back to Headers').click();
  await bell(page).click();
  await expect(heading(page, 'Activity')).toHaveCSS('font-size', '32px');
  await button(page, 'Back to Headers').click();
  await button(page, 'Back to groups').click();
  await motionSettled(page);
  // The groups list shows the mark, about as tall as a title, with the name
  // beside it at title size, instead of a title.
  await expect(page.getByText('Your groups', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('splitnext-logo')).toHaveAttribute('height', '34');
  const name = page.getByText('splitnext', { exact: true });
  const logo = (await page.getByTestId('splitnext-logo').boundingBox())!;
  const nameBox = (await name.boundingBox())!;

  await expect(name).toHaveCSS('font-size', '32px');
  expect(nameBox.x).toBeGreaterThan(logo.x + logo.width);
  expect(nameBox.x - (logo.x + logo.width)).toBeLessThan(20);
  expect(Math.abs(nameBox.y + nameBox.height / 2 - (logo.y + logo.height / 2))).toBeLessThanOrEqual(3);
  await button(page, 'New group').click();
  // New group opens upward from its button, over the groups list, ready to type.
  await expect(page.getByRole('region', { name: 'New group' })).toBeVisible();
  await expect(field(page, 'Group name')).toBeFocused();
  await expect(heading(page, 'Your groups')).toBeVisible();
  await button(page, 'Back to groups').click();
  await motionSettled(page);
  await expect(page.getByRole('region', { name: 'New group' })).toHaveCount(0);

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

test('dims the rest while a name or the join link is edited, and a tap there only ends it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createGroup(page, 'Covers', 'Ana');
  await addMember(page, 'Ben');
  const cover = page.getByTestId('edit-cover');

  /** Taps the middle of what a locator shows, wherever it is, as a finger would. */
  const tapOver = async (target: Locator) => {
    const box = (await target.boundingBox())!;

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };

  /** Whether the field itself, not the cover, is what a tap on it reaches. */
  const uncovered = (target: Locator) => target.evaluate((node) => {
    const box = node.getBoundingClientRect();

    return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });

  // Adding a person: a tap on Ben's row adds the typed name instead of opening Ben.
  await field(page, 'Add a person').click();
  await page.keyboard.type('Dee');
  await expect(cover).toBeVisible();
  expect(await uncovered(field(page, 'Add a person'))).toBe(true);
  await tapOver(person(page, 'Ben'));
  await expect(person(page, 'Dee')).toBeVisible();
  await expect(heading(page, 'Ben')).toHaveCount(0);
  await expect(cover).toHaveCount(0);

  // The group's name: a tap on Ben's row saves the name instead of opening Ben.
  await expect(cover).toHaveCount(0);
  await button(page, 'Rename group').click();
  await field(page, 'Group name').fill('Covered');
  await expect(cover).toBeVisible();
  expect(await uncovered(field(page, 'Group name'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('cover-group-name.png') });
  await tapOver(person(page, 'Ben'));
  await expect(heading(page, 'Covered')).toBeVisible();
  await expect(heading(page, 'Ben')).toHaveCount(0);
  await expect(cover).toHaveCount(0);

  // A member's name: a tap on Back saves the name and stays.
  await person(page, 'Ben').click();
  await button(page, 'Rename Ben').click();
  await field(page, 'Name').fill('Benny');
  await expect(cover).toBeVisible();
  expect(await uncovered(field(page, 'Name'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('cover-member-name.png') });
  await tapOver(button(page, 'Back to Covered'));
  await expect(heading(page, 'Benny')).toBeVisible();
  await expect(cover).toHaveCount(0);
  await button(page, 'Back to Covered').click();
  await button(page, 'Back to groups').click();
  await motionSettled(page);

  // Join with a link: a tap on New group closes the field without opening New group.
  await button(page, 'Join with an invite link').click();
  await expect(cover).toBeVisible();
  expect(await uncovered(field(page, 'Invite link'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('cover-join-link.png') });
  await tapOver(button(page, 'New group'));
  await expect(field(page, 'Invite link')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'New group' })).toHaveCount(0);
  await expect(cover).toHaveCount(0);
});

test('wraps long names onto more lines while renaming, and Enter still saves', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createGroup(page, 'Wrap', 'Ana');
  await addMember(page, 'Ben');

  const renames = [
    { open: 'Rename group', field: 'Group name', name: 'A very long group name that keeps going well past one line' },
    { open: 'Rename Ben', field: 'Name', name: 'Bartholomew Maximilian Fitzgerald-Worthington the Third' },
  ];

  for (const rename of renames) {
    if (rename.open === 'Rename Ben') await person(page, 'Ben').click();
    await button(page, rename.open).click();
    const input = field(page, rename.field);
    const oneLine = (await input.boundingBox())!.height;

    // The field grows a line at a time instead of scrolling sideways.
    await input.fill(rename.name);
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
    expect(await input.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`wrap-${rename.field.toLowerCase().replace(' ', '-')}.png`) });
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(heading(page, rename.name)).toBeVisible();
  }
});

test('keeps rename fields steady from their first frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await createGroup(page, 'Rename flash', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  for (const member of [false, true]) {
    if (member) {
      await person(page, 'Benjamin Alexander').click();
      await expect(page.locator('[data-copied-page]')).toHaveCount(0);
    }

    const label = member ? 'Name' : 'Group name';

    const watching = page.evaluate((label) => new Promise<{ heights: number[]; pans: number[] }>((resolve) => {
      const heights: number[] = [];
      const pans: number[] = [];
      const start = performance.now();

      const record = (event: Event) => {
        const node = event.target;
        const page = document.getElementById('splitnext-page');

        if (node instanceof HTMLElement && page && node !== page && node.contains(page) && node.scrollTop) pans.push(node.scrollTop);
      };

      document.addEventListener('scroll', record, true);

      (function frame() {
        const input = document.querySelector(`textarea[aria-label="${label}"]`);

        if (input) heights.push(input.getBoundingClientRect().height);

        if (performance.now() - start < 700) requestAnimationFrame(frame);
        else {
          document.removeEventListener('scroll', record, true);
          resolve({ heights, pans });
        }
      })();
    }), label);

    await button(page, member ? 'Rename Benjamin Alexander' : 'Rename group').click();
    const { heights, pans } = await watching;

    expect(heights.length).toBeGreaterThan(5);
    expect(Math.max(...heights) - Math.min(...heights), label).toBeLessThanOrEqual(1);
    expect(pans, label).toEqual([]);
    await field(page, label).press('Escape');
    await expect(field(page, label)).toHaveCount(0);
  }
});

test('opens a rename where the name already is: full width, the same lines in the same places', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const groupName = 'A very long group name that keeps going on';
  const you = 'Anastasia Konstantinopoulou-Smith';
  const other = 'Bartholomew Maximilian Fitzgerald';

  await createGroup(page, groupName, you);
  await addMember(page, other);

  /** Where each line of text sits and ends, rounded to the pixel, so a moved line break shows. */
  const lines = (node: Element) => {
    const range = document.createRange();

    range.selectNodeContents(node);

    const ends = new Map<number, number>();

      for (const rect of Array.from(range.getClientRects())) ends.set(Math.round(rect.y), Math.max(ends.get(Math.round(rect.y)) ?? 0, Math.round(rect.right)));

      return [...ends].map(([y, right]) => `${y}–${right}`);
  };

  const renames = [
    { open: 'Rename group', field: 'Group name', title: groupName, go: async () => {} },
    { open: `Rename ${other}`, field: 'Name', title: other, go: () => person(page, other).click() },
    { open: `Rename ${you}`, field: 'Name', title: you, go: async () => { await button(page, `Back to ${groupName}`).click(); await person(page, you).click(); } },
  ];

  for (const rename of renames) {
    await rename.go();
    await motionSettled(page);
    const title = heading(page, rename.title);
    const before = await title.evaluate(lines);
    const left = (await title.boundingBox())!.x;

    // Long enough to wrap; the title shows two lines of it.
    expect(before.length).toBeGreaterThanOrEqual(2);
    await button(page, rename.open).click();
    const input = field(page, rename.field);
    const box = (await input.boundingBox())!;

    // The field's lines are laid out by the unseen copy of its text beside it.
    const after = await input.evaluate((node) => {
      const copy = node.previousElementSibling!;
      const range = document.createRange();

      range.selectNodeContents(copy);

      const ends = new Map<number, number>();

      for (const rect of Array.from(range.getClientRects())) ends.set(Math.round(rect.y), Math.max(ends.get(Math.round(rect.y)) ?? 0, Math.round(rect.right)));

      return [...ends].map(([y, right]) => `${y}–${right}`);
    });

    expect(box.x).toBeCloseTo(left, 0);
    // The column's gutter is 20px.
    expect(box.x + box.width).toBeCloseTo(390 - 20, 0);
    // The first line breaks where the title's did; the title ends its second line with an ellipsis.
    expect(after[0]).toBe(before[0]);
    expect(after[1]?.split('–')[0]).toBe(before[1]?.split('–')[0]);

    // The whole name is selected, ready to be typed over.
    await expect(input).toBeFocused();
    expect(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd])).toEqual([0, rename.title.length]);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
  }

  // Typing replaces the name rather than adding to it.
  await button(page, `Rename ${you}`).click();
  await page.keyboard.type('Ana');
  await expect(field(page, 'Name')).toHaveValue('Ana');
  await page.keyboard.press('Enter');
  await expect(heading(page, 'Ana')).toBeVisible();
});

test('hides the rename pencil as the header compacts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await createGroup(page, 'Pencils', 'Ana');
  await addMember(page, 'Ben');

  for (const amount of ['10', '20', '30', '40', '50', '60', '70', '80']) await addExpense(page, `Meal ${amount}`, amount);
  const scroller = page.locator('#splitnext-page');

  // The expenses are long enough to scroll the group's header compact.
  await showTab(page, 'Expenses');

  for (const pencil of ['Rename group', 'Rename Ben']) {
    if (pencil === 'Rename Ben') {
      await showTab(page, 'People');
      await person(page, 'Ben').click();
    }

    await expect(button(page, pencil)).toBeVisible();
    await expect(button(page, pencil)).toHaveCSS('opacity', '1');
    await scroller.evaluate((node) => { node.scrollTop = 20; });
    await expect.poll(() => button(page, pencil).evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThan(1);
    expect(await button(page, pencil).evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0);
    await scroller.evaluate((node) => { node.scrollTop = 300; });
    await expect(button(page, pencil)).toHaveCount(0);
    await scroller.evaluate((node) => { node.scrollTop = 0; });
    await expect(button(page, pencil)).toBeVisible();
    await expect(button(page, pencil)).toHaveCSS('opacity', '1');
  }
});

test('keeps the Activity bell on a person’s page, beside a long Back', async ({ page }, testInfo) => {
  const group = 'A very long group name that keeps going on';

  await page.setViewportSize({ width: 390, height: 844 });
  await createGroup(page, group, 'Ana');
  await addMember(page, 'Ben');
  await person(page, 'Ben').click();
  await expect(heading(page, 'Ben')).toBeVisible();

  // The bell sits whole at the end of the top row, clear of Back.
  const bellBox = (await bell(page).boundingBox())!;
  const backBox = (await button(page, `Back to ${group}`).boundingBox())!;

  expect(bellBox.x + bellBox.width).toBeLessThanOrEqual(390);
  expect(backBox.x + backBox.width).toBeLessThanOrEqual(bellBox.x);
  await page.screenshot({ path: testInfo.outputPath('person-bell.png'), clip: { x: 0, y: 0, width: 390, height: 160 } });

  // It opens Activity, and Back returns to the person.
  await bell(page).click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await button(page, new RegExp('^Back to ')).click();
  await expect(heading(page, 'Ben')).toBeVisible();
});

test('flies a group’s name to the list at its font size, even when it unwraps', async ({ page }) => {
  // Two lines as the group's title, one line in the list.
  const name = 'A long group name that wraps';

  await page.setViewportSize({ width: 390, height: 844 });
  await createGroup(page, name, 'Ana');
  await expect(heading(page, name)).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Every scale the flying name is drawn at, from its animations' keyframes.
  const scales = page.evaluate((text) => new Promise<number[]>((resolve) => {
    const seen = new Set<number>();
    const start = performance.now();

    const frame = () => {
      for (const animation of document.getAnimations()) {
        const effect = animation.effect;

        if (!(effect instanceof KeyframeEffect) || effect.target?.textContent !== text) continue;

        for (const keyframe of effect.getKeyframes()) {
          const scale = /scale\(([\d.]+)\)/.exec(String(keyframe.transform ?? ''));

          if (scale) seen.add(Math.round(Number(scale[1]) * 1000) / 1000);
        }
      }

      if (performance.now() - start < 600) requestAnimationFrame(frame);
      else resolve([...seen].sort((a, b) => a - b));
    };

    frame();
  }), name);

  await button(page, 'Back to groups').click();
  await motionSettled(page);
  // 32px as the title, 20px in the list: it leaves at 20/32 and arrives from 32/20.
  expect(await scales).toEqual([0.625, 1.6]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await motionSettled(page);
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
  await motionSettled(page);
  await expect(page.getByLabel('settled', { exact: true })).toBeVisible();
  await button(page, 'Open Summaries').click();
  await addExpense(page, 'Dinner', '60', 'Ana');
  await addExpense(page, 'Tickets', '40', 'Ben');
  await expect(button(page, 'Ana (you), +10.00. Show details')).toBeVisible();

  await goOffline(page, context);
  await button(page, 'Back to groups').click();
  await motionSettled(page);
  await expect(page.getByText('+10.00', { exact: true })).toBeVisible();
  await button(page, 'Open Summaries').click();
  await person(page, 'Ana').click();

  // Expenses name Ana, so her details offer no Remove and no explanation.
  await expect(button(page, 'Remove Ana')).toHaveCount(0);
  await expect(page.getByText(/^Settle up first/)).toHaveCount(0);
  await button(page, 'Back to Summaries').click();
});

test('shows each balance and your balance on the groups list', async ({ page }) => {
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
  await motionSettled(page);
  await expect(page.getByText('+10.00', { exact: true })).toBeVisible();
  // A group's row is its name and your balance; who is in it shows inside.
  await expect(page.getByText('2 people · You’re Ana', { exact: true })).toHaveCount(0);
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
  await expect(page.getByTestId('expense-timestamp')).toHaveCount(0);
  const save = button(page, 'Save');

  await expect(save).toBeDisabled();
  await motionSettled(page);
  const savePosition = (await save.boundingBox())!;

  expect(savePosition.y + savePosition.height).toBeGreaterThan((page.viewportSize()?.height ?? 0) - 60);
  expect(savePosition.width).toBeGreaterThan(300);

  // Amounts are plain numbers: there is no currency to choose.
  await expect(button(page, /Change currency$/)).toHaveCount(0);
  await field(page, 'Amount').fill('30');
  await expect(page.getByTestId('split-summary')).toHaveText('15.00 each');
  await expect(field(page, 'Amount for Ben')).toHaveCount(0);
  await field(page, 'Description').fill('Dinner');
  await expect(save).toBeEnabled();
  await expect(save).toHaveCSS('background-color', 'rgb(20, 20, 19)');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Dinner · 30.00')).toBeVisible();
  await expect(addButton).toBeVisible();
  await motionSettled(page);
  expect(await addButton.boundingBox()).toEqual(addPosition);
  await expect(button(page, 'Ana (you), +15.00. Show details')).toBeVisible();
  await showTab(page, 'People');
  await expect(button(page, 'Ben, −15.00. Show details')).toBeVisible();
  await showTab(page, 'Expenses');

  await button(page, 'Change Dinner · 30.00').click();
  await expect(field(page, 'Amount')).not.toBeFocused();
  await motionSettled(page);
  expect(await save.boundingBox()).toEqual(savePosition);
  const timestamp = page.getByTestId('expense-timestamp');

  // The same relative wording as Activity, at the right.
  await expect(timestamp).toHaveText(/^Created (just now|\d+m ago)$/);
  await expect(timestamp).toHaveCSS('text-align', 'left');
  await expect(field(page, 'Amount')).toHaveCSS('text-align', 'right');
  const created = await timestamp.textContent();
  const timestampBox = await timestamp.boundingBox();
  const amountBox = await field(page, 'Amount').boundingBox();

  expect(timestampBox!.y + timestampBox!.height).toBeLessThanOrEqual(amountBox!.y);
  await button(page, 'Cancel').click();
  await button(page, 'Change Dinner · 30.00').click();
  await expect(timestamp).toHaveText(created!);
  await field(page, 'Amount').fill('40');
  await button(page, 'Save').click();
  await expect(button(page, 'Change Dinner · 40.00')).toBeVisible();

  // An expense names Ben, so he cannot be removed.
  await showTab(page, 'People');
  await person(page, 'Ben').click();
  await expect(button(page, 'Remove Ben')).toHaveCount(0);
  await expect(page.getByText(/^Settle up first/)).toHaveCount(0);
  await button(page, 'Back to Trip').click();

  // Deleting happens from the expense's own screen, which returns to the group.
  await page.reload();
  await showTab(page, 'Expenses');
  await button(page, 'Change Dinner · 40.00').click();
  await expect(timestamp).toHaveText(/^Last updated (just now|\d+m ago)$/);
  await button(page, 'Delete Dinner · 40.00').click();
  // The expenses say there are none; Add expense stays where it was.
  await expect(page.getByText('No expenses yet', { exact: true })).toBeVisible();
  await expect(addButton).toBeVisible();
  await motionSettled(page);
  expect(await addButton.boundingBox()).toEqual(addPosition);
  await expect(button(page, 'Ana (you), no expenses yet. Show details')).toBeVisible();

  // Settled again, Ben still stays: the removed expense names him, and only
  // someone no expense or repayment names can be removed.
  await showTab(page, 'People');
  await person(page, 'Ben').click();
  await expect(button(page, 'Remove Ben')).toHaveCount(0);
  await expect(button(page, 'Hide Ben')).toHaveCount(0);
});

test('keeps the expense amount formatted while typing and accepts dots or commas', async ({ page }) => {
  await createGroup(page, 'Amounts', 'Ana');
  await button(page, 'Add expense').click();
  const amount = field(page, 'Amount');

  for (const [entered, formatted] of [['12', '12.00'], ['12.5', '12.50'], ['12,5', '12.50'], ['.5', '0.50'], ['0', '0.00'], ['1,234.56', '1,234.56']]) {
    await amount.fill(entered!);
    await expect(amount).toHaveValue(formatted!);
    await expect(amount).toBeFocused();
  }

  for (const invalid of ['abc', '-12', '1e3', '12..5']) {
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

test('groups the digits of large amounts in threes, as typed and as shown', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createGroup(page, 'Big', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  const amount = field(page, 'Amount');
  // Groups are separated by commas.
  const grouped = (text: string) => text.replaceAll(' ', ',');

  await amount.pressSequentially('1234567');
  await expect(amount).toHaveValue(grouped('1 234 567.00'));
  await amount.pressSequentially(',8');
  await expect(amount).toHaveValue(grouped('1 234 567.80'));

  // Typing in the middle of a grouped figure keeps its place, and the groups move.
  await amount.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 1));
  await amount.pressSequentially('0');
  await expect(amount).toHaveValue(grouped('10 234 567.80'));
  await amount.pressSequentially('x');
  await expect(amount).toHaveValue(grouped('10 234 567.80'));
  await amount.press('Backspace');
  await expect(amount).toHaveValue(grouped('1 234 567.80'));

  // A grouped figure pasted back in is read as a plain amount.
  await amount.fill('');
  await page.evaluate(() => navigator.clipboard.writeText('2,500.25'));
  await amount.focus();
  await page.keyboard.press('Control+V');
  await expect(amount).toHaveValue(grouped('2 500.25'));

  await amount.fill('4321');
  await field(page, 'Description').fill('Flights');
  await openSplit(page);
  await expect(button(page, `Amount for Ana: ${grouped('2 160.50')}. Change amount`)).toBeVisible();
  await button(page, 'Save').click();
  await expect(button(page, `Change Flights · ${grouped('4 321.00')}`)).toBeVisible();
  // What the expense does to you shows under it; Ben's balance is with everyone's.
  await expect(page.getByText(grouped('+2 160.50'), { exact: true })).toBeVisible();
  await showTab(page, 'People');
  await expect(page.getByText(grouped('−2 160.50'), { exact: true })).toBeVisible();
});

test('fits the split bar within the page however many people share the expense', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Many', 'Ana');

  for (const name of ['Al', 'Bo', 'Cy', 'Di', 'Ed', 'Fy', 'Gu', 'Hu', 'Ia', 'Jo', 'Ki', 'Lu', 'Mo']) await addMember(page, name);

  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('1765.25');
  await openSplit(page);
  await button(page, 'Increase share for Ana').click();
  const bar = page.getByTestId('split-bar');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    await page.waitForTimeout(600);
    // The bar ends where the rules above and below it end.
    const edge = (await page.getByRole('button', { name: /^Paid by / }).boundingBox())!;
    const segments = await bar.evaluate((node) => [...node.children].map((child) => child.getBoundingClientRect().width));
    const box = (await bar.boundingBox())!;

    expect(box.x + box.width).toBeLessThanOrEqual(edge.x + edge.width + 0.5);
    expect(Math.max(...await bar.evaluate((node) => [...node.children].map((child) => child.getBoundingClientRect().right)))).toBeLessThanOrEqual(edge.x + edge.width + 0.5);
    expect(segments).toHaveLength(14);
    // Ana's two shares take twice anyone else's room.
    expect(Math.abs(segments[0]! / segments[1]! - 2)).toBeLessThan(0.05);
  }
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
    await openSplit(page);
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
  await openSplit(page);
  await button(page, 'Increase share for Ana').click();
  await button(page, /^Amount for Cy:/).click();
  await field(page, 'Amount for Cy').fill('10');
  await field(page, 'Amount for Cy').press('Enter');
  await page.getByRole('checkbox', { name: 'Benjamin Alexander shares this expense' }).click();

  const center = async (target: ReturnType<typeof button>) => {
    const box = (await target.boundingBox())!;

    return box.x + box.width / 2;
  };

  // Every row ends with its checkbox; − sits beside + once someone has more than one share or a fixed amount.
  for (const name of ['Ana', 'Benjamin Alexander', 'Cy']) await expect(page.getByRole('checkbox', { name: `${name} shares this expense` })).toHaveCount(1);
  await expect(button(page, 'Decrease share for Benjamin Alexander')).toHaveCount(0);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    const amount = (await button(page, /^Amount for Ana:/).boundingBox())!;
    const fixed = (await field(page, 'Amount for Cy').boundingBox())!;
    const plus = (await button(page, 'Increase share for Cy').boundingBox())!;

    expect(fixed.width).toBeLessThan(60);
    expect(Math.abs(plus.x + plus.width - fixed.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(fixed.width - amount.width)).toBeLessThanOrEqual(1);
    const end = await center(page.getByRole('checkbox', { name: 'Ana shares this expense' }));
    const minus = await center(button(page, 'Decrease share for Ana'));

    expect(Math.abs(fixed.x + fixed.width - (amount.x + amount.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(await center(page.getByRole('checkbox', { name: 'Cy shares this expense' })) - end)).toBeLessThanOrEqual(1);
    expect(Math.abs(await center(page.getByRole('checkbox', { name: 'Benjamin Alexander shares this expense' })) - end)).toBeLessThanOrEqual(1);
    // − lines up in its own column before the amount, and + right after it.
    expect(Math.abs(await center(button(page, 'Decrease share for Cy')) - minus)).toBeLessThanOrEqual(1);
    expect(minus).toBeLessThan(amount.x);
    // + sits before the amount, and only where it changes the split: Ana alone
    // divides the rest, so another share would change nothing.
    expect(await center(button(page, 'Increase share for Cy'))).toBeGreaterThan(minus);
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
  await openSplit(page);
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

  // Opening an amount and keeping its value must preserve the original weight.
  for (const finish of ['blur', 'Enter']) {
    await button(page, /^Amount for Ana:/).click();
    await expect(field(page, 'Amount for Ana')).toBeFocused();
    await expect(field(page, 'Amount for Ana')).toHaveValue('50.00');

    if (finish === 'Enter') {
      await field(page, 'Amount for Ana').fill('50');
      await field(page, 'Amount for Ana').press('Enter');
    } else await field(page, 'Description').click();

    await expect(button(page, 'Amount for Ana: 50.00. Change amount')).toBeVisible();
    await field(page, 'Amount').fill('120');
    await expect(button(page, 'Amount for Ana: 60.00. Change amount')).toBeVisible();
    await field(page, 'Amount').fill('100');
  }

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
  // The large figure, under Owes, and the breakdown's Balance row show the same total.
  await expect(page.getByText('10.00', { exact: true })).toHaveCount(1);
  await expect(page.getByText('−10.00', { exact: true })).toHaveCount(1);

  // Ben pays Ana directly; Cy's debt is a separate payment Ben is not part of.
  await button(page, 'Settle up, 1 payment').click();
  await expect(heading(page, 'Settle up')).toBeVisible();
  await expect(button(page, 'Ben pays you 10.00. Record this payment')).toBeVisible();

  // Short names and the amount fit, so they share one line.
  const drawer = page.getByRole('region', { name: 'Settle up' });
  const tops = await Promise.all(['Ben', '→ you', '10.00'].map(async (text) => (await drawer.getByText(text, { exact: true }).boundingBox())!.y));

  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(4);
  await page.screenshot({ path: test.info().outputPath('settle-up-drawer.png') });

  // A partial payment, recorded as a Payment from the group, leaves the rest in the plan.
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Settle').click();
  await addPayment(page, 'Ben', 'Ana', '4');
  await showTab(page, 'People');
  await person(page, 'Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await expect(button(page, 'Ben pays you 6.00. Record this payment')).toBeVisible();

  // Record records a planned payment at once.
  await button(page, 'Ben pays you 6.00. Record this payment').click();
  await expect(page.getByText('✓ Settled', { exact: true })).toBeVisible();
  await button(page, 'Back to Ben').click();
  await expect(button(page, /^Settle up/)).toHaveCount(0);
  await button(page, 'Back to Settle').click();
  await showTab(page, 'Expenses');
  await expect(button(page, 'Change repayment: Ben paid you back 4.00')).toBeVisible();
  await showTab(page, 'People');

  // Settled, Ben folds into one line with anyone else settled, which shows them.
  await expect(button(page, 'Ben, 0.00. Show details')).toHaveCount(0);
  await button(page, '1 settled: Ben').click();
  await expect(button(page, 'Ben, 0.00. Show details')).toBeVisible();
  await expect(person(page, 'Ben').getByText('0.00', { exact: true })).toBeVisible();

  // People in no expense yet stay listed; settled people follow, folded or shown.
  await addMember(page, 'Dee');
  expect(await page.getByRole('button', { name: /Show details$/ }).evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))).toEqual([
    expect.stringMatching(/^Ana \(you\), /),
    expect.stringMatching(/^Cy, /),
    'Dee, no expenses yet. Show details',
    'Ben, 0.00. Show details',
  ]);
  await expect(person(page, 'Dee').getByText('Dee', { exact: true })).toBeVisible();
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

test('opens who paid in place and keeps the choice', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Payers', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  await button(page, 'Paid by Ana (you). Change payer').click();
  const payers = page.getByRole('radiogroup', { name: 'Paid by' });

  await expect(payers).toBeVisible();
  const you = payers.getByRole('radio', { name: 'Ana (you)', exact: true });

  await expect(you).toBeChecked();
  await expect(you.getByText('you', { exact: true })).toBeVisible();
  await expect(payers.getByRole('radio', { name: 'Ben', exact: true }).getByText('you', { exact: true })).toHaveCount(0);
  await payers.getByRole('radio', { name: 'Ben', exact: true }).click();
  await expect(payers).toHaveCount(0);
  await expect(button(page, 'Paid by Ben. Change payer')).toBeVisible();
  await button(page, 'Paid by Ben. Change payer').click();
  await expect(you).not.toBeChecked();
  await expect(you.getByText('you', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('expense-payer-you.png') });
  await you.click();
  await expect(button(page, 'Paid by Ana (you). Change payer')).toBeVisible();
});

test('renames the group in place, copies the invite link, and replaces it after confirming', async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createGroup(page, 'Trip', 'Ana');
  await button(page, 'Rename group').click();
  await field(page, 'Group name').fill('Lisbon');

  // Every frame after saving: the title goes from the field straight to the new name.
  const titles = page.evaluate(() => new Promise<string[]>((resolve) => {
    const seen: string[] = [];
    const start = performance.now();

    (function frame() {
      const title = document.querySelector('[role="heading"]')?.textContent ?? '';

      if (title && seen.at(-1) !== title) seen.push(title);

      if (performance.now() - start < 1000) requestAnimationFrame(frame);
      else resolve(seen);
    })();
  }));

  await field(page, 'Group name').press('Enter');
  await expect(heading(page, 'Lisbon')).toBeVisible();
  expect(await titles).toEqual(['Lisbon']);

  // The link opens in place under the name.
  await button(page, 'Invite people').click();
  const panel = page.getByRole('region', { name: 'Invite people' });
  const before = (await panel.getByTestId('invite-link').textContent()) ?? '';

  // One row: the link, with Replace as an icon at its right; there is no Copy link button.
  const linkBox = (await panel.getByTestId('invite-link').boundingBox())!;
  const replaceBox = (await panel.getByRole('button', { name: 'Regenerate link', exact: true }).boundingBox())!;

  expect(replaceBox.x).toBeGreaterThan(linkBox.x + linkBox.width);
  expect(Math.abs(replaceBox.y + replaceBox.height / 2 - (linkBox.y + linkBox.height / 2))).toBeLessThanOrEqual(2);
  expect(replaceBox.width).toBeLessThanOrEqual(44);
  await expect(panel.getByText('Copy link', { exact: true })).toHaveCount(0);

  // The link never wraps, even on a narrow screen: it stays whole on one line, smaller if need be.
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(300);
    const text = panel.getByTestId('invite-link');
    const lines = await text.evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));

    expect(lines).toBe(1);
    expect(await text.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }

  await expect(panel.getByText('Tap the link to copy it', { exact: true })).toHaveCount(0);
  // Tapping the link itself highlights and copies it.
  await panel.getByTestId('invite-link').click();
  await expect(panel.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
  await expect(panel.getByText('✓ Copied', { exact: true })).toBeVisible();
  // The panel shows the link without its scheme; the copy keeps it, so it opens when tapped.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://${before}`);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(before);

  // Regenerating asks first, in the same place.
  await panel.getByRole('button', { name: 'Regenerate link', exact: true }).click();
  await expect(panel.getByText('Regenerate the invite link to create a new one. The old link will stop working. Everyone already in the group keeps their access.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Regenerate', exact: true }).click();
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

  // The rest is dimmed while adding; Enter on the empty field finishes.
  await expect(page.getByTestId('edit-cover')).toBeVisible();
  expect(await add.evaluate((node) => {
    const box = node.getBoundingClientRect();

    return node.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  })).toBe(true);
  await page.keyboard.press('Enter');
  await expect(add).not.toBeFocused();
  await expect(page.getByTestId('edit-cover')).toHaveCount(0);
  await expect(button(page, 'Add expense')).toBeEnabled();
});

test('opens details as pages with Back, browser history, and keyboard focus', async ({ page }) => {
  await createGroup(page, 'Trip', 'Ana');
  await field(page, 'Add a person').click();
  await expect(field(page, 'Add a person')).toBeFocused();
  await field(page, 'Add a person').fill('Ben');
  await field(page, 'Add a person').press('Enter');
  await expect(person(page, 'Ben')).toBeVisible();
  await field(page, 'Add a person').press('Enter');

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

test('opens views at the top and restores context on returning or browsing history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await createGroup(page, 'Scroll navigation', 'Ana');

  // Enough people for the People tab to scroll.
  for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran', 'Gus', 'Hal', 'Ida', 'Jo', 'Kai', 'Lu', 'Mo']) await addMember(page, name);

  for (let index = 0; index < 12; index++) await addExpense(page, `Thing ${index}`, '70');

  const scroller = page.locator('#splitnext-page');
  const position = () => scroller.evaluate((node) => node.scrollTop);
  const atTop = async () => { await expect.poll(position).toBe(0); };

  await scroller.evaluate((node) => { node.scrollTop = 160; });
  await expect(heading(page, 'Scroll navigation')).toHaveCSS('font-size', '18px');
  await person(page, 'Gus').scrollIntoViewIfNeeded();
  const groupPosition = await position();

  await person(page, 'Gus').click();
  await atTop();
  await expect(heading(page, 'Gus')).toHaveCSS('font-size', '32px');
  await scroller.evaluate((node) => { node.scrollTop = 150; });
  await expect(heading(page, 'Gus')).toHaveCSS('font-size', '18px');
  await button(page, 'Back to Scroll navigation').click();
  await expect.poll(position).toBeCloseTo(groupPosition, 0);

  // A fresh opening starts at the top even if this person was scrolled before.
  await person(page, 'Gus').click();
  await atTop();
  // Fully collapse the header before testing restoration; 120px can leave
  // it partly expanded depending on the header's measured height.
  await scroller.evaluate((node) => { node.scrollTop = 160; });
  await expect(heading(page, 'Gus')).toHaveCSS('font-size', '18px');
  const personPosition = await position();

  await page.goBack();
  await expect(heading(page, 'Scroll navigation')).toBeVisible();
  await expect.poll(position).toBeCloseTo(groupPosition, 0);
  await page.goForward();
  await expect(heading(page, 'Gus')).toBeVisible();
  await expect.poll(position).toBeCloseTo(personPosition, 0);
  await button(page, 'Back to Scroll navigation').click();
  await expect.poll(position).toBeCloseTo(groupPosition, 0);

  // Invite people stays in the header however far the page scrolls; at the top it opens the link in place.
  await expect(button(page, 'Invite people')).toBeVisible();
  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await atTop();
  await button(page, 'Invite people').click();
  await expect(page.getByRole('region', { name: 'Invite people' })).toBeVisible();
  await expect.poll(position).toBe(0);
  await button(page, 'Invite people').click();
  await expect(page.getByRole('region', { name: 'Invite people' })).toHaveCount(0);
  await scroller.evaluate((node, top) => { node.scrollTop = top; }, groupPosition);
  await expect.poll(position).toBeCloseTo(groupPosition, 0);

  await bell(page).click();
  await atTop();
  await scroller.evaluate((node) => { node.scrollTop = 200; });
  await expect(heading(page, 'Activity')).toHaveCSS('font-size', '18px');
  await button(page, 'Back to Scroll navigation').click();
  await bell(page).click();
  await atTop();
  await button(page, 'Back to Scroll navigation').click();

  // Each new draft and each recorded expense opens with its amount in view.
  await button(page, 'Add expense').click();
  await atTop();
  await field(page, 'Amount').evaluate((input) => input.blur());
  await openSplit(page);
  await scroller.evaluate((node) => { node.scrollTop = 250; });
  await expect(field(page, 'Amount')).toHaveCSS('height', '36px');
  await button(page, 'Cancel').click();
  await button(page, 'Add expense').click();
  await atTop();
  await expect(field(page, 'Amount')).toHaveCSS('height', '60px');
  await button(page, 'Cancel').click();
  await showTab(page, 'Expenses');
  await button(page, 'Change Thing 7 · 70.00').click();
  await atTop();
  await openSplit(page);
  await scroller.evaluate((node) => { node.scrollTop = 250; });
  await expect(field(page, 'Amount')).toHaveCSS('height', '36px');
  await button(page, 'Cancel').click();
  await button(page, 'Change Thing 6 · 70.00').click();
  await atTop();
  await expect(field(page, 'Amount')).toHaveCSS('height', '60px');
  await field(page, 'Amount').fill('75');
  await button(page, 'Save').click();
  await expect(heading(page, 'Scroll navigation')).toBeVisible();
  await expect.poll(position).toBeGreaterThan(0);
  await expect(heading(page, 'Scroll navigation')).toHaveCSS('font-size', '18px');
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

  // Becoming someone else, even a name taken elsewhere, is leaving and rejoining as them.
  await button(visitor, 'Back to groups').click();
  await button(visitor, 'Leave Trip').click();
  await button(visitor, 'Leave').click();
  await button(visitor, 'Show 1 group you left').click();
  await button(visitor, 'Rejoin Trip').click();
  await visitor.getByRole('radio', { name: /^Ana/ }).click();
  await button(visitor, 'Rejoin as Ana').click();
  await expect(button(visitor, /^Ana \(you\), /)).toBeVisible();
  await person(visitor, 'Ana').click();
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
  await motionSettled(page);
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
  await motionSettled(page);
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
  await addMember(page, 'Ben');
  await button(page, 'Back to groups').click();
  await motionSettled(page);
  await button(page, 'Leave Lisbon').click();
  await expect(page.getByText('Leave Lisbon on this device? You can rejoin it later.', { exact: true })).toBeVisible();
  await button(page, 'Cancel').click();
  await expect(page.getByText(/^Leave Lisbon on this device/)).toHaveCount(0);
  await button(page, 'Leave Lisbon').click();
  await button(page, 'Leave').click();
  await button(page, 'Show 1 group you left').click();
  await button(page, 'Rejoin Lisbon').click();

  // Rejoining is how to change who you are: here, as Ben instead of Ana.
  await page.getByRole('radio', { name: /^Ben/ }).click();
  await button(page, 'Rejoin as Ben').click();
  await expect(field(page, 'Add a person')).toBeVisible();
  await expect(button(page, /^Ben \(you\), /)).toBeVisible();
  await expect(button(page, /^Ana, /)).toBeVisible();
});

test('keeps Settle up rows whole with very long names and amounts', async ({ page }, testInfo) => {
  const long = 'Wolfgang Amadeus Schwarzenegger-Müller';

  await page.setViewportSize({ width: 390, height: 844 });
  await createGroup(page, 'Long settle', 'Ana');
  await addMember(page, long);
  await addMember(page, 'Jaqy Gypsy');
  await addExpense(page, 'Castle', '299999.97', long);
  await person(page, long).click();
  await button(page, 'Settle up, 2 payments').click();
  const drawer = page.getByRole('region', { name: 'Settle up' });
  const records = drawer.getByRole('button', { name: /Record this payment$/ });

  await expect(records).toHaveCount(2);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const area = (await drawer.boundingBox())!;

    for (const record of await records.all()) {
      const box = (await record.boundingBox())!;

      // Record is whole and inside the drawer, and each name stays on one line.
      expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
      expect(await record.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }

    for (const name of await drawer.getByText(new RegExp(`^(→ )?${long}$`)).all()) {
      expect((await name.boundingBox())!.height).toBeLessThan(30);
    }

    await page.screenshot({ path: testInfo.outputPath(`settle-up-long-${width}.png`) });
  }
});

test('records planned and other repayments offline', async ({ page, context }) => {
  await createGroup(page, 'Repayments', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await addExpense(page, 'Dinner', '60');
  await page.setViewportSize({ width: 390, height: 844 });
  await goOffline(page, context);
  await addPayment(page, 'Benjamin Alexander', 'Ana', '10');
  await showTab(page, 'People');
  await person(page, 'Benjamin Alexander').click();
  await button(page, 'Settle up, 1 payment').click();
  await expect(button(page, 'Benjamin Alexander pays you 20.00. Record this payment')).toBeVisible();
  expect(await page.locator('#splitnext-page').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await button(page, 'Back to Benjamin Alexander').click();
  await button(page, 'Back to Repayments').click();

  await openPayment(page);
  await expect(heading(page, 'Earlier repayments')).toHaveCount(0);
  await expect(button(page, /^Change repayment:/)).toHaveCount(0);
  await button(page, 'Cancel').click();
  await addPayment(page, 'Benjamin Alexander', 'Ana', '5');
  await showTab(page, 'People');
  await person(page, 'Benjamin Alexander').click();
  await button(page, 'Settle up, 1 payment').click();
  await expect(button(page, 'Benjamin Alexander pays you 15.00. Record this payment')).toBeVisible();
  await page.reload();
  await showTab(page, 'Expenses');
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 10.00')).toBeVisible();
  await expect(button(page, 'Change repayment: Benjamin Alexander paid you back 5.00')).toBeVisible();
  await goOnline(page, context);
  await expect(page.getByText(/saved here/)).toHaveCount(0);
});

test('uses expense-style amount, member rows, and footer in the repayment editor', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Dropdown payments', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await addMember(page, 'Cy');
  await addExpense(page, 'Dinner', '60');
  await openPayment(page);
  const from = button(page, /^Paid by .*Change payer$/);
  const to = button(page, /^Paid to .*Change recipient$/);

  const choose = async (side: Locator, name: string) => {
    await side.click();
    await page.getByRole('radio', { name, exact: true }).click();
  };

  const amount = field(page, 'Amount');
  const record = button(page, 'Save');

  await expect(from).toBeVisible();
  await expect(to).toBeVisible();
  await choose(from, 'Benjamin Alexander');
  await choose(to, 'Ana (you)');
  await expect(button(page, 'Paid by Benjamin Alexander. Change payer')).toBeVisible();
  await expect(button(page, 'Paid to Ana (you). Change recipient')).toBeVisible();
  await from.click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(3);
  await from.click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' })).toHaveCount(0);
  await amount.fill('7.50');
  await choose(from, 'Cy');
  await expect(amount).toHaveValue('7.50');
  await choose(to, 'Cy');
  await expect(record).toBeDisabled();
  await choose(to, 'Benjamin Alexander');
  await expect(record).toBeEnabled();

  const fromBox = (await from.boundingBox())!;
  const toBox = (await to.boundingBox())!;
  const amountBox = (await amount.boundingBox())!;
  const recordBox = (await record.boundingBox())!;

  expect(amountBox.y + amountBox.height).toBeLessThan(fromBox.y);
  expect(fromBox.y + fromBox.height).toBeLessThanOrEqual(toBox.y);
  expect(fromBox.x).toBe(toBox.x);
  expect(toBox.y + toBox.height).toBeLessThan(recordBox.y);
  await expect(amount).toHaveCSS('font-size', '56px');
  await amount.fill('1234,5');
  await expect(amount).toHaveValue('1,234.50');
  await amount.fill('7.50');
  expect(await page.locator('#splitnext-page').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await record.click();
  await openPayment(page);
  await expect(button(page, /^Change repayment:/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('repayment-dropdowns-320.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('repayment-dropdowns-390.png') });
  await button(page, 'Cancel').click();
  await button(page, 'Change repayment: Cy paid Benjamin Alexander back 7.50').click();
  await expect(button(page, 'Paid by Cy. Change payer')).toBeVisible();
  await expect(button(page, 'Paid to Benjamin Alexander. Change recipient')).toBeVisible();
  await choose(from, 'Ana (you)');
  await button(page, 'Cancel').click();
  await button(page, 'Change repayment: Cy paid Benjamin Alexander back 7.50').click();
  await expect(button(page, 'Paid by Cy. Change payer')).toBeVisible();
  await choose(from, 'Ana (you)');
  await button(page, 'Save').click();
  await expect(button(page, 'Change repayment: You paid Benjamin Alexander back 7.50')).toBeVisible();
});

test('switches a new entry between expense and payment, keeping what each has', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createGroup(page, 'Tabs', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');
  await button(page, 'Add expense').click();
  const amount = field(page, 'Amount');
  const tabs = page.getByRole('radiogroup', { name: 'Entry type' });
  const tab = (name: string) => tabs.getByRole('radio', { name, exact: true });

  /** How far the sticky header reaches past the underline of a field in it: none. */
  const pastUnderline = (name: string) => field(page, name).evaluate((node) => {
    const content = document.getElementById('splitnext-page');
    let underline: Element | null = node;

    while (underline && getComputedStyle(underline).borderBottomWidth === '0px') underline = underline.parentElement;
    let header: Element | null = node;

    while (header && content && !header.parentElement?.contains(content)) header = header.parentElement;

    return underline && header ? Math.round(header.getBoundingClientRect().bottom - underline.getBoundingClientRect().bottom) : null;
  });

  await expect(tab('Expense')).toBeChecked();
  expect(await pastUnderline('Description')).toBe(0);
  await amount.fill('12.50');
  await field(page, 'Description').fill('Snacks');
  await button(page, /^Paid by .*Change payer$/).click();
  await page.getByRole('radio', { name: 'Ben', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('entry-switch-expense.png') });

  // A payment takes the amount and who paid; who was paid starts as you.
  // Switching cross-fades in place rather than dropping the sheet and raising a page.
  await motionSettled(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    const seen = document.documentElement.dataset;
    const until = performance.now() + 1000;

    const watch = () => {
      for (const animation of document.getAnimations()) {
        if (animation.effect instanceof KeyframeEffect) seen.keyframes = `${seen.keyframes ?? ''}${JSON.stringify(animation.effect.getKeyframes())}`;
      }

      if (performance.now() < until) requestAnimationFrame(watch);
    };

    seen.keyframes = '';
    watch();
  });
  await tab('Payment').click();
  await page.waitForTimeout(1000);
  const keyframes = await page.evaluate(() => document.documentElement.dataset.keyframes ?? '');

  expect(keyframes).toContain('opacity');
  expect(keyframes).not.toContain('translateY');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(tab('Payment')).toBeChecked();
  await expect(amount).toHaveValue('12.50');
  await expect(button(page, 'Paid by Ben. Change payer')).toBeVisible();
  await expect(button(page, 'Paid to Ana (you). Change recipient')).toBeVisible();
  expect(await pastUnderline('Amount')).toBe(0);
  await button(page, /^Paid to .*Change recipient$/).click();
  await page.getByRole('radio', { name: 'Cy', exact: true }).click();
  await amount.fill('20.25');
  await page.screenshot({ path: testInfo.outputPath('entry-switch-payment.png') });

  // Back on the expense, its description stays and the new amount carries over.
  await tab('Expense').click();
  await expect(field(page, 'Description')).toHaveValue('Snacks');
  await expect(amount).toHaveValue('20.25');
  await expect(button(page, 'Paid by Ben. Change payer')).toBeVisible();

  // The payment remembers who was paid.
  await tab('Payment').click();
  await expect(button(page, 'Paid to Cy. Change recipient')).toBeVisible();
  await button(page, 'Save').click();
  await button(page, 'Change repayment: Ben paid Cy back 20.25').click();
  await expect(tabs).toHaveCount(0);
  await button(page, 'Cancel').click();

  // A new expense starts afresh, and so does the payment it switches to.
  await button(page, 'Add expense').click();
  await expect(field(page, 'Description')).toHaveValue('');
  await tab('Payment').click();
  await expect(button(page, 'Paid by Ana (you). Change payer')).toBeVisible();
  await expect(button(page, 'Paid to Ben. Change recipient')).toBeVisible();
  await button(page, 'Cancel').click();
  await expect(button(page, 'Add expense')).toBeVisible();
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
  await button(page, 'Save').click();
  await expect(button(page, 'Change repayment: Ben paid you back 15.00')).toBeVisible();
  await showTab(page, 'People');
  await expect(button(page, 'Ben, +3.00. Show details')).toBeVisible();
  await showTab(page, 'Expenses');
  await button(page, 'Change repayment: Ben paid you back 15.00').click();
  const remove = button(page, 'Delete');
  const save = button(page, 'Save');

  await expect(remove).toBeVisible();
  const removeBox = (await remove.boundingBox())!;
  const saveBox = (await save.boundingBox())!;

  await expect(remove).toHaveText('Delete');
  await expect(button(page, /^Remove repayment/)).toHaveCount(0);
  // Delete stays above the amount; Save uses the same footer as expenses.
  expect(removeBox.y + removeBox.height).toBeLessThan((await field(page, 'Amount').boundingBox())!.y);
  expect(saveBox.y).toBeGreaterThan((await field(page, 'Amount').boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath('repayment-header.png') });
  await remove.click();
  await expect(heading(page, 'Repayment changes')).toBeVisible();
  await expect(button(page, /^Change repayment:/)).toHaveCount(0);
  await showTab(page, 'People');
  await expect(button(page, 'Ben, −12.00. Show details')).toBeVisible();
});

test('puts the Activity scroll divider under the pinned day heading', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.route('**/groups/*/activity', async (route) => {
    const response = await route.fetch();
    // SAFETY: This is the local Worker's schema-validated Activity response.
    const body = await response.json() as { events: { occurred_at: string }[] };
    const today = new Date();
    const yesterday = new Date();

    today.setHours(12, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    for (const [index, event] of body.events.entries()) {
      event.occurred_at = (index < body.events.length - 6 ? yesterday : today).toISOString();
    }

    await route.fulfill({ response, json: body });
  });
  await createGroup(page, 'Days', 'Ana');

  for (const name of ['Ben', 'Cy', 'Dee', 'Eli', 'Fran', 'Gus', 'Hal', 'Inez', 'Jo', 'Kai', 'Lee', 'Mo']) await addMember(page, name);

  await bell(page).click();
  const title = heading(page, 'Activity');
  const header = title.locator('..').locator('..');
  const today = heading(page, 'Today').locator('..').locator('..');
  const yesterday = heading(page, 'Yesterday').locator('..').locator('..');
  const scroller = page.locator('#splitnext-page');

  await expect(today).toBeVisible();
  await expect(yesterday).toBeAttached();
  await expect(today).toHaveCSS('box-shadow', 'none');
  // Travel beyond full header collapse even after its released height adjusts scrollTop.
  await scroller.evaluate((node) => { node.scrollTop = 220; });
  await expect(title).toHaveCSS('font-size', '18px');
  await expect(today).not.toHaveCSS('box-shadow', 'none');
  await expect(header).toHaveCSS('box-shadow', 'none');
  await expect(yesterday).toHaveCSS('box-shadow', 'none');
  await page.screenshot({ path: testInfo.outputPath('activity-today-divider.png') });

  await yesterday.evaluate((node) => {
    const scroller = document.getElementById('splitnext-page')!;

    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 24;
  });
  await expect(yesterday).not.toHaveCSS('box-shadow', 'none');
  await expect(today).toHaveCSS('box-shadow', 'none');
  await expect(header).toHaveCSS('box-shadow', 'none');
  await page.screenshot({ path: testInfo.outputPath('activity-yesterday-divider.png') });
  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await expect(title).toHaveCSS('font-size', '32px');
  await expect(today).toHaveCSS('box-shadow', 'none');
});

test('reads Activity offline and restores a removed expense', async ({ page, context }) => {
  await createGroup(page, 'History', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Dinner', '24');
  await showTab(page, 'Expenses');
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
  await showTab(page, 'Expenses');
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
  // Undo is the ordinary opposite action, entered in Activity as itself.
  await button(page, 'Undo: You recorded a repayment').click();
  await expect(page.getByText('You removed a repayment', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo: You recorded a repayment', disabled: false })).toHaveCount(0);
  await expect(page.getByText(/undid/)).toHaveCount(0);

  // Reversing that is restoring the repayment.
  await button(page, 'Restore repayment').click();
  await expect(page.getByText('You restored a repayment', { exact: true })).toBeVisible();
  await button(page, 'Back to Money undo').click();
  await showTab(page, 'Expenses');
  await expect(button(page, 'Change repayment: Ben paid you back 12.00')).toBeVisible();
});

test('undoes member changes in Activity as well as a group rename', async ({ page }) => {
  await createGroup(page, 'Original name', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');
  await button(page, 'Rename group').click();
  await field(page, 'Group name').fill('New name');
  await field(page, 'Group name').press('Enter');
  await expect(heading(page, 'New name')).toBeVisible();
  await person(page, 'Cy').click();
  await button(page, 'Rename Cy').click();
  await field(page, 'Name').fill('Cynthia');
  await field(page, 'Name').press('Enter');
  await expect(heading(page, 'Cynthia')).toBeVisible();
  await button(page, 'Back to New name').click();

  // Renaming the group, renaming a member, and adding one each undo from their entry.
  await bell(page).click();
  await button(page, 'Undo: You renamed the group').click();
  await button(page, 'Undo: You renamed Cy').click();
  await button(page, 'Undo: You added Ben').click();
  await expect(page.getByText('You renamed the group', { exact: true })).toHaveCount(2);
  await expect(page.getByText('You renamed Cynthia', { exact: true })).toBeVisible();
  await expect(page.getByText('You removed Ben', { exact: true })).toBeVisible();
  await expect(page.getByText(/undid/)).toHaveCount(0);
  await expect(button(page, 'Undo: You created the group')).toHaveCount(0);
  await button(page, 'Back to Original name').click();
  await expect(heading(page, 'Original name')).toBeVisible();
  await expect(person(page, 'Ben')).toHaveCount(0);
  await expect(person(page, 'Cy')).toBeVisible();
});

test('counts balance changes from others on the bell and tags every new Activity entry', async ({ page, browser }) => {
  await createGroup(page, 'Shared', 'Ana');
  await addMember(page, 'Ben');
  // Establish the seen baseline before another installation can join. The empty
  // bell alone also describes the period before the first Activity read finishes.
  await bell(page).click();
  await expect(page.getByText('You created the group', { exact: true })).toBeVisible();
  await button(page, 'Back to Shared').click();
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

  await showTab(page, 'Expenses');
  await expect(button(page, 'Change Fresh dinner · 20.00')).toBeVisible();
  // Joining is new Activity, but only the expense moves balances and counts on the bell.
  await expect(bell(page)).toHaveAccessibleName('Activity: 1 new update');
  await expect(page.getByTestId('activity-count')).toHaveText('1');
  const bellBox = (await bell(page).boundingBox())!;

  await page.screenshot({ path: test.info().outputPath('activity-bell.png'), clip: { x: bellBox.x + bellBox.width - 390, y: 0, width: 390, height: 140 } });
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(bell(visitor)).toHaveAccessibleName('Activity, no new updates');

  // Visiting Activity sees it all: what was new keeps its tag for the visit,
  // and is no longer new on returning.
  await bell(page).click();
  await expect(page.getByText('new', { exact: true })).toHaveCount(2);
  await expect(button(page, 'Mark all seen')).toHaveCount(0);
  await button(page, 'Back to Shared').click();
  await expect(bell(page)).toHaveAccessibleName('Activity, no new updates');
  await bell(page).click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await expect(page.getByText('new', { exact: true })).toHaveCount(0);
  await button(page, 'Back to Shared').click();
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
    const save = button(page, 'Save');

    await expect(save).toBeInViewport({ ratio: 1 });
    const savePosition = (await save.boundingBox())!;

    expect(savePosition.y + savePosition.height).toBeGreaterThan(height - 60);

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

    // Sample settling after the final wheel input; on slower machines that
    // input can arrive after the old fixed 900ms cutoff.
    const settled = await page.evaluate(() => new Promise<{ top: number; header: number }[]>((resolve) => {
      const scroller = document.getElementById('splitnext-page')!;
      const start = performance.now();
      const samples: { top: number; header: number }[] = [];

      (function frame() {
        const elapsed = performance.now() - start;

        if (elapsed > 200) samples.push({ top: scroller.scrollTop, header: scroller.getBoundingClientRect().top });

        if (elapsed < 600) requestAnimationFrame(frame);
        else resolve(samples);
      })();
    }));

    const headers = settled.map((sample) => sample.header);
    const positions = settled.map((sample) => sample.top);
    const detail = JSON.stringify({ scenario, reversal: Math.max(...reversals), settled });

    expect(Math.max(...reversals), detail).toBeLessThanOrEqual(1);
    expect(Math.max(...headers) - Math.min(...headers), detail).toBeLessThanOrEqual(1);
    expect(Math.max(...positions) - Math.min(...positions), detail).toBeLessThanOrEqual(1);
    await expect(save).toBeInViewport({ ratio: 1 });
    await motionSettled(page);
  expect(await save.boundingBox()).toEqual(savePosition);

    for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -25);

    await expect(amount).toHaveCSS('height', '60px');
  }
});

test('shrinks the large title as the page scrolls and grows it back at the top', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await createGroup(page, 'Long trip', 'Ana');

  for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran']) await addMember(page, name);

  for (const name of ['Cabin', 'Train', 'Groceries', 'Boat', 'Lunch', 'Taxi', 'Dinner', 'Coffee', 'Tickets', 'Hotel', 'Breakfast', 'Snacks']) await addExpense(page, name, '60');

  const scroller = page.locator('#splitnext-page');
  const title = heading(page, 'Long trip');

  await showTab(page, 'Expenses');

  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await expect(title).toHaveCSS('font-size', '32px');
  await scroller.evaluate((node) => { node.scrollTop = 200; });
  await expect(title).toHaveCSS('font-size', '18px');
  await expect(button(page, 'Rename group')).toHaveCount(0);
  await expect(button(page, 'Add expense')).toBeInViewport();

  // The page is the only scroll area.
  const scrollAreas = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((node) =>
    ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight ? [node.id || node.tagName] : []));

  expect(scrollAreas).toEqual(['splitnext-page']);
  await button(page, 'Scroll to top').click();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(title).toHaveCSS('font-size', '32px');
  await expect(button(page, 'Rename group')).toBeVisible();
});

test('morphs between screens and leaves nothing behind', async ({ page }) => {
  await createGroup(page, 'Morphing', 'Ana');
  await button(page, 'Back to groups').click();
  await motionSettled(page);
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

test('keeps a scrolled group still beneath the opening expense sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await createGroup(page, 'Still underneath', 'Ana');

  for (let index = 0; index < 10; index++) await addExpense(page, `Item ${index}`, '20');

  const scroller = page.locator('#splitnext-page');

  await showTab(page, 'Expenses');
  await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(heading(page, 'Still underneath')).toHaveCSS('font-size', '18px');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  for (const delta of [0, -60]) {
    await scroller.evaluate((node, movement) => { node.scrollTop += movement; }, delta);
    const before = await scroller.evaluate((node) => ({ top: node.getBoundingClientRect().top, scroll: node.scrollTop }));

    const watching = page.evaluate(() => new Promise<{ samples: { top: number; scroll: number; title: string; amount: string }[]; screenScrolls: number[] }>((resolve) => {
      const start = performance.now();
      const samples: { top: number; scroll: number; title: string; amount: string }[] = [];
      const screenScrolls: number[] = [];

      const onScroll = (event: Event) => {
        const node = event.target;
        const page = document.getElementById('splitnext-page');

        // Observe before ScreenMorph resets its scroll: a frame sample misses
        // the brief pan caused by revealing a focused field still sliding in.
        if (node instanceof HTMLElement && page && node !== page && node.contains(page) && node.scrollTop > 0) screenScrolls.push(node.scrollTop);
      };

      document.addEventListener('scroll', onScroll, true);

      (function frame() {
        const copied = document.querySelector('[data-copied-page]');
        const title = document.querySelector('[aria-hidden] [data-morph^="gname-"]');
        const amount = document.querySelector('#splitnext-page')?.parentElement?.parentElement?.querySelector('input[aria-label="Amount"]');

        if (copied && title && amount) samples.push({ top: copied.getBoundingClientRect().top, scroll: copied.scrollTop, title: getComputedStyle(title).fontSize, amount: getComputedStyle(amount).fontSize });

        if (performance.now() - start < 700) requestAnimationFrame(frame);
        else {
          document.removeEventListener('scroll', onScroll, true);
          resolve({ samples, screenScrolls });
        }
      })();
    }));

    await button(page, 'Add expense').click();
    const { samples, screenScrolls } = await watching;

    expect(samples.length).toBeGreaterThan(5);
    expect(screenScrolls).toEqual([]);
    expect(samples.filter((sample) => Math.abs(sample.top - before.top) > 1 || Math.abs(sample.scroll - before.scroll) > 1 || sample.title !== '18px' || sample.amount !== '56px')).toEqual([]);
    await button(page, 'Cancel').click();
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(before.scroll);
    await expect(page.locator('[data-copied-page]')).toHaveCount(0);
  }
});

test('keeps a focused split amount visible when the keyboard reduces the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await createGroup(page, 'Visible split', 'Ana');

  for (const name of ['Ben', 'Cy', 'Dana', 'Eli', 'Fran', 'Gus']) await addMember(page, name);

  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('70');
  await openSplit(page);
  await button(page, /^Amount for Gus:/).click();
  const amount = field(page, 'Amount for Gus');

  await expect(amount).toBeFocused();
  await page.setViewportSize({ width: 390, height: 400 });
  await expect.poll(async () => {
    const input = (await amount.boundingBox())!;
    const area = (await page.locator('#splitnext-page').boundingBox())!;

    return input.y >= area.y - 1 && input.y + input.height <= area.y + area.height + 1;
  }).toBe(true);
  await expect(amount).toBeFocused();
  await expect(button(page, 'Save')).toBeInViewport({ ratio: 1 });

  // A phone keyboard can resize/pan only visualViewport, leaving the layout
  // viewport unchanged. Exercise the hook's actual keyboard event path too.
  await page.setViewportSize({ width: 390, height: 650 });
  await page.evaluate(() => {
    const viewport = window.visualViewport!;

    Object.defineProperty(viewport, 'height', { configurable: true, value: 320 });
    Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 80 });
    viewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => {
    const input = (await amount.boundingBox())!;
    const area = (await page.locator('#splitnext-page').boundingBox())!;

    return input.y >= Math.max(area.y, 80) - 1 && input.y + input.height <= Math.min(area.y + area.height, 400) + 1;
  }).toBe(true);
  await expect(amount).toBeFocused();
});

test('does not pan the screen when switching expense and payment editors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await createGroup(page, 'Still editors', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  for (const type of ['Payment', 'Expense']) {
    const watching = page.evaluate(() => new Promise<{ x: number; y: number }[]>((resolve) => {
      const pans: { x: number; y: number }[] = [];

      const record = (event: Event) => {
        const node = event.target;
        const page = document.getElementById('splitnext-page');

        if (node instanceof HTMLElement && page && node !== page && node.contains(page) && (node.scrollTop || node.scrollLeft)) pans.push({ x: node.scrollLeft, y: node.scrollTop });
      };

      document.addEventListener('scroll', record, true);
      setTimeout(() => {
        document.removeEventListener('scroll', record, true);
        resolve(pans);
      }, 800);
    }));

    await page.getByRole('radiogroup', { name: 'Entry type' }).getByRole('radio', { name: type, exact: true }).click();
    expect(await watching, type).toEqual([]);
    await expect(field(page, 'Amount')).toBeInViewport({ ratio: 1 });
  }
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
    ['expense form', async () => { await button(page, /^Back to /).click(); await showTab(page, 'Expenses'); await button(page, /^Change Groceries jqyp/).click(); }],
    ['groups list', async () => { await button(page, 'Cancel').click(); await button(page, 'Back to groups').click(); }],
    ['new group', () => button(page, 'New group').click()],
  ];

  for (const [screen, open] of screens) {
    await open();
    await motionSettled(page);
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
        frames.push({ ellipsis: (style.textOverflow === 'ellipsis' || (style.webkitLineClamp !== '' && style.webkitLineClamp !== 'none')) && ['hidden', 'clip'].includes(style.overflow), width: node.getBoundingClientRect().width });
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

test('lands flying names where they end up when leaving a scrolled screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await createGroup(page, 'Scrolled', 'Ana');

  for (const name of ['Ben', 'Cy', 'Dana', 'Eli']) await addMember(page, name);

  for (let index = 0; index < 12; index++) await addExpense(page, `Thing ${index}`, String(10 + index));

  const scroller = page.locator('#splitnext-page');

  type Spot = { y: number; height: number };

  // The last frame of Ben's name in flight, and where the real name then sits.
  async function flight(go: () => Promise<void>): Promise<{ last: Spot | undefined; landed: Spot }> {
    const watching = page.evaluate(() => new Promise<Spot[]>((resolve) => {
      const start = performance.now();
      const spots: Spot[] = [];

      (function frame() {
        for (const node of document.querySelectorAll('[aria-hidden] *')) {
          if (node.childElementCount || node.textContent !== 'Ben' || Number(getComputedStyle(node).opacity) < 0.9) continue;
          const box = node.getBoundingClientRect();

          spots.push({ y: box.y, height: box.height });
        }

        if (performance.now() - start < 900) requestAnimationFrame(frame);
        else resolve(spots);
      })();
    }));

    await go();
    const spots = await watching;
    const landed = (await page.getByText('Ben', { exact: true }).boundingBox())!;

    return { last: spots.at(-1), landed: { y: landed.y, height: landed.height } };
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // From the group screen scrolled to its compact header, Ben's page opens at full size.
  await scroller.evaluate((node) => { node.scrollTop = 400; });
  await page.waitForTimeout(600);
  const opening = await flight(() => person(page, 'Ben').click());

  expect(Math.abs(opening.last!.y - opening.landed.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(opening.last!.height - opening.landed.height)).toBeLessThanOrEqual(1);

  // From Ben's page scrolled to its compact header, back to the group at its top.
  await button(page, 'Back to Scrolled').click();
  await page.waitForTimeout(800);
  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await page.waitForTimeout(600);
  await person(page, 'Ben').click();
  await page.waitForTimeout(800);
  await scroller.evaluate((node) => { node.scrollTop = 400; });
  await page.waitForTimeout(600);
  const returning = await flight(() => button(page, 'Back to Scrolled').click());

  expect(Math.abs(returning.last!.y - returning.landed.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(returning.last!.height - returning.landed.height)).toBeLessThanOrEqual(1);
});

test('closes each dropdown on a tap outside it, and still lets that tap act', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Outside', 'Ana');
  await addMember(page, 'Ben');
  const elsewhere = () => page.mouse.click(200, 500);

  // Who paid: open, tap away, gone; its own button still toggles it.
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('10');
  await page.getByRole('button', { name: /^Paid by / }).click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(2);
  await field(page, 'Description').click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(0);
  await expect(field(page, 'Description')).toBeFocused();
  await page.getByRole('button', { name: /^Paid by / }).click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(2);
  await page.getByRole('button', { name: /^Paid by / }).click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(0);
  await button(page, 'Cancel').click();

  // The invite link: a tap away closes it; a tap on Activity opens Activity, and Back returns to the group.
  await button(page, 'Invite people').click();
  await expect(page.getByRole('region', { name: 'Invite people' })).toBeVisible();
  await elsewhere();
  await expect(page.getByRole('region', { name: 'Invite people' })).toHaveCount(0);
  await button(page, 'Invite people').click();
  await expect(page.getByRole('region', { name: 'Invite people' })).toBeVisible();
  await bell(page).click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await page.waitForTimeout(200);
  await expect(heading(page, 'Activity')).toBeVisible();
  await button(page, 'Back to Outside').click();
  await expect(heading(page, 'Outside')).toBeVisible();

  // Joining with a link, and leaving a group, on the groups list.
  await button(page, 'Back to groups').click();
  await motionSettled(page);
  await button(page, 'Join with an invite link').click();
  await expect(field(page, 'Invite link')).toBeVisible();
  await elsewhere();
  await expect(field(page, 'Invite link')).toHaveCount(0);
  await button(page, 'Leave Outside').click();
  await expect(page.getByText(/^Leave Outside on this device/)).toBeVisible();
  await elsewhere();
  await expect(page.getByText(/^Leave Outside on this device/)).toHaveCount(0);
});

test('closes panels in place without the content returning at the end', async ({ page }) => {
  await createGroup(page, 'Panels', 'Ana');
  await addMember(page, 'Ben');
  await button(page, 'Add expense').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const payer = page.getByRole('button', { name: /^Paid by / });

  await payer.click();
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(2);
  await page.waitForTimeout(500);

  // Every frame of closing, until well after the movement ends.
  const watching = page.evaluate(() => new Promise<{ height: number; content: number }[]>((resolve) => {
    let panel = document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Paid by"]');

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
  await expect(page.getByRole('radiogroup', { name: 'Paid by' }).getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: /^Ben/ })).toBeVisible();
});


test('floats standard field labels without moving the textboxes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app');
  await button(page, /^(New group|Create a group)$/).click();
  const groupName = field(page, 'Group name');
  const yourName = field(page, 'Your name in this group');
  const label = page.getByText('Your name in this group', { exact: true });

  await expect(groupName).toBeFocused();
  await expect(label).toHaveCSS('font-size', '17px');
  await motionSettled(page);
  const before = (await yourName.boundingBox())!;
  const labelBefore = (await label.boundingBox())!;

  await groupName.fill('Lisbon trip');
  await groupName.press('Enter');
  await expect(yourName).toBeFocused();
  await expect(label).toHaveCSS('font-size', '12px');
  expect((await label.boundingBox())!.y).toBeLessThan(labelBefore.y);
  expect((await yourName.boundingBox())!.y).toBe(before.y);
  await yourName.fill('Ana');
  await yourName.press('Tab');
  await expect(label).toHaveCSS('font-size', '12px');
  await page.screenshot({ path: testInfo.outputPath('standard-fields.png') });
  await yourName.fill('');
  await yourName.press('Tab');
  await expect(label).toHaveCSS('font-size', '17px');
  expect((await yourName.boundingBox())!.y).toBe(before.y);
  await label.click();
  await expect(yourName).toBeFocused();
  await yourName.fill('Ana');
  await button(page, 'Create group').click();
  await expect(heading(page, 'Lisbon trip')).toBeVisible();
});


test('keeps member name line breaks stable while returning from details', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const name = 'Benjamin Alex';

  await createGroup(page, 'Stable names', 'Ana');
  await addMember(page, name);

  const measure = (node: Element) => {
    const range = document.createRange();

    range.selectNodeContents(node);

    return { font: getComputedStyle(node).fontSize, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
  };

  const row = await page.locator('[data-morph^="pname-"]').filter({ hasText: name }).evaluate(measure);

  await person(page, name).click();
  const title = await heading(page, name).evaluate(measure);

  expect(row.lines).toBeGreaterThan(0);
  expect(title.lines).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const watching = page.evaluate((value) => new Promise<{ font: string; lines: number; arriving: boolean }[]>((resolve) => {
    const start = performance.now();
    const samples: { font: string; lines: number; arriving: boolean }[] = [];

    (function frame() {
      for (const node of document.querySelectorAll<HTMLElement>('[aria-hidden] *')) {
        const style = getComputedStyle(node);

        if (node.childElementCount || node.textContent !== value || style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
        const range = document.createRange();

        range.selectNodeContents(node);
        samples.push({ font: style.fontSize, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, arriving: node.hasAttribute('data-morph-arriving') });
      }

      if (performance.now() - start < 800) requestAnimationFrame(frame);
      else resolve(samples);
    })();
  }), name);

  await button(page, 'Back to Stable names').click();
  const samples = await watching;

  expect(samples.filter((sample) => sample.arriving).length).toBeGreaterThan(5);
  expect(samples.filter((sample) => sample.font === title.font).length).toBeGreaterThan(0);
  expect(samples.filter((sample) => sample.lines !== (sample.font === title.font ? title.lines : row.lines))).toEqual([]);
  await expect(person(page, name)).toBeVisible();
});

test('moves the expense amount straight from its row to the editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await createGroup(page, 'Straight amounts', 'Ana');
  await addExpense(page, 'Dinner', '1234.56');
  await showTab(page, 'Expenses');
  const source = (await page.locator('[data-morph^="eamt-"]').boundingBox())!;

  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const watching = page.evaluate(() => new Promise<{ x: number; y: number }[]>((resolve) => {
    const start = performance.now();
    const samples: { x: number; y: number }[] = [];

    (function frame() {
      for (const input of document.querySelectorAll<HTMLElement>('[data-morph-arriving] input')) {
        if (Number(getComputedStyle(input.parentElement!).opacity) < 0.05) continue;
        const box = input.getBoundingClientRect();

        samples.push({ x: box.right, y: box.top + box.height / 2 });
      }

      if (performance.now() - start < 800) requestAnimationFrame(frame);
      else resolve(samples);
    })();
  }));

  await button(page, /^Change Dinner/).click();
  const samples = await watching;
  const target = (await field(page, 'Amount').boundingBox())!;
  const from = { x: source.x + source.width, y: source.y + source.height / 2 };
  const dx = target.x + target.width - from.x;
  const dy = target.y + target.height / 2 - from.y;

  expect(samples.length).toBeGreaterThan(5);
  const deviations = samples.map((point) => Math.abs(dx * (point.y - from.y) - dy * (point.x - from.x)) / Math.hypot(dx, dy));

  expect(Math.max(...deviations)).toBeLessThanOrEqual(1);
});

test('keeps member amounts on one line throughout the details transition', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Unbroken amounts', 'Ana');
  await addMember(page, 'Benjamin Alexander');
  await addExpense(page, 'Dinner', '123456.78');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const amountText = await page.locator('[data-morph^="pamt-"]').first().textContent();

  const samples = page.evaluate((value) => new Promise<{ lines: number; nowrap: boolean; ellipsis: boolean }[]>((resolve) => {
    const start = performance.now();
    const result: { lines: number; nowrap: boolean; ellipsis: boolean }[] = [];

    (function frame() {
      document.querySelectorAll<HTMLElement>('div').forEach((node) => {
        if (node.children.length || node.textContent !== value || getComputedStyle(node).visibility === 'hidden') return;
        const range = document.createRange();

        range.selectNodeContents(node);
        result.push({ lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size, nowrap: ['nowrap', 'pre'].includes(getComputedStyle(node).whiteSpace), ellipsis: Boolean(node.closest('[aria-hidden]')) && getComputedStyle(node).textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth + 1 });
      });

      if (performance.now() - start < 700) requestAnimationFrame(frame);
      else resolve(result);
    })();
  }), amountText);

  await person(page, 'Benjamin Alexander').click();
  await expect(heading(page, 'Benjamin Alexander')).toBeVisible();
  const measured = await samples;

  expect(measured.length).toBeGreaterThan(5);
  expect(measured.filter((sample) => !sample.nowrap || sample.lines !== 1 || sample.ellipsis)).toEqual([]);
});


test('uses a floating label for the expense description and saves with Enter', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createGroup(page, 'Standard descriptions', 'Ana');
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill('20');
  const description = field(page, 'Description');
  const label = page.getByText('Description', { exact: true });

  await expect(label).toHaveCSS('font-size', '17px');
  await motionSettled(page);
  const before = (await description.boundingBox())!;

  await description.click();
  await expect(label).toHaveCSS('font-size', '12px');
  expect((await description.boundingBox())!.y).toBe(before.y);
  const title = 'Dinner and groceries for the whole weekend with everyone staying in the mountain cabin';

  await description.fill(title);
  await field(page, 'Amount').click();
  await expect(label).toHaveCSS('font-size', '12px');
  await expect(description).toHaveValue(title);
  await page.screenshot({ path: testInfo.outputPath('standard-description.png') });
  await description.click();
  await description.press('Enter');
  await expect(button(page, new RegExp('^Change Dinner and groceries'))).toBeVisible();
  await button(page, new RegExp('^Change Dinner and groceries')).click();
  await expect(description).toHaveValue(title);
  await expect(label).toHaveCSS('font-size', '12px');
});


test('collapses a two-line group title without a sudden header jump', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await createGroup(page, 'A long summer holiday', 'Ana');

  for (const title of ['Train', 'Lunch', 'Dinner', 'Boat', 'Hotel', 'Taxi', 'Coffee', 'Tickets', 'Breakfast', 'Snacks', 'Groceries', 'Cabin']) await addExpense(page, title, '20');
  const scroller = page.locator('#splitnext-page');
  const title = heading(page, 'A long summer holiday');

  await showTab(page, 'Expenses');

  await scroller.evaluate((node) => { node.scrollTop = 0; });
  await expect(title).toHaveCSS('font-size', '32px');
  expect((await title.boundingBox())!.height).toBeGreaterThan(60);

  const heights = await scroller.evaluate(async (node) => {
    const values: number[] = [];

    for (let top = 0; top <= 200; top += 2) {
      node.scrollTop = top;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      values.push(node.getBoundingClientRect().top);
    }

    return values;
  });

  expect(Math.max(...heights.slice(1).map((height, index) => Math.abs(height - heights[index]!)))).toBeLessThan(8);
  await expect(title).toHaveCSS('font-size', '18px');
  expect((await title.boundingBox())!.height).toBeLessThan(30);
  await button(page, 'Scroll to top').click();
  await expect(title).toHaveCSS('font-size', '32px');
});


test('opens canonical Activity records and returns, keeping unavailable actions hidden', async ({ page }) => {
  await createGroup(page, 'Activity links', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Dinner', '24');
  await person(page, 'Ben').click();
  await button(page, 'Settle up, 1 payment').click();
  await button(page, 'Ben pays you 12.00. Record this payment').click();
  await button(page, 'Back to Ben').click();
  await button(page, 'Back to Activity links').click();
  await addMember(page, 'Cy');
  await bell(page).click();
  await button(page, 'Undo: You added Cy').click();
  await expect(button(page, 'Open member: You added Cy')).toHaveCount(0);
  await expect(button(page, 'Open member: You removed Cy')).toHaveCount(0);
  await expect(button(page, 'Restore member')).toBeVisible();
  await expect(button(page, 'Undo: You added Ben')).toHaveCount(0);
  await expect(page.getByText(/cannot be removed by undoing/)).toHaveCount(0);
  await button(page, 'Open member: You added Ben').click();
  await expect(heading(page, 'Ben')).toBeVisible();
  await button(page, 'Back to Activity').click();
  await button(page, 'Open repayment: You recorded a repayment').click();
  await button(page, 'Cancel').click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await button(page, 'Open expense: You added Dinner').click();
  await button(page, 'Cancel').click();
  await expect(heading(page, 'Activity')).toBeVisible();
  await motionSettled(page);
  const title = page.getByText('Dinner', { exact: true });
  await expect(title).toHaveCSS('font-weight', '600');
  await button(page, 'Undo: You added Dinner').click();
  await expect(button(page, 'Open expense: You added Dinner')).toHaveCount(0);
  await expect(button(page, 'Open expense: You removed Dinner')).toHaveCount(0);
  await expect(button(page, 'Restore expense')).toBeVisible();
  await button(page, 'Undo: You recorded a repayment').click();
  await expect(button(page, 'Open repayment: You recorded a repayment')).toHaveCount(0);
  await expect(button(page, 'Open repayment: You removed a repayment')).toHaveCount(0);
  await expect(button(page, 'Restore repayment')).toBeVisible();
});


test('searches expenses and repayments with accent-insensitive words and personal filters', async ({ page }) => {
  await createGroup(page, 'Searchable trip', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Caf\u00e9 breakfast', '12');
  await addExpense(page, 'Caf\u00e9 lunch', '6', 'Ben');
  await addExpense(page, 'Taxi', '10');
  await addPayment(page, 'Ben', 'Ana', '2');
  await showTab(page, 'Expenses');
  await button(page, 'Search expenses').click();
  const search = field(page, 'Search expenses');
  const results = page.getByRole('list', { name: 'Expenses', exact: true });

  await search.fill('CAFE');
  await expect(results.getByRole('button', { name: /^Change / })).toHaveCount(2);
  await expect(results.getByText('2 results', { exact: true })).toBeVisible();
  await expect(results.getByText('+3.00', { exact: true })).toBeVisible();
  await search.fill('breakfast cafe');
  await expect(results.getByRole('button', { name: /^Change / })).toHaveCount(1);
  await search.fill('not recorded');
  await expect(page.getByText('Nothing matches', { exact: true })).toBeVisible();
  await search.fill('');
  await button(page, 'Paid by you').click();
  await expect(results.getByRole('button', { name: /^Change / })).toHaveCount(2);
  await expect(results.getByText('+11.00', { exact: true })).toBeVisible();
  await button(page, 'Paid by you').click();
  await button(page, 'Involves you').click();
  await expect(results.getByRole('button', { name: /^Change / })).toHaveCount(4);
  // The result total includes the repayment's effect as well as the expenses.
  await expect(results.getByText('4 results', { exact: true }).locator('..').getByText('+6.00', { exact: true })).toBeVisible();
  await button(page, 'Cancel').click();
  await expect(search).toHaveCount(0);
  await button(page, 'Search expenses').click();
  await expect(search).toHaveValue('');
  await expect(results.getByRole('button', { name: /^Change / })).toHaveCount(4);
});

test('keeps tabular balance typography while flying into person details', async ({ page }) => {
  await createGroup(page, 'Flying balance', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Dinner', '60');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const watching = page.evaluate(() => new Promise<string[]>((resolve) => {
    const fonts: string[] = [];
    const start = performance.now();

    (function frame() {
      for (const node of document.querySelectorAll<HTMLElement>('[data-morph-arriving]')) {
        if (node.textContent === '30.00') fonts.push(getComputedStyle(node).fontSize);
      }

      if (performance.now() - start < 800) requestAnimationFrame(frame);
      else resolve(fonts);
    })();
  }));

  await person(page, 'Ben').click();
  const fonts = await watching;

  expect(fonts.length).toBeGreaterThan(0);
  expect(new Set(fonts)).toEqual(new Set(['36px']));
});

test('keeps screen motion within its shared duration and avoids layout animation', async ({ page }) => {
  await createGroup(page, 'Motion budget', 'Ana');
  await addMember(page, 'Ben');
  await addExpense(page, 'Dinner', '60');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const measure = async (open: () => Promise<void>) => {
    const watching = page.evaluate(() => new Promise<{ duration: number; layout: boolean }[]>((resolve) => {
      const samples: { duration: number; layout: boolean }[] = [];
      const start = performance.now();

      (function frame() {
        for (const animation of document.getAnimations()) {
          const effect = animation.effect;

          if (!(effect instanceof KeyframeEffect)) continue;
          samples.push({ duration: Number(effect.getTiming().duration), layout: effect.getKeyframes().some((key) => 'width' in key || 'height' in key) });
        }

        if (performance.now() - start < 800) requestAnimationFrame(frame);
        else resolve(samples);
      })();
    }));

    await open();
    const samples = await watching;

    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((sample) => sample.duration))).toBeLessThanOrEqual(300);
    expect(samples.some((sample) => sample.layout)).toBe(false);
  };

  await measure(() => person(page, 'Ben').click());
  await button(page, 'Back to Motion budget').click();
  await expect(page.locator('[data-copied-page]')).toHaveCount(0);
  await measure(() => button(page, 'Add expense').click());
});

test('keeps the empty preferred-member summary quiet with a long name', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const name = 'Anastasia Konstantinopoulou';

  await createGroup(page, 'Long names', name);
  const summary = button(page, `${name} (you), no expenses yet. Show details`);

  await expect(summary).toBeVisible();
  await expect(summary.getByText('· No expenses yet', { exact: true })).toHaveCount(0);
  await expect(summary.getByText(name, { exact: true })).toBeVisible();
});

test('keeps payer and recipient labels on one line beside long names on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await createGroup(page, 'Narrow choices', 'Anastasia Konstantinopoulou-Smith');
  await addMember(page, 'Benjamin Alexander Fitzgerald');
  await button(page, 'Add expense').click();
  await motionSettled(page);

  const singleLine = async (name: string) => {
    const label = page.getByText(name, { exact: true });
    const dimensions = await label.evaluate((node) => ({ height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node).lineHeight) }));

    expect(dimensions.height).toBeLessThanOrEqual(dimensions.line + 1);
  };

  await singleLine('Paid by');
  await page.getByRole('radio', { name: 'Payment', exact: true }).click();
  await motionSettled(page);
  await singleLine('Paid by');
  await singleLine('Paid to');
  expect(await page.locator('#splitnext-page').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('folds a person avatar without jumping their name sideways while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await createGroup(page, 'Person scroll', 'Ana');
  const name = 'Benjamin Alexander Fitzgerald';

  await addMember(page, name);

  for (let index = 0; index < 12; index++) await addExpense(page, `Dinner ${index}`, '30');

  await person(page, name).click();
  await motionSettled(page);

  await page.screenshot({ path: test.info().outputPath('person-header-expanded.png') });

  const positions = await page.locator('#splitnext-page').evaluate(async (node) => {
    const values: number[] = [];

    for (let top = 0; top <= 160; top += 2) {
      node.scrollTop = top;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      values.push(document.querySelector('h1')!.getBoundingClientRect().x);
    }

    return values;
  });

  expect(Math.max(...positions.slice(1).map((x, index) => Math.abs(x - positions[index]!)))).toBeLessThan(8);
  await expect(heading(page, name)).toHaveCSS('font-size', '18px');
  await page.screenshot({ path: test.info().outputPath('person-header-compact.png') });
});
