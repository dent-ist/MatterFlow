import { createRequire } from 'module';
const require = createRequire('/home/user/wt-mycalm/frontend/package.json');
export const { chromium } = require('@playwright/test');
export const BASE = 'http://127.0.0.1:5611';
export const USERS = { pm1: 'KE\\testuser35', pm3: 'KE\\testuser19', pm5: 'KE\\testuser03' };
export const VIEWS = { '1366x768': [1366, 768], '1920x1080': [1920, 1080], '768x1024': [768, 1024], '375x812': [375, 812] };
export async function launch() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
}
export async function ctx(browser, user, view, extra = {}) {
  const [w, h] = VIEWS[view];
  const c = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'X-Dev-User': USERS[user] }, ...extra });
  const p = await c.newPage();
  return { c, p };
}
export async function settle(p, ms = 1500) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(ms);
}
