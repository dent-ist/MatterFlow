import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TaskTypeBadge } from '../../shared/task-type/task-type-badge';
import { MyMattersFocus } from './focus';
import { SectionTypes, TypeOption } from './section-types';

/** The checklist gets a search box above this many task types. */
const SEARCH_OVER = 10;

/** At most this many task types are drawn at once (a search finds the rest): a list of hundreds would make every click slow. */
const MAX_ROWS = 100;

/** The text of the Focus chip: "Focus: Intake, Production" (a type the list does not know shows by its number). */
export function focusLabel(ids: readonly number[], options: readonly TypeOption[]): string {
  const names = ids.map((id) => options.find((o) => o.id === id)?.name ?? `Task type ${id}`);
  return `Focus: ${names.join(', ')}`;
}

/**
 * The Focus checklist of My Matters (PM v2, PV-07 #858): a checklist of the task types with Save and Clear; the choice is kept per person and stays until it
 * is changed (`MyMattersFocus`). Since issue #900 it is not a button of its own but a part of the title row's one Options menu (with the scope switch), and the
 * chip below names the types in force and has a remove button that clears the Focus everywhere.
 */
@Component({
  selector: 'mf-mm-focus',
  imports: [NgTemplateOutlet, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-block;
    }
    .fc__title {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .fc__inline .fc__list {
      width: auto;
      max-height: 9rem;
    }
    .fc__search {
      width: 100%;
      margin: 0 0 var(--mf-s2);
    }
    .fc__hint {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .fc__list {
      width: min(20rem, 76vw);
      max-height: 14rem;
      margin: 0 0 var(--mf-s2);
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .fc__opt {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      min-height: 32px;
      cursor: pointer;
    }
    .fc__actions {
      display: flex;
      gap: var(--mf-s2);
    }
    @media (max-width: 639.98px) {
      .fc__opt,
      .fc__actions .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    <!-- Always inside the title row's Options menu (issue #900): the checklist itself, with a heading, no popover of its own. -->
    <div class="fc__inline" role="group" aria-labelledby="fc-inline-h" data-focus data-focus-inline>
      <p class="fc__title" id="fc-inline-h">Focus</p>
      <ng-container *ngTemplateOutlet="panel" />
    </div>
    <ng-template #panel>
      <div data-focus-panel>
        <p class="fc__hint">
          Pick the task types you work on now. Every list on this page shows only these, until you
          change it.
        </p>
        @if (options.options().length > searchOver) {
          <input
            type="search"
            class="mf-control mf-control--compact fc__search"
            aria-label="Find a task type"
            placeholder="Find a task type"
            data-focus-search
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        }
        @if (capped()) {
          <p class="fc__hint" data-focus-capped>
            Showing the first 100. Search to find the others.
          </p>
        }
        @if (options.options().length === 0) {
          <p class="fc__hint" data-focus-none>No task types to choose from.</p>
        } @else {
          <ul class="fc__list">
            @for (o of shown(); track o.id) {
              <li>
                <label class="fc__opt">
                  <input
                    type="checkbox"
                    [checked]="draft().includes(o.id)"
                    (change)="toggle(o.id)"
                    [attr.data-focus-option]="o.id"
                  />
                  <mf-task-type-badge
                    [decorative]="true"
                    [iconKey]="o.iconKey"
                    [colourKey]="o.colourKey"
                    [name]="o.name"
                  />
                  <span>{{ o.name }}</span>
                </label>
              </li>
            }
          </ul>
        }
        <div class="fc__actions">
          <button
            type="button"
            class="mf-btn mf-btn--primary"
            data-focus-save
            data-options-pick
            (click)="save()"
          >
            Save
          </button>
          <button
            type="button"
            class="mf-btn"
            data-focus-clear
            data-options-pick
            (click)="clearAll()"
          >
            Clear
          </button>
        </div>
      </div>
    </ng-template>
  `,
})
export class FocusControl {
  protected readonly focus = inject(MyMattersFocus);
  protected readonly options = inject(SectionTypes);
  protected readonly draft = signal<number[]>([]);
  protected readonly searchOver = SEARCH_OVER;
  protected readonly query = signal('');
  /** The task types to list: the ones in force first (as saved), then the rest; narrowed by the search box (shown above ten types). */
  protected readonly shown = computed(() => {
    const saved = this.focus.types();
    const q = this.query().trim().toLowerCase();
    const all = this.options.options();
    const list =
      q && all.length > SEARCH_OVER ? all.filter((o) => o.name.toLowerCase().includes(q)) : all;
    return [...list]
      .sort((a, b) => Number(saved.includes(b.id)) - Number(saved.includes(a.id)))
      .slice(0, MAX_ROWS);
  });
  protected readonly capped = computed(
    () => this.options.options().length > MAX_ROWS && this.query().trim() === '',
  );

  constructor() {
    this.options.ensure();
    this.focus.ensure();
    // The checklist lives in the Options menu, which has no "opened" moment: the draft follows the saved Focus.
    effect(() => {
      const saved = this.focus.types();
      untracked(() => this.draft.set([...saved]));
    });
  }

  /** The Options menu was opened: it starts from the saved Focus, so a menu closed without saving never keeps a half choice. */
  reset(): void {
    this.draft.set([...this.focus.types()]);
    this.query.set('');
  }

  protected toggle(id: number): void {
    const now = this.draft();
    this.draft.set(now.includes(id) ? now.filter((t) => t !== id) : [...now, id]);
  }

  protected save(): void {
    this.focus.set(this.draft());
  }

  protected clearAll(): void {
    this.focus.clear();
    this.draft.set([]);
  }
}

/** The chip under the filters: "Focus: Intake, Production" with a button that clears the Focus for every section. */
@Component({
  selector: 'mf-mm-focus-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s2);
    }
    :host(:empty) {
      display: none;
    }
    .fc__chip {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .fc__x {
      min-width: 24px;
      min-height: 24px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    @media (max-width: 639.98px) {
      .fc__x {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (focus.types().length > 0) {
      <span class="fc__chip" data-focus-chip>
        <span>{{ label() }}</span>
        <button
          type="button"
          class="fc__x"
          data-focus-remove
          aria-label="Clear the Focus in every section"
          (click)="focus.clear()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </span>
    }
  `,
})
export class FocusChip {
  protected readonly focus = inject(MyMattersFocus);
  private readonly options = inject(SectionTypes);
  protected readonly label = computed(() => focusLabel(this.focus.types(), this.options.options()));

  constructor() {
    this.options.ensure();
    this.focus.ensure();
  }
}

/** The chip beside the Focus chip while the page shows All matters (issue #900: the scope switch is inside Options, so what is in force must stay in sight). */
@Component({
  selector: 'mf-mm-scope-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s2);
    }
    :host(:empty) {
      display: none;
    }
    .fc__chip {
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-sm);
    }
    .fc__x {
      min-width: 24px;
      min-height: 24px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    @media (max-width: 639.98px) {
      .fc__x {
        min-width: 44px;
        min-height: 44px;
      }
    }
  `,
  template: `
    @if (scope() === 'all') {
      <span class="fc__chip" data-scope-chip>
        <span>Showing all matters</span>
        <button
          type="button"
          class="fc__x"
          data-scope-back
          aria-label="Show only the matters I manage"
          (click)="back.emit()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </span>
    }
  `,
})
export class ScopeChip {
  readonly scope = input<'mine' | 'all'>('mine');
  readonly back = output<void>();
}
