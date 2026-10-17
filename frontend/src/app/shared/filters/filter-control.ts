import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';
import { ColumnSelectFilter, ColumnTextFilter } from '../ui/column-filters';
import { ColumnDateRangeFilter } from './date-range-filter';
import {
  FilterDef,
  FilterOption,
  RangeValue,
  isRange,
  optionsOf,
  selectOptions,
  valueText,
} from './filter-def';
import { ListFilters } from './list-filters';
import { ColumnMultiselectFilter } from './multiselect-filter';
import { ColumnNumberRangeFilter } from './number-range-filter';
import { ColumnTristateFilter } from './tristate-filter';
import { ColumnUserFilter } from './user-filter';

let nextUid = 0;

/**
 * The control for ONE filter definition: picks the right column control for `def.type`, wires its value to `ListFilters` (the URL) and
 * shows a disabled stand-in with the reason when the definition is unavailable (a column the active tab owns). The row and the sheet
 * both render filters through it. The heavy controls (multi-select, user, date range, number range) load lazily.
 */
@Component({
  selector: 'mf-filter-control',
  imports: [
    ColumnTextFilter,
    ColumnSelectFilter,
    ColumnTristateFilter,
    // Only used inside @defer blocks, so they load in their own chunks.
    ColumnMultiselectFilter,
    ColumnUserFilter,
    ColumnDateRangeFilter,
    ColumnNumberRangeFilter,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = def();
    @if (reason(); as why) {
      <div class="fc-off" [attr.title]="why" data-filter-disabled>
        @if (fixed(); as text) {
          <!-- A value the tab decides: shown as muted text, readable by screen readers, not an input and not a filter. -->
          <span class="fc-fixed" [attr.data-filter]="d.key" data-filter-fixed>
            <span aria-hidden="true">{{ text }}</span>
            <span class="fc-sr">{{ d.label }}: {{ text }}, set by this tab</span>
          </span>
        } @else {
          <input
            class="mf-control mf-control--compact fc-off__input"
            type="text"
            disabled
            [value]="current()"
            [attr.aria-label]="'Filter by ' + d.label"
            [attr.aria-describedby]="uid + '-why'"
            [attr.data-filter]="d.key"
          />
        }
        <span [id]="uid + '-why'" [class]="inline() ? 'fc-why' : 'fc-sr'">{{ why }}</span>
      </div>
    } @else {
      @switch (d.type) {
        @case ('text') {
          <mf-column-text-filter
            [label]="d.label"
            [key]="d.key"
            [maxlength]="d.maxLength ?? 200"
            [value]="filters().text(d.key)"
            (valueChange)="filters().set(d.key, $event, { replace: true })"
          />
        }
        @case ('select') {
          <mf-column-select-filter
            [label]="d.label"
            [key]="d.key"
            [options]="selectOpts()"
            [value]="filters().text(d.key)"
            (valueChange)="filters().set(d.key, $event)"
          />
        }
        @case ('triState') {
          <mf-column-tristate-filter
            [label]="d.label"
            [key]="d.key"
            [anyLabel]="triOptions()[0]?.label ?? 'Any'"
            [yesLabel]="triOptions()[1]?.label ?? 'Yes'"
            [noLabel]="triOptions()[2]?.label ?? 'No'"
            [value]="filters().text(d.key)"
            (valueChange)="filters().set(d.key, $event)"
          />
        }
        @case ('multiSelect') {
          @defer (on immediate) {
            <mf-column-multiselect-filter
              [label]="d.label"
              [key]="d.key"
              [options]="listOptions()"
              [valueLabel]="d.valueLabel ?? identity"
              [value]="filters().list(d.key)"
              [emptyLabel]="d.emptyLabel ?? 'All'"
              [groups]="d.valueGroups ?? []"
              [inline]="inline()"
              (valueChange)="filters().set(d.key, $event)"
            />
          } @placeholder {
            <div class="fc-ph" aria-hidden="true"></div>
          }
        }
        @case ('user') {
          @defer (on immediate) {
            <mf-column-user-filter
              [label]="d.label"
              [key]="d.key"
              [users]="optionsOf(d)"
              [meValue]="meValue()"
              [specials]="flagChoices()"
              [value]="filters().list(d.key)"
              [emptyLabel]="d.emptyLabel ?? 'Any'"
              [inline]="inline()"
              (valueChange)="filters().set(d.key, $event)"
            />
          } @placeholder {
            <div class="fc-ph" aria-hidden="true"></div>
          }
        }
        @case ('dateRange') {
          @defer (on immediate) {
            <mf-column-date-range-filter
              [label]="d.label"
              [key]="d.key"
              [value]="range()"
              [presets]="d.presets ?? defaultPresets"
              [emptyLabel]="d.emptyLabel ?? 'Any date'"
              [inline]="inline()"
              (valueChange)="filters().set(d.key, $event)"
            />
          } @placeholder {
            <div class="fc-ph" aria-hidden="true"></div>
          }
        }
        @case ('numberRange') {
          @defer (on immediate) {
            <mf-column-number-range-filter
              [label]="d.label"
              [key]="d.key"
              [value]="range()"
              [emptyLabel]="d.emptyLabel ?? 'Any'"
              [inline]="inline()"
              (valueChange)="filters().set(d.key, $event)"
            />
          } @placeholder {
            <div class="fc-ph" aria-hidden="true"></div>
          }
        }
      }
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .fc-ph {
      min-height: var(--mf-row-h-compact);
    }
    .fc-off__input {
      width: 100%;
      min-width: 0;
      font-weight: 400;
    }
    .fc-fixed {
      display: block;
      padding: 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fc-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .fc-why {
      display: block;
      margin-top: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
})
export class FilterControl {
  readonly def = input.required<FilterDef>();
  readonly filters = input.required<ListFilters>();
  /** In the sheet: expanded groups instead of popovers. */
  readonly inline = input(false);

  protected readonly optionsOf = optionsOf;
  protected readonly identity = (v: string): string => v;
  protected readonly defaultPresets = ['today', 'thisWeek', 'last7', 'last30', 'thisMonth'];
  protected readonly uid = `mf-fc-${nextUid++}`;
  private readonly auth = inject(AuthStore, { optional: true });

  protected readonly reason = computed(() => this.def().disabledReason?.() ?? null);
  protected readonly fixed = computed(() => this.def().fixedValue?.() ?? null);
  protected readonly selectOpts = computed(() => selectOptions(this.def()));
  protected readonly triOptions = computed(() => optionsOf(this.def()));
  protected readonly range = computed<RangeValue>(() => {
    const v = this.filters().value(this.def().key);
    return isRange(v) ? v : { from: '', to: '' };
  });
  protected readonly current = computed(() =>
    valueText(this.def(), this.filters().value(this.def().key)),
  );
  protected readonly meValue = computed(() => {
    const id = this.auth?.profile()?.userId;
    return id ? String(id) : null;
  });
  protected readonly flagChoices = computed<FilterOption[]>(() =>
    Object.entries(this.def().flagOptions ?? {}).map(([value, f]) => ({ value, label: f.label })),
  );
  /** Flag choices first ("Unassigned", "No pod"), then the options. */
  protected readonly listOptions = computed<FilterOption[]>(() => [
    ...this.flagChoices(),
    ...optionsOf(this.def()),
  ]);
}
