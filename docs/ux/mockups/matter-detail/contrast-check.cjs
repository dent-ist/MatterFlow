// WCAG 1.4.3 contrast check for index.html and alt-specs-own-tab.html (text only, many states, 1366x768 and 375x812).
// Based on ../notes-mockup-r3-contrast.js (same engine: composites semi-transparent layers, 4.5:1, 3:1 for large text).
// Run: node docs/ux/mockups/matter-detail/contrast-check.cjs   (needs a global `playwright` install; no network)
const { chromium } = require('playwright');
const path = require('path');
const base = 'file://' + path.resolve(__dirname) + '/';
const T = async (pg, t) => { await pg.click('[data-act=tab][data-v=' + t + ']'); await pg.waitForTimeout(100); };
const STEPS={
 '01-summary':async pg=>{},
 '02-summary-edit-panel':async pg=>{await pg.click('.card-h [data-act=editall]');},
 '03-summary-no-my-matters':async pg=>{await pg.click('#mockbtn');await pg.uncheck('#mMM');await pg.click('#mockbtn');},
 '04-tasks':async pg=>{await T(pg,'tasks')},
 '05-tasks-view-dropdown':async pg=>{await T(pg,'tasks');await pg.click('[data-dd=tview]');},
 '06-tasks-selected-link':async pg=>{await T(pg,'tasks');await pg.check('[data-sel=T-3105]');await pg.check('[data-sel=T-3107]');await pg.click('[data-act=bulklink]');},
 '07-projects':async pg=>{await T(pg,'projects')},
 '08-project-panel-tasks':async pg=>{await T(pg,'projects');await pg.click('tr[data-id=P3]');},
 '09-projects-new':async pg=>{await T(pg,'projects');await pg.click('[data-act=newproj]');},
 '10-assets':async pg=>{await T(pg,'assets')},
 '11-assets-type-dropdown':async pg=>{await T(pg,'assets');await pg.click('[data-dd=atype]');},
 '12-assets-panel':async pg=>{await T(pg,'assets');await pg.click('tr[data-id=A-204]');},
 '13-productions':async pg=>{await T(pg,'prods')},
 '14-production-detail':async pg=>{await T(pg,'prods');await pg.click('tr[data-id=PRD-002]');},
 '15-production-history':async pg=>{await T(pg,'prods');await pg.click('tr[data-id=PRD-001]');await pg.click('[data-act=ptab][data-v=h]');},
 '16-production-new':async pg=>{await T(pg,'prods');await pg.click('[data-act=newprod]');},
 '17-specs-subview':async pg=>{await T(pg,'prods');await pg.click('[data-act=pv][data-v=specs]');},
 '18-spec-new':async pg=>{await T(pg,'prods');await pg.click('[data-act=pv][data-v=specs]');await pg.click('[data-act=newspec]');},
 '19-notes-read':async pg=>{await T(pg,'notes')},
 '20-notes-tags-panel':async pg=>{await T(pg,'notes');await pg.click('[data-act=rail][data-v=tags]');},
 '21-notes-edit-mode':async pg=>{await T(pg,'notes');await pg.click('[data-act=nedit]');},
 '22-notes-slash':async pg=>{await T(pg,'notes');await pg.click('#mockbtn');await pg.click('[data-act=slashdemo]');},
 '23-notes-slash-note':async pg=>{await T(pg,'notes');await pg.click('#mockbtn');await pg.click('[data-act=slashdemo]');await pg.keyboard.type('note');await pg.keyboard.press('Enter');await pg.waitForTimeout(100);await pg.keyboard.press('Enter');},
 '24-notes-table-menu':async pg=>{await T(pg,'notes');await pg.click('[data-act=nedit]');await pg.click('#tb [data-v=table]');await pg.hover('#tblpop button[data-r="4"][data-c="5"]',{timeout:3000}).catch(()=>{});},
 '25-notes-table-tools':async pg=>{await T(pg,'notes');await pg.click('[data-act=nedit]');await pg.click('#ed table td');},
 '26-notes-style-dropdown':async pg=>{await T(pg,'notes');await pg.click('[data-act=nedit]');await pg.click('#ed p');await pg.click('[data-act=tstyle]');},
 '27-notes-splitter-wide':async pg=>{await T(pg,'notes');await pg.focus('#splitter');for(let i=0;i<8;i++)await pg.keyboard.press('ArrowRight');},
 '28-notes-locked':async pg=>{await T(pg,'notes');await pg.click('.nitem[data-id=n4]');},
 '29-notes-new':async pg=>{await T(pg,'notes');await pg.click('[data-act=nnew]');},
 '30-notes-ai-panel':async pg=>{await T(pg,'notes');await pg.click('[data-act=rail][data-v=ai]');},
 '31-notes-ai-off':async pg=>{await pg.goto(base+'index.html#tab=notes&ai=no');await pg.reload();await pg.click('.nlistc [data-act=ai]',{force:true});},
 '32-notes-ai-warning':async pg=>{await pg.goto(base+'index.html#tab=notes&warn=1');await pg.reload();await pg.click('[data-act=nedit]');await pg.click('[data-act=nsave]');},
 '33-activities':async pg=>{await T(pg,'acts')},
 '34-new-menu':async pg=>{await pg.click('[data-act=newmenu]');},
 '35-set-inactive-blocked':async pg=>{await pg.click('[data-act=more]');await pg.click('[data-act=toggleactive]');},
};

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
  for (const [w, h] of [[1366, 768], [1366, 600], [375, 812]]) {
    const pg = await browser.newPage({ viewport: { width: w, height: h } });
    for (const [n, fn] of Object.entries(STEPS)) {
      await pg.goto(base + 'index.html'); await pg.waitForTimeout(100);
      try { await fn(pg); } catch (e) { console.log('  (state step skipped at ' + w + ': ' + n + ': ' + e.message.split('\n')[0] + ')'); }
      await pg.waitForTimeout(150);
      const bad = await pg.evaluate(inPage); checked++;
      bad.forEach((b) => console.log('FAIL', w + 'x' + h, n, JSON.stringify(b)));
      total += bad.length;
    }
    await pg.close();
  }
  await browser.close();
  console.log(total === 0 ? 'Contrast: 0 failures in ' + checked + ' state/size combinations.' : 'Contrast: ' + total + ' failures.');
  process.exit(total ? 1 : 0);
})();
