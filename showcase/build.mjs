// Turns the recordings in showcase/out/ into showcase/out/index.html: each
// flow's video beside its steps, then every conditional element by area.
// `node showcase/build.mjs clean` empties out/ before a new capture.
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '..');

const out = join(here, 'out');

if (process.argv[2] === 'clean') {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  process.exit(0);
}

async function readAll(folder) {
  const path = join(out, folder);

  if (!existsSync(path)) return [];
  const names = (await readdir(path)).filter((name) => name.endsWith('.json'));

  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(path, name), 'utf8'))));
}

const flows = (await readAll('flows')).sort((a, b) => a.order - b.order);

// Moments in each flow's video, shown as its poster and thumbnails.
const screens = (await readAll('screens')).sort((a, b) => a.order - b.order);

const cases = (await readAll('cases')).sort((a, b) => a.order - b.order);

const caseAreas = ['App', 'Welcome and groups', 'New group', 'Group screen', 'Balances', 'People', 'Expense form', 'Settling up', 'Invite sheet', 'Joining', 'Activity', 'Offline and sync'];

if (!flows.length && !cases.length) {
  console.error('Nothing captured yet: run `npm run showcase`.');
  process.exit(1);
}

await mkdir(join(out, 'assets'), { recursive: true });

for (const font of ['instrument-sans.woff2', 'geist-mono.woff2']) {
  await cp(join(root, 'apps/client/public/assets', font), join(out, 'assets', font));
}

const icon = (await readFile(join(root, 'apps/client/public/icon.svg'), 'utf8')).replace(/<\?xml[^>]*>/, '');

const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function flowCard(flow, index) {
  const own = screens.filter((screen) => screen.flow === flow.id);

  return `
  <article class="flow" id="flow-${escape(flow.id)}">
    <div class="phone"><video src="${escape(flow.video)}"${own[0] ? ` poster="screens/${escape(own[0].id)}.png"` : ''} controls muted playsinline preload="metadata" data-flow="${escape(flow.id)}"></video></div>
    <div class="flow-text">
      <p class="eyebrow">Flow ${index + 1} · ${flow.steps.length} steps</p>
      <h3>${escape(flow.title)}</h3>
      <p class="summary">${escape(flow.summary)}</p>
      <ol class="steps">
        ${flow.steps.map((step, number) => `<li><button type="button" data-seek="${step.at.toFixed(2)}" data-end="${(flow.steps[number + 1]?.at ?? 1e6).toFixed(2)}"><span class="time">${clock(step.at)}</span><span>${escape(step.text)}</span></button></li>`).join('\n        ')}
      </ol>
      ${own.length ? `<div class="strip">${own.map((screen) => `<button type="button" class="thumb" data-seek="${screen.at.toFixed(2)}" title="${escape(screen.title)}"><img src="screens/${escape(screen.id)}.png" alt="${escape(screen.title)}" loading="lazy"></button>`).join('')}</div>` : ''}
    </div>
  </article>`;
}

function caseCard(entry) {
  const text = `<figcaption><strong>${escape(entry.element)}</strong><span>${escape(entry.when)}</span></figcaption>`;

  if (entry.missing) return `
      <figure class="missing">
        <div class="gap"><span>Not captured</span><small>${escape(entry.missing)}</small></div>
        ${text}
      </figure>`;

  return `
      <figure>
        <button type="button" class="shot" data-full="cases/${escape(entry.id)}.png" data-title="${escape(entry.element)}" data-note="${escape(entry.when)}"><img src="cases/${escape(entry.id)}.png" alt="${escape(entry.element)}" loading="lazy"></button>
        ${text}
      </figure>`;
}

const groupBy = (names, items, key) => names.flatMap((name) => {
  const matching = items.filter((item) => item[key] === name);

  return matching.length ? [{ name, items: matching }] : [];
});

const caseGroups = groupBy(caseAreas, cases, 'area');

const missing = cases.filter((entry) => entry.missing).length;

