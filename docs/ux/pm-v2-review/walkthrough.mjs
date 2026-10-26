// PM v2 review: walks every screen a Project Manager uses day to day at four sizes and takes one screenshot per screen.
//
//   BASE=http://127.0.0.1:5391 PM_USER='KE\testuser03' ADMIN_USER='KE\kekim' OUT=docs/ux/pm-v2-review/screenshots PW=frontend \
//     node docs/ux/pm-v2-review/walkthrough.mjs
//
// Dev authentication (`X-Dev-User`). Besides the PNGs it writes OUT/../walkthrough.json with facts per shot (page overflow in px, axe-free
// structural checks, headings, row counts) so the README can quote observed numbers.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(path.resolve(process.env.PW ?? "frontend") + "/");
const { chromium } = require("@playwright/test");

const BASE = process.env.BASE ?? "http://127.0.0.1:5391";
const PM = process.env.PM_USER ?? "KE\\testuser03";
const ADMIN = process.env.ADMIN_USER ?? "KE\\kekim";
const OUT = path.resolve(process.env.OUT ?? "docs/ux/pm-v2-review/screenshots");
const SIZES = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "375x812", width: 375, height: 812 },
].filter((s) => !process.env.ONLY_SIZE || process.env.ONLY_SIZE.split(",").includes(s.name));

const facts = [];

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[data-loading], [aria-busy="true"]') &&
        !/Loading /.test(document.body.innerText.slice(0, 600)),
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

async function shot(page, size, name, full = false) {
  const dir = path.join(OUT, size.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: full });
  const info = await page.evaluate(() => ({
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.title,
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim().replace(/\s+/g, " ")),
    scrollHeight: document.documentElement.scrollHeight,
  }));
  facts.push({ size: size.name, shot: name, url: page.url().replace(BASE, ""), ...info });
}

async function go(page, url) {
  await page.goto(BASE + url);
  await settle(page);
}

async function tryStep(label, fn) {
  try {
    await fn();
  } catch (e) {
    facts.push({ shot: label, error: String(e.message).split("\n")[0] });
  }
}

const browser = await chromium.launch();
for (const size of SIZES) {
  const mk = (user) =>
    browser.newContext({
      baseURL: BASE,
      viewport: { width: size.width, height: size.height },
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: { "X-Dev-User": user, "X-MatterFlow-Client": "web" },
    });
  const ctx = await mk(PM);
  const page = await ctx.newPage();

  // 01 My Matters, four tabs
  await go(page, "/");
  await shot(page, size, "01-my-matters-overview");
  await shot(page, size, "01b-my-matters-overview-full", true);
  for (const [n, tab] of [["02", "deadlines"], ["03", "trends"], ["04", "activity"]]) {
    await tryStep(tab, async () => {
      await go(page, `/my-matters?tab=${tab}`);
      await shot(page, size, `${n}-my-matters-${tab}`);
    });
  }
  // 05 Matters list
  await go(page, "/matters");
  await shot(page, size, "05-matters-list");
  // 06 matter record: Overview, Tasks, Assets, Details
  await tryStep("matter-record", async () => {
    const link = page.locator('a[href^="/matters/"]').first();
    await link.click();
    await settle(page);
    await shot(page, size, "06-matter-overview");
    await shot(page, size, "06b-matter-overview-full", true);
    for (const [n, tab] of [["07", "Tasks"], ["08", "Assets"], ["09", "Details"]]) {
      await tryStep(tab, async () => {
        await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).first().click();
        await settle(page);
        await shot(page, size, `${n}-matter-${tab.toLowerCase()}`);
      });
    }
    await tryStep("create-task", async () => {
      await page.getByRole("tab", { name: /^Overview/ }).first().click().catch(() => undefined);
      await page.getByRole("button", { name: /New task/ }).first().click();
      await settle(page);
      await shot(page, size, "10-create-task-from-matter");
    });
  });
  // 11 Task Queue (scoped)
  await go(page, "/tasks");
  await shot(page, size, "11-task-queue");
  // 12 Assets list and 13 record
  await go(page, "/assets");
  await shot(page, size, "12-assets-list");
  await tryStep("asset-record", async () => {
    await page.locator('a[href^="/assets/"]').first().click();
    await settle(page);
    await shot(page, size, "13-asset-record");
  });
  // 14 Clients, 15 Projects
  await go(page, "/clients");
  await shot(page, size, "14-clients-list");
  await go(page, "/projects");
  await shot(page, size, "15-projects-list");
  // 16 search as a PM
  await tryStep("search", async () => {
    await go(page, "/search?q=review");
    await shot(page, size, "16-search-results");
  });
  // 17 bell, 18 notifications page
  await go(page, "/");
  await tryStep("bell", async () => {
    await page.getByRole("button", { name: /Notifications/i }).first().click();
    await page.waitForTimeout(500);
    await shot(page, size, "17-notification-bell");
    await page.keyboard.press("Escape");
  });
  await go(page, "/notifications");
  await shot(page, size, "18-notifications-page");
  // 19 menu
  await go(page, "/");
  await tryStep("menu", async () => {
    if (size.width < 640) {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.waitForTimeout(400);
    }
    await shot(page, size, "19-menu");
  });
  await ctx.close();

  // Administrator: the Task Type pages the new design changes
  const actx = await mk(ADMIN);
  const apage = await actx.newPage();
  await tryStep("admin-task-types", async () => {
    await go(apage, "/admin/task-types");
    await shot(apage, size, "20-admin-task-types");
    await apage.locator('a[href^="/admin/task-types/"]').first().click();
    await settle(apage);
    await shot(apage, size, "21-admin-task-type-edit");
    await shot(apage, size, "21b-admin-task-type-edit-full", true);
  });
  await tryStep("admin-asset-types", async () => {
    await go(apage, "/admin/asset-types");
    await shot(apage, size, "22-admin-asset-types");
  });
  await actx.close();
}
await browser.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(path.join(path.dirname(OUT), process.env.FACTS ?? "walkthrough.json"), JSON.stringify(facts, null, 1));
console.log(`${facts.length} records; errors: ${facts.filter((f) => f.error).length}`);
