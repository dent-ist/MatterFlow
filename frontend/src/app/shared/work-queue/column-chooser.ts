import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Dismissable } from '../ui/dismissable';
import { WORK_COLUMNS, Density, normalizeColumns } from './column-prefs';

/** "Columns" and "Density" controls (UX 5.2): Ref and Title are always shown; the choice is remembered per user by the page. */
@Component({
  selector: 'mf-column-chooser',
  imports: [Dismissable],
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
          [mfDismissable]="btn"
          (dismissed)="open.set(false)"
        >
          <div class="cc-body" data-columns-scroll>
            <fieldset class="cc-set">
              <legend>Columns</legend>
              @if (note(); as n) {
                <p class="cc-view-note" data-columns-view-note>Modified by this view. {{ n }}</p>
              }
              @for (col of all; track col.key) {
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
    .cc {
      position: relative;
    }
    /* Same height as the Filters and More filters buttons beside it in the bar (UXR4-16): the compact 32 px. */
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
      .cc-body {
        flex-direction: column;
        gap: var(--mf-s3);
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

  /** The Group by choice (My Work, Active tab): None or Due. Hidden where the screen cannot group. */
  readonly groupable = input(false);
  readonly group = input<'due' | null>(null);

  readonly columnsChange = output<string[]>();
  readonly densityChange = output<Density>();
  readonly groupChange = output<'due' | null>();

  protected readonly all = WORK_COLUMNS;
  protected readonly open = signal(false);
  protected readonly announce = signal('');
  protected readonly isDefault = computed(() => {
    const def = this.defaults();
    return !!def && sameSet(normalizeColumns(def), normalizeColumns(this.columns()));
  });

  /** Room below the button, measured when the panel opens (the toolbar sits well below the header on a short window). */
  protected readonly maxHeight = signal<number | null>(null);

  protected togglePanel(btn: HTMLElement): void {
    if (!this.open()) {
      const room = window.innerHeight - btn.getBoundingClientRect().bottom - 4 - 12;
      this.maxHeight.set(Math.max(180, Math.floor(room)));
    }
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected reset(def: readonly string[]): void {
    this.columnsChange.emit(normalizeColumns(def));
    this.announce.set('Columns reset to the default set.');
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
