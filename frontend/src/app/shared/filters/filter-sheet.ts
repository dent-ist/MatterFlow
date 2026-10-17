import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  effect,
  Injector,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { Dismissable } from '../ui/dismissable';
import { FilterControl } from './filter-control';
import { ListFilters } from './list-filters';

let nextId = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The same filters as a bottom sheet (docs/ux/column-filters-review.md 4.9), used below 768 px or when the grid overflows sideways
 * (`ListFilters.sheetMode()`), where the filter row is not usable. A modal dialog named "Filters": focus moves in and is kept inside,
 * Esc (when no filled box needs it) and Close shut it and give focus back to the Filters button. Controls are the row's controls
 * rendered stacked and expanded (no nested overlays) with 44 px targets, changes apply live, and the footer reads "Show 42 results"
 * (it just closes the sheet) beside "Clear filters". It is part of `mf-filters-bar`, so a page does not place it.
 */
@Component({
  selector: 'mf-filter-sheet',
  imports: [FilterControl, Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (filters().sheetOpen() && filters().sheetMode()) {
      <div
        class="fs-backdrop"
        role="presentation"
        tabindex="-1"
        (click)="close()"
        (keydown.escape)="close()"
      ></div>
      <div
        #dlg
        class="fs"
        role="dialog"
        [mfDismissable]="null"
        [mfDismissableModal]="true"
        (dismissed)="close()"
        aria-modal="true"
        data-filter-sheet
        [attr.aria-labelledby]="uid + '-h'"
        (keydown)="onKey($event)"
      >
        <header class="fs-head">
          <h2 class="fs-title" [id]="uid + '-h'">Filters</h2>
          <button
            type="button"
            class="fs-close mf-btn"
            aria-label="Close filters"
            (click)="close()"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </header>
        <div class="fs-body">
          @for (d of controls(); track d.key) {
            <div class="fs-field" role="group" [attr.aria-label]="d.label">
              <span class="fs-label" aria-hidden="true">{{ d.label }}</span>
              <mf-filter-control [def]="d" [filters]="filters()" [inline]="true" />
            </div>
          }
        </div>
        <footer class="fs-foot">
          <ng-content select="[mfSheetFooter]" />
          @if (filters().activeCount() > 0) {
            <button type="button" class="mf-btn" data-sheet-clear (click)="clearAll()">
              Clear filters
            </button>
          }
          <button
            type="button"
            class="mf-btn mf-btn--primary fs-show"
            data-sheet-show
            (click)="close()"
          >
            {{ showText() }}
          </button>
        </footer>
      </div>
    }
  `,
  styles: `
    .fs-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1190;
      background: rgb(0 0 0 / 40%);
    }
    .fs {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      max-height: 85dvh;
      border-radius: var(--mf-radius-lg) var(--mf-radius-lg) 0 0;
      background: var(--mf-surface);
      color: var(--mf-text);
      box-shadow: 0 -6px 24px rgb(0 0 0 / 25%);
    }
    .fs-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .fs-title {
      margin: 0;
      font-size: var(--mf-fs-lg, 1.125rem);
    }
    .fs-close {
      min-width: 44px;
      min-height: 44px;
    }
    .fs-body {
      display: grid;
      gap: var(--mf-s3);
      overflow-y: auto;
      padding: var(--mf-s3);
    }
    .fs-field {
      display: grid;
      gap: var(--mf-s1);
    }
    .fs-label {
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    /* 44 px targets (the row's controls are 32 px). */
    .fs-field ::ng-deep .mf-control,
    .fs-field ::ng-deep .mf-btn,
    .fs-field ::ng-deep .ms-opt {
      min-height: 44px;
    }
    .fs-field ::ng-deep .ms-opt input {
      width: 20px;
      height: 20px;
    }
    .fs-foot {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      border-top: 1px solid var(--mf-border);
    }
    .fs-foot .mf-btn {
      min-height: 44px;
    }
    @media print {
      .fs,
      .fs-backdrop {
        display: none;
      }
    }
  `,
})
export class FilterSheet {
  readonly filters = input.required<ListFilters>();
  /** Legacy parameters that "Clear filters" drops as well (a retired search box). */
  readonly clearAlso = input<readonly string[]>([]);

  protected readonly uid = `mf-fs-${nextId++}`;
  private readonly dlg = viewChild<ElementRef<HTMLElement>>('dlg');
  private readonly destroyRef = inject(DestroyRef);
  private opener: HTMLElement | null = null;

  /** Every filter that has a control, whether or not its column is on screen. */
  protected readonly controls = computed(() =>
    this.filters()
      .defs()
      .filter((d) => !d.noControl),
  );
  protected readonly showText = computed(() => {
    const n = this.filters().resultTotal();
    return n === null ? 'Show results' : n === 1 ? 'Show 1 result' : `Show ${n} results`;
  });

  constructor() {
    effect(() => {
      const open = this.filters().sheetOpen() && this.filters().sheetMode();
      untracked(() => {
        if (open) {
          const active = document.activeElement;
          this.opener = active instanceof HTMLElement ? active : null;
          afterNextRender(
            () => {
              const el = this.dlg()?.nativeElement;
              const first =
                el?.querySelector<HTMLElement>(
                  '.fs-body input, .fs-body select, .fs-body button',
                ) ?? el?.querySelector<HTMLElement>(FOCUSABLE);
              first?.focus();
            },
            { injector: this.injector },
          );
        }
      });
    });
    this.destroyRef.onDestroy(() => (this.opener = null));
  }

  private readonly injector = inject(Injector);

  /** Esc closes the sheet wherever focus is (it can be on the page when the button that had it went away). */
  @HostListener('document:keydown.escape', ['$event'])
  protected onDocumentEscape(event: Event): void {
    if (event.defaultPrevented || !this.filters().sheetOpen() || !this.filters().sheetMode())
      return;
    this.close();
  }

  /** Clear filters: the button disappears, so focus moves on to "Show results" instead of dropping to the page. */
  protected clearAll(): void {
    this.filters().clear(this.clearAlso());
    afterNextRender(
      () => this.dlg()?.nativeElement.querySelector<HTMLElement>('.fs-show')?.focus(),
      {
        injector: this.injector,
      },
    );
  }

  protected close(): void {
    this.filters().closeSheet();
    const opener = this.opener;
    this.opener = null;
    afterNextRender(
      () =>
        (opener?.isConnected
          ? opener
          : document.querySelector<HTMLElement>('[data-filters-toggle]')
        )?.focus(),
      { injector: this.injector },
    );
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const el = this.dlg()?.nativeElement;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