const slug = (text) => text.toLowerCase().replace(/[^a-z]+/g, '-');

/** Chips that jump to each area of a section. */
const areaLinks = (prefix, groups) => `<div class="chips">${groups.map((group) => `<a href="#${prefix}-${slug(group.name)}">${escape(group.name)} <small>${group.items.length}</small></a>`).join('')}</div>`;

const generated = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>splitnext · App showcase</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">
<style>
  @font-face { font-family: 'Instrument Sans'; src: url(assets/instrument-sans.woff2) format('woff2'); font-weight: 400 700; }
  @font-face { font-family: 'Geist Mono'; src: url(assets/geist-mono.woff2) format('woff2'); font-weight: 400 700; }
  :root { --bg: #f2f4f6; --surface: #fff; --ink: #10161d; --soft: #39424c; --muted: #56606b; --border: #dde2e7; --action: #1b5fc1; --action-soft: #e6effc; --night: #10161d; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 76px; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.5 'Instrument Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  h1, h2, h3 { font-family: 'Instrument Sans', system-ui, sans-serif; letter-spacing: -0.02em; margin: 0; }
  button { font: inherit; color: inherit; }
  .bar { position: sticky; top: 0; z-index: 10; background: rgba(242, 244, 246, 0.86); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
  .bar-inner { max-width: 1180px; margin: 0 auto; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
  .bar svg { width: 30px; height: 30px; flex: none; }
  .bar .name { font: 700 18px 'Instrument Sans', system-ui, sans-serif; letter-spacing: -0.02em; }
  .bar nav { margin-left: auto; display: flex; gap: 4px; overflow-x: auto; }
  .bar nav a { padding: 7px 12px; border-radius: 999px; color: var(--soft); text-decoration: none; font-weight: 500; font-size: 14px; white-space: nowrap; }
  .bar nav a:hover { background: var(--surface); color: var(--ink); }
  main { max-width: 1180px; margin: 0 auto; padding: 0 24px 96px; }
  .hero { padding: 64px 0 40px; display: grid; gap: 14px; }
  .hero h1 { font-size: clamp(36px, 6vw, 60px); line-height: 1.02; letter-spacing: -0.035em; max-width: 14ch; }
  .hero p { margin: 0; max-width: 58ch; color: var(--soft); font-size: 17px; }
  .facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .facts span { padding: 6px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); font-size: 13px; color: var(--soft); }
  .facts b { color: var(--ink); font-family: 'Geist Mono', monospace; font-weight: 500; }
  section > h2 { font-size: 30px; margin: 56px 0 6px; }
  section > p.lead { margin: 0 0 24px; color: var(--muted); }
  .eyebrow { margin: 0; color: var(--muted); font: 600 12px 'Instrument Sans', sans-serif; text-transform: uppercase; letter-spacing: 0.08em; }
  .flow { display: grid; grid-template-columns: 300px 1fr; gap: 40px; align-items: start; padding: 32px; margin-bottom: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 28px; }
  .phone { position: sticky; top: 92px; padding: 9px; border-radius: 40px; background: var(--night); box-shadow: 0 24px 48px -24px rgba(16, 22, 29, 0.45); }
  .phone video { display: block; width: 100%; aspect-ratio: 390 / 844; border-radius: 31px; background: var(--bg); }
  .flow-text { display: grid; gap: 10px; min-width: 0; }
  .flow-text h3 { font-size: 28px; }
  .summary { margin: 0; color: var(--soft); max-width: 56ch; }
  .steps { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 2px; counter-reset: step; }
  .steps button { width: 100%; display: flex; gap: 14px; align-items: baseline; text-align: left; padding: 10px 12px; border: 0; border-radius: 12px; background: none; cursor: pointer; color: var(--soft); transition: background 160ms, color 160ms; }
  .steps button:hover { background: var(--bg); color: var(--ink); }
  .steps button.now { background: var(--action-soft); color: var(--ink); }
  .steps .time { flex: none; width: 38px; font: 500 13px 'Geist Mono', monospace; color: var(--action); }
  .strip { display: flex; gap: 10px; overflow-x: auto; padding: 14px 2px 6px; margin-top: 6px; border-top: 1px solid var(--border); }
  .thumb { flex: none; padding: 0; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--bg); cursor: pointer; transition: transform 160ms, box-shadow 160ms; }
  .thumb:hover { transform: translateY(-2px); box-shadow: 0 8px 18px -10px rgba(16, 22, 29, 0.4); }
  .thumb img { display: block; width: 62px; aspect-ratio: 390 / 844; object-fit: cover; object-position: top; }
  .facts .warn { border-color: #f3c9a8; background: #fff4e5; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: -8px 0 8px; }
  .chips a { padding: 6px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--soft); text-decoration: none; font-size: 13px; font-weight: 500; }
  .chips a:hover { border-color: var(--action); color: var(--action); }
  .chips small { color: var(--muted); font-family: 'Geist Mono', monospace; }
  .missing .gap { display: grid; place-content: center; gap: 6px; aspect-ratio: 390 / 844; padding: 16px; border: 2px dashed #f3c9a8; border-radius: 18px; background: #fff4e5; text-align: center; }
  .missing .gap span { font-weight: 600; color: #a9470c; }
  .missing .gap small { color: var(--soft); font-size: 12px; word-break: break-word; }
  .area h3 { font-size: 20px; margin: 36px 0 14px; display: flex; align-items: baseline; gap: 10px; }
  .area h3 small { font: 500 13px 'Geist Mono', monospace; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 22px; }
  figure { margin: 0; display: grid; gap: 10px; align-content: start; }
  .shot { padding: 0; border: 1px solid var(--border); border-radius: 18px; overflow: hidden; background: var(--surface); cursor: zoom-in; box-shadow: 0 10px 24px -18px rgba(16, 22, 29, 0.35); transition: transform 180ms, box-shadow 180ms; }
  .shot:hover { transform: translateY(-3px); box-shadow: 0 18px 32px -20px rgba(16, 22, 29, 0.45); }
  .shot img { display: block; width: 100%; height: auto; }
  figcaption { display: grid; gap: 2px; padding: 0 4px; font-size: 13px; color: var(--muted); }
  figcaption strong { color: var(--ink); font-size: 14px; font-weight: 600; }
  .lightbox { position: fixed; inset: 0; z-index: 20; display: none; place-items: center; background: rgba(16, 22, 29, 0.82); padding: 24px; }
  .lightbox.open { display: grid; }
  .lightbox figure { max-height: 100%; justify-items: center; }
  .lightbox img { max-width: min(92vw, 1100px); max-height: calc(100vh - 140px); border-radius: 18px; box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4); }
  .lightbox figcaption { color: #cbd2d9; text-align: center; }
  .lightbox figcaption strong { color: #fff; font-size: 16px; }
  .lightbox .nav { position: fixed; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 22px; cursor: pointer; }
  .lightbox .nav:hover { background: rgba(255, 255, 255, 0.26); }
  .lightbox .prev { left: 20px; } .lightbox .next { right: 20px; }
  .lightbox .close { top: 20px; right: 20px; transform: none; }
  footer { max-width: 1180px; margin: 0 auto; padding: 24px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--border); }
  @media (max-width: 820px) {
    .flow { grid-template-columns: 1fr; padding: 20px; gap: 24px; }
    .phone { position: static; max-width: 300px; margin: 0 auto; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; } }
</style>
</head>
<body>
<header class="bar"><div class="bar-inner">${icon}<span class="name">splitnext</span>
  <nav><a href="#flows">Flows</a><a href="#cases">Conditional UI</a></nav>
</div></header>
<main>
  <div class="hero">
    <p class="eyebrow">App showcase</p>
    <h1>Every flow and screen, recorded from the real app.</h1>
    <p>Each video drives the built app on a local Worker, on a phone-sized screen. Steps and thumbnails beside a video jump to that moment. Conditional UI spotlights each element that appears only in some situation.</p>
    <div class="facts"><span><b>${flows.length}</b> flows</span><span><b>${cases.length - missing}</b> conditional elements</span>${missing ? `<span class="warn"><b>${missing}</b> not captured</span>` : ''}<span>Captured ${escape(generated)}</span></div>
  </div>

  <section id="flows">
    <h2>Flows</h2>
    <p class="lead">What someone does in the app, start to finish.</p>
    ${flows.map(flowCard).join('\n')}
  </section>

  <section id="cases">
    <h2>Conditional UI</h2>
    <p class="lead">Each element the app renders only in some situation, spotlighted, with when it appears.</p>
    ${areaLinks('cases', caseGroups)}
    ${caseGroups.map((group) => `
    <div class="area" id="cases-${slug(group.name)}">
      <h3>${escape(group.name)} <small>${group.items.length}</small></h3>
      <div class="grid">${group.items.map(caseCard).join('')}
      </div>
    </div>`).join('\n')}
  </section>
</main>
<footer>Generated by <code>npm run showcase</code> from <code>showcase/capture.spec.ts</code> and <code>showcase/cases.spec.ts</code>.</footer>

<div class="lightbox" role="dialog" aria-modal="true" aria-label="Screen">
  <button type="button" class="nav close" aria-label="Close">✕</button>
  <button type="button" class="nav prev" aria-label="Previous screen">‹</button>
  <figure><img alt=""><figcaption><strong></strong><span></span></figcaption></figure>
  <button type="button" class="nav next" aria-label="Next screen">›</button>
</div>

<script>
  // Steps follow the video and seek it; thumbnails jump to their moment.
  for (const flow of document.querySelectorAll('.flow')) {
    const video = flow.querySelector('video');
    const steps = [...flow.querySelectorAll('.steps button')];

    const seek = (at) => {
      video.currentTime = Math.max(0, Number(at) - 0.3);
      video.play().catch(() => {});
    };

    for (const control of flow.querySelectorAll('[data-seek]')) control.addEventListener('click', () => seek(control.dataset.seek));
    video.addEventListener('timeupdate', () => {
      for (const step of steps) step.classList.toggle('now', video.currentTime >= Number(step.dataset.seek) - 0.3 && video.currentTime < Number(step.dataset.end) - 0.3);
    });
  }

  const shots = [...document.querySelectorAll('.shot')];
  const box = document.querySelector('.lightbox');
  let current = 0;

  const show = (index) => {
    current = (index + shots.length) % shots.length;
    const shot = shots[current];

    box.querySelector('img').src = shot.dataset.full;
    box.querySelector('img').alt = shot.dataset.title;
    box.querySelector('strong').textContent = shot.dataset.title;
    box.querySelector('figcaption span').textContent = shot.dataset.note;
    box.classList.add('open');
  };

  shots.forEach((shot, index) => shot.addEventListener('click', () => show(index)));
  box.querySelector('.close').addEventListener('click', () => box.classList.remove('open'));
  box.querySelector('.prev').addEventListener('click', () => show(current - 1));
  box.querySelector('.next').addEventListener('click', () => show(current + 1));
  box.addEventListener('click', (event) => { if (event.target === box) box.classList.remove('open'); });
  addEventListener('keydown', (event) => {
    if (!box.classList.contains('open')) return;
    if (event.key === 'Escape') box.classList.remove('open');
    if (event.key === 'ArrowLeft') show(current - 1);
    if (event.key === 'ArrowRight') show(current + 1);
  });
</script>
</body>
</html>
`;

await writeFile(join(out, 'index.html'), html);

console.log(`Showcase: ${flows.length} flows, ${cases.length - missing} conditional elements${missing ? ` (${missing} not captured)` : ''} → ${join(out, 'index.html')}`);
