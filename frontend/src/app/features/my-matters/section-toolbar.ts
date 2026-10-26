import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TaskTypeBadge } from '../../shared/task-type/task-type-badge';
import { SECTION_SORTS, SectionDir } from './section-prefs';
import { TypeOption } from './section-types';

let nextId = 0;

/**
 * The filter and sort bar of a My Matters task section (`mf-mm-section-toolbar`, PM v2 #857): a searchable multi-select of task types (a native
 * `details` with checkboxes, so the keyboard and screen readers get it for free), chips for the chosen types with a remove button each, a Clear
 * button, and - where the section can sort - a Sort select and a direction button that says what it does. The bar only edits; the section loads.
 * "All types" is the default (nothing chosen).
 */
@Component({
  selector: 'mf-mm-section-toolbar',
  imports: [TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'close()' },
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s2);
    }
    .st {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
    }
    .st__types {
      position: relative;
    }
    .st__summary {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 32px;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      cursor: pointer;
      list-style: none;
    }
    .st__summary::-webkit-details-marker {
      display: none;
    }
    .st__panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 2px);
      left: 0;
      width: min(22rem, 86vw);
      box-sizing: border-box;
      padding: var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2, 0 4px 14px rgb(0 0 0 / 0.18));
    }
    .st__search {
      box-sizing: border-box;
      width: 100%;
      min-height: 32px;
      margin-bottom: var(--mf-s2);
    }
    .st__list {
      max-height: 14rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .st__opt {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      min-height: 32px;
      cursor: pointer;
    }
    .st__hint {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .st__chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      padding: 0;
      margin: 0;
      list-style: none;
    }
    .st__chip {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
      padding: 0 var(--mf-s1) 0 var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .st__x {
      min-width: 24px;
      min-height: 24px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .st__sort {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
    }
    .st select {
      min-height: 32px;
    }
    @media (max-width: 639.98px) {
      .st__summary,
      .st select,
      .st .mf-btn,
      .st__search {
        min-height: 44px;
      }
      .st__opt {
        min-height: 44px;
      }
      .st__x {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `,
  template: `
    <div class="st" role="group" [attr.aria-label]="label() + ': filter and sort'" data-toolbar>
      <details class="st__types" #details>
        <summary class="st__summary" data-types-trigger>
          <span>Task types:</span>
          <strong>{{ summary() }}</strong>
        </summary>
        <div class="st__panel">
          <input
            type="search"
            class="st__search"
            [attr.aria-label]="'Search task types for ' + label()"
            placeholder="Search task types"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
            data-types-search
          />
          @if (shown().length === 0) {
            <p class="st__hint" data-types-none>No task type matches.</p>
          } @else {
            <ul class="st__list">
              @for (o of shown(); track o.id) {
                <li>
                  <label class="st__opt">
                    <input
                      type="checkbox"
                      [checked]="types().includes(o.id)"
                      (change)="toggle(o.id)"
                      [attr.data-type-option]="o.id"
                    />
                    <mf-task-type-badge
                      [decorative]="true"
                      [iconKey]="o.iconKey"
                      [colourKey]="o.colourKey"
                      [name]="o.name"
                    />
                    <span>{{ o.name }}</span>
                    @if (!o.active) {
                      <span class="st__hint">(inactive)</span>
                    }
                  </label>
                </li>
              }
            </ul>
          }
          <button
            type="button"
            class="mf-btn"
            data-types-clear
            [disabled]="types().length === 0"
            (click)="clear()"
          >
            Clear
          </button>
        </div>
      </details>
      @if (sorts()) {
        <span class="st__sort">
          <label [for]="id + '-sort'">Sort</label>
          <select
            [id]="id + '-sort'"
            [value]="sort()"
            (change)="sortChange.emit($any($event.target).value)"
            data-sort
          >
            @for (s of choices; track s.value) {
              <option [value]="s.value" [selected]="s.value === sort()">{{ s.label }}</option>
            }
          </select>
          <button
            type="button"
            class="mf-btn"
            data-dir
            [attr.aria-label]="dirLabel()"
            [attr.title]="dirLabel()"
            [disabled]="sort() === ''"
            (click)="dirChange.emit(dir() === 'asc' ? 'desc' : 'asc')"
          >
            <i
              [class]="dir() === 'asc' ? 'pi pi-arrow-up' : 'pi pi-arrow-down'"
              aria-hidden="true"
            ></i>
          </button>
        </span>
      }
      @if (chosen().length > 0) {
        <ul class="st__chips" [attr.aria-label]="'Chosen task types'" data-chips>
          @for (o of chosen(); track o.id) {
            <li class="st__chip" data-chip>
              <mf-task-type-badge
                [decorative]="true"
                [iconKey]="o.iconKey"
                [colourKey]="o.colourKey"
                [name]="o.name"
              />
              <span>{{ o.name }}</span>
              <button
                type="button"
                class="st__x"
                [attr.aria-label]="'Remove ' + o.name"
                (click)="toggle(o.id)"
              >
                <i class="pi pi-times" aria-hidden="true"></i>
              </button>
            </li>
          }
        </ul>
        <button type="button" class="mf-btn mf-btn--text" data-clear-all (click)="clear()">
          Clear
        </button>
      }
    </div>
  `,
})
export class SectionToolbar {
  /** The section's name, for the accessible names ("Needs my attention"). */
  readonly label = input.required<string>();
  readonly options = input<readonly TypeOption[]>([]);
  readonly types = input<readonly number[]>([]);
  readonly sort = input('');
  readonly dir = input<SectionDir>('asc');
  /** False for a section that is only filtered (the deadline calendar and the matter groups). */
  readonly sorts = input(true);

  readonly typesChange = output<number[]>();
  readonly sortChange = output<string>();
  readonly dirChange = output<SectionDir>();

  protected readonly id = `mm-st-${++nextId}`;
  protected readonly choices = SECTION_SORTS;
  protected readonly search = signal('');
  private readonly details = viewChild<ElementRef<HTMLDetailsElement>>('details');

  /** The chosen types as options; a chosen id the list does not know (an inactive type, a list that failed to load) still shows by its number. */
  protected readonly chosen = computed<TypeOption[]>(() =>
    this.types().map(
      (id) =>
        this.options().find((o) => o.id === id) ?? {
          id,
          name: `Task type ${id}`,
          iconKey: 'file-text',
          colourKey: undefined,
          active: true,
        },
    ),
  );

  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.options().filter((o) => !q || o.name.toLowerCase().includes(q));
  });

  protected readonly summary = computed(() => {
    const n = this.types().length;
    return n === 0 ? 'All types' : n === 1 ? this.chosen()[0].name : `${n} selected`;
  });

  protected readonly dirLabel = computed(() =>
    this.sort() === ''
      ? 'Choose a sort first'
      : this.dir() === 'asc'
        ? 'Sorted ascending, change to descending'
        : 'Sorted descending, change to ascending',
  );

  protected toggle(id: number): void {
    const now = this.types();
    this.typesChange.emit(now.includes(id) ? now.filter((t) => t !== id) : [...now, id]);
  }

  protected clear(): void {
    this.typesChange.emit([]);
  }

  protected close(): void {
    const details = this.details()?.nativeElement;
    if (!details?.open) return;
    details.open = false;
    details.querySelector<HTMLElement>('summary')?.focus();
  }
}
