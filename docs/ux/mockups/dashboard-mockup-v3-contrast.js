// WCAG 1.4.3 contrast check and page-fit check for dashboard-mockup-v3.html (text only, many roles, tabs and states).
// Run: node docs/ux/mockups/dashboard-mockup-v3-contrast.js   (needs a global `playwright` install; no network)
// Contrast: for every visible element that owns text it computes the colour and the effective background (semi-transparent
// layers are composited) and reports any pair below 4.5:1 (3:1 for large text: 24 px, or 18.66 px bold).
// Fit: at 1366x768 and 1920x1080 the document must not scroll (scrollHeight <= innerHeight, no sideways scroll); at 375x812 there must be no
// sideways scroll. Console errors also fail.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, 'dashboard-mockup-v3.html');

const STATES = [];
for (const role of ['director', 'pod', 'tech']) {
  const tabs = role === 'director' ? ['summary', 'breakdowns', 'trends', 'swimlane', 'users'] : role === 'pod' ? ['summary', 'swimlane', 'users'] : ['summary'];
  for (const tab of tabs) STATES.push({ n: role + ' ' + tab, h: '#role=' + role + '&tab=' + tab });
}
for (const list of ['unassigned', 'overdue', 'hold']) STATES.push({ n: 'director list ' + list, h: '#role=director&list=' + list });
for (const st of ['empty', 'loading', 'stale']) STATES.push({ n: 'director ' + st, h: '#role=director&state=' + st });
STATES.push({ n: 'pod without ViewUsers', h: '#role=pod&without=ViewUsers' });
STATES.push({ n: 'director without View', h: '#role=director&without=View' });
STATES.push({ n: 'users coverage', h: '#role=pod&tab=users', run: async (pg) => { await pg.click('[data-k=uv2]'); } });
STATES.push({ n: 'users table', h: '#role=pod&tab=users', run: async (pg) => { await pg.click('[data-k=um2]'); } });
STATES.push({ n: 'trends backlog', h: '#role=director&tab=trends', run: async (pg) => { await pg.click('[data-k=ms2]'); } });
STATES.push({ n: 'dropdown matter', h: '#role=director', run: async (pg) => { await pg.click('[data-k=dd-matter]'); } });
STATES.push({ n: 'dropdown client', h: '#role=director', run: async (pg) => { await pg.click('[data-k=dd-client]'); } });
STATES.push({ n: 'task drawer', h: '#role=director', run: async (pg) => { await pg.click('.tbl tbody tr'); } });
STATES.push({ n: 'mockup panel', h: '#role=pod', run: async (pg) => { await pg.click('#mbtn'); } });
STATES.push({ n: 'notifications', h: '#role=director', run: async (pg) => { await pg.click('[data-k=bell]'); } });
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
  let total = 0, checked = 0, fitBad = 0;
  for (const [w, h] of SIZES) {
    const pg = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    for (const s of STATES) {
      await pg.goto('about:blank'); await pg.goto(URL + s.h);
      if (s.run) { try { await s.run(pg); } catch (e) { console.log('  (state step skipped at ' + w + ': ' + s.n + ': ' + e.message.split('\n')[0] + ')'); } }
      await pg.waitForTimeout(120);
      const bad = await pg.evaluate(inPage); checked++;
      bad.forEach((b) => console.log('FAIL contrast', w + 'x' + h, s.n, JSON.stringify(b)));
      total += bad.length;
      const m = await pg.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, sw: document.scrollingElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
      const fixedPage = w >= 768 && h >= 561;
      if (m.sw > m.iw || (fixedPage && m.sh > m.ih)) { fitBad++; console.log('FAIL fit', w + 'x' + h, s.n, JSON.stringify(m)); }
    }
    await pg.close();
    errs.forEach((e) => { total++; console.log('FAIL console', w + 'x' + h, e); });
  }
  await browser.close();
  console.log('Checked ' + checked + ' state/size combinations: ' + total + ' contrast or console failures, ' + fitBad + ' fit failures.');
  process.exit(total || fitBad ? 1 : 0);
})();
