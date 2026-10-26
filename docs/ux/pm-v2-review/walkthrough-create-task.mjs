// Create task from a matter, four sizes (companion of walkthrough.mjs).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve(process.env.PW ?? "frontend") + "/");
const { chromium } = require("@playwright/test");
const BASE = process.env.BASE, OUT = path.resolve(process.env.OUT);
const browser = await chromium.launch();
for (const [n, w, h] of [["1366x768",1366,768],["1920x1080",1920,1080],["768x1024",768,1024],["375x812",375,812]]) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: w, height: h }, locale: "en-US", timezoneId: "America/New_York", extraHTTPHeaders: { "X-Dev-User": process.env.PM_USER, "X-MatterFlow-Client": "web" } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/matters/1"); await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Create task/ }).first().click().catch(async () => page.getByRole("link", { name: /Create task/ }).first().click());
  await page.waitForLoadState("networkidle"); await page.waitForTimeout(600);
  fs.mkdirSync(path.join(OUT, n), { recursive: true });
  await page.screenshot({ path: path.join(OUT, n, "10-create-task-from-matter.png") });
  await ctx.close();
}
await browser.close();
