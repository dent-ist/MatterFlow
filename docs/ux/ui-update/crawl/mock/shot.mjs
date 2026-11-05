// Screenshot helper for the mock stack. Usage: node shot.mjs <outDir> <name> [baseUrl=http://localhost:4293]
// Edit the SCENARIOS below or import { openApp } from another script. Needs: node server.mjs (API mock), `ng serve --port 4293 --proxy-config proxy.json`,
// CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome. The app signs in with the stub scenario (director).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../../frontend/package.json', import.meta.url).pathname);
const { chromium } = require('@playwright/test');

export const SIZES = [[1366, 768], [1920, 1080]];
export async function openApp(browser, w, h, base = 'http://localhost:4293') {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  return { ctx, page, base };
}
export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
}
