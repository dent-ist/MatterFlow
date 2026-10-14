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
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  MatterResponse,
  MattersClient,
  ProjectResponse,
  ProjectsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EntityActivity } from '../../../shared/ui/entity-activity';
import { MatterAssets } from '../../../shared/ui/matter-assets';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { ScopedTasks } from '../../../shared/work-queue/scoped-tasks';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActiveBadge } from '../../../shared/ui/badge';
import { PageHeader, RecordTitle } from '../../../shared/ui/page-header';

type Tab = 'tasks' | 'projects' | 'assets' | 'details' | 'activity';
type LoadState = 'loading' | 'ready' | 'error';

/**
 * Matter detail (UX S06): reference with copy button, sensitivity and inactive banners, activation with the open-task rule,
 * and Tasks / Projects / Assets / Details / Activity tabs (Tasks is the shared work-queue table filtered to the Matter).
 */
@Component({
  selector: 'mf-matter-detail-page',
  imports: [
    PageHeader,
    RecordTitle,
    ActiveBadge,
    ErrorReference,
    RouterLink,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterRef,
    MatterAssets,
    EntityActivity,
    MfDatePipe,
    CustomFieldsView,
    ScopedTasks,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading the matter...</div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert">
          We couldn't find that matter.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (matter(); as m) {
          <mf-page-header
            [crumbs]="[
              { label: 'Matters', link: '/matters' },
              { label: m.matterRef + ' ' + m.name },
            ]"
          >
            <mf-record-title mfTitle [name]="m.name">
              <mf-matter-ref mfRef [value]="m.matterRef" />
              <mf-active-badge [active]="m.isActive" />
            </mf-record-title>
            <span *mfHasPermission="'Matter.SetActive'" mfActions class="pg-toggle">
              <p-button
                [label]="m.isActive ? 'Set inactive' : 'Set active'"
                severity="secondary"
                [disabled]="deactivateBlocked()"
                [attr.aria-describedby]="deactivateBlocked() ? 'matter-toggle-reason' : null"
                (onClick)="toggleOpen.set(true)"
              />
              @if (deactivateBlocked()) {
                <span class="pg-reason" id="matter-toggle-reason" data-toggle-reason>
                  This matter has {{ m.openTaskCount }} tasks that aren't Completed or Cancelled.
                  Finish or cancel them first.
                </span>
              }
            </span>
            <p-button
              mfActions
              *mfHasPermission="'Matter.Edit'"
              label="Edit"
              severity="secondary"
              (onClick)="go('/matters/' + m.matterId + '/edit')"
            />
            <p-button
              mfActions
              *mfHasPermission="'Project.Create'"
              label="New project"
              icon="pi pi-plus"
              severity="secondary"
              (onClick)="go('/projects/new?matterId=' + m.matterId)"
            />
            <p-button
              mfActions
              *mfHasPermission="'Task.Create'"
              label="Create task in this matter"
              icon="pi pi-plus"
              [disabled]="!m.isActive"
              (onClick)="go('/tasks/new?matterId=' + m.matterId)"
            />
            <p class="pg-muted" data-client>
              Client:
              <a class="pg-link" [routerLink]="['/clients', m.clientId]"
                ><span class="pg-mono">{{ m.clientNumber }}</span> {{ m.clientName }}</a
              >
            </p>
          </mf-page-header>

          @if (m.isSensitive) {
            <div class="pg-banner" role="note" data-sensitive-banner>
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              <strong> Sensitive matter.</strong> Handle its tasks and assets with extra care. This
              flag is a warning only and does not restrict who can see them.
            </div>
          }
          @if (!m.isActive) {
            <div class="pg-banner" role="note" data-inactive-banner>
              This matter is inactive. New tasks can't be created and completed or cancelled tasks
              can't be reopened.
            </div>
          }
          @if (!m.clientIsActive) {
            <div class="pg-banner" role="note" data-client-inactive-banner>
              The client {{ m.clientNumber }} is inactive.
            </div>
          }

          <div class="pg-tabs" role="tablist" aria-label="Matter sections">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'tasks'"
              (click)="tab.set('tasks')"
            >
              Tasks ({{ m.openTaskCount ?? 0 }} open)
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'projects'"
              (click)="tab.set('projects')"
            >
              Projects ({{ m.projectCount }})
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'assets'"
              (click)="tab.set('assets')"
            >
              Assets
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'details'"
              (click)="tab.set('details')"
            >
              Details
            </button>
            @if (canSeeActivity()) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="tab() === 'activity'"
                (click)="tab.set('activity')"
              >
                Activity
              </button>
            }
          </div>

          @switch (tab()) {
            @case ('tasks') {
              <mf-scoped-tasks
                [matterId]="m.matterId"
                [canCreate]="m.isActive"
                [showCreate]="false"
              />
            }
            @case ('projects') {
              @if (projects().length === 0) {
                <div class="pg-state" data-empty="projects">No projects in this matter yet.</div>
              } @else {
                <table class="pg-table">
                  <caption class="pg-sr">
                    Projects of
                    {{
                      m.matterRef
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Description</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (p of projects(); track p.projectId) {
                      <tr>
                        <td>
                          <a class="pg-link" [routerLink]="['/projects', p.projectId]">{{
                            p.name
                          }}</a>
                        </td>
                        <td>{{ p.description }}</td>
                        <td>
                          <mf-active-badge [active]="p.isActive" inactiveLabel="Archived" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            }
            @case ('assets') {
              @if (canSeeAssets()) {
                <mf-matter-assets [matterId]="m.matterId" />
              } @else {
                <div class="pg-state" data-no-access="assets">
                  You don't have permission to view assets.
                </div>
              }
            }
            @case ('details') {
              <dl class="pg-dl">
                <dt>Matter reference</dt>
                <dd><mf-matter-ref [value]="m.matterRef" /></dd>
                <dt>Client</dt>
                <dd>{{ m.clientNumber }} {{ m.clientName }}</dd>
                <dt>Matter number</dt>
                <dd class="pg-mono">{{ m.matterNumber }}</dd>
                <dt>Name</dt>
                <dd>{{ m.name }}</dd>
                <dt>Status</dt>
                <dd>{{ m.isActive ? 'Active' : 'Inactive' }}</dd>
                <dt>Sensitive</dt>
                <dd>{{ m.isSensitive ? 'Yes (warning only)' : 'No' }}</dd>
                <dt>Created</dt>
                <dd>{{ m.createdAtUtc | mfDate }}</dd>
                @if (m.modifiedAtUtc) {
                  <dt>Last changed</dt>
                  <dd>{{ m.modifiedAtUtc | mfDate }}</dd>
                }
              </dl>
              <mf-custom-fields-view [versionId]="m.formVersionId" [values]="m.formValues ?? {}" />
            }
            @case ('activity') {
              <mf-entity-activity objectType="Matter" [objectId]="m.matterId" />
            }
          }

          <mf-confirm-dialog
            [title]="m.isActive ? 'Set matter inactive' : 'Reactivate matter'"
            [confirmLabel]="m.isActive ? 'Set inactive' : 'Set active'"
            [danger]="m.isActive"
            [busy]="busy()"
            [(visible)]="toggleOpen"
            (confirmed)="toggleActive()"
          >
            @if (m.isActive) {
              <p data-toggle-body>
                Set {{ m.matterRef }} inactive? New tasks can't be created and completed or
                cancelled tasks can't be reopened until it's active again.
              </p>
            } @else {
              <p data-toggle-body>
                Reactivate {{ m.matterRef }}? New tasks can be created for it again.
              </p>
            }
          </mf-confirm-dialog>

          <mf-confirm-dialog
            title="Can't set this matter inactive"
            cancelLabel="Close"
            [showConfirm]="false"
            [(visible)]="blockedOpen"
          >
            <p data-blocked-body>
              This matter has {{ blockedCount() }} tasks that aren't Completed or Cancelled. Finish
              or cancel them first.
            </p>
            <p-button
              *mfHasPermission="'Task.View'"
              label="View open tasks"
              severity="secondary"
              (onClick)="go('/tasks?matterId=' + m.matterId)"
            />
          </mf-confirm-dialog>
        }
      }
    }
  `,
  styles: `
    .pg-toggle {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--mf-s1);
    }
  `,
})
export class MatterDetailPage {
  readonly matterId = input.required<string>();

  private readonly api = inject(MattersClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly projectsApi = inject(ProjectsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly state = signal<LoadState>('loading');
  protected readonly matter = signal<MatterResponse | null>(null);
  protected readonly projects = signal<ProjectResponse[]>([]);
  protected readonly tab = signal<Tab>('tasks');
  protected readonly toggleOpen = signal(false);
  protected readonly blockedOpen = signal(false);
  protected readonly blockedCount = signal(0);
  protected readonly busy = signal(false);
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  protected readonly canSeeAssets = computed(() => this.auth.has('Asset.View'));
  /** Deactivation is disabled with a visible reason while Tasks are open (UX 5.7). */
  protected readonly deactivateBlocked = computed(() => {
    const m = this.matter();
    return !!m && m.isActive && (m.openTaskCount ?? 0) > 0;
  });

  constructor() {
    effect(() => {
      const m = this.matter();
      if (m) this.pageTitle.set(m.matterRef + ' ' + m.name);
    });
    effect(() => {
      this.matterId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const id = Number(this.matterId());
    this.state.set('loading');
    try {
      const [matter, projects] = await Promise.all([
        firstValueFrom(this.api.getMatter(id)),
        this.auth.has('Project.View')
          ? firstValueFrom(this.projectsApi.listProjects(undefined, id, undefined, 1, 100, 'name'))
          : Promise.resolve(null),
      ]);
      this.matter.set(matter);
      this.projects.set(projects?.items ?? []);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected async toggleActive(): Promise<void> {
    const m = this.matter();
    if (!m) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.setMatterActive(m.matterId, { isActive: !m.isActive, rowVersion: m.rowVersion }),
      );
      this.matter.set({ ...updated, openTaskCount: m.openTaskCount });
      this.toggleOpen.set(false);
      this.notify.success(updated.isActive ? 'Matter reactivated' : 'Matter set inactive');
    } catch (err) {
      this.toggleOpen.set(false);
      if (err instanceof ApiError && err.code === 'MATTER_HAS_OPEN_TASKS') {
        const count = err.problem?.meta?.['openTaskCount'];
        this.blockedCount.set(typeof count === 'number' ? count : 0);
        this.blockedOpen.set(true);
      } else {
        await this.load(); // conflicts and failures are toasted by the HTTP layer; show the latest state
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
