// usage: node keys.mjs <dist> <port>  -- keyboard walk of the run page, the grid, the Saved Views menu and its dialogs (API mocked)
import { boot, SIZES } from './lib.mjs';
import { createState } from './mock.mjs';
const [dist, portArg] = process.argv.slice(2);
const state = createState();
const h = await boot({ dist, port: Number(portArg), state });
const { page, base } = h;
const active = () => page.evaluate(() => {
  const e = document.activeElement;
  if (!e || e === document.body) return { tag: 'BODY' };
  const label = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim()) || e.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) || e.getAttribute('placeholder') || '';
  const data = [...e.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).slice(0, 3);
  const dlg = e.closest('[role="dialog"],[role="alertdialog"]');
  return { tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), label, data, inDialog: dlg ? (dlg.getAttribute('aria-label') || dlg.querySelector('h1,h2,h3,.p-dialog-title')?.textContent?.trim() || 'dialog') : null, inPanel: !!e.closest('[data-views-panel]'), inGrid: !!e.closest('table'), th: e.closest('th')?.getAttribute('data-col') ?? null, w: e.closest('th') ? Math.round(e.closest('th').getBoundingClientRect().width) : null };
});
const fmt = (a) => `${a.tag}${a.role ? `[${a.role}]` : ''} "${a.label ?? ''}"${a.th ? ` (th ${a.th} w=${a.w})` : ''}${a.inDialog ? ` {dialog: ${a.inDialog}}` : ''}${a.inPanel ? ' {views panel}' : ''}`;
const out = [];
const log = (s) => { console.log(s); out.push(s); };

async function tabWalk(title, max, stopWhen) {
  log(`\n== ${title}`);
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    const a = await active();
    log(`${String(i).padStart(2)}. ${fmt(a)}`);
    if (stopWhen?.(a)) break;
  }
}

await page.setViewportSize(SIZES[0]);
await page.goto(base + '/reports/5');
await page.locator('[data-param="MAX"]').waitFor();
await page.waitForLoadState('networkidle');
// start at the page content: focus the document, skip the shell by pressing the skip link if present
await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
await tabWalk('Run page: Tab order from the top of the page (form)', 40, (a) => a.label === 'Run Report');

// fill and run
await page.locator('[data-param="CLIENT"] input[role="combobox"]').fill('acme');
await page.getByRole('option', { name: /Acme/ }).click();
await page.getByRole('button', { name: 'Run Report' }).click();
await page.locator('tbody tr[data-record-id]').first().waitFor();
await page.waitForLoadState('networkidle');

