import { Injector, afterNextRender, effect, inject, untracked } from '@angular/core';

/** True while a PrimeNG dialog (or its closing animation) is still in the page. */
function dialogShown(): boolean {
  return !!document.querySelector('.p-dialog-mask');
}

/** Runs `fn` once no dialog is in the page any more (the dialog's own focus trap would take focus back); gives up after 1.5 s. */
function whenDialogGone(fn: () => void): void {
  if (!dialogShown()) {
    setTimeout(fn, 0);
    return;
  }
  const watcher = new MutationObserver(() => {
    if (dialogShown()) return;
    watcher.disconnect();
    clearTimeout(giveUp);
    setTimeout(fn, 0);
  });
  const giveUp = setTimeout(() => {
    watcher.disconnect();
    fn();
  }, 1500);
  watcher.observe(document.body, { childList: true, subtree: true });
}

function focusIt(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (!target.matches('a, button, input, select, textarea, [tabindex]')) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus();
  return true;
}

/** The status badge of the page title (Active, Published, Draft v4, ...), the heading when there is none. */
function statusTarget(prefer?: string): HTMLElement | null {
  return (
    (prefer ? document.querySelector<HTMLElement>(prefer) : null) ??
    document.querySelector<HTMLElement>('[data-page-title] mf-badge') ??
    document.querySelector<HTMLElement>('[data-page-title]')
  );
}

/**
 * The one rule after a successful action on a record, a version or a form (TY-K, #414): focus goes to the status badge in the page title
 * (the heading when the page has none), because the control that was used (the menu entry, the dialog button) is gone or changed its
 * meaning; the polite live region of the page has already said what happened ("Published v3"). A failure never calls this: focus stays
 * in the dialog, whose message is a `role="alert"` (`mf-confirm-dialog [error]`). Call it right after the page state changed; it waits
 * for the page to render and for a closing dialog to leave. `prefer` names the badge that changed when it is not the one in the title
 * (the workflow's "Published v2" badge after a version was retired).
 */
export function focusStatusAfterAction(injector: Injector, prefer?: string): void {
  afterNextRender(() => whenDialogGone(() => focusIt(statusTarget(prefer))), { injector });
}

/**
 * The same rule for a row of a list (#414). `menuLabel` is the accessible name of the row's menu button ("Actions for Billing"), the
 * control that was used: when the row is still listed (Show all, or a record that stays in the result) focus goes back to that button,
 * and when the row has left the result (a deactivated record under the default Active filter) the opener is gone, so focus goes to the
 * page heading instead of the page body or another row.
 */
export function focusListAfterAction(injector: Injector, menuLabel: string): void {
  afterNextRender(
    () =>
      whenDialogGone(() => {
        const opener = Array.from(
          document.querySelectorAll<HTMLElement>('main button[aria-label]'),
        ).find((b) => b.getAttribute('aria-label') === menuLabel);
        focusIt(opener ?? document.querySelector<HTMLElement>('[data-page-title]'));
      }),
    { injector },
  );
}

interface Pending {
  prefer?: string;
  at: number;
}
let pending: Pending | null = null;

/**
 * A successful action is about to open another page (Publish and Discard draft go to the workflow, Create new draft to the new draft):
 * that page puts focus on its status badge once it has loaded (`restoreStatusFocus`, #414). The request expires after 10 seconds.
 */
export function expectStatusFocus(prefer?: string): void {
  pending = { prefer, at: Date.now() };
}

/**
 * Call in the constructor of a page an action may open. `ready()` is falsy while the page loads and a value that identifies what is
 * shown once it is there (the record's state, or the version's id for a page that is reused for the next version): each time it
 * changes to a new truthy value, a fresh request from `expectStatusFocus` is taken and focus moves to the status badge.
 */
export function restoreStatusFocus(ready: () => unknown): void {
  const injector = inject(Injector);
  let last: unknown = null;
  effect(() => {
    const now = ready();
    if (!now || now === last) return;
    last = now;
    const request = pending;
    pending = null;
    if (!request || Date.now() - request.at > 10_000) return;
    untracked(() => focusStatusAfterAction(injector, request.prefer));
  });
}
