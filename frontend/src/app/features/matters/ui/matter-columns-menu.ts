import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { Dismissable } from '../../../shared/ui/dismissable';

/** The optional columns of the Matters list (PM v2, #881). The default set shows none of them. */
export type MatterExtraColumn = 'onHold' | 'atRisk' | 'dataSize' | 'pending';

export interface MatterExtraColumnChoice {
  readonly key: MatterExtraColumn;
  readonly label: string;
}

const STORAGE_KEY = 'mf.matters.columns';

/** The remembered choice (a per-viewer convenience: any storage failure means the default, none). */
export function loadExtraColumns(allowed: readonly MatterExtraColumn[]): MatterExtraColumn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? allowed.filter((k) => list.includes(k)) : [];
  } catch {
    return [];
  }
}

export function saveExtraColumns(columns: readonly MatterExtraColumn[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  } catch {
    /* private window or blocked storage: the choice just does not survive a reload */
  }
}

/**
 * "Columns" (PM v2, #881): a button with a small panel of checkboxes for the optional columns of the Matters list (On hold, At risk, Data size,
 * Pending disposition). Name, Client and the rest are always there; the default is none of the extras. The page keeps and remembers the choice.
 */
@Component({
  selector: 'mf-matter-columns-menu',
  imports: [Dismissable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }
    .mcm-panel {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      right: 0;
      min-width: 14rem;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-2);
    }
    .mcm-title {
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mcm-row {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
    }
  `,
  template: `
    <button
      #btn
      type="button"
      class="mf-btn"
      data-matter-columns
      [attr.aria-expanded]="open()"
      aria-controls="matter-columns-panel"
      (click)="open.set(!open())"
    >
      <i class="pi pi-table" aria-hidden="true"></i>
      Columns
    </button>
    @if (open()) {
      <div
        id="matter-columns-panel"
        class="mcm-panel"
        role="group"
        aria-label="Optional columns"
        data-matter-columns-panel
        [mfDismissable]="btn"
        (dismissed)="open.set(false)"
      >
        <p class="mcm-title">Add to the table</p>
        @for (c of choices(); track c.key) {
          <label class="mcm-row">
            <input
              type="checkbox"
              [attr.data-column]="c.key"
              [checked]="selected().includes(c.key)"
              (change)="toggle(c.key, $any($event.target).checked)"
            />
            {{ c.label }}
          </label>
        }
      </div>
    }
  `,
})
export class MatterColumnsMenu {
  /** The columns this viewer may have (the page leaves out the ones their permissions hide). */
  readonly choices = input.required<readonly MatterExtraColumnChoice[]>();
  readonly selected = input.required<readonly MatterExtraColumn[]>();
  readonly changed = output<readonly MatterExtraColumn[]>();

  protected readonly open = signal(false);

  protected toggle(key: MatterExtraColumn, on: boolean): void {
    const next = this.choices()
      .map((c) => c.key)
      .filter((k) => (k === key ? on : this.selected().includes(k)));
    this.changed.emit(next);
  }
}
