import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A one-line, dismissible inline note under the tab row (UX review 2, R1; also the "That pod is not available to you" case of P1).
 * A polite status (`role="status"`), neutral colours, never an error. It is built for the Dashboard and kept apart from `mf-dash-state`
 * on purpose: nothing failed. The page decides when it shows and drops it on the next navigation; nothing is stored.
 */
@Component({
  selector: 'mf-dash-note',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="note" role="status" data-dash-note>
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <span class="text">{{ text() }}</span>
      <button
        type="button"
        class="close"
        data-dash-note-close
        aria-label="Dismiss this note"
        (click)="dismiss.emit()"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s3);
    }
    .note {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
    }
    .note > .pi {
      margin-top: 2px;
      color: var(--mf-text-muted);
    }
    .text {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .close {
      flex: none;
      min-width: 1.5rem;
      min-height: 1.5rem;
      padding: 0;
      color: var(--mf-text-muted);
      background: transparent;
      border: 0;
      border-radius: var(--mf-radius);
      cursor: pointer;
    }
    .close:hover {
      color: var(--mf-text);
      background: var(--mf-surface-alt);
    }
  `,
})
export class DashNote {
  readonly text = input.required<string>();
  readonly dismiss = output<void>();
}
