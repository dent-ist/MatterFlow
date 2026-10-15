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
import { SEARCH_DEBOUNCE_MS } from '../ui/search-box';
import { RangeValue } from './filter-def';
import { FILTER_TRIGGER_STYLES, FilterPopover } from './filter-popover';

let nextId = 0;

const WHOLE = /^-?\d{1,9}$/;

/**
 * Number range column filter: a button ("Any" / "3 to 10") opening a panel with Min and Max (whole numbers; live 300 ms after the last
 * key, at once on Enter). Min above Max shows an error and is not applied. In the sheet (`inline`) the two boxes show in place.
 */
@Component({
  selector: 'mf-column-number-range-filter',
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
        [attr.data-active]="hasValue() ? '' : null"
        [disabled]="disabled()"
        (click)="toggle()"
      >
        <span class="ft-text" [attr.data-empty]="hasValue() ? null : ''">{{ summary() }}</span>
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
      <div class="nr" [id]="uid + '-panel'">
        <div class="ft-field">
          <label [for]="uid + '-min'">Min</label>
          <input
            class="mf-control mf-control--compact"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [id]="uid + '-min'"
            [attr.aria-label]="label() + ' minimum'"
            [attr.aria-invalid]="badMin() ? 'true' : null"
            [value]="draft().from"
            (input)="onInput('from', $any($event.target).value)"
            (keydown.enter)="$event.preventDefault(); flush()"
          />
        </div>
        <div class="ft-field">
          <label [for]="uid + '-max'">Max</label>
          <input
            class="mf-control mf-control--compact"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [id]="uid + '-max'"
            [attr.aria-label]="label() + ' maximum'"
            [attr.aria-invalid]="badMax() ? 'true' : null"
            [value]="draft().to"
            (input)="onInput('to', $any($event.target).value)"
            (keydown.enter)="$event.preventDefault(); flush()"
          />
        </div>
        @if (badMin() || badMax()) {
          <p class="ft-error" role="alert" data-number-error>Use whole numbers.</p>
        } @else if (reversed()) {
          <p class="ft-error" role="alert" data-range-error>
            Min is above Max. Change one of the numbers to apply the filter.
          </p>
        }
        <div class="ft-foot">
          <button
            type="button"
            class="mf-btn mf-btn--text"
            [disabled]="!hasValue()"
            (click)="clearRange()"
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
  styles: [FILTER_TRIGGER_STYLES],
})
export class ColumnNumberRangeFilter {
  readonly label = input.required<string>();
  readonly key = input('');
  readonly value = input<RangeValue>({ from: '', to: '' });
  readonly emptyLabel = input('Any');
  readonly inline = input(false);
  readonly disabled = input(false);
  readonly valueChange = output<RangeValue>();

  protected readonly uid = `mf-nr-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly draft = signal<RangeValue>({ from: '', to: '' });
  private readonly btn = viewChild<ElementRef<HTMLButtonElement>>('btn');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly hasValue = computed(() => !!this.draft().from || !!this.draft().to);
  protected readonly badMin = computed(() => !!this.draft().from && !WHOLE.test(this.draft().from));
  protected readonly badMax = computed(() => !!this.draft().to && !WHOLE.test(this.draft().to));
  protected readonly reversed = computed(() => {
    const { from, to } = this.draft();
    return WHOLE.test(from) && WHOLE.test(to) && Number(from) > Number(to);
  });
  protected readonly summary = computed(() => {
    const { from, to } = this.draft();
    if (from && to) return from === to ? from : `${from} to ${to}`;
    if (from) return `${from} or more`;
    if (to) return `${to} or less`;
    return this.emptyLabel();
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    effect(() => {
      const committed = this.value() ?? { from: '', to: '' };
      untracked(() => {
        clearTimeout(this.timer);
        this.draft.set({ from: committed.from, to: committed.to });
      });
    });
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.open.set(true);
  }

  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.flush();
    this.open.set(false);
    if (refocus) this.btn()?.nativeElement.focus();
  }

  protected onInput(side: 'from' | 'to', text: string): void {
    this.draft.set({ ...this.draft(), [side]: text.trim() } as RangeValue);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SEARCH_DEBOUNCE_MS);
  }

  protected flush(): void {
    clearTimeout(this.timer);
    if (this.badMin() || this.badMax() || this.reversed()) return;
    const d = this.draft();
    const c = this.value() ?? { from: '', to: '' };
    if (c.from === d.from && c.to === d.to) return;
    this.valueChange.emit({ from: d.from, to: d.to });
  }

  protected clearRange(): void {
    this.draft.set({ from: '', to: '' });
    this.flush();
  }
}
