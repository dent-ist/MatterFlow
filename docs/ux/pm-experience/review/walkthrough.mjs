// PM experience review (#787): walks the running product as a Project Manager through four day-in-the-life scenarios at four sizes.
//
//   BASE=http://127.0.0.1:5391 PM_USER='ke\e2e-pm-a' OUT=docs/ux/pm-experience/review PW=frontend node docs/ux/pm-experience/review/walkthrough.mjs
//
// Dev authentication (`X-Dev-User`). Every click the person would make goes through `rec.click`, so the click count of a step is a fact, not an
// estimate; reading the page costs no click. Screenshots go to OUT/<size>/<scenario>-<nn>-<step>.png; the numbers to OUT/walkthrough.json.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(path.resolve(process.env.PW ?? "frontend") + "/");
const { chromium } = require("@playwright/test");

const BASE = process.env.BASE ?? "http://127.0.0.1:5391";
const USER = process.env.PM_USER;
const OUT = path.resolve(process.env.OUT ?? "docs/ux/pm-experience/review");
const MATTER = process.env.MATTER_NAME ?? ""; // name fragment of the matter used in scenarios 3 and 4
const SIZES = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "375x812", width: 375, height: 812 },
];
const ONLY = process.env.ONLY_SIZE;
if (ONLY)
  SIZES.splice(0, SIZES.length, ...SIZES.filter((s) => s.name === ONLY));
if (!USER) throw new Error("PM_USER is required");

const results = [];

/** The page has stopped loading: network quiet, no loading placeholder left. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[data-loading], [aria-busy="true"]') &&
        !/Loading (deadlines|workload|trends|activity)/.test(
          document.body.innerText,
        ),
      undefined,
      { timeout: 8000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

function recorder(page, size, scenario) {
  let clicks = 0;
  let n = 0;
  const steps = [];
  const rec = {
    steps,
    get clicks() {
      return clicks;
    },
    async click(locator, label) {
      clicks++;
      await locator.first().click({ timeout: 8000 });
      await settle(page);
      return label;
    },
    add(n) {
      clicks += n;
    },
    async shot(step, extra = {}) {
      n++;
      const dir = path.join(OUT, size.name);
      fs.mkdirSync(dir, { recursive: true });
      const file = `${scenario}-${String(n).padStart(2, "0")}-${step}.png`;
      await page.screenshot({ path: path.join(dir, file) });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      steps.push({
        step,
        clicksSoFar: clicks,
        file: `${size.name}/${file}`,
        pageOverflowPx: overflow,
        ...extra,
      });
    },
    async visibleWithoutScroll(locator) {
      const box = await locator
        .first()
        .boundingBox()
        .catch(() => null);
      return !!box && box.y + Math.min(box.height, 20) <= size.height;
    },
    note(step, text) {
      steps.push({ step, clicksSoFar: clicks, note: text });
    },
    async text(locator) {
      return (
        (await locator
          .first()
          .innerText({ timeout: 4000 })
          .catch(() => "")) || ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
    },
  };
  return rec;
}

/** Opens a main menu item the way a person does: on a phone the Menu button first (one more click). */
async function viaMenu(page, rec, size, name) {
  if (size.width < 640)
    await rec.click(
      page.getByRole("button", { name: "Menu", exact: true }),
      "Menu",
    );
  await rec.click(
    page.locator('nav[aria-label="Main"] a', {
      hasText: new RegExp(`^\\s*${name}\\s*$`),
    }),
    name,
  );
}

