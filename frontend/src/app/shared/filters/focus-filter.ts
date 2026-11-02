import {
  Directive,
  HostListener,
  Injector,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardShortcuts } from '../layout/keyboard-shortcuts';
import { FOCUS_FILTER_SHORTCUT, ShortcutRegistry, isShortcut } from '../layout/shortcut-registry';
import { ListFilters } from './list-filters';

/**
 * What every filter bar of a list does about the existing `/` shortcut (registered in `shortcut-registry.ts`, unchanged: no new or changed
 * shortcut, #420): it is listed in the `?` help while a screen with a text filter is open and, when pressed outside a text field, opens the filter
 * row (or sheet) and focuses the first text control. A list toolbar (`mf-list-toolbar`) focuses its always-visible Search box first.
 */
@Directive()
export abstract class FocusFilter {
  readonly filters = input.required<ListFilters>();

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly shortcuts = inject(KeyboardShortcuts);

  /** Whether `/` works here: the screen has a text filter with a control. */
  private readonly hasTextFilter = computed(() =>
    this.filters()
      .defs()
      .some((d) => d.type === 'text' && !d.noControl && !d.disabledReason?.()),
  );

  constructor() {
    // The `?` help lists `/` only while a screen that has it is open: under "Work lists" on the three work lists, else as the page's own.
    const registry = inject(ShortcutRegistry);
    let unregister: (() => void) | null = null;
    effect(() => {
      unregister?.();
      unregister = null;
      if (!this.hasTextFilter()) return;
      const path = this.router.url.split(/[?#]/)[0];
      const workList = ['/tasks', '/my-work', '/pods/work'].includes(path);
      unregister = registry.register({
        ...FOCUS_FILTER_SHORTCUT,
        keys: [...FOCUS_FILTER_SHORTCUT.keys],
        group: workList ? 'work-lists' : 'page',
        does: workList ? 'Focus the Title or Ref filter' : 'Focus the first text filter',
      });
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }

  /**
   * `/` opens the row (or the sheet) if it is closed and focuses the first text filter, unless the user is typing somewhere. Only on
   * screens that have a text filter.
   */
  @HostListener('document:keydown', ['$event'])
  protected onSlash(event: KeyboardEvent): void {
    if (!isShortcut('focus-filter', event) || event.defaultPrevented) return;
    // A single-key shortcut: it stays quiet when the person switched the keyboard shortcuts off (WCAG 2.1.4, #181).
    if (!this.shortcuts.enabled()) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable || target?.closest?.('[role="dialog"]')) return;
    const f = this.filters();
    if (!f.defs().some((d) => d.type === 'text' && !d.noControl && !d.disabledReason?.())) return;
    event.preventDefault();
    f.reveal();
    afterNextRender(
      () =>
        document
          .querySelector<HTMLElement>(
            '[data-list-search] input, [data-filter-row] .cf__input, [data-filter-sheet] .cf__input',
          )
          ?.focus(),
      { injector: this.injector },
    );
  }
}
