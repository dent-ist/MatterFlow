// Capture script for the "after" screenshots and numbers of epic #893 (same personas, sizes and file names as ../before/stageA.mjs).
// Usage (stack running, see ../progress.md):  node stageA.mjs [pm1,pm3] [tab,tab]   ->  <persona>-<tab>-<size>.png and metrics.json here.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launch, ctx, BASE, settle, VIEWS } from './lib.mjs';
import { measure } from './metrics.mjs';
const OUT = path.dirname(fileURLToPath(import.meta.url));
const personas = process.argv[2] ? process.argv[2].split(',') : ['pm1', 'pm3'];
const TABS = process.argv[3] ? process.argv[3].split(',') : ['overview', 'deadlines', 'breakdown', 'data', 'activity', 'trends'];
const file = path.join(OUT, 'metrics.json');
const results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const b = await launch();
for (const pers of personas) for (const view of Object.keys(VIEWS)) {
  const { c, p } = await ctx(b, pers, view);
  for (const t of TABS) {
    await p.goto(BASE + '/my-matters' + (t === 'overview' ? '' : '?tab=' + t)); await settle(p, 3000);
    await p.evaluate(() => window.scrollTo(0, 0));
    const m = await p.evaluate(measure); results[`${pers}|${t}|${view}`] = m;
    const base = `${OUT}/${pers}-${t}-${view}`;
    await p.screenshot({ path: base + '.png' });
    if (view === '1366x768' || view === '375x812') await p.screenshot({ path: base + '-full.png', fullPage: true });
    console.log(pers, t, view, m.pxAboveFirstTaskRow, m.controlsInViewport, m.wordsInViewport, m.pageHeight);
  }
  await c.close();
}
fs.writeFileSync(file, JSON.stringify(results, null, 1));
await b.close();
