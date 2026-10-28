// Lists the controls a person can reach and the words seen on the first screen (what `metrics.mjs` counts), to see where a budget goes.
// Usage: MF_BASE=http://127.0.0.1:5841 node listControls.mjs pm3 1366x768 [tab]
import { launch, ctx, BASE, settle } from './lib.mjs';
const [pers = 'pm3', view = '1366x768', tab = 'overview'] = process.argv.slice(2);
const b = await launch();
const { c, p } = await ctx(b, pers, view);
await p.goto(BASE + '/my-matters' + (tab === 'overview' ? '' : '?tab=' + tab));
await settle(p, 3000);
const rows = await p.evaluate(() => {
  const vh = innerHeight, vw = innerWidth;
  const main = document.querySelector('main') || document.body;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]') && !el.closest('.mf-sr-only'); };
  const sel = 'a[href], button, input, select, textarea, summary, [role=tab], [role=button], [role=menuitem], [tabindex]:not([tabindex="-1"])';
  const reach = (el) => !(el.closest('details:not([open])') && el.tagName !== 'SUMMARY') && !el.closest('[data-skip-links], mf-mm-skip-links');
  return [...document.body.querySelectorAll(sel)].filter((e) => vis(e) && reach(e)).map((e) => { const r = e.getBoundingClientRect(); return { in: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw, main: main.contains(e), y: Math.round(r.top), x: Math.round(r.left), t: (e.getAttribute('aria-label') || e.innerText || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 50), tag: e.tagName }; });
});
const inside = rows.filter((r) => r.in);
console.log(pers, view, 'controls in viewport (whole page incl. shell):', inside.length, ' in main:', inside.filter((r) => r.main).length);
for (const r of inside) console.log(`${r.main ? 'M' : 'S'} y${String(r.y).padStart(4)} x${String(r.x).padStart(4)} ${r.tag.padEnd(7)} ${r.t}`);
await c.close(); await b.close();
