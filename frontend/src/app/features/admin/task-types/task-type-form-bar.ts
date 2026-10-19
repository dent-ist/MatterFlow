import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Button } from 'primeng/button';
import { Badge } from '../../../shared/ui/badge';

/**
 * The action bar of the form designer (FD1, #407), the same pattern as the workflow version page's bar. It sits under the page header
 * and stays under the application header while a narrow page scrolls; on the fixed-height page the whole header stays anyway.
 *
 *   draft:      [Versions (3)] [Unsaved changes]  Draft v4 saved.            [Save draft] [Publish...]
 *   read-only:  [Versions (3)]                                    [Retire version] [Open draft v4 | Create new draft]
 *
 * The page owns the data and the dialogs; this bar only shows the buttons and says what was pressed. The primary action is the last
 * button and no keyboard shortcut is attached to any of them.
 */
@Component({
  selector: 'mf-form-designer-bar',
  imports: [Button, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: sticky;
      /* Directly under the application header (it sticks at the top of the page, z-index 20). */
      top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s1));
      z-index: 6;
      display: block;
      margin-bottom: var(--mf-s3);
    }
    .fdb {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2) var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      box-shadow: 0 4px 6px -4px rgb(0 0 0 / 16%);
    }
    .fdb__state {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      margin-right: auto;
    }
    .fdb__notice {
      min-width: 0;
      color: var(--mf-success-text);
      overflow-wrap: anywhere;
    }
    .fdb__notice:empty {
      display: none;
    }
    .fdb__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      margin-left: auto;
    }
  `,
  template: `
    <div class="fdb" role="group" aria-label="Form actions" data-action-bar>
      <div class="fdb__state">
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-versions
          aria-haspopup="dialog"
          (click)="versions.emit($any($event.currentTarget))"
        >
          Versions ({{ versionCount() }})
        </button>
        @if (!readOnly() && dirty()) {
          <mf-badge tone="warning" icon="pi-pencil" data-dirty>Unsaved changes</mf-badge>
        }
        <span class="fdb__notice" role="status" aria-live="polite" data-notice>{{ notice() }}</span>
      </div>
      <div class="fdb__actions">
        @if (!readOnly()) {
          <p-button
            label="Save draft"
            severity="secondary"
            [disabled]="!dirty() || busy()"
            (onClick)="save.emit()"
          />
          <p-button label="Publish..." [disabled]="busy()" (onClick)="publish.emit()" />
        } @else {
          @if (published()) {
            <p-button
              label="Retire version"
              severity="secondary"
              [disabled]="busy()"
              (onClick)="retire.emit()"
            />
          }
          @if (draftNo(); as d) {
            <p-button
              [label]="'Open draft v' + d"
              data-open-draft
              [disabled]="busy()"
              (onClick)="openDraft.emit()"
            />
          } @else {
            <p-button label="Create new draft" [disabled]="busy()" (onClick)="newDraft.emit()" />
          }
        }
      </div>
    </div>
  `,
})
export class FormDesignerBar {
  /** A published or retired version: it cannot be edited. */
  readonly readOnly = input(false);
  /** The shown version is the published one (it can be retired). */
  readonly published = input(false);
  readonly dirty = input(false);
  readonly busy = input(false);
  readonly versionCount = input(0);
  /** The version number of the open draft, when there is one (a read-only version links to it instead of offering a second draft). */
  readonly draftNo = input<number | null>(null);
  /** What just happened ("Draft v2 saved."), announced politely. */
  readonly notice = input('');

  readonly save = output<void>();
  readonly publish = output<void>();
  readonly retire = output<void>();
  readonly newDraft = output<void>();
  readonly openDraft = output<void>();
  readonly versions = output<HTMLElement>();
}
