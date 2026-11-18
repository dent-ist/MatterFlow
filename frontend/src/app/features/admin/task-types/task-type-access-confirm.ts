import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import type { AccessConfirm } from './task-type-access';

export type AccessDialogKind = 'closed' | 'checking' | 'error' | 'confirm';

/**
 * The question before the access rules are saved (#1402, mockup screens 06 to 08 and 15): `mf-confirm-dialog`, title "Save Access Rules". It opens only when the preview says
 * people lose view or edit, the type becomes open to everyone, or the caller loses access. A lead sentence and up to three fact lines say who and how many; the confirm is the
 * solid red button when the caller loses access. While the preview runs it shows quiet lines ("checking"); when the preview failed it offers Cancel and Retry only, so nobody
 * restricts a type without knowing how many people it hides. This body is longer than the one sentence of D-34: an exception recorded in the design guidelines (D-44ab).
 */
@Component({
  selector: 'mf-task-type-access-confirm',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialog],
  template: `
    <mf-confirm-dialog
      title="Save Access Rules"
      [visible]="kind() !== 'closed'"
      (visibleChange)="$event ? null : cancelled.emit()"
      [confirmLabel]="kind() === 'error' ? 'Retry' : 'Save Access Rules'"
      [showConfirm]="kind() === 'error' || kind() === 'confirm'"
      [danger]="kind() === 'confirm' && !!confirm()?.danger"
      [busy]="busy()"
      [error]="error()"
      (confirmed)="kind() === 'error' ? retry.emit() : confirmed.emit()"
    >
      @switch (kind()) {
        @case ('checking') {
          <div aria-busy="true" data-access-checking>
            <span class="mf-sr-only" role="status">Checking who is affected</span>
            <span class="ac__bar" aria-hidden="true"></span>
            <span class="ac__bar ac__bar--short" aria-hidden="true"></span>
          </div>
        }
        @case ('error') {
          <p data-access-preview-error>
            Couldn't check who is affected. Nothing was saved. Try again, or cancel.
          </p>
        }
        @case ('confirm') {
          @if (confirm(); as c) {
            <p class="ac__lead" data-access-lead>
              <strong>{{ c.lead }}</strong>
            </p>
            @if (c.lines.length > 0) {
              <ul class="ac__lines" data-access-lines>
                @for (l of c.lines; track l.text) {
                  <li [class.ac__warn]="l.warn" [class.ac__strong]="l.strong">
                    <i class="pi" [class]="l.icon" aria-hidden="true"></i>
                    <span>{{ l.text }}</span>
                  </li>
                }
              </ul>
            }
            @if (c.closing) {
              <p class="muted ac__closing" data-access-closing>{{ c.closing }}</p>
            }
          }
        }
      }
    </mf-confirm-dialog>
  `,
  styles: `
    .ac__lead {
      margin: 0 0 var(--mf-s3);
    }
    .ac__lines {
      display: grid;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      padding: 0;
      list-style: none;
    }
    .ac__lines li {
      display: flex;
      gap: var(--mf-s2);
      align-items: flex-start;
    }
    .ac__lines .pi {
      flex: none;
      margin-top: 1px;
      font-size: var(--mf-icon-md);
      color: var(--mf-text-muted);
    }
    .ac__warn .pi {
      color: var(--mf-sem-risk-fg);
    }
    .ac__strong {
      font-weight: var(--mf-fw-semibold);
    }
    .ac__closing {
      margin: 0;
    }
    .ac__bar {
      display: block;
      height: var(--mf-s4);
      margin-bottom: var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .ac__bar--short {
      width: 60%;
    }
  `,
})
export class TaskTypeAccessConfirm {
  readonly kind = input.required<AccessDialogKind>();
  readonly confirm = input<AccessConfirm | null>(null);
  readonly busy = input(false);
  /** Why the save failed after the question was answered: shown in the dialog, which stays open. */
  readonly error = input('');

  readonly confirmed = output<void>();
  readonly retry = output<void>();
  readonly cancelled = output<void>();
}
