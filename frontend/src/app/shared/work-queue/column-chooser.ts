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
import { Dismissable } from '../ui/dismissable';
import { ColumnScope, ColumnDef, WORK_COLUMNS, Density, normalizeColumns } from './column-prefs';
import { ColumnWidthsPanel } from './column-widths-panel';
import {
  canSuggestClosed,
  loadSuggestionDismissed,
  saveSuggestionDismissed,
  swapClosedForDue,
  swapDueForClosed,
} from './closed-suggestion';
import { WorkWidths } from './work-widths';

/** The panel's groups (#230): what a column is for. The table keeps the canonical `WORK_COLUMNS` order. */
const GROUPS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'Task', keys: ['ref', 'title', 'type', 'workflow', 'progress'] },
  { label: 'Where', keys: ['matter', 'client', 'project'] },
  { label: 'Who', keys: ['assignee', 'pod', 'creator', 'requestor'] },
  { label: 'When', keys: ['due', 'created', 'updated', 'closed', 'age'] },
  { label: 'State', keys: ['priority', 'status'] },
];

/** "Columns" and "Density" controls (UX 5.2): Ref and Title are always shown; the choice is remembered per user by the page. */
@Component({
  selector: 'mf-column-chooser',
  imports: [Dismissable, ColumnWidthsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cc">
      <button
        #btn
        type="button"
        class="mf-btn cc-button"
        [attr.aria-controls]="open() ? 'cc-panel' : null"
        [attr.aria-expanded]="open()"
        (click)="togglePanel(btn)"
      >
        <i class="pi pi-table" aria-hidden="true"></i>
        Columns
      </button>
      @if (open()) {
        <div
          id="cc-panel"
          class="cc-panel"
          role="group"
          aria-label="Table columns, density and grouping"
          data-columns-panel
          [style.--cc-max.px]="maxHeight()"
          [style.--cc-maxw.px]="maxWidth()"
          [mfDismissable]="btn"
          (dismissed)="open.set(false)"
        >
          <div class="cc-body" data-columns-scroll>
            <div class="cc-cols" role="group" aria-label="Columns">
              @if (note(); as n) {
                <p class="cc-view-note" data-columns-view-note>Modified by this view. {{ n }}</p>
              }
              @if (showRestore()) {
                <p class="cc-suggest" data-columns-suggest="restore">
                  <span>Closed is shown instead of Due.</span>
                  <button
                    type="button"
                    class="mf-btn mf-btn--text"
                    data-columns-restore-due
                    (click)="restoreDue()"
                  >
                    Restore Due
                  </button>
                </p>
              } @else if (showSuggestion()) {
                <p class="cc-suggest" data-columns-suggest="closed">
                  <span>Showing finished tasks: show Closed instead of Due</span>
                  <button
                    type="button"
                    class="mf-btn mf-btn--text"
                    data-columns-show-closed
                    (click)="showClosed()"
                  >
                    Show Closed
                  </button>
                  <button
                    type="button"
                    class="mf-btn mf-btn--text"
                    data-columns-suggest-dismiss
                    aria-label="Dismiss the Closed suggestion"
                    (click)="dismissSuggestion()"
                  >
                    Dismiss
                  </button>
                </p>
              }
              @for (group of groups; track group.label) {
                <fieldset class="cc-set" [attr.data-columns-group]="group.label">
                  <legend>{{ group.label }}</legend>
                  @for (col of group.columns; track col.key) {
                    <label class="cc-check">
                      <input
                        type="checkbox"
                        [checked]="col.locked || columns().includes(col.key)"
                        [disabled]="col.locked"
                        (change)="toggle(col.key)"
                      />
                      {{ col.label }}
                      @if (col.locked) {
                        <span class="cc-note">(always shown)</span>
                      }
                    </label>
                  }
                </fieldset>
              }
            </div>
            <div class="cc-side">
              <fieldset class="cc-set">
                <legend>Density</legend>
                <label class="cc-check">
                  <input
                    type="radio"
                    name="cc-density"
                    [checked]="density() === 'comfortable'"
                    (change)="densityChange.emit('comfortable')"
                  />
                  Comfortable
                </label>
                <label class="cc-check">
                  <input
                    type="radio"
                    name="cc-density"
                    [checked]="density() === 'compact'"
                    (change)="densityChange.emit('compact')"
                  />
                  Compact
                </label>
              </fieldset>
              @if (groupable()) {
                <fieldset class="cc-set" data-group-set>
                  <legend>Group by</legend>
                  <label class="cc-check">
                    <input
                      type="radio"
                      name="cc-group"
                      [checked]="group() === null"
                      (change)="groupChange.emit(null)"
                    />
                    None
                  </label>
                  <label class="cc-check">
                    <input
                      type="radio"
                      name="cc-group"
                      data-group-due
                      [checked]="group() === 'due'"
                      (change)="groupChange.emit('due')"
                    />
                    Due
                  </label>
                </fieldset>
              }
            </div>
            @if (widthScope(); as scope) {
              <mf-column-widths-panel
                [columns]="columns()"
                [scope]="scope"
                [userId]="widthUser()"
                [assignLink]="widthAssignLink()"
                (announced)="say($event)"
              />
            }
          </div>
          <div class="cc-foot">
            @if (defaults(); as def) {
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-columns-reset
                [disabled]="isDefault()"
                (click)="reset(def)"
              >
                Reset columns
              </button>
            }
            @if (widthScope()) {
              <button
                type="button"
                class="mf-btn mf-btn--text cc-widths-reset"
                data-widths-reset
                [attr.aria-disabled]="hasWidths() ? null : 'true'"
                (click)="resetWidths()"
              >
                Reset all widths
              </button>
            }
            <button type="button" class="mf-btn cc-done" data-columns-close (click)="close()">
              Done
            </button>
          </div>
          <span class="mf-sr-only" role="status" aria-live="polite" data-columns-live>{{
            announce()
          }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .cc-view-note {
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .cc-suggest {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s2);
      grid-column: 1 / -1;
      margin: 0;
      font-size: var(--mf-fs-xs);
    }
    .cc {
      position: relative;
    }
    /* Same height as the Filters and Other filters buttons beside it in the bar (UXR4-16): the compact 32 px. */
    .cc-button {
      min-height: var(--mf-row-h-compact);
    }
    .cc-panel {
      position: absolute;
      right: 0;
      z-index: 5;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      /* Never taller than the window below the header (a fixed-header page cannot scroll to it): the list scrolls, the footer stays. */
      max-height: min(36rem, var(--cc-max, calc(100dvh - var(--mf-header-h, 3.75rem) - 16px)));
      margin-top: var(--mf-s1);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2);
    }
    /* Scroll shadow: the gradients stay at the edges (scroll) and are covered by the fading surface layers (local) until content is cut. */
    .cc-body {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      gap: var(--mf-s5);
      min-height: 0;
      padding: var(--mf-s4);
      overflow-y: auto;
      overscroll-behavior: contain;
      background:
        linear-gradient(var(--mf-surface) 30%, transparent) top / 100% 1.5rem no-repeat local,
        linear-gradient(transparent, var(--mf-surface) 70%) bottom / 100% 1.5rem no-repeat local,
        linear-gradient(rgb(0 0 0 / 0.18), transparent) top / 100% 0.5rem no-repeat scroll,
        linear-gradient(transparent, rgb(0 0 0 / 0.18)) bottom / 100% 0.5rem no-repeat scroll;
    }
    .cc-foot {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s4);
      border-top: 1px solid var(--mf-border);
    }
    .cc-done {
      margin-left: auto;
    }
    .cc-foot {
      flex-wrap: wrap;
    }
    .cc-widths-reset[aria-disabled='true'] {
      opacity: 0.5;
      cursor: default;
    }
    @media (max-width: 639.98px) {
      .cc-widths-reset {
        display: none;
      }
    }
    /* The groups sit in two columns where there is room (#230); Density and Group by stand beside them. */
    .cc-cols {
      display: grid;
      grid-template-columns: repeat(2, max-content);
      align-content: start;
      gap: var(--mf-s3) var(--mf-s5);
    }
    .cc-cols .cc-view-note {
      grid-column: 1 / -1;
      margin: 0;
    }
    .cc-side {
      display: grid;
      align-content: start;
      gap: var(--mf-s3);
    }
    .cc-panel {
      width: max-content;
      max-width: min(46rem, var(--cc-maxw, calc(100vw - 2rem)));
    }
    /* A phone: the panel is a bottom sheet, full width, at most 70% of the screen. */
    @media (max-width: 480px) {
      .cc-panel {
        position: fixed;
        inset: auto 0 0 0;
        max-height: 70dvh;
        margin: 0;
        border-radius: var(--mf-radius) var(--mf-radius) 0 0;
        z-index: 1100;
      }
      .cc-panel {
        width: auto;
        max-width: none;
      }
      .cc-body {
        flex-direction: column;
        flex-wrap: nowrap;
        gap: var(--mf-s3);
      }
      .cc-cols {
        grid-template-columns: 1fr;
      }
    }
    .cc-set {
      display: grid;
      align-content: start;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .cc-set legend {
      font-weight: 600;
    }
    .cc-check {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min);
      white-space: nowrap;
    }
    .cc-note {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
  `,
})
export class ColumnChooser {
  readonly columns = input.required<readonly string[]>();
  /** The current tab's default column set. When given, the panel offers "Reset columns" (disabled while the set already is the default). */
  readonly defaults = input<readonly string[] | null>(null);
  readonly density = input<Density>('comfortable');
  /** Set while a quick view's overlay changes the shown set ("Modified by this view"). */
  readonly note = input<string | null>(null);
  /** The Status filter holds only finished tasks and no view overlay already swaps the columns (#231): the panel may suggest Closed. */
  readonly finishedOnly = input(false);

  /** The Group by choice (My Work, Active tab): None or Due. Hidden where the screen cannot group. */
  readonly groupable = input(false);
  readonly group = input<'due' | null>(null);

  /** Where the widths of this grid live (`columnScope`); null hides "Column widths" (a grid whose widths cannot be edited). */
  readonly widthScope = input<ColumnScope | null>(null);
  readonly widthUser = input<number | null>(null);
  /** Pod Work: the Assignee default is wider where "Assign to me" sits beside "Unassigned". */
  readonly widthAssignLink = input(false);

  readonly columnsChange = output<string[]>();
  readonly densityChange = output<Density>();
  readonly groupChange = output<'due' | null>();

  protected readonly groups: readonly { label: string; columns: ColumnDef[] }[] = GROUPS.map(
    (g) => ({
      label: g.label,
      columns: g.keys.map((k) => WORK_COLUMNS.find((c) => c.key === k)!),
    }),
  );
  private readonly widthStore = inject(WorkWidths);
  protected readonly hasWidths = computed(() => {
    const scope = this.widthScope();
    return !!scope && this.widthStore.has(scope, this.widthUser());
  });
  protected readonly open = signal(false);
  private readonly swapped = signal(false);
  private readonly dismissed = signal(loadSuggestionDismissed());
  protected readonly showSuggestion = computed(
    () => this.finishedOnly() && !this.dismissed() && canSuggestClosed(this.columns()),
  );
  protected readonly showRestore = computed(
    () => this.finishedOnly() && this.swapped() && !this.columns().includes('due'),
  );

  constructor() {
    // Leaving the finished-only filter forgets the swap; the user's set is not changed.
    effect(() => {
      if (!this.finishedOnly()) untracked(() => this.swapped.set(false));
    });
  }
  protected readonly announce = signal('');
  protected readonly isDefault = computed(() => {
    const def = this.defaults();
    return !!def && sameSet(normalizeColumns(def), normalizeColumns(this.columns()));
  });

  /** Room below the button, measured when the panel opens (the toolbar sits well below the header on a short window). */
  protected readonly maxHeight = signal<number | null>(null);
  protected readonly maxWidth = signal<number | null>(null);

  protected togglePanel(btn: HTMLElement): void {
    if (!this.open()) {
      const room = window.innerHeight - btn.getBoundingClientRect().bottom - 4 - 12;
      this.maxHeight.set(Math.max(180, Math.floor(room)));
      // The panel hangs from the button's right edge and must not run over the side navigation: it is at most as wide as the room to the left of it.
      const left = btn.closest('main')?.getBoundingClientRect().left ?? 0;
      this.maxWidth.set(Math.max(280, Math.floor(btn.getBoundingClientRect().right - left - 8)));
    }
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }

  /** A polite message; the same text twice in a row is announced again. */
  protected say(text: string): void {
    this.announce.set('');
    queueMicrotask(() => this.announce.set(text));
  }

  protected resetWidths(): void {
    const scope = this.widthScope();
    if (!scope || !this.hasWidths()) return;
    this.widthStore.resetAll(scope, this.widthUser());
    this.say('All column widths reset to the default.');
  }

  protected reset(def: readonly string[]): void {
    this.columnsChange.emit(normalizeColumns(def));
    this.announce.set('Columns reset to the default set.');
  }

  protected showClosed(): void {
    this.swapped.set(true);
    this.columnsChange.emit(swapDueForClosed(this.columns()));
    this.say('Showing Closed instead of Due.');
  }

  protected restoreDue(): void {
    this.swapped.set(false);
    this.columnsChange.emit(swapClosedForDue(this.columns()));
    this.say('Showing Due again.');
  }

  protected dismissSuggestion(): void {
    this.dismissed.set(true);
    saveSuggestionDismissed();
    this.say('Suggestion dismissed.');
  }

  protected toggle(key: string): void {
    const current = this.columns();
    this.columnsChange.emit(
      normalizeColumns(
        current.includes(key) ? current.filter((c) => c !== key) : [...current, key],
      ),
    );
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}