const scenarios = {
  // (1) Morning check: what is on fire, what changed since yesterday, who is away, what is due this week.
  async morning(page, rec, size) {
    await page.goto(BASE + "/");
    await settle(page);
    await rec.shot("landing", {
      strip: await rec.text(page.locator("mf-mm-strip")),
      sinceVisible: await rec.visibleWithoutScroll(page.locator("mf-mm-since")),
      attentionVisible: await rec.visibleWithoutScroll(
        page.locator("mf-mm-attention"),
      ),
      stripVisible: await rec.visibleWithoutScroll(page.locator("mf-mm-strip")),
    });
    rec.note("since-last-visit", await rec.text(page.locator("mf-mm-since")));
    const mark = page.getByRole("button", { name: /Mark as read/ });
    await mark
      .first()
      .waitFor({ timeout: 4000 })
      .catch(() => undefined);
    if (await mark.count()) {
      await rec.click(mark, "Mark as read");
      await rec.shot("marked-read");
    } else rec.note("mark-as-read", "no Mark as read button (nothing new)");
    for (const tab of ["deadlines", "workload", "trends", "activity"]) {
      await rec.click(
        page.locator(`[role=tab][data-tab="${tab}"]`),
        `tab ${tab}`,
      );
      await rec.shot(`tab-${tab}`, {
        text: await rec.text(page.locator("[data-mm-tabpanel]")),
      });
    }
  },

  // (2) Handling an overdue task: from the count to the task to a decision.
  async overdue(page, rec, size) {
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle");
    await rec.click(
      page.locator("mf-mm-strip a", { hasText: /Overdue/ }),
      "strip: Overdue",
    );
    await page.waitForURL(/\/tasks\?/);
    await settle(page);
    await rec.shot("overdue-list", {
      url: page.url(),
      range: await rec.text(page.locator("[data-range]")),
      scopePressed: await rec.text(
        page.locator("[data-scope][aria-pressed=true]"),
      ),
      scopeLine: await rec.text(page.locator("[data-scope-line]")),
      chips: await rec.text(
        page.locator("[data-chip], .p-chip, [data-filter-chips]"),
      ),
    });
    const first = page.locator('main a[href^="/tasks/"]');
    await rec.click(first, "open first overdue task");
    await page.waitForURL(/\/tasks\/\d+/);
    await settle(page);
    await rec.shot("task-detail", { url: page.url() });
    const labels = await page
      .locator("main button, main a[role=button]")
      .allInnerTexts();
    rec.note(
      "task-actions",
      labels
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 25)
        .join(" | "),
    );
    // The decision: who holds it and when is it due. Reassign (two clicks), then comment (three).
    const assignee = page
      .locator("[data-task-header] button, mf-task-header button")
      .filter({ hasText: /Test User/ });
    if (await assignee.count()) {
      await rec.click(assignee, "Assignee menu");
      await rec.shot("assignee-menu", {
        options: await rec.text(
          page
            .locator(
              "[role=listbox], [role=menu], .p-select-overlay, .p-popover",
            )
            .last(),
        ),
      });
      const option = page.getByText(/^\s*Test User 02/).first();
      if (await option.count()) {
        await rec.click(option, "pick another person");
        await rec.shot("reassigned", {
          toast: await rec.text(
            page.locator("[role=status], .p-toast-message").last(),
          ),
        });
      } else rec.note("reassign", "no option to pick");
    } else rec.note("reassign", "assignee is not a button");
    const commentsTab = page.getByRole("tab", { name: /^Comments/ });
    if (await commentsTab.count()) {
      await rec.click(commentsTab, "Comments tab");
      const box = page.getByRole("textbox").first();
      await rec.click(box, "focus the comment box");
      await box.fill(
        "Moved to a colleague who has room this week; client call at 3.",
      );
      await rec.shot("comment-typed");
      const post = page.getByRole("button", {
        name: /^(Add|Post|Send) comment|^Comment$|^Post$/,
      });
      if (await post.count()) {
        await rec.click(post, "post the comment");
        await rec.shot("comment-posted");
      } else rec.note("comment", "no post button found");
    }
    const matterCrumb = page
      .locator('nav[aria-label="Breadcrumb"] a, [data-crumbs] a')
      .filter({ hasText: /\d{5}-\d{5}|\d{3,}/ });
    rec.note(
      "matter-in-crumb",
      `${await matterCrumb.count()} crumb links with a matter reference`,
    );
  },

  // (3) Adding work to a matter: + New task from the matter row, then the Create task form.
  async addwork(page, rec, size) {
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle");
    await rec.shot("landing");
    await page.locator("[data-new-task]").first().scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() =>
      Math.round(
        Math.max(
          window.scrollY,
          ...[...document.querySelectorAll("*")].map((e) => e.scrollTop),
        ),
      ),
    );
    await rec.shot("health-panel", { scrolledPx: scrolled });
    await rec.click(
      page.locator("[data-new-task]").first(),
      "+ New task on the health row",
    );
    await page.waitForURL((u) => !u.pathname.startsWith("/my-matters"));
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page
      .locator("main, mf-fixed-page")
      .first()
      .evaluate((el) => el.scrollTo?.(0, 0))
      .catch(() => undefined);
    await rec.shot("create-task-chooser", {
      url: page.url(),
      text: await rec.text(page.locator("main")),
    });
    const card = page
      .locator("[role=radio], button, a")
      .filter({
        hasText: /Incoming Production Intake|General \/ Ad Hoc Request/,
      })
      .first();
    await rec.click(card, "choose a task type");
    await rec.shot("create-task-form", {
      url: page.url(),
      fields: (await page.locator("label").allInnerTexts())
        .map((t) => t.replace(/\s+/g, " ").trim())
        .slice(0, 30)
        .join(" | "),
    });
    await page
      .getByRole("textbox", { name: /^Title/ })
      .first()
      .fill("Prepare privilege log for the third production")
      .catch(() => rec.note("title", "title box not found"));
    // The required fields: requestor, category, what is needed, what drives the due date (the form's own words).
    await page
      .getByRole("textbox", { name: /^Requestor name/ })
      .first()
      .fill("Dana Reyes");
    const pick = async (label) => {
      const control = page.getByLabel(new RegExp(label)).first();
      if (!(await control.count()))
        return rec.note("pick", `${label}: no control`);
      const tag = await control.evaluate((el) => el.tagName);
      if (tag === "SELECT") {
        await control.selectOption({ index: 1 });
        rec.add(2); // open the list, choose
      } else {
        await rec.click(control, label);
        await rec.click(
          page
            .locator(".p-select-overlay li, .p-select-option, [role=option]")
            .first(),
          `${label}: first option`,
        );
      }
    };
    await pick("^Category");
    await page
      .getByRole("textbox", { name: /^What is needed/ })
      .first()
      .fill("Privilege log for the third production volume")
      .catch(() => rec.note("need", "no box"));
    await pick("driving the due date");
    await rec.shot("create-task-filled");
    const submit = page.getByRole("button", { name: /^Create task$/ });
    if (await submit.count()) {
      await rec.click(submit.last(), "Create task");
      await rec.shot("create-task-result", {
        url: page.url(),
        errors: await rec.text(
          page.locator("[data-error-summary], [role=alert]"),
        ),
      });
    }
  },

  // (4) Preparing for a client call: find the matter, read the Overview, reach tasks and assets.
  async clientcall(page, rec, size) {
    await page.goto(BASE + "/");
    await page.waitForLoadState("networkidle");
    await viaMenu(page, rec, size, "Matters");
    await rec.shot("matters-list", {
      count: await rec.text(page.locator("[data-scope-line]")),
    });
    const link = MATTER
      ? page.locator("tbody tr a, [data-record-card] a", { hasText: MATTER })
      : page.locator(
          'tbody tr a[href^="/matters/"], [data-record-card] a[href^="/matters/"]',
        );
    await rec.click(link, "open the matter");
    await page.waitForURL(/\/matters\/\d+/);
    await settle(page);
    await page
      .locator("[data-section]")
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
    const sections = {};
    for (const key of [
      "health",
      "status",
      "deadlines",
      "people",
      "assets",
      "activity",
    ]) {
      const s = page.locator(`[data-section="${key}"]`);
      sections[key] = (await s.count())
        ? {
            visibleWithoutScroll: await rec.visibleWithoutScroll(s),
            text: await rec.text(s),
          }
        : null;
    }
    await rec.shot("matter-overview", { sections });
    await page.evaluate(() => window.scrollTo(0, 0));
    await rec.click(
      page.locator("mf-record-header [data-overflow]"),
      "More actions",
    );
    await rec.shot("matter-actions-menu");
    await page.keyboard.press("Escape");
    const assetsTab = page.getByRole("tab", { name: /^Assets/ });
    await rec.click(assetsTab, "Assets tab");
    await rec.shot("matter-assets-tab");
    // The other way in: the header search by name (focus, type, choose).
    await page.goto(BASE + "/");
    await settle(page);
    const before = rec.clicks;
    if (size.width < 640)
      await rec.click(
        page.getByRole("button", { name: /Search/ }),
        "open the search",
      );
    await rec.click(
      page.getByRole("combobox", { name: /Search/ }),
      "focus the search",
    );
    await page.getByRole("combobox", { name: /Search/ }).fill("Smith");
    await page.waitForTimeout(900);
    await rec.shot("search-open", {
      options: await rec.text(page.locator("[role=listbox]")),
    });
    rec.note(
      "search-clicks",
      `search route to a matter: ${rec.clicks - before} click before choosing a result, plus 1 to choose`,
    );
  },
};

