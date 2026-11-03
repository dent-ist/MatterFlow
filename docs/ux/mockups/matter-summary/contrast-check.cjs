// WCAG 1.4.3 contrast check for index.html (text only), many states, three window sizes, Before and Recommended.
// Same engine as ../matter-detail/contrast-check.cjs (composites semi-transparent layers; 4.5:1, 3:1 for large text).
// Run: node docs/ux/mockups/matter-summary/contrast-check.cjs   (needs a global `playwright` install; no network)
const { chromium } = require('playwright');
const path = require('path');
const base = 'file://' + path.resolve(__dirname) + '/index.html';
const VARIANTS = {
  'default': '',
  'many-fields-raw-names-no-sens': '&cf=12&dn=0&sens=0&ai=no&sec=none&assets=6',
  'company-ai-few-rows': '&ai=company&act=3&assets=1&total=0',
  'loading': '&load=loading',
  'error': '&load=error',
  'empty-assets-no-activity': '&assets=0&act=0&edit=0',
  'edit-dialog': '&open=edit',
  'pm-dialog': '&open=pm',
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
    for (const mode of ['rec', 'before']) {
      for (const [n, q] of Object.entries(VARIANTS)) {
        await pg.goto(base + '#mode=' + mode + q + '&tb=0'); await pg.reload(); await pg.waitForTimeout(150);
        const bad = await pg.evaluate(inPage); checked++;
        bad.forEach((b) => console.log('FAIL', w + 'x' + h, mode, n, JSON.stringify(b)));
        total += bad.length;
      }
    }
    await pg.close();
  }
  await browser.close();
  console.log(total === 0 ? 'Contrast: 0 failures in ' + checked + ' state/size combinations.' : 'Contrast: ' + total + ' failures.');
  process.exit(total ? 1 : 0);
})();
