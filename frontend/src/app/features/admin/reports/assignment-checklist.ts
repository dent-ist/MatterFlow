import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

/** One line of an assignment checklist. */
export interface ChecklistItem {
  id: number;
  name: string;
  /** A second line (a category, a description, the number of people). */
  detail?: string;
  /** Shown as a text chip: "Inactive". Never by colour alone. */
  flag?: string;
  /** Headings the list is grouped by (the report's category). Items are listed in the order given. */
  group?: string;
  assigned: boolean;
}

/** `Pod Lead now has 3 reports (added Tasks per matter; removed Finance)`. */
export function diffMessage(
  owner: string,
  count: number,
  noun: string,
  added: readonly string[],
  removed: readonly string[],
): string {
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(', ')}`);
  if (removed.length) parts.push(`removed ${removed.join(', ')}`);
  const plural = count === 1 ? noun : noun + 's';
  return `${owner} now has ${count} ${plural}${parts.length ? ` (${parts.join('; ')})` : ''}.`;
}

/**
 * A checklist with a search box, a count ("3 of 14"), Save and Reset, shared by the two assignment screens (a role's reports and a report's
 * roles; spec 9.4). Checking boxes changes nothing until Save; the page then runs the full replace and hands the saved items back, which
 * resets the list. Native checkboxes in one fieldset, so a keyboard walk needs nothing but Tab and Space. Nothing here shows SQL: the items
 * are names, categories and descriptions.
 */
@Component({
  selector: 'mf-assignment-checklist',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ac" data-assignment-checklist>
      <div class="ac__bar">
        <div class="ac__search">
          <label class="mf-label mf-label--sm" [for]="idPrefix() + '-search'"
            >Search {{ nounPlural() }}</label
          >
          <input
            [id]="idPrefix() + '-search'"
            class="mf-control mf-control--fill"
            type="search"
            autocomplete="off"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
            data-checklist-search
          />
        </div>
        <p class="ac__count" role="status" aria-live="polite" data-checklist-count>
          {{ selectedCount() }} of {{ items().length }}
          {{ items().length === 1 ? noun() : nounPlural() }} assigned
        </p>
      </div>
      <fieldset class="ac__list" [disabled]="busy()">
        <legend class="mf-sr-only">{{ legend() }}</legend>
        @for (g of groups(); track g.name) {
          @if (g.name) {
            <p class="ac__group" data-checklist-group>{{ g.name }}</p>
          }
          @for (item of g.items; track item.id) {
            <label
              class="ac__item"
              [class.ac__item--inactive]="!!item.flag"
              [attr.data-item]="item.id"
            >
              <input
                type="checkbox"
                [checked]="selected().has(item.id)"
                (change)="toggle(item.id, $any($event.target).checked)"
              />
              <span class="ac__text">
                <span class="ac__name">{{ item.name }}</span>
                @if (item.flag) {
                  <span class="ac__flag" data-flag>{{ item.flag }}</span>
                }
                @if (item.detail) {
                  <span class="ac__detail">{{ item.detail }}</span>
                }
              </span>
            </label>
          }
        } @empty {
          <p class="ac__empty" data-checklist-empty>
            {{ items().length === 0 ? 'Nothing to assign yet.' : 'No ' + nounPlural() + ' match.' }}
          </p>
        }
      </fieldset>
      <div class="ac__actions">
        <button
          type="button"
          class="mf-btn mf-btn--primary"
          (click)="save.emit(selectedIds())"
          [disabled]="busy() || !dirty()"
          data-checklist-save
        >
          {{ busy() ? 'Saving...' : 'Save assignment' }}
        </button>
        <button
          type="button"
          class="mf-btn"
          (click)="reset()"
          [disabled]="busy() || !dirty()"
          data-checklist-reset
        >
          Discard changes
        </button>
        @if (!dirty()) {
          <span class="ac__hint" data-checklist-clean>No changes to save.</span>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .ac {
      display: grid;
      gap: var(--mf-s3);
      max-width: 48rem;
    }

    .ac__bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s3);
      align-items: end;
      justify-content: space-between;
    }

    .ac__search {
      display: grid;
      flex: 1 1 14rem;
      gap: var(--mf-s1);
      max-width: 22rem;
    }

    .ac__count,
    .ac__hint,
    .ac__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }

    .ac__list {
      display: grid;
      gap: 0;
      min-width: 0;
      max-height: 28rem;
      margin: 0;
      padding: 0;
      overflow: auto;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }

    .ac__group {
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface-alt);
      font-weight: 600;
    }

    .ac__item {
      display: flex;
      gap: var(--mf-s3);
      align-items: flex-start;
      min-height: var(--mf-target-min);
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      cursor: pointer;
    }

    .ac__text {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mf-s2);
      align-items: baseline;
      min-width: 0;
    }

    .ac__item--inactive .ac__name {
      color: var(--mf-text-muted);
    }

    .ac__flag {
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }

    .ac__detail {
      flex-basis: 100%;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }

    .ac__empty {
      padding: var(--mf-s3);
    }

    .ac__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s3);
      align-items: center;
    }
  `,
})
export class AssignmentChecklist {
  readonly items = input.required<readonly ChecklistItem[]>();
  /** "report" or "role": singular noun of the items. */
  readonly noun = input('item');
  readonly nounPlural = computed(() => this.noun() + 's');
  readonly legend = input('Assignment');
  readonly idPrefix = input('ac');
  readonly busy = input(false);
  /** The ids that should be assigned after Save. */
  readonly save = output<number[]>();

  protected readonly search = signal('');
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  private readonly savedIds = signal<ReadonlySet<number>>(new Set());

  protected readonly selectedCount = computed(() => this.selected().size);
  protected readonly selectedIds = computed(() => [...this.selected()].sort((a, b) => a - b));
  protected readonly dirty = computed(() => {
    const a = this.selected();
    const b = this.savedIds();
    return a.size !== b.size || [...a].some((id) => !b.has(id));
  });

  /** The items that match the search, grouped by heading in the order given. */
  protected readonly groups = computed(() => {
    const needle = this.search().trim().toLowerCase();
    const shown = this.items().filter(
      (i) =>
        !needle || `${i.name} ${i.detail ?? ''} ${i.group ?? ''}`.toLowerCase().includes(needle),
    );
    const out: { name: string; items: ChecklistItem[] }[] = [];
    for (const item of shown) {
      const name = item.group ?? '';
      let group = out.find((g) => g.name === name);
      if (!group) out.push((group = { name, items: [] }));
      group.items.push(item);
    }
    return out;
  });

  constructor() {
    // A new list (after a load or a save) is the new saved state.
    effect(() => {
      const ids = new Set(
        this.items()
          .filter((i) => i.assigned)
          .map((i) => i.id),
      );
      untracked(() => {
        this.savedIds.set(ids);
        this.selected.set(new Set(ids));
      });
    });
  }

  /** True while there are checked changes that are not saved (the page asks before leaving). */
  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  protected toggle(id: number, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected reset(): void {
    this.selected.set(new Set(this.savedIds()));
  }
}