const browser = await chromium.launch({
  executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
  args: process.env.E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
});
const SQL = process.env.SQL_CONTAINER;
for (const size of SIZES) {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (SQL && name === "morning")
      execSync(
        `docker exec ${SQL} /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P 'MatterFlow_Dev1!' -d MatterFlow -Q "DELETE FROM dbo.UserMatterActivitySeen"`,
        { stdio: "ignore" },
      ); // every size starts as a first visit
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: size.width, height: size.height },
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: { "X-Dev-User": USER, "X-MatterFlow-Client": "web" },
    });
    const page = await context.newPage();
    const rec = recorder(page, size, name);
    const started = Date.now();
    let error = null;
    try {
      await fn(page, rec, size);
    } catch (e) {
      error = String(e.message).split("\n")[0];
      await rec.shot("blocked").catch(() => undefined);
    }
    results.push({
      size: size.name,
      scenario: name,
      clicks: rec.clicks,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      error,
      steps: rec.steps,
    });
    await context.close();
  }
}
await browser.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "walkthrough.json"),
  JSON.stringify(results, null, 1),
);
for (const r of results)
  console.log(
    `${r.size.padEnd(10)} ${r.scenario.padEnd(11)} clicks ${r.clicks}  ${r.error ?? "ok"}`,
  );
