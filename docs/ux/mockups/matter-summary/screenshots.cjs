const { chromium } = require('playwright');
// One lightweight Chromium launch, no test runner. Writes screenshots/<view>-<size>.png.
// Run: node docs/ux/mockups/matter-summary/screenshots.cjs [outDir]   (needs a global `playwright` install)
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const base = 'file://' + path.resolve(__dirname) + '/index.html';
const SIZES = ['1920x1080', '1366x768', '1366x600', '375x812'];
// Before reproduces today's page with the owner's data (raw account names, dn=0); Recommended uses display names.
const JOBS = [];
for (const s of SIZES) {
  JOBS.push({ name: 'before-' + s, vp: s, hash: 'mode=before&dn=0&cf=4' });
  JOBS.push({ name: 'recommended-' + s, vp: s, hash: 'mode=rec&cf=4' });
}
JOBS.push({ name: 'recommended-12-custom-fields-1366x768', vp: '1366x768', hash: 'mode=rec&cf=12&assets=6' });
JOBS.push({ name: 'recommended-raw-names-1366x768', vp: '1366x768', hash: 'mode=rec&dn=0&sec=none&cf=0&sens=0&ai=no&act=3&assets=1' });
JOBS.push({ name: 'recommended-loading-1366x768', vp: '1366x768', hash: 'mode=rec&load=loading' });
JOBS.push({ name: 'recommended-error-1366x768', vp: '1366x768', hash: 'mode=rec&load=error' });
JOBS.push({ name: 'recommended-tablet-768x1024', vp: '768x1024', hash: 'mode=rec&cf=12' });
(async () => {
  const b = await chromium.launch();
  for (const j of JOBS) {
    const [w, h] = j.vp.split('x').map(Number);
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    pg.on('pageerror', (e) => console.log('ERR', j.name, String(e)));
    await pg.goto(base + '#' + j.hash + '&tb=0'); await pg.reload(); await pg.waitForTimeout(250);
    await pg.screenshot({ path: path.join(OUT, j.name + '.png') });
    await pg.close();
  }
  await b.close();
})();
