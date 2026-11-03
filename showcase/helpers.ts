import { fileURLToPath } from 'node:url';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Locators and quick, off-camera setup shared by the showcase's capture scripts. */

/** Where captures go; `build.mjs` reads them from here. */
export const out = fileURLToPath(new URL('./out/', import.meta.url));

export const baseURL = 'http://localhost:8793';

export const phone = { width: 390, height: 844 };

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export function button(page: Page, name: string | RegExp) {
  return page.getByRole('button', { name, exact: !(name instanceof RegExp) });
}

export function field(page: Page, name: string) {
  return page.getByRole('textbox', { name, exact: true });
}

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true });
}

export function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function person(page: Page, name: string) {
  return button(page, new RegExp(`^${escaped(name)}( \\(you\\))?(, removed)?, .*\\. Show details$`));
}

export function bell(page: Page) {
  return button(page, /^Activity[,:]/);
}

/** Opens the groups list, from wherever the app reopens. */
export async function toGroups(page: Page): Promise<void> {
  await page.goto('/app');
  const list = button(page, 'New group');
  const back = button(page, 'Back to groups');

  await expect(list.or(back)).toBeVisible();

  if (await back.isVisible()) await back.click();
  await expect(list).toBeVisible();
}

export async function createGroup(page: Page, name: string, you: string): Promise<void> {
  await toGroups(page);
  await button(page, 'New group').click();
  await field(page, 'Group name').fill(name);
  await field(page, 'Your name in this group').fill(you);
  await button(page, 'Create group').click();
  await expect(heading(page, name)).toBeVisible();
}

export async function addMember(page: Page, name: string): Promise<void> {
  // Once not everyone fits, the Add a person line shows only with everyone listed.
  await expect(async () => {
    const showAll = page.getByRole('button', { name: /^Show all \d+ people$/ });

    if (await showAll.count()) await showAll.click();
    await expect(field(page, 'Add a person')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await field(page, 'Add a person').fill(name);
  await field(page, 'Add a person').press('Enter');
  // Once the balances collapse, someone new may be past the rows shown.
  await expect(field(page, 'Add a person')).toHaveValue('');
  await leaveField(page);
}

/** Leaves the field being edited, so its edit cover stops blocking the rest of the screen. */
export async function leaveField(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-cover')).toHaveCount(0);
}

export async function addExpense(page: Page, description: string, amount: string, payer?: string): Promise<void> {
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill(amount);

  if (payer) {
    await button(page, /^Paid by .*Change payer$/).click();
    await page.getByRole('radio', { name: new RegExp(`^${escaped(payer)}( \\(you\\))?$`) }).click();
  }

  await field(page, 'Description').fill(description);
  await button(page, 'Save').click();
  await expect(button(page, new RegExp(`^Change ${escaped(description)} · `))).toBeVisible();
}

export async function renameGroup(page: Page, name: string): Promise<void> {
  // The name is edited in place in the header; Enter keeps it.
  await button(page, 'Rename group').click();
  await field(page, 'Group name').fill(name);
  await field(page, 'Group name').press('Enter');
  await expect(heading(page, name)).toBeVisible();
}

export async function inviteLink(page: Page): Promise<string> {
  // Invite people opens the link in place under the header and closes it again.
  await button(page, 'Invite people').click();
  const link = (await page.getByTestId('invite-link').textContent()) ?? '';

  await button(page, 'Invite people').click();
  await expect(page.getByTestId('invite-link')).toHaveCount(0);

  return link;
}

export async function synced(page: Page): Promise<void> {
  await expect(page.getByText(/saved here|changes? waiting/)).toHaveCount(0, { timeout: 15_000 });
}

/** Builds a device's data off camera and returns its storage, so a video starts where the flow does. */
export async function prepare(browser: Browser, build: (page: Page) => Promise<void>): Promise<StorageState> {
  const context = await browser.newContext({ baseURL, viewport: phone });
  const page = await context.newPage();

  await build(page);
  await synced(page);
  const state = await context.storageState({ indexedDB: true });

  await context.close();

  return state;
}

export async function setOffline(context: BrowserContext, page: Page, offline: boolean): Promise<void> {
  await context.setOffline(offline);
  await page.evaluate((event) => window.dispatchEvent(new Event(event)), offline ? 'offline' : 'online');
}

/** Opens the app on a group, whether it reopens there or on the groups list. */
export async function openGroup(page: Page, name: string): Promise<void> {
  const open = button(page, `Open ${name}`);

  await page.goto('/app');
  await expect(heading(page, name).or(open)).toBeVisible();

  if (await open.isVisible()) await open.click();
  await expect(heading(page, name)).toBeVisible();
}

/** Records a planned payment from someone's Settle up screen and returns to it. */
export async function recordPlanned(page: Page, payment: string | RegExp): Promise<void> {
  // Record saves the planned payment at once; the plan then drops it.
  await button(page, payment).click();
  await expect(button(page, payment)).toHaveCount(0);
}
