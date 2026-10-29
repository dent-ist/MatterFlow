// Navigation panel screenshots for MM-43 / MM-44 (#939, #940): node navShots.mjs (MF_BASE = origin of the running app, Dev auth).
// MM-58 / MM-59 (#950, #951): the dark navy panel and the new menu order; earlier looks stay as nav-before-*, nav-after-* (bar) and nav-pill-*. "dark" sets data-theme="dark"
// on <html> (the app has no dark theme yet; only the nav tokens react to it, so the page stays light).
import { launch, BASE } from './lib.mjs';
const SIZES = { '1366x768': [1366, 768], '768x1024': [768, 1024], '375x812': [375, 812] };
const OLD = `.mf-nav{--mf-nav-bg:#fff;--mf-nav-hover-bg:#EEF0F4;--mf-nav-selected-bg:#E3ECFA;--mf-nav-border:#C9CED8;--mf-nav-text-muted:#4B5563}
.mf-nav a.mf-active,.mf-nav .mf-nav-morebtn.mf-active{box-shadow:none!important}.mf-nav-version{display:none!important}`;
const out = new URL('./', import.meta.url).pathname;
const browser = await launch();
for (const [size, [w, h]] of Object.entries(SIZES)) {
  for (const theme of ['light', 'dark']) {
    for (const variant of ['navy']) {
      if (variant === 'before' && theme === 'dark') continue;
      const c = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await c.newPage();
      await p.goto(BASE + '/dashboard');
      await p.waitForLoadState('networkidle').catch(() => {});
      if (variant === 'before') await p.addStyleTag({ content: OLD });
      if (theme === 'dark') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      if (w < 640) await p.getByRole('button', { name: 'Menu', exact: true }).click();
      await p.waitForTimeout(600);
      const name = `nav-${variant}-${theme}-${size}`;
      await p.screenshot({ path: `${out}${name}.png` });
      if (variant === 'navy' && w >= 1366) {
        const link = p.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Clients' });
        await link.hover();
        await p.screenshot({ path: `${out}nav-navy-${theme}-hover-${size}.png` });
        await p.mouse.move(700, 400);
        await p.keyboard.press('Tab');
        for (let i = 0; i < 12; i++) {
          const inNav = await p.evaluate(() => !!document.activeElement?.closest('.mf-nav'));
          if (inNav) break;
          await p.keyboard.press('Tab');
        }
        await p.screenshot({ path: `${out}nav-navy-${theme}-focus-${size}.png` });
      }
      await c.close();
    }
  }
}
await browser.close();
