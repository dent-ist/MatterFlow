import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { DetailLayout } from '../../../shared/ui/detail-layout';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { ScopedTasks } from '../../../shared/work-queue/scoped-tasks';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActiveBadge } from '../../../shared/ui/badge';
import { PageHeader, RecordTitle } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Project detail (UX S07): the project's Tasks grid in the main area and a Details panel on the right (fields, custom fields, Edit and
 * Archive / Restore). Activity opens in a right-side drawer from the header button; an old `?tab=activity` link opens it too.
 */
@Component({
  selector: 'mf-project-detail-page',
  imports: [
    PageHeader,
    RecordTitle,
    ActiveBadge,
    ErrorReference,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterRef,
    ActivityDrawer,
    DetailLayout,
    MfDatePipe,
    CustomFieldsView,
    ScopedTasks,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading the project...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't find that project.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (project(); as p) {
          <mf-page-header
            [crumbs]="[
              { label: 'Matters', link: '/matters' },
              { label: p.matterRef, link: ['/matters', p.matterId] },
              { label: p.name },
            ]"
          >
            <mf-record-title mfTitle [name]="p.name">
              <mf-active-badge [active]="p.isActive" inactiveLabel="Archived" />
            </mf-record-title>
            @if (canSeeActivity()) {
              <p-button
                mfActions
                label="Activity"
                icon="pi pi-history"
                severity="secondary"
                data-activity-button
                (onClick)="setActivityOpen(true)"
              />
            }
            <p class="pg-muted" data-matter>
              Matter: <mf-matter-ref [value]="p.matterRef" [link]="['/matters', p.matterId]" />
              {{ p.matterName }}
            </p>
          </mf-page-header>

          @if (!p.isActive) {
            <div class="pg-banner" role="note" data-archived-banner>
              This project is archived. Existing tasks keep it, but new tasks can't select it.
            </div>
          }

          <mf-detail-layout [collapsible]="true">
            <section mfMain aria-labelledby="project-tasks-h">
              <h2 id="project-tasks-h" class="pg-section-h">Tasks</h2>
              <mf-scoped-tasks
                [matterId]="p.matterId"
                [projectId]="p.projectId"
                [canCreate]="p.isActive"
              />
            </section>

            <div mfAside>
              <div class="pg-panel-actions">
                <p-button
                  *mfHasPermission="'Project.Edit'"
                  label="Edit"
                  severity="secondary"
                  (onClick)="go('/projects/' + p.projectId + '/edit')"
                />
                <p-button
                  *mfHasPermission="'Project.Archive'"
                  [label]="p.isActive ? 'Archive' : 'Restore'"
                  severity="secondary"
                  (onClick)="toggleOpen.set(true)"
                />
              </div>
              <dl class="pg-dl pg-dl--stacked">
                <dt>Name</dt>
                <dd>{{ p.name }}</dd>
                <dt>Description</dt>
                <dd>{{ p.description || 'No description' }}</dd>
                <dt>Matter</dt>
                <dd>
                  <mf-matter-ref [value]="p.matterRef" [link]="['/matters', p.matterId]" />
                  {{ p.matterName }}
                </dd>
                <dt>Status</dt>
                <dd><mf-active-badge [active]="p.isActive" inactiveLabel="Archived" /></dd>
                <dt>Created</dt>
                <dd>{{ p.createdAtUtc | mfDate }}</dd>
                @if (p.modifiedAtUtc) {
                  <dt>Last changed</dt>
                  <dd>{{ p.modifiedAtUtc | mfDate }}</dd>
                }
              </dl>
              <mf-custom-fields-view [versionId]="p.formVersionId" [values]="p.formValues ?? {}" />
            </div>
          </mf-detail-layout>

          @if (canSeeActivity()) {
            <mf-activity-drawer
              objectType="Project"
              [objectId]="p.projectId"
              [name]="p.name"
              [visible]="activityOpen()"
              (visibleChange)="setActivityOpen($event)"
            />
          }

          <mf-confirm-dialog
            [title]="p.isActive ? 'Archive project' : 'Restore project'"
            [confirmLabel]="p.isActive ? 'Archive' : 'Restore'"
            [danger]="p.isActive"
            [busy]="busy()"
            [(visible)]="toggleOpen"
            (confirmed)="toggleActive()"
          >
            @if (p.isActive) {
              <p data-toggle-body>
                Archive {{ p.name }}? Existing tasks keep this project, but new tasks can't select
                it.
              </p>
            } @else {
              <p data-toggle-body>Restore {{ p.name }}? New tasks can select it again.</p>
            }
          </mf-confirm-dialog>
        }
      }
    }
  `,
})
export class ProjectDetailPage {
  readonly projectId = input.required<string>();
  /** Old deep links: `activity` opens the drawer; other values just show the page. */
  readonly tab = input<string>();

  private readonly api = inject(ProjectsClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly state = signal<LoadState>('loading');
  protected readonly project = signal<ProjectResponse | null>(null);
  protected readonly activityOpen = signal(false);
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));

  constructor() {
    effect(() => {
      const p = this.project();
      if (p) this.pageTitle.set(p.name);
    });
    effect(() => {
      this.projectId();
      untracked(() => void this.load());
    });
    effect(() => {
      if (this.tab() === 'activity' && this.canSeeActivity()) {
        untracked(() => this.activityOpen.set(true));
      }
    });
  }

  protected setActivityOpen(open: boolean): void {
    this.activityOpen.set(open);
    if (!open && this.tab() === 'activity') {
      void this.router.navigate([], {
        queryParams: { tab: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.project.set(await firstValueFrom(this.api.getProject(Number(this.projectId()))));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected async toggleActive(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.setProjectActive(p.projectId, { isActive: !p.isActive, rowVersion: p.rowVersion }),
      );
      this.project.set(updated);
      this.toggleOpen.set(false);
      this.notify.success(updated.isActive ? 'Project restored' : 'Project archived');
    } catch {
      this.toggleOpen.set(false);
      await this.load(); // conflicts and failures are toasted by the HTTP layer; show the latest state
    } finally {
      this.busy.set(false);
    }
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
