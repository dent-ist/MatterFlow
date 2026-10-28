// "Nothing to show" states after epic #893 batch 1 (#920): the 1-matter person filtered to Secondary (nothing matches), every tab, four sizes.
// Output: states/empty-<tab>-<size>.png and states/metrics.json. Compare with ../before/states/ (empty-*).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launch, ctx, BASE, settle, VIEWS } from './lib.mjs';
import { measure } from './metrics.mjs';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'states');
const TABS = ['overview', 'deadlines', 'breakdown', 'data', 'activity', 'trends'];
const results = {};
const b = await launch();
for (const view of Object.keys(VIEWS)) {
  const { c, p } = await ctx(b, 'pm1', view);
  for (const t of TABS) {
    await p.goto(BASE + '/my-matters?role=secondary' + (t === 'overview' ? '' : '&tab=' + t)); await settle(p, 2500);
    await p.evaluate(() => window.scrollTo(0, 0));
    const m = await p.evaluate(measure);
    const panel = await p.evaluate(() => document.querySelector('[data-mm-tabpanel]')?.getBoundingClientRect().height ?? null);
    results[`empty|${t}|${view}`] = { ...m, panelHeight: panel };
    await p.screenshot({ path: `${OUT}/empty-${t}-${view}.png` });
    console.log(t, view, m.controlsInViewport, m.wordsInViewport, m.pageHeight, panel);
  }
  await c.close();
}
fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(results, null, 1));
await b.close();
