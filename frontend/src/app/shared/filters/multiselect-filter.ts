import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FILTER_TRIGGER_STYLES, FilterPopover } from './filter-popover';
import { FilterOption, ValueGroup } from './filter-def';

/** A tick applies 400 ms after the last one (never per tick), or at once when the panel closes. */
export const MULTI_COMMIT_MS = 400;
/** The find box shows above this many options. */
export const FIND_BOX_FROM = 8;

let nextId = 0;

/**
 * Multi-select column filter (docs/ux/column-filters-review.md 4.2): a button that reads "All", the single value or "3 selected" and opens
 * a panel with a checkbox group, a find box above 8 options, optional counts, "Clear" and "Done". The panel is a fixed-position popover
 * (never clipped by the grid). With `inline` (the sheet) the group is shown in place instead. A checkbox group, not a listbox, for
 * reliable screen reader support.
 */
@Component({
  selector: 'mf-column-multiselect-filter',
  imports: [NgTemplateOutlet, FilterPopover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ft--inline]': 'inline()' },
  template: `
    @if (!inline()) {
      <button
        #btn
        type="button"
        class="mf-control mf-control--compact ft-btn"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? uid + '-panel' : null"
        [attr.aria-label]="'Filter by ' + label() + ', ' + summary()"
        [attr.data-filter]="key() || label()"
        [attr.data-active]="draft().length > 0 ? '' : null"
        [disabled]="disabled()"
        (click)="toggle()"
      >
        <span class="ft-text" [attr.data-empty]="draft().length === 0 ? '' : null">{{
          summary()
        }}</span>
        <i class="pi pi-chevron-down" aria-hidden="true"></i>
      </button>
      @if (open()) {
        <mf-filter-popover [anchor]="btn" [label]="'Filter by ' + label()" (closed)="close(false)">
          <ng-container *ngTemplateOutlet="panel" />
        </mf-filter-popover>
      }
    } @else {
      <ng-container *ngTemplateOutlet="panel" />
    }

    <ng-template #panel>
      <div class="ms" [id]="uid + '-panel'">
        @if (options().length > findFrom) {
          <input
            type="search"
            class="mf-control mf-control--compact ms-find"
            autocomplete="off"
            [attr.aria-label]="'Find in ' + label()"
            placeholder="Find"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        }
        <div class="ms-group" role="group" [attr.aria-label]="label()">
          @for (o of shown(); track o.value) {
            <label class="ms-opt">
              <input
                type="checkbox"
                [checked]="draft().includes(o.value)"
                [attr.data-option]="o.value"
                (change)="tick(o.value, $any($event.target).checked)"
              />
              <span class="ms-label">{{ o.label }}</span>
              @if (o.hint) {
                <span class="ms-hint"> {{ o.hint }}</span>
              }
              @if (o.count !== undefined) {
                <span class="ms-count">{{ o.count }}</span>
              }
            </label>
          } @empty {
            <p class="ms-none" role="status">No match</p>
          }
        </div>
        <div class="ft-foot">
          <button
            type="button"
            class="mf-btn mf-btn--text"
            [disabled]="draft().length === 0"
            (click)="clearAll()"
          >
            Clear
          </button>
          @if (!inline()) {
            <button type="button" class="mf-btn" (click)="close(true)">Done</button>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [
    FILTER_TRIGGER_STYLES,
    `
      .ms-find {
        width: 100%;
        margin-bottom: var(--mf-s1);
      }
      .ms-group {
        display: grid;
        max-height: 14rem;
        overflow-y: auto;
      }
      .ms-opt {
        display: flex;
        align-items: center;
        gap: var(--mf-s2);
        min-height: 28px;
        padding: 0 var(--mf-s1);
        cursor: pointer;
      }
      .ms-opt:hover {
        background: var(--mf-surface-alt);
      }
      .ms-label {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .ms-hint,
      .ms-count,
      .ms-none {
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .ms-none {
        margin: var(--mf-s1);
      }
      :host(.ft--inline) .ms-group {
        max-height: none;
      }
    `,
  ],
})
export class ColumnMultiselectFilter {
  readonly label = input.required<string>();
  readonly key = input('');
  readonly options = input.required<readonly FilterOption[]>();
  /** The committed values (from the URL). */
  readonly value = input<readonly string[]>([]);
  /** What the button says when nothing is chosen. */
  readonly emptyLabel = input('All');
  /** Named sets of values: a choice equal to one reads as its name ("Open") in the button. */
  readonly groups = input<readonly ValueGroup[]>([]);
  /** The sheet shows the checkbox group in place instead of a popover. */
  readonly inline = input(false);
  readonly disabled = input(false);
  readonly findFrom = FIND_BOX_FROM;
  /** The chosen values, once per change (400 ms after the last tick, or when the panel closes). */
  readonly valueChange = output<string[]>();

  protected readonly uid = `mf-ms-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly draft = signal<readonly string[]>([]);

  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.options();
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  });

  protected readonly summary = computed(() => {
    const d = this.draft();
    if (d.length === 0) return this.emptyLabel();
    const group = this.groups().find(
      (g) => g.values.length === d.length && g.values.every((v) => d.includes(v)),
    );
    if (group) return group.label;
    if (d.length === 1) {
      return this.options().find((o) => o.value === d[0])?.label ?? d[0];
    }
    return `${d.length} selected`;
  });

  private readonly btn = viewChild<ElementRef<HTMLButtonElement>>('btn');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: readonly string[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    effect(() => {
      const committed = this.value() ?? [];
      untracked(() => {
        // The echo of our own change coming back from the address (400 ms after a tick, the router answers a little later) must not
        // undo a tick the user made in the meantime; only a change from outside (Clear filters, a chip, Back) replaces the draft.
        const echo =
          committed.length === this.last.length && committed.every((x) => this.last.includes(x));
        if (echo) return;
        this.last = committed;
        clearTimeout(this.timer);
        this.draft.set(committed);
      });
    });
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else {
      this.query.set('');
      this.open.set(true);
    }
  }

  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.commit();
    if (refocus) this.btn()?.nativeElement.focus();
  }

  protected tick(value: string, checked: boolean): void {
    const d = this.draft();
    this.draft.set(
      checked ? [...d.filter((x) => x !== value), value] : d.filter((x) => x !== value),
    );
    this.schedule();
  }

  protected clearAll(): void {
    this.draft.set([]);
    this.commit();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.commit(), MULTI_COMMIT_MS);
  }

  private commit(): void {
    clearTimeout(this.timer);
    const d = this.draft();
    if (d.length === this.last.length && d.every((x) => this.last.includes(x))) return;
    this.last = d;
    this.valueChange.emit([...d]);
  }
}
