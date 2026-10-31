// WCAG 1.4.3 contrast check for notes-mockup-r3.html (text only, many states).
// Run: node docs/ux/mockups/notes-mockup-contrast.js   (needs a global `playwright` install; no network)
// For every visible element that owns text it computes the colour and the effective background (semi-transparent
// layers are composited over each other) and reports any pair below 4.5:1 (3:1 for large text: 24 px, or 18.66 px bold).
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, 'notes-mockup-r3.html');

const STATES = [
  { n: 'A list', h: '#screen=matter&opt=A' },
  { n: 'A read note', h: '#screen=matter&opt=A&note=n1' },
  { n: 'A read-only user', h: '#screen=matter&opt=A&role=reader&note=n7&sens=1' },
  { n: 'A empty matter', h: '#screen=matter&data=empty' },
  { n: 'A edit, table, tag picker', h: '#screen=matter&opt=A&note=n1', run: async (pg) => {
      await pg.click('[data-pact=edit]'); await pg.click('#ed');
      await pg.click('[data-c=table]'); await pg.click('[data-pact=addtag]'); } },
  { n: 'A edit, mention list', h: '#screen=matter&opt=A&note=n1', run: async (pg) => {
      await pg.click('[data-pact=edit]'); await pg.click('#ed'); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' @a'); } },
  { n: 'A edit, conflict banner', h: '#screen=matter&opt=A&note=n1', run: async (pg) => {
      await pg.click('[data-pact=edit]'); await pg.click('#mockbtn'); await pg.click('#mConf'); await pg.click('#mockbtn'); await pg.click('[data-cf=keep]'); } },
  { n: 'A tag filter open', h: '#screen=matter&opt=A', run: async (pg) => { await pg.click('[data-act=tagfilter]'); } },
  { n: 'A search with marks', h: '#screen=matter&opt=A', run: async (pg) => { await pg.fill('#nq', 'hold'); } },
  { n: 'A delete dialog', h: '#screen=matter&opt=A&note=n1', run: async (pg) => { await pg.click('[data-pact=del]'); } },
  { n: 'A loading', h: '#screen=matter&opt=A', run: async (pg) => { await pg.click('#mockbtn'); await pg.check('#mLoad'); } },
  { n: 'Mockup panel', h: '#screen=matter&opt=A', run: async (pg) => { await pg.click('#mockbtn'); } },
  { n: 'B reader', h: '#screen=matter&opt=B&note=n4' },
  { n: 'C board', h: '#screen=matter&opt=C' },
  { n: 'C board + drawer', h: '#screen=matter&opt=C&note=n3' },
  { n: 'My Matters notes', h: '#screen=mymatters&opt=A' },
  { n: 'My Matters overview', h: '#screen=mymatters&tab=overview' },
  { n: 'Matter overview', h: '#screen=matter&tab=overview' },
  { n: 'Admin tags', h: '#screen=admin&role=admin' },
  { n: 'Admin tag dialog', h: '#screen=admin&role=admin', run: async (pg) => { await pg.click('[data-act=tagnew]'); await pg.click('[data-ok]'); } },
  { n: 'Admin blocked delete', h: '#screen=admin&role=admin', run: async (pg) => { await pg.click('[data-act=tagdel][data-id=g7]'); } },
  { n: 'Editor: Delete disabled', h: '#screen=matter&opt=A&role=editor&note=n1' },
  { n: 'Asset chips read + refs', h: '#screen=matter&opt=A&note=n10' },
  { n: 'Asset window', h: '#screen=matter&opt=A&note=n5', run: async (pg) => { await pg.focus('#rbody [data-asset-id=a1]'); await pg.keyboard.press('Enter'); } },
  { n: 'Asset # list', h: '#screen=matter&opt=A&note=n1', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('#ed'); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' #'); } },
  { n: 'B reader splitter focused', h: '#screen=matter&opt=B&note=n4', run: async (pg) => { await pg.focus('#split'); } },
  { n: 'Locked read (locker)', h: '#screen=matter&opt=A&note=n1&data=locked' },
  { n: 'Locked read (other editor)', h: '#screen=matter&opt=A&note=n1&data=locked&role=editor' },
  { n: 'Locked filter list', h: '#screen=matter&opt=A&data=locked', run: async (pg) => { await pg.click('[data-act=tagfilter]'); } },
  { n: 'Lock banner while editing', h: '#screen=matter&opt=A&note=n2', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('#mockbtn'); await pg.click('#mLock'); await pg.click('#mockbtn'); } },
  { n: 'Edit with history', h: '#screen=matter&opt=A&note=n3', run: async (pg) => { await pg.click('[data-pact=edit]'); } },
  { n: 'Edit, history collapsed', h: '#screen=matter&opt=A&note=n3', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('[data-pact=histmin]'); } },
  { n: 'Slash commands', h: '#screen=matter&opt=A&note=n11', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('#ed'); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' /'); } },
  { n: 'Slash task list', h: '#screen=matter&opt=A&note=n11', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('#ed'); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' /task '); } },
  { n: 'Slash project list', h: '#screen=matter&opt=A&note=n11', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('#ed'); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' /project '); } },
  { n: 'Slash template list', h: '#screen=matter&opt=A&note=n11', run: async (pg) => { await pg.click('[data-pact=edit]'); await pg.click('#ed'); await pg.keyboard.press('Control+End'); await pg.keyboard.type(' /template '); } },
  { n: 'Task window', h: '#screen=matter&opt=A&note=n4', run: async (pg) => { await pg.focus('#rbody [data-task-id=t214]'); await pg.keyboard.press('Enter'); } },
  { n: 'Project window', h: '#screen=matter&opt=A&note=n10', run: async (pg) => { await pg.focus('#rbody [data-project-id=p4]'); await pg.keyboard.press('Enter'); } },
  { n: 'Refs removed/completed', h: '#screen=matter&opt=A&note=n10' },
  { n: 'Templates view', h: '#screen=matter&opt=A&view=templates' },
  { n: 'Template read', h: '#screen=matter&opt=A&view=templates&note=tpl_m2' },
  { n: 'Template edit', h: '#screen=matter&opt=A&view=templates&role=admin&note=tpl_m2', run: async (pg) => { await pg.click('[data-pact=tpl-edit]'); } },
  { n: 'Templates as reader', h: '#screen=matter&opt=A&view=templates&role=reader' },
  { n: 'New note menu', h: '#screen=matter&opt=A', run: async (pg) => { await pg.click('[data-act=newmenu]'); } },
  { n: 'Choose template dialog', h: '#screen=matter&opt=A', run: async (pg) => { await pg.click('[data-act=newmenu]'); await pg.click('.dd-panel li[data-id=tpl]'); } },
  { n: 'Save as template dialog', h: '#screen=matter&opt=A&note=n3', run: async (pg) => { await pg.click('[data-pact=more]'); await pg.click('.dd-panel li[data-id=sat]'); } },
  { n: 'History dialog (narrow panel)', h: '#screen=matter&opt=A&note=n3', run: async (pg) => { await pg.click('[data-pact=hist]'); } },
  { n: 'Admin denied', h: '#screen=admin&role=editor' },
];
const SIZES = [[1366, 768], [1920, 1080], [768, 1024], [375, 812]];

