import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Dismissable } from './dismissable';
import {
  DEFAULT_GRID_PREFS,
  GridColumnDef,
  GridPrefs,
  isShown,
  moveKey,
  orderedKeys,
  withVisible,
} from './grid-prefs';

/**
 * The Columns button of a grid (epic #1001, MD-28, #1032): a panel with one row per column to show or hide it (a locked column is shown and cannot be
 * hidden), "Move left" and "Move right" buttons per shown column (the keyboard way to reorder; dragging a header is the pointer way,
 * `mfReorder`), and "Reset to default" (order and visibility; widths stay). It changes nothing itself: it emits the new `GridPrefs` and the grid
 * keeps and stores them (`grid-prefs.ts`).
 *
 * ```html
 * <mf-grid-columns [defs]="defs" [prefs]="prefs()" (prefsChange)="setPrefs($event)" (resetColumns)="resetPrefs()" />
 * ```
 */
@Component({
  selector: 'mf-grid-columns',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    /* The surface is the shared menu (mf-menu, D-36); only where it opens is here. */
    .gc-panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      right: 0;
      width: max-content;
    }
    .gc-title {
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .gc-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .gc-row {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h);
    }
    .gc-label {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--mf-s2);
    }
    .gc-foot {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--mf-s2);
      padding-top: var(--mf-s2);
      border-top: 1px solid var(--mf-border-soft);
    }
  `,
  template: `
    <button
      #btn
      type="button"
      class="mf-btn"
      data-grid-columns
      aria-haspopup="true"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      (click)="open.set(!open())"
    >
      <i class="pi pi-table" aria-hidden="true"></i>
      Columns
    </button>
    @if (open()) {
      <div
        class="gc-panel mf-menu"
        role="group"
        aria-label="Columns"
        data-grid-columns-panel
        [id]="panelId"
        [mfDismissable]="btn"
        (dismissed)="open.set(false)"
      >
        <div class="mf-menu__body">
          <p class="gc-title">Show, hide and order the columns</p>
          <ul class="gc-list">
            @for (c of rows(); track c.def.key) {
              <li class="gc-row" [attr.data-row]="c.def.key">
                <label class="gc-label">
                  <input
                    type="checkbox"
                    [attr.data-column]="c.def.key"
                    [checked]="c.shown"
                    [disabled]="c.def.locked"
                    (change)="toggle(c.def.key, $any($event.target).checked)"
                  />
                  {{ c.def.label }}
                </label>
                @if (c.shown && !c.def.pinned) {
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    [attr.data-move]="c.def.key + ':left'"
                    [attr.aria-label]="'Move ' + c.def.label + ' left'"
                    [attr.aria-disabled]="c.canLeft ? null : 'true'"
                    (click)="move(c.def.key, -1)"
                  >
                    <i class="pi pi-arrow-left" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    [attr.data-move]="c.def.key + ':right'"
                    [attr.aria-label]="'Move ' + c.def.label + ' right'"
                    [attr.aria-disabled]="c.canRight ? null : 'true'"
                    (click)="move(c.def.key, 1)"
                  >
                    <i class="pi pi-arrow-right" aria-hidden="true"></i>
                  </button>
                }
              </li>
            }
          </ul>
          <div class="gc-foot">
            <button type="button" class="mf-btn" data-grid-columns-reset (click)="resetAll()">
              Reset to Default
            </button>
          </div>
          <span class="mf-sr-only" role="status" data-grid-columns-status>{{ status() }}</span>
        </div>
      </div>
    }
  `,
})
export class GridColumns {
  private static nextId = 0;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly panelId = `gc-panel-${GridColumns.nextId++}`;

  /** The columns this person may have (the grid leaves out the ones their permissions hide). */
  readonly defs = input.required<readonly GridColumnDef[]>();
  readonly prefs = input<GridPrefs>(DEFAULT_GRID_PREFS);
  readonly prefsChange = output<GridPrefs>();
  readonly resetColumns = output<void>();

  protected readonly open = signal(false);
  protected readonly status = signal('');

  protected readonly rows = computed(() => {
    const defs = this.defs();
    const prefs = this.prefs();
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const keys = orderedKeys(defs, prefs);
    const shown = keys.filter((k) => isShown(byKey.get(k)!, prefs));
    const movable = shown.filter((k) => !byKey.get(k)!.pinned);
    return keys.map((k) => {
      const def = byKey.get(k)!;
      const at = movable.indexOf(k);
      return {
        def,
        shown: isShown(def, prefs),
        canLeft: at > 0,
        canRight: at >= 0 && at < movable.length - 1,
      };
    });
  });

  protected toggle(key: string, on: boolean): void {
    const prefs = this.prefs();
    const visible = withVisible(this.defs(), prefs, key, on);
    this.prefsChange.emit({ order: orderedKeys(this.defs(), prefs), visible });
    this.status.set(`${this.label(key)} ${on ? 'shown' : 'hidden'}`);
  }

  protected move(key: string, delta: -1 | 1): void {
    const prefs = this.prefs();
    const next = moveKey(this.defs(), prefs, key, delta);
    if (next.join() === orderedKeys(this.defs(), prefs).join()) return;
    this.prefsChange.emit({ order: next, visible: prefs.visible });
    this.status.set(`${this.label(key)} moved ${delta < 0 ? 'left' : 'right'}`);
    // The row is re-inserted by the list: give the pressed button its focus back.
    setTimeout(() =>
      this.host
        .querySelector<HTMLElement>(`[data-move="${key}:${delta < 0 ? 'left' : 'right'}"]`)
        ?.focus(),
    );
  }

  protected resetAll(): void {
    this.resetColumns.emit();
    this.status.set('Columns reset to the default');
  }

  private label(key: string): string {
    return this.defs().find((d) => d.key === key)?.label ?? key;
  }
}
