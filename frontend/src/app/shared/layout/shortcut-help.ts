import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { ShortcutHelpState } from './shortcut-help-state';

interface Shortcut {
  keys: string[];
  does: string;
}

interface ShortcutGroup {
  heading: string;
  items: Shortcut[];
}

/** Only shortcuts that exist. Add a line here in the same change that adds a shortcut. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    heading: 'Anywhere',
    items: [
      { keys: ['Ctrl', 'K'], does: 'Search matters, clients, tasks and assets (Cmd + K on a Mac)' },
      { keys: ['?'], does: 'Show or hide this list' },
      { keys: ['Esc'], does: 'Close a menu, list or dialog and return to where you were' },
    ],
  },
  {
    heading: 'Task Queue',
    items: [{ keys: ['/'], does: 'Go to the filter search box' }],
  },
  {
    heading: 'Menus and lists',
    items: [
      { keys: ['Enter', 'Space'], does: 'Open a menu or choose the highlighted option' },
      { keys: ['↑', '↓'], does: 'Move through the options of a menu or search results' },
    ],
  },
  {
    heading: 'Tabs',
    items: [
      { keys: ['←', '→'], does: 'Switch to the previous or next tab' },
      { keys: ['Home', 'End'], does: 'Go to the first or last tab' },
    ],
  },
];

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
        @for (group of groups; track group.heading) {
          <section class="sh__group">
            <h3 class="sh__heading">{{ group.heading }}</h3>
            <dl class="sh__list">
              @for (item of group.items; track item.does) {
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
  protected readonly groups = SHORTCUT_GROUPS;
  protected readonly state = inject(ShortcutHelpState);
}