function inPage() {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) { const bg = parse(getComputedStyle(e).backgroundColor); if (bg && bg.a > 0) { chain.push(bg); if (bg.a === 1) break; } }
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = chain.length - 1; i >= 0; i--) acc = over(chain[i], acc);
    return acc;
  };
  const bad = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (['SCRIPT', 'STYLE', 'svg', 'use', 'path', 'symbol', 'defs'].includes(el.tagName)) return;
    if (el.closest('svg, .sr, [hidden], [aria-hidden=true]')) return;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) return;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[disabled]')) return;
    const fg = parse(cs.color); if (!fg) return;
    const bg = bgOf(el); const text = over({ ...fg, a: fg.a * (parseFloat(cs.opacity) || 1) }, bg);
    const l1 = lum(text), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need) bad.push({ text: own.map((n) => n.textContent.trim()).join(' ').slice(0, 40), cls: el.className && el.className.baseVal === undefined ? el.className : '', ratio: +ratio.toFixed(2), need });
  });
  return bad;
}

(async () => {
  const browser = await chromium.launch();
  let total = 0, checked = 0;
  for (const [w, h] of SIZES) {
    const pg = await browser.newPage({ viewport: { width: w, height: h } });
    for (const s of STATES) {
      await pg.goto('about:blank'); await pg.goto(URL + s.h);
      if (s.run) { try { await s.run(pg); } catch (e) { console.log('  (state step skipped at ' + w + ': ' + s.n + ': ' + e.message.split('\n')[0] + ')'); } }
      await pg.waitForTimeout(120);
      const bad = await pg.evaluate(inPage); checked++;
      bad.forEach((b) => console.log('FAIL', w + 'x' + h, s.n, JSON.stringify(b)));
      total += bad.length;
    }
    await pg.close();
  }
  await browser.close();
  console.log(total === 0 ? 'Contrast: 0 failures in ' + checked + ' state/size combinations.' : 'Contrast: ' + total + ' failures.');
  process.exit(total ? 1 : 0);
})();