// grid: stops inside thead
log('\n== Grid: focusable elements per heading');
const perTh = await page.evaluate(() => [...document.querySelectorAll('thead tr:first-child th')].map((th) => ({ col: th.getAttribute('data-col'), focusables: [...th.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter((e) => e.tabIndex >= 0 && !e.disabled).map((e) => (e.getAttribute('aria-label') || e.textContent.trim() || e.tagName).slice(0, 30)) })));
for (const t of perTh) log(`${t.col}: ${t.focusables.length} tab stop(s): ${t.focusables.join(' | ')}`);

// walk from the first heading
await page.locator('thead tr:first-child th button').first().focus();
log('\n== Grid: Tab walk from the first heading');
for (let i = 1; i <= 14; i++) {
  await page.keyboard.press('Tab');
  const a = await active();
  log(`${String(i).padStart(2)}. ${fmt(a)}`);
}
// resize with Shift+Arrow
log('\n== Grid: resize with Shift+Arrow on a focused heading');
const th = page.locator('thead tr:first-child th').nth(1);
await th.locator('button').first().focus();
const w = async () => Math.round((await th.boundingBox()).width);
const w0 = await w();
for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
const w1 = await w();
for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
const w2 = await w();
log(`width start=${w0} after 3x Shift+Right=${w1} after 6x Shift+Left=${w2}; focus still on heading: ${(await active()).th}`);
for (let i = 0; i < 80; i++) await page.keyboard.press('Shift+ArrowLeft');
log(`after 80x Shift+Left (min) = ${await w()}`);
for (let i = 0; i < 200; i++) await page.keyboard.press('Shift+ArrowRight');
log(`after 200x Shift+Right (max) = ${await w()}`);
// plain arrow does not resize or move
const w3 = await w();
await page.keyboard.press('ArrowRight');
log(`plain ArrowRight leaves width ${w3} -> ${await w()}`);

// Saved Views menu by keyboard
log('\n== Saved Views menu');
await page.locator('[data-views-trigger]').focus();
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.waitForTimeout(200);
log(`after Enter: focus = ${fmt(await active())}; aria-expanded=${await page.locator('[data-views-trigger]').getAttribute('aria-expanded')}`);
for (let i = 1; i <= 3; i++) { await page.keyboard.press('Tab'); log(`   Tab ${i}: ${fmt(await active())}`); }
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
log(`Esc from inside the panel: panel open=${await page.locator('[data-views-panel]').count()}, focus = ${fmt(await active())}`);
// Esc with focus still on the trigger
await page.locator('[data-views-trigger]').focus();
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
log(`Esc with focus on the trigger: panel open=${await page.locator('[data-views-panel]').count()}, focus = ${fmt(await active())}`);
// Walk past the end of the panel: does the panel close when focus leaves?
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
await page.waitForTimeout(250);
log(`Tab past the last item: panel open=${await page.locator('[data-views-panel]').count()}, focus = ${fmt(await active())}`);
await page.locator('[data-views-trigger]').focus();

// Save as new dialog
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.locator('[data-view-save-new]').focus();
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(300);
log('\n== Save View dialog');
log(`after open: focus = ${fmt(await active())}`);
for (let i = 1; i <= 6; i++) { await page.keyboard.press('Tab'); log(`   Tab ${i}: ${fmt(await active())}`); }
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
await page.waitForTimeout(250);
log(`after Esc: dialogs=${await page.getByRole('dialog').count()}, focus = ${fmt(await active())}`);

// Rename via keyboard
await page.locator('[data-views-trigger]').focus();
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.locator('[data-view-row]').first().locator('[data-view-apply]').focus();
log('\n== Rename dialog (keyboard)');
await page.keyboard.press('Tab');
log(`Tab from the view row: focus = ${fmt(await active())}`);
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(300);
log(`after open: focus = ${fmt(await active())}`);
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
await page.waitForTimeout(250);
log(`after Esc: focus = ${fmt(await active())}`);

// Delete confirm
await page.locator('[data-views-trigger]').focus();
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor().catch(() => {});
const row = page.locator('[data-view-row]').first();
await row.locator('[data-view-apply]').focus().catch(() => {});
await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
log('\n== Delete confirm (keyboard)');
log(`on: ${fmt(await active())}`);
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(300);
log(`after open: focus = ${fmt(await active())}`);
for (let i = 1; i <= 4; i++) { await page.keyboard.press('Tab'); log(`   Tab ${i}: ${fmt(await active())}`); }
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
await page.waitForTimeout(250);
log(`after Esc: focus = ${fmt(await active())}`);
// Success paths: save a new view with Enter in the field, then rename with Enter, then delete with Enter on the confirm button
log('\n== Dialog success paths (focus after the action)');
await page.locator('[data-views-trigger]').focus();
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.locator('[data-view-save-new]').focus();
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(300);
await page.keyboard.type(' two');
await page.keyboard.press('Enter');
await page.getByRole('dialog').waitFor({ state: 'detached' }).catch(() => {});
await page.waitForTimeout(600);
log(`after Save View with Enter: focus = ${fmt(await active())}`);
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
log(`menu choose: Enter, Tab, Enter on Default -> focus after`);
await page.keyboard.press('Enter');
await page.locator('[data-views-panel]').waitFor();
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
log(`after choosing a view: focus = ${fmt(await active())}`);
console.log('errors:', h.errors.slice(0, 5));
await h.close();
