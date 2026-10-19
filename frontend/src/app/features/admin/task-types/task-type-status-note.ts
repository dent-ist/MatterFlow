import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NoteFix, NoteReason } from './task-type-record';

/**
 * The one status note of the Task Type page (TE3, #384; the look of the Task page's status note, #301): grey, never warning colours, under
 * the header. It says that the type cannot be used for new tasks and names each reason with its fix as a link: the form is a route, adding
 * a workflow and activating are actions of the page (`fixed`). It is absent for a usable type (no reasons).
 */
@Component({
  selector: 'mf-task-type-status-note',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (reasons().length > 0) {
      <div class="sn" role="note" data-status-note>
        <i class="pi pi-info-circle sn__icon" aria-hidden="true"></i>
        <div class="sn__body">
          <p class="sn__lead" data-note-lead>Not usable for new tasks yet.</p>
          <ul class="sn__list">
            @for (r of reasons(); track r.code) {
              <li [attr.data-reason]="r.code">
                {{ r.text }}
                @if (r.fixLabel) {
                  @if (r.fix === 'form' && formLink(); as link) {
                    <a [routerLink]="link" [state]="linkState()" data-note-fix>{{ r.fixLabel }}</a>
                  } @else if (r.fix !== 'form') {
                    <button type="button" class="sn__fix" data-note-fix (click)="fixed.emit(r.fix)">
                      {{ r.fixLabel }}
                    </button>
                  }
                }
              </li>
            }
          </ul>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    /* Neutral on purpose (decision W): the surface, border and text tokens of a panel, no warning colours. */
    .sn {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
      line-height: 20px;
    }
    .sn__icon {
      flex: none;
      margin-top: 3px;
      color: var(--mf-text-muted);
    }
    .sn__body {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .sn__lead {
      margin: 0;
      font-weight: 600;
    }
    .sn__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sn__list li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--mf-s1);
    }
    a,
    .sn__fix {
      min-height: var(--mf-target-min, 24px);
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
    @media (forced-colors: active) {
      .sn {
        border-color: CanvasText;
      }
    }
  `,
})
export class TaskTypeStatusNote {
  readonly reasons = input.required<readonly NoteReason[]>();
  /** The request form designer of the type (a router link); absent while it cannot be opened. */
  readonly formLink = input<readonly unknown[] | null>(null);
  /** Router state that goes with the form link (the list view the page was opened from). */
  readonly linkState = input<Record<string, unknown> | undefined>(undefined);
  /** An action fix was chosen: Activate it, or Add one (the Workflows tab). */
  readonly fixed = output<Exclude<NoteFix, 'form'>>();
}
