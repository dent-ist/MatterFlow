import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { ShortcutHelpState } from './shortcut-help-state';
import { ShortcutRegistry } from './shortcut-registry';

/** The `?` overlay: a dialog listing the keyboard shortcuts. Focus goes back to what was focused before it opened. */
@Component({
  selector: 'mf-shortcut-help',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-confirm-dialog
      title="Keyboard shortcuts"
      cancelLabel="Close"
      [showConfirm]="false"
      [(visible)]="state.open"
    >
      <div data-shortcut-help>
        @for (group of registry.groups(); track group.id) {
          <section class="sh__group">
            <h3 class="sh__heading">{{ group.heading }}</h3>
            <dl class="sh__list">
              @for (item of group.items; track item.id) {
                <div class="sh__row">
                  <dt>
                    @for (k of item.keys; track k; let last = $last) {
                      <kbd>{{ k }}</kbd>
                      @if (!last) {
                        <span class="sh__or" aria-hidden="true"> </span>
                      }
                    }
                  </dt>
                  <dd>{{ item.does }}</dd>
                </div>
              }
            </dl>
          </section>
        }
      </div>
    </mf-confirm-dialog>
  `,
  styles: `
    .sh__group + .sh__group {
      margin-top: var(--mf-s3);
    }
    .sh__heading {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-body);
      font-weight: 600;
    }
    .sh__list {
      margin: 0;
    }
    .sh__row {
      display: grid;
      grid-template-columns: 9rem 1fr;
      gap: var(--mf-s3);
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border);
    }
    .sh__row dt,
    .sh__row dd {
      margin: 0;
    }
    kbd {
      display: inline-block;
      min-width: 1.5rem;
      margin-right: var(--mf-s1);
      padding: 0 var(--mf-s1);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      font: inherit;
      font-size: var(--mf-fs-sm);
      text-align: center;
    }
  `,
})
export class ShortcutHelp {
  protected readonly registry = inject(ShortcutRegistry);
  protected readonly state = inject(ShortcutHelpState);
}
