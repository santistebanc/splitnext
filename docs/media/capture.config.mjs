// Showcase capture for Splitnext. Flows create groups, so they run against the local dev server:
//   npm run dev        # Worker, D1 and the built web app on http://localhost:8787
//   node <project-showcase>/scripts/capture.mjs --config docs/media/capture.config.mjs
// Every shot and flow starts as a fresh installation and builds its own group through the real UI.
// showcase/ (npm run showcase) is the longer per-flow walkthrough page; this folder feeds the README.

const BASE = 'http://localhost:8787';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const button = (page, name) => page.getByRole('button', { name, exact: !(name instanceof RegExp) });

const field = (page, name) => page.getByRole('textbox', { name, exact: true });


async function createGroup(page, name, you) {
  await button(page, 'New group').waitFor({ timeout: 20000 });
  await button(page, 'New group').click();
  await field(page, 'Group name').fill(name);
  await field(page, 'Your name in this group').fill(you);
  await button(page, 'Create group').click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}

async function addMember(page, name) {
  const showAll = page.getByRole('button', { name: /^Show all \d+ people$/ });

  if (await showAll.count()) await showAll.click();
  await field(page, 'Add a person').fill(name);
  await field(page, 'Add a person').press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.getByTestId('edit-cover').waitFor({ state: 'detached' }).catch(() => {});
}

async function addExpense(page, description, amount, payer) {
  await button(page, 'Add expense').click();
  await field(page, 'Amount').fill(amount);

  if (payer) {
    await button(page, /^Paid by .*Change payer$/).click();
    await page.getByRole('radio', { name: new RegExp(`^${esc(payer)}( \\(you\\))?$`) }).click();
  }

  await field(page, 'Description').fill(description);
  await button(page, 'Save').click();
  await button(page, new RegExp(`^Change ${esc(description)} · `)).waitFor();
}

/** A Lisbon trip with three people and a few expenses. */
async function lisbon(page, h, { expenses = true } = {}) {
  await createGroup(page, 'Lisbon trip', 'Ana');
  await addMember(page, 'Ben');
  await addMember(page, 'Cy');

  if (expenses) {
    await addExpense(page, 'Apartment', '360');
    await addExpense(page, 'Dinner at Taberna', '90', 'Ben');
    await addExpense(page, 'Tram tickets', '24', 'Cy');
  }

  await page.getByText(/saved here|changes? waiting/).first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.getByRole('tab', { name: /^People/ }).or(button(page, /^People, \d+$/)).first().click();
  await h.pause(500);
}

export default {
  name: 'Splitnext',
  url: BASE,
  // The app has one light design.
  themes: ['light'],
  ready: (page) => page.locator('body').waitFor(),
  shots: [
    {
      id: 'group', path: '/app', viewports: ['mobile'],
      caption: 'A group: each person\'s balance first, then the expenses',
      before: async (page, h) => { await lisbon(page, h); },
    },
    {
      id: 'split', path: '/app', viewports: ['mobile'],
      caption: 'An expense split by shares: Cy takes two shares, the others one each',
      before: async (page, h) => {
        await lisbon(page, h, { expenses: false });
        await button(page, 'Add expense').click();
        await field(page, 'Amount').fill('90');
        await field(page, 'Description').fill('Dinner at Taberna');
        await button(page, /Change split$/).click();
        await button(page, 'Increase share for Cy').click();
        await h.pause(500);
      },
    },
    {
      id: 'settle', path: '/app', viewports: ['mobile'],
      caption: 'The settle-up plan with the fewest payments',
      before: async (page, h) => {
        await lisbon(page, h);
        await button(page, /^Settle up/).first().click();
        await page.getByRole('heading', { name: 'Settle up', exact: true }).waitFor();
        await h.pause(500);
      },
    },
  ],
  flows: [
    {
      id: 'add-expense', path: '/app', viewport: 'mobile', theme: 'light', hero: true,
      caption: 'Add an expense: the amount, who paid and a description; balances update at once',
      before: async (page, h) => { await lisbon(page, h, { expenses: false }); await addExpense(page, 'Apartment', '360'); await h.pause(1500); },
      run: async (page, h) => {
        await h.pause(600);
        await h.click(button(page, 'Add expense'));
        await h.type(field(page, 'Amount'), '90');
        await h.click(button(page, /^Paid by .*Change payer$/));
        await h.click(page.getByRole('radio', { name: /^Ben$/ }));
        await h.type(field(page, 'Description'), 'Dinner at Taberna');
        await h.click(button(page, 'Save'));
        await h.pause(2000);
      },
    },
    {
      id: 'settle-up', path: '/app', viewport: 'mobile', theme: 'light',
      caption: 'Open a person, see the plan and record a repayment with one press',
      before: async (page, h) => { await lisbon(page, h); },
      run: async (page, h) => {
        await h.pause(600);
        await h.click(button(page, /^Settle up/).first());
        await h.pause(1200);
        await h.click(button(page, /Record this payment$/).first());
        await h.pause(1800);
      },
    },
  ],
};
