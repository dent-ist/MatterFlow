// The Data Area states of epic #893 (#931 to #933): the selection bar with several matters, one matter, a period, a size field, the chart switch and the open pickers.
// Usage (stack running):  MF_BASE=http://127.0.0.1:5290 node stageData.mjs [pm1,pm3]   ->  <persona>-data-<state>-<size>.png here.
import path from 'path';
import { fileURLToPath } from 'url';
import { launch, ctx, BASE, settle, VIEWS } from './lib.mjs';
const OUT = process.env.MF_OUT ?? path.dirname(fileURLToPath(import.meta.url));
const personas = process.argv[2] ? process.argv[2].split(',') : ['pm1', 'pm3'];
const b = await launch();
for (const pers of personas) for (const view of Object.keys(VIEWS)) {
  const { c, p } = await ctx(b, pers, view);
  const shot = async (name) => { await p.screenshot({ path: `${OUT}/${pers}-data-${name}-${view}.png` }); console.log(pers, view, name); };
  const go = async (q = '') => { await p.goto(BASE + '/my-matters?tab=data' + q); await settle(p, 2000); await p.evaluate(() => window.scrollTo(0, 0)); };
  await go(); await shot('default');
  // Matters picker open (a person with one matter is not offered it).
  const matters = p.locator('[data-pick-matters] summary');
  if (await matters.count()) {
    await matters.click(); await p.waitForTimeout(400); await shot('pick-matters');
    const boxes = p.locator('[data-pick-matters] input[type=checkbox]');
    const n = await boxes.count();
    if (n >= 2) { await boxes.nth(0).check(); await boxes.nth(1).check(); await p.waitForTimeout(800); await shot('several-matters'); }
    await p.keyboard.press('Escape');
    if (n >= 1) { await go(); await p.locator('[data-pick-matters] summary').click(); await p.locator('[data-pick-matters] input[type=checkbox]').nth(0).check(); await p.keyboard.press('Escape'); await p.waitForTimeout(800); await shot('one-matter'); }
  }
  await go(); const types = p.locator('[data-pick-types] summary');
  if (await types.count()) { await types.click(); await p.waitForTimeout(400); await shot('pick-types'); await p.keyboard.press('Escape'); }
  await go(); const sizes = p.locator('[data-pick-sizes] summary');
  if (await sizes.count()) {
    await sizes.click(); await p.waitForTimeout(400); await shot('pick-sizes');
    const f = p.locator('[data-pick-sizes] input[data-size-field]'); if (await f.count()) { await f.first().check(); await p.waitForTimeout(500); await shot('size-field'); }
    await p.keyboard.press('Escape');
  }
  await go(); await p.locator('[data-data-period]').selectOption('12m').catch(() => {}); await p.waitForTimeout(800); await shot('period');
  await go(); await p.locator('[data-show-bar]').click(); await p.waitForTimeout(800); await shot('bar');
  await p.locator('[data-show-pie]').click(); await p.waitForTimeout(800); await shot('pie');
  await go(); await p.locator('[data-how]').click().catch(() => {}); await p.waitForTimeout(400); await shot('info');
  await c.close();
}
await b.close();
