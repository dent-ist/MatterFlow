import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  WorkflowDetail,
  WorkflowVersionStatus,
  WorkflowVersionSummary,
} from '../../../api/generated/api-client';
import { ActionMenu, MenuAction } from '../../../shared/ui/action-menu';
import { Badge, workflowStatusTone } from '../../../shared/ui/badge';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';

/** Why Create draft from this version is unavailable while a draft is in progress (WE4). */
export const DRAFT_EXISTS_REASON = 'A draft is already in progress. Open it or discard it first.';

/**
 * The Versions tab of the Workflow page (WE4, #392): every version with its status, mode, steps, Created, By and Tasks (open tasks, from the API;
 * a number the API did not send is never shown, and without any the column is left out), the version number as the link to the version page and
 * an overflow per row: Open, Create draft from this version (disabled with its reason while a draft exists; Open draft vN is offered instead),
 * Retire (a published version; the page opens the dialog). Rows are 44 px; below 640 px each version is a card.
 */
@Component({
  selector: 'mf-workflow-versions-tab',
  imports: [RouterLink, Badge, ActionMenu, MfDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', './workflow-versions-tab.scss'],
  template: `
    <section class="wv" aria-labelledby="wv-heading" data-versions-tab>
      <div class="wv__head">
        <h2 id="wv-heading" class="wv__title">Version history</h2>
        <p class="wv__help">
          Tasks run on a published version. Published versions cannot be edited; create a new draft
          to make changes.
        </p>
      </div>
      @if (detail().versions.length === 0) {
        <p class="wv__empty" data-no-versions>No versions yet.</p>
      } @else if (phone()) {
        <ul class="wv__cards" aria-label="Versions" data-version-cards>
          @for (v of detail().versions; track v.workflowVersionId) {
            <li class="wv__card" [attr.data-version]="v.versionNo">
              <div class="wv__card-top">
                <a
                  class="pg-link wv__link"
                  [routerLink]="link(v)"
                  [state]="carry()"
                  [attr.aria-label]="(isDraft(v) ? 'Edit draft v' : 'View v') + v.versionNo"
                  >v{{ v.versionNo }}</a
                >
                <mf-badge [tone]="tone(v)">{{ v.status }}</mf-badge>
                @if (isCurrent(v)) {
                  <mf-badge tone="success">Current</mf-badge>
                }
                <mf-action-menu
                  class="wv__menu"
                  [label]="'Actions for v' + v.versionNo"
                  [items]="menu(v)"
                  [floating]="true"
                />
              </div>
              <dl class="wv__facts">
                <div>
                  <dt>Mode</dt>
                  <dd>{{ v.isOrdered ? 'Ordered' : 'Unordered' }}</dd>
                </div>
                <div>
                  <dt>Steps</dt>
                  <dd>{{ v.stepCount }}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd [attr.title]="v.createdAtUtc | mfDate">
                    {{ v.createdAtUtc | mfDate: 'date' }}
                  </dd>
                </div>
                @if (v.createdByName) {
                  <div>
                    <dt>By</dt>
                    <dd>{{ v.createdByName }}</dd>
                  </div>
                }
                @if (showTasks()) {
                  <div>
                    <dt>Tasks</dt>
                    <dd>{{ tasks(v) }}</dd>
                  </div>
                }
              </dl>
            </li>
          }
        </ul>
      } @else {
        <div class="mf-table-wrap">
          <table class="pg-table mf-has-menu" data-version-table>
            <caption class="mf-sr-only">
              Versions of
              {{
                detail().workflow.name
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
                <th scope="col">Mode</th>
                <th scope="col" class="pg-num">Steps</th>
                <th scope="col">Created</th>
                <th scope="col">By</th>
                @if (showTasks()) {
                  <th scope="col" class="pg-num">Tasks</th>
                }
                <th scope="col" class="mf-col-menu"><span class="mf-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (v of detail().versions; track v.workflowVersionId) {
                <tr [attr.data-version]="v.versionNo">
                  <td class="wv__ver">
                    <a
                      class="pg-link wv__link"
                      [routerLink]="link(v)"
                      [state]="carry()"
                      [attr.aria-label]="(isDraft(v) ? 'Edit draft v' : 'View v') + v.versionNo"
                      >v{{ v.versionNo }}</a
                    >
                    @if (isCurrent(v)) {
                      <mf-badge class="wv__current" tone="success">Current</mf-badge>
                    }
                  </td>
                  <td>
                    <mf-badge [tone]="tone(v)">{{ v.status }}</mf-badge>
                  </td>
                  <td>{{ v.isOrdered ? 'Ordered' : 'Unordered' }}</td>
                  <td class="pg-num">{{ v.stepCount }}</td>
                  <td [attr.title]="v.createdAtUtc | mfDate">
                    {{ v.createdAtUtc | mfDate: 'date' }}
                  </td>
                  <td class="wv__by" [attr.title]="v.createdByName || null">
                    {{ v.createdByName || '' }}
                  </td>
                  @if (showTasks()) {
                    <td class="pg-num" data-version-tasks>{{ tasks(v) }}</td>
                  }
                  <td class="mf-col-menu">
                    <mf-action-menu
                      [label]="'Actions for v' + v.versionNo"
                      [items]="menu(v)"
                      [floating]="true"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (detail().workflow.draftVersionId) {
        <p class="wv__help" data-draft-note>
          A draft (v{{ detail().workflow.draftVersionNo }}) is in progress. Publish or discard it
          before creating another.
        </p>
      }
    </section>
  `,
})
export class WorkflowVersionsTab {
  readonly detail = input.required<WorkflowDetail>();
  /** True while a request of the page is running. */
  readonly busy = input(false);
  /** Router state that carries the list address on to the version page. */
  readonly carry = input<{ returnTo?: string; keepRow?: boolean } | undefined>(undefined);
  /** May the viewer create drafts and retire (the page is `Workflow.Manage`, so this is normally true). */
  readonly canChange = input(true);

  readonly newDraft = output<WorkflowVersionSummary>();
  readonly retire = output<WorkflowVersionSummary>();

  private readonly router = inject(Router);
  protected readonly phone = phoneCards();

  /** The Tasks column exists only when the API counted at least one version (a viewer without Task.View gets none). */
  protected readonly showTasks = computed(() =>
    this.detail().versions.some((v) => typeof v.openTaskCount === 'number'),
  );

  protected isDraft(v: WorkflowVersionSummary): boolean {
    return v.status === WorkflowVersionStatus.Draft;
  }

  protected isCurrent(v: WorkflowVersionSummary): boolean {
    return v.workflowVersionId === this.detail().workflow.publishedVersionId;
  }

  protected tone(v: WorkflowVersionSummary) {
    return workflowStatusTone(v.status);
  }

  protected link(v: WorkflowVersionSummary): unknown[] {
    return [
      '/admin/workflows',
      this.detail().workflow.workflowDefinitionId,
      'versions',
      v.workflowVersionId,
    ];
  }

  /** The open tasks of the version as the API counted them; a draft has none, a missing number stays "--" (never a made-up 0). */
  protected tasks(v: WorkflowVersionSummary): string {
    return typeof v.openTaskCount === 'number' ? String(v.openTaskCount) : '--';
  }

  protected menu(v: WorkflowVersionSummary): MenuAction[] {
    const w = this.detail().workflow;
    const items: MenuAction[] = [
      {
        id: 'open',
        label: this.isDraft(v) ? 'Open draft' : 'Open',
        icon: this.isDraft(v) ? 'pi-pencil' : 'pi-eye',
        run: () => void this.router.navigate(this.link(v), { state: this.carry() }),
      },
    ];
    if (!this.canChange() || this.isDraft(v)) return items;
    if (w.draftVersionId) {
      items.push({
        id: 'create-draft',
        label: 'Create draft from this version',
        icon: 'pi-plus',
        disabled: true,
        reason: DRAFT_EXISTS_REASON,
        run: () => undefined,
      });
      items.push({
        id: 'open-draft',
        label: `Open draft v${w.draftVersionNo}`,
        icon: 'pi-pencil',
        run: () =>
          void this.router.navigate(
            ['/admin/workflows', w.workflowDefinitionId, 'versions', w.draftVersionId],
            { state: this.carry() },
          ),
      });
    } else {
      items.push({
        id: 'create-draft',
        label: 'Create draft from this version',
        icon: 'pi-plus',
        disabled: this.busy(),
        run: () => this.newDraft.emit(v),
      });
    }
    if (v.status === WorkflowVersionStatus.Published) {
      items.push({
        id: 'retire',
        label: `Retire v${v.versionNo}`,
        icon: 'pi-ban',
        danger: true,
        separated: true,
        disabled: this.busy(),
        run: () => this.retire.emit(v),
      });
    }
    return items;
  }
}
