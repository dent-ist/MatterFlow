import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { KeyboardShortcuts } from './keyboard-shortcuts';
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
        <div class="sh__switch">
          <label class="sh__switchlabel">
            <input
              type="checkbox"
              role="switch"
              data-shortcuts-switch
              [checked]="keyboard.enabled()"
              (change)="keyboard.setEnabled(asChecked($event))"
            />
            <span
              >Keyboard shortcuts: <strong>{{ keyboard.enabled() ? 'on' : 'off' }}</strong></span
            >
          </label>
          <p class="sh__switchnote">
            Turns off every single-key shortcut below (J, K, S, P, G then a letter, / and ?). Ctrl +
            K, Esc and the arrow keys keep working. Your choice is remembered for you on this
            browser.
          </p>
        </div>
        @for (group of registry.groups(); track group.id) {
          <section class="sh__group">
            <h3 class="sh__heading">{{ group.heading }}</h3>
            <dl class="sh__list">
              @for (item of group.items; track item.id) {
                <div class="sh__row">
                  <dt>
                    @for (k of item.keys; track k; let last = $last) {
                      <kbd>{{ k }}</kbd>
                      @if (!last && item.sequence) {
                        <span class="sh__then">then</span>
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
    .sh__switch {
      margin-bottom: var(--mf-s3);
      padding-bottom: var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .sh__switchlabel {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min, 2rem);
      cursor: pointer;
    }
    .sh__switchlabel input {
      width: 1.125rem;
      height: 1.125rem;
    }
    .sh__switchnote {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .sh__then {
      margin-right: var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
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
  protected readonly keyboard = inject(KeyboardShortcuts);

  protected asChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
