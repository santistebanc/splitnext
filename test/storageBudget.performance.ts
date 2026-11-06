import { beforeAll, expect, it } from 'vitest';
import { largeInstallation, operationBudgetMs } from './fixtures/largeInstallation';

let fixture: Awaited<ReturnType<typeof largeInstallation>>;

beforeAll(async () => { fixture = await largeInstallation(); }, 120_000);

/** The median duration of an operation run several times, in milliseconds. */
async function median<T>(runs: number, operation: (run: number) => Promise<T>): Promise<number> {
  const durations: number[] = [];

  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();

    await operation(run);
    durations.push(performance.now() - started);
  }

  return durations.sort((left, right) => left - right)[Math.floor(runs / 2)] ?? 0;
}

  it('keeps local operations on a large installation within their time budget', async () => {
    const { client, groupIds } = fixture;
    const [open = ''] = groupIds;
    const renamed = (await client.inspect(open)).projected_snapshot?.members.slice(30, 35).map((member) => member.id) ?? [];

    const timings = {
      submit: await median(15, (run) => client.submit(open, {
        type: 'member.rename',
        payload: { member_id: renamed[run % renamed.length] ?? '', display_name: `Timed ${run}` },
      })),
      inspect: await median(15, () => client.inspect(open)),
      installation: await median(15, () => client.installationState([open])),
    };

    console.info(JSON.stringify({ measurement: 'large-installation-storage', medianRuns: 15, budgetMs: operationBudgetMs, timings }));

    for (const [operation, duration] of Object.entries(timings))
      expect(duration, `${operation} took ${duration} ms; all: ${JSON.stringify(timings)}`).toBeLessThan(operationBudgetMs);
  });
