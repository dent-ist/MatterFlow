import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CountChip } from './count-chip';
import { Tip } from './tip';

/** One list in the catalogue: the label, the "Used for" line and the number of active items (`null` while it is not known: the chip reads `--`). */
export interface CatalogueItem {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly count: number | null;
}

export interface CatalogueGroup {
  readonly name: string;
  /** PrimeIcons class of the group heading, for example `pi-briefcase`. */
  readonly icon: string;
  readonly items: readonly CatalogueItem[];
}

/** A keyboard move waits this long before the editor swaps, so holding an arrow key does not start a request per list (UI spec 7). */
export const CATALOGUE_IDLE_MS = 150;

let nextCatalogueId = 0;

/**
 * The master-detail catalogue (D-44y, epic #1314): a named listbox of lists in groups, in a 320 px card (`--mf-catalogue-w`) at the left of an editor pane. Each option is a 44 px
 * button with the list name (14 / 600), a one-line muted hint and the count chip of the ACTIVE items; the selected one is `--mf-selected-bg` with the 2 px inset `--mf-primary` (D-05).
 * The listbox is ONE Tab stop (the selected option, roving tabindex); Up, Down, Home and End move and select (keys of one focused widget, D-44b, never a shortcut), the editor
 * following after 150 ms of idle (`pick` is emitted then; a click emits at once). A letter key is not bound. The component owns one polite live region: "Priorities, 4 active" after the
 * selection changes, "3 lists" after the groups change (a search).
 *
 *   <mf-list-catalogue label="Lists" [groups]="groups()" [selected]="current()" (pick)="open($event)">
 *     <mf-search-box mfCatalogueSearch ... />
 *     <p mfCatalogueEmpty>No list matches "x".</p>
 *     <a mfCataloguePointer ...>Open Custom Fields</a>
 *   </mf-list-catalogue>
 */
