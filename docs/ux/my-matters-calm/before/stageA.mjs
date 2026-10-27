import fs from 'fs';
import { launch, ctx, BASE, settle, VIEWS } from './lib.mjs';
import { measure } from './metrics.mjs';
const OUT = '/home/user/wt-mycalm/docs/ux/my-matters-calm/before';
fs.mkdirSync(OUT, { recursive: true });
const personas = process.argv[2] ? process.argv[2].split(',') : ['pm1', 'pm3'];
const TABS = ['overview', 'deadlines', 'breakdown', 'data', 'activity', 'trends'];
const b = await launch();
const results = JSON.parse(fs.existsSync('/tmp/mycalm/metrics.json') ? fs.readFileSync('/tmp/mycalm/metrics.json', 'utf8') : '{}');
for (const pers of personas) for (const view of Object.keys(VIEWS)) {
  const { c, p } = await ctx(b, pers, view);
  for (const t of TABS) {
    await p.goto(BASE + '/my-matters' + (t === 'overview' ? '' : '?tab=' + t)); await settle(p, 3000);
    await p.evaluate(() => window.scrollTo(0, 0));
    const m = await p.evaluate(measure); results[`${pers}|${t}|${view}`] = m;
    const base = `${OUT}/${pers}-${t}-${view}`;
    await p.screenshot({ path: base + '.png' });
    if (view === '1366x768' || view === '375x812') await p.screenshot({ path: base + '-full.png', fullPage: true });
    console.log(pers, t, view, m.pxAboveFirstTaskRow, m.controlsInViewport, m.wordsInViewport);
  }
  await c.close();
}
fs.writeFileSync('/tmp/mycalm/metrics.json', JSON.stringify(results, null, 1));
await b.close();
