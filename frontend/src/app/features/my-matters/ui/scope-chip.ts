import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The current scope as a removable chip beside the page title (MM-20, #1053): "Client > Matter" (or "Client > all matters"), with an x that clears it back to all. It shows
 * whether the Client and Matters tree is open or on its rail. A long name is cut with an ellipsis and the whole text is the tooltip.
 */
@Component({
  selector: 'mf-mm-scope-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <span class="sc" data-scope-chip [attr.title]="label()">
        <i class="pi pi-sitemap" aria-hidden="true"></i>
        <span class="tx">{{ label() }}</span>
        <button
          type="button"
          class="x"
          data-clear-scope
          [attr.aria-label]="'Clear scope: ' + label()"
          (click)="clear.emit()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
    }
    .sc {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      max-width: 100%;
      padding: 0 var(--mf-s1) 0 var(--mf-s3);
      min-height: 28px;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-pill);
      background: var(--mf-surface);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .tx {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: var(--mf-radius-pill);
      background: none;
      color: inherit;
      cursor: pointer;
    }
    .x:hover {
      background: var(--mf-surface-hover, var(--mf-bg));
    }
  `,
})
export class MmScopeChip {
  /** The scope in words, or empty for "everything" (no chip). */
  readonly label = input('');
  readonly clear = output<void>();
}