@Component({
  selector: 'mf-list-catalogue',
  imports: [CountChip, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: flex; min-height: 0' },
  template: `
    <aside class="cat mf-card" [attr.aria-label]="label()">
      <div class="cat__search"><ng-content select="[mfCatalogueSearch]" /></div>
      <div class="cat__body">
        @if (total() > 0) {
          <div class="cat__list" role="listbox" [attr.aria-label]="label()">
            @for (g of groups(); track g.name) {
              <div role="group" [attr.aria-labelledby]="uid + '-' + g.name">
                <div class="cat__group" [id]="uid + '-' + g.name">
                  <i class="pi" [class]="g.icon" aria-hidden="true"></i>{{ g.name }}
                </div>
                @for (it of g.items; track it.key) {
                  <button
                    type="button"
                    role="option"
                    class="cat__opt"
                    [class.cat__opt--on]="it.key === shown()"
                    [attr.aria-selected]="it.key === shown()"
                    [attr.aria-label]="optionName(it)"
                    [attr.data-list]="it.key"
                    [tabindex]="it.key === stop() ? 0 : -1"
                    [mfTip]="it.hint"
                    (click)="choose(it.key)"
                    (keydown)="onKey($event)"
                  >
                    <span class="cat__text">
                      <span class="cat__name">{{ it.label }}</span>
                      <span class="cat__hint">{{ it.hint }}</span>
                    </span>
                    <mf-count-chip aria-hidden="true" data-count>{{
                      it.count ?? '--'
                    }}</mf-count-chip>
                  </button>
                }
              </div>
            }
          </div>
        } @else {
          <div class="cat__none" data-no-match><ng-content select="[mfCatalogueEmpty]" /></div>
        }
      </div>
      <div class="cat__foot"><ng-content select="[mfCataloguePointer]" /></div>
      <div class="mf-sr-only" role="status" aria-live="polite" data-catalogue-live>
        {{ announcement() }}
      </div>
    </aside>
  `,
  styles: `
    :host {
      width: var(--mf-catalogue-w);
      flex: none;
    }
    .cat {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
      padding: 0;
    }
    .cat__search {
      padding: var(--mf-s3) var(--mf-s3) var(--mf-s2);
    }
    .cat__search:empty {
      display: none;
    }
    .cat__body {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      padding: 0 var(--mf-s2) var(--mf-s2);
    }
    .cat__group {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: var(--mf-s2) var(--mf-s2) 2px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .cat__group .pi {
      font-size: var(--mf-icon-sm);
    }
    .cat__opt {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 2px var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius-lg);
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .cat__opt:hover {
      background: var(--mf-row-hover);
    }
    .cat__opt--on,
    .cat__opt--on:hover {
      background: var(--mf-selected-bg);
      box-shadow: inset 0 0 0 2px var(--mf-primary);
    }
    .cat__opt:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .cat__text {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-width: 0;
    }
    .cat__name,
    .cat__hint {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cat__name {
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-semibold);
      line-height: 1.3;
    }
    .cat__hint {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      line-height: 1.3;
    }
    .cat__none {
      padding: var(--mf-s5) var(--mf-s3);
      color: var(--mf-text-muted);
      text-align: center;
    }
    .cat__foot {
      flex: none;
    }
    .cat__foot:not(:empty) {
      margin: var(--mf-s2);
    }
  `,
})
export class ListCatalogue {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  protected readonly uid = `cat${nextCatalogueId++}`;

  /** The accessible name of the card and of the listbox. */
  readonly label = input('Lists');
  /** The groups to draw (already filtered by permission and search); an empty group is not drawn by the page. */
  readonly groups = input.required<readonly CatalogueGroup[]>();
  /** The key of the open list (the address). It stays highlighted even when the search hides it. */
  readonly selected = input<string | null>(null);
  /** A list was chosen by click, or by key after the idle time. */
  readonly pick = output<string>();

  /** The option the keyboard moved to and the editor has not followed yet. */
  private readonly pending = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTotal = -1;
  private lastSelected: string | null | undefined;

  protected readonly announcement = signal('');
  private readonly items = computed(() => this.groups().flatMap((g) => g.items));
  protected readonly total = computed(() => this.items().length);
  protected readonly shown = computed(() => this.pending() ?? this.selected());
  /** The roving Tab stop: the selected option, or the first one when the search hides it. */
  protected readonly stop = computed(() => {
    const keys = this.items().map((i) => i.key);
    const on = this.shown();
    return on && keys.includes(on) ? on : (keys[0] ?? null);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // The editor followed (or the address changed by itself): the keyboard move is over.
    effect(() => {
      const selected = this.selected();
      untracked(() => {
        if (this.pending() === selected) this.pending.set(null);
        if (this.lastSelected !== undefined && selected !== this.lastSelected && selected) {
          const it = this.items().find((i) => i.key === selected);
          if (it)
            this.announcement.set(
              `${it.label}${it.count === null ? '' : ', ' + it.count + ' active'}`,
            );
        }
        this.lastSelected = selected;
      });
    });
    // A search changed the lists on show: "3 lists" (the search box already waits 300 ms after the last key).
    effect(() => {
      const total = this.total();
      untracked(() => {
        if (this.lastTotal >= 0 && total !== this.lastTotal)
          this.announcement.set(`${total} ${total === 1 ? 'list' : 'lists'}`);
        this.lastTotal = total;
      });
    });
  }

  protected optionName(it: CatalogueItem): string {
    return it.count === null
      ? `${it.label}, count not available`
      : `${it.label}, ${it.count} active`;
  }

  protected choose(key: string): void {
    clearTimeout(this.timer);
    this.pending.set(key);
    this.pick.emit(key);
  }

  protected onKey(event: KeyboardEvent): void {
    const keys = this.items().map((i) => i.key);
    if (keys.length === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const at = Math.max(0, keys.indexOf(this.stop() ?? ''));
    let to: number;
    switch (event.key) {
      case 'ArrowDown':
        to = Math.min(keys.length - 1, at + 1);
        break;
      case 'ArrowUp':
        to = Math.max(0, at - 1);
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = keys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const key = keys[to];
    this.pending.set(key);
    afterNextRender(() => this.focusOption(key), { injector: this.injector });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pick.emit(key), CATALOGUE_IDLE_MS);
  }

  private focusOption(key: string): void {
    this.host.querySelector<HTMLElement>(`[data-list="${key}"]`)?.focus();
  }
}
