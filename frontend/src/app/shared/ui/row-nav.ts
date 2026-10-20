import {
  DestroyRef,
  Directive,
  booleanAttribute,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { SkipTarget } from '../layout/skip-target';
import { ShortcutRegistry } from '../layout/shortcut-registry';
import { DrillReturn } from '../work-queue/drill';

/**
 * The router state of a link that goes back to a list or a record: the page it lands on puts keyboard focus where the person left
 * (`DrillReturn`, #281). Pass it as `[state]` on a `routerLink`.
 */
export const RETURN_STATE = { restoreFocus: true } as const;

/** Whether a click is a plain left click that opens the link in this tab (not a new tab or window, not a download). */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/**
 * The name link of a list row (#281, #282). It carries the list and the row key as `data-row-list` / `data-row-key`, remembers the row
 * when it is used (so Back puts focus on this link again, see `restoreRowFocus`) and is the place from which the right arrow reaches the
 * row's copy button (`mf-copy-button` with `rowStop`), which is not a Tab stop of its own.
 *
 *   <a class="pg-link pg-name" [routerLink]="..." mfRowLink="clients" [rowKey]="c.clientId">...</a>
 *
 * Task Detail (T9) uses the same directive on the task links of the Matter and Project Tasks grids with its own list id.
 */
@Directive({
  selector: 'a[mfRowLink]',
  host: {
    '[attr.data-row-list]': 'mfRowLink() || null',
    '[attr.data-row-key]': 'mfRowLink() ? rowKey() : null',
    '(click)': 'onClick($event)',
    '(keydown)': 'onKey($event)',
  },
})
export class RowLink {
  private readonly drill = inject(DrillReturn);
  /** The list the row belongs to (`clients`, `matters`, ...); empty switches the directive off. */
  readonly mfRowLink = input.required<string>();
  /** The row's key (the record id). */
  readonly rowKey = input.required<string | number>();

  protected onClick(event: MouseEvent): void {
    if (this.mfRowLink() && isPlainClick(event))
      this.drill.leaveRow(this.mfRowLink(), this.rowKey());
  }

  /** The right arrow steps to the row's copy button (it is not a Tab stop, #282); Tab goes on to the next row's link as usual. */
  protected onKey(event: KeyboardEvent): void {
    if (
      event.key !== 'ArrowRight' ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }
    const link = event.currentTarget as HTMLElement;
    const stop = link
      .closest('tr, li')
      ?.querySelector<HTMLElement>('[data-row-stop]:not([disabled])');
    if (!stop) return;
    event.preventDefault();
    stop.focus();
  }
}

/**
 * A link of a list row that is not the row's name and not a Tab stop (TY-K, #413): the count links of the Administration lists ("2
 * workflows", "5 open tasks", "Open draft v3"). The row keeps two Tab stops, the name and the row's menu; the right arrow on the name
 * (`RowLink`) steps to the first of these links, the right and left arrows move between them, Shift+Tab or the left arrow past the
 * first comes back to the name, and Tab goes on to what follows the row's name. The same pages are one click away on the record, so no
 * action depends on this stop. Same model as the Copy button of Clients (`mf-copy-button` with `rowStop`).
 *
 *   <a mfRowStop routerLink="/admin/workflows">3</a>
 */
@Directive({
  selector: 'a[mfRowStop]',
  host: {
    '[attr.tabindex]': 'on() ? -1 : null',
    '[attr.data-row-stop]': "on() ? '' : null",
    '(keydown)': 'onKey($event)',
  },
})
export class RowStop {
  /** False puts the link back into the Tab order (a page that shows the same link outside a row). */
  readonly on = input(true, { alias: 'mfRowStop', transform: booleanAttribute });

  protected onKey(event: KeyboardEvent): void {
    if (!this.on() || event.ctrlKey || event.altKey || event.metaKey) return;
    const forward = event.key === 'Tab' && !event.shiftKey;
    const back = event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey);
    const next = event.key === 'ArrowRight';
    if (!forward && !back && !next) return;
    if (event.shiftKey && event.key !== 'Tab') return;
    const here = event.currentTarget as HTMLElement;
    const row = here.closest('tr, li');
    const link = row?.querySelector<HTMLElement>('a[data-row-key]');
    if (!row || !link) return;
    const stops = Array.from(row.querySelectorAll<HTMLElement>('[data-row-stop]:not([disabled])'));
    const at = stops.indexOf(here);
    if (next) {
      const target = stops[at + 1];
      if (!target) return;
      event.preventDefault();
      target.focus();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      (stops[at - 1] ?? link).focus();
      return;
    }
    // Tab and Shift+Tab: the name link is the row's place in the Tab order; from there the browser goes on (forward) or has come from (back).
    if (back) event.preventDefault();
    link.focus();
  }
}

