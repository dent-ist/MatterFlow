import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { Badge } from '../../../shared/ui/badge';

/**
 * The action bar of the workflow version page (VP1, #357). It sits under the page header and stays under the application header while
 * the page scrolls, so Publish and Save draft never leave the screen (they were at y = -1,097 after one wheel scroll).
 *
 *   draft:      [Unsaved changes]                       [Save draft] [Publish...] [...  Discard draft]
 *   read-only:                                          [Create new draft from vN | Open draft vM] [...  Retire version]
 *
 * The page owns the data and the dialogs; this bar only shows the buttons and says what was pressed. The order in the DOM is the
 * visual order, the primary action is the last button before the overflow, and no shortcut is attached to any of them.
 */
@Component({
  selector: 'mf-workflow-version-bar',
  imports: [Button, RouterLink, ActionMenu, Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: sticky;
      /* Directly under the application header (sticky at the top of the page, z-index 20; its box is one step taller than the variable). */
      top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s1));
      z-index: 6;
      display: block;
      margin-bottom: var(--mf-s4);
    }
    .wvb {
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
    .wvb__state {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      margin-right: auto;
    }
    .wvb__state mf-badge {
      flex: none;
    }
    .wvb__name {
      min-width: 0;
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* A phone keeps its room for the buttons: the name is already in the heading above. */
    @media (max-width: 639.98px) {
      .wvb__name {
        display: none;
      }
    }
    .wvb__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .wvb__link {
      text-decoration: none;
    }
  `,
  template: `
    <div class="wvb" role="group" aria-label="Version actions" data-action-bar>
      <div class="wvb__state">
        <span class="wvb__name" data-bar-name>{{ name() }} v{{ versionNo() }}</span>
        @if (editable() && dirty()) {
          <mf-badge tone="warning" icon="pi-pencil" data-dirty>Unsaved changes</mf-badge>
        }
      </div>
      <div class="wvb__actions">
        @if (editable()) {
          <p-button
            label="Save draft"
            severity="secondary"
            [disabled]="busy() || !dirty()"
            (onClick)="save.emit()"
          />
          <p-button
            label="Publish..."
            [disabled]="busy() || !canPublish()"
            (onClick)="publish.emit()"
          />
        } @else if (draftVersionId(); as d) {
          <a
            class="mf-btn mf-btn--primary wvb__link"
            data-open-draft
            [routerLink]="['/admin/workflows', workflowId(), 'versions', d]"
            >Open draft v{{ draftVersionNo() }}</a
          >
        } @else {
          <p-button
            [label]="'Create new draft from v' + versionNo()"
            [disabled]="busy()"
            (onClick)="newDraft.emit()"
          />
        }
        <mf-action-menu label="More version actions" [items]="menu()" />
      </div>
    </div>
  `,
})
export class WorkflowVersionBar {
  readonly workflowId = input.required<string>();
  readonly name = input('');
  readonly versionNo = input.required<number>();
  /** A draft: it can be saved, published and discarded. Otherwise the version is read-only. */
  readonly editable = input(false);
  /** A published version can be retired (from the overflow). */
  readonly published = input(false);
  readonly dirty = input(false);
  readonly busy = input(false);
  /** False while the draft has no steps. */
  readonly canPublish = input(true);
  /** The workflow's open draft (read-only versions link to it instead of offering a second one). */
  readonly draftVersionId = input<number | null | undefined>(null);
  readonly draftVersionNo = input<number | null | undefined>(null);

  readonly save = output<void>();
  readonly publish = output<void>();
  readonly discard = output<void>();
  readonly retire = output<void>();
  readonly newDraft = output<void>();

  protected readonly menu = computed<MenuAction[]>(() => {
    if (this.editable()) {
      return [
        {
          id: 'discard',
          label: 'Discard draft',
          icon: 'pi-trash',
          danger: true,
          disabled: this.busy(),
          run: () => this.discard.emit(),
        },
      ];
    }
    return this.published()
      ? [
          {
            id: 'retire',
            label: 'Retire version',
            icon: 'pi-ban',
            danger: true,
            disabled: this.busy(),
            run: () => this.retire.emit(),
          },
        ]
      : [];
  });
}