/** The row link of `list` for `key`, in the page (compared, not selected: a key is data). */
function rowLink(list: string, key: string): HTMLElement | null {
  const links = document.querySelectorAll<HTMLElement>('a[data-row-key]');
  return (
    Array.from(links).find(
      (a) => a.getAttribute('data-row-list') === list && a.getAttribute('data-row-key') === key,
    ) ?? null
  );
}

/** Puts focus on the page heading (the fallback when the row is gone). */
function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>('[data-page-title]');
  heading?.setAttribute('tabindex', '-1');
  heading?.focus();
}

/**
 * Back from a record to a list (#281): once the list has its rows (`ready()` turns true), focus goes to the name link of the row the
 * person left; when that row is not on the page any more (a filter changed, the record was deleted) it goes to the list heading. Nothing
 * happens when the list was not reached by a return (a forward visit, a reload, a different list). No scroll jump beyond `nearest`.
 * Call it in the list's constructor (`list` may be a function when the id depends on an input). `fallback` may name a better place than the heading for a row that is not there (the toggle of a
 * collapsed group that holds it).
 *
 *   restoreRowFocus('clients', () => this.state() === 'ready');
 */
export function restoreRowFocus(
  listId: string | (() => string),
  ready: () => boolean,
  fallback?: (key: string) => HTMLElement | null,
): void {
  const drill = inject(DrillReturn);
  const injector = inject(Injector);
  let handled = false;
  effect(() => {
    if (handled || !ready()) return;
    handled = true;
    // A list whose id is known only once its inputs are set (a table that serves a Matter and a Project) passes a function.
    const list = untracked(() => (typeof listId === 'function' ? listId() : listId));
    const key = untracked(() => drill.takeRow(list));
    if (key === null) return;
    afterNextRender(
      () => {
        const link = rowLink(list, key);
        if (!link) {
          const near = fallback?.(key);
          if (near) near.focus();
          else focusHeading();
          return;
        }
        link.focus({ preventScroll: true });
        link.scrollIntoView({ block: 'nearest' });
      },
      { injector },
    );
  });
}

/**
 * Back to a record page (#281): once the record is on screen, focus goes to its selected tab button, unless the person left a row of a
 * list inside the page (`ownLists`: that list focuses its own row). Call it in the record page's constructor.
 */
export function restoreTabFocus(ready: () => boolean, ownLists: readonly string[]): void {
  const drill = inject(DrillReturn);
  const injector = inject(Injector);
  let handled = false;
  effect(() => {
    if (handled || !ready()) return;
    handled = true;
    if (!untracked(() => drill.takeTab(ownLists))) return;
    afterNextRender(
      () =>
        document
          .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?.focus({ preventScroll: true }),
      { injector },
    );
  });
}

/**
 * "Skip to table" (#283): the page's first Tab stop, ahead of "Skip to main content". It moves focus to the first row's name link, or to
 * the empty, error or no-access message when there is no row. The `?` help lists it (and, with `copyButton`, the right arrow to a row's
 * copy button). Call it in the list component's constructor (the
 * component's own element holds the list).
 */
export function registerTableSkip(
  options: { copyButton?: boolean; rowLinks?: boolean } = {},
): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef);
  const skip = inject(SkipTarget);
  const shortcuts = inject(ShortcutRegistry);
  const off = [
    skip.register({
      label: 'Skip to table',
      element: host.nativeElement,
      focus: () => {
        const root = host.nativeElement;
        const target =
          root.querySelector<HTMLElement>('a[data-row-key], tbody a.pg-name, li.rc a[href]') ??
          root.querySelector<HTMLElement>(
            '[data-empty], [data-error], [data-forbidden], [data-no-access]',
          ) ??
          root.querySelector<HTMLElement>('[tabindex="0"], .mf-table-wrap');
        if (!target) return;
        if (!target.matches('a, button, [tabindex]')) target.setAttribute('tabindex', '-1');
        target.focus();
      },
    }),
    shortcuts.register({
      id: 'skip-table',
      group: 'page',
      keys: ['Tab'],
      does: 'On Clients, Matters, Projects, Task Types, Workflows, Workflow Steps and their tabs, the first stop is "Skip to table"; press Enter to land on the first row',
    }),
    ...(options.rowLinks
      ? [
          shortcuts.register({
            id: 'row-links',
            group: 'page',
            keys: ['→'],
            does: 'On a Task Types, Workflows or Workflow Steps list, step from a name to the counts and the draft link of its row (Tab skips them); ← comes back',
          }),
        ]
      : []),
    ...(options.copyButton
      ? [
          shortcuts.register({
            id: 'row-copy',
            group: 'page',
            keys: ['→'],
            does: 'On a matter name in a list, step to its Copy button (Tab skips it); ← or Shift + Tab comes back',
          }),
        ]
      : []),
  ];
  inject(DestroyRef).onDestroy(() => off.forEach((fn) => fn()));
}
