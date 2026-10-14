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
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { LocalTimePipe } from '../../../shared/pipes/local-time.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EntityActivity } from '../../../shared/ui/entity-activity';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { ScopedTasks } from '../../../shared/work-queue/scoped-tasks';

type Tab = 'tasks' | 'details' | 'activity';
type LoadState = 'loading' | 'ready' | 'error';

/** Project detail (UX S07): flat container of Tasks in a Matter; edit and archive/restore. */
@Component({
  selector: 'mf-project-detail-page',
  imports: [
    RouterLink,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterRef,
    EntityActivity,
    LocalTimePipe,
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
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @case ('ready') {
        @if (project(); as p) {
          <header class="pg-head">
            <div>
              <p class="pg-crumbs">
                <a routerLink="/matters">Matters</a> &gt;
                <a [routerLink]="['/matters', p.matterId]">{{ p.matterRef }}</a> &gt; Project:
                {{ p.name }}
              </p>
              <h1 class="pg-title">
                {{ p.name }}
                <span class="pg-chip" [class.pg-chip--inactive]="!p.isActive">{{
                  p.isActive ? 'Active' : 'Archived'
                }}</span>
              </h1>
              <p class="pg-muted" data-matter>
                Matter: <mf-matter-ref [value]="p.matterRef" [link]="['/matters', p.matterId]" />
                {{ p.matterName }}
              </p>
            </div>
            <div class="pg-actions">
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
          </header>

          @if (!p.isActive) {
            <div class="pg-banner" role="note" data-archived-banner>
              This project is archived. Existing tasks keep it, but new tasks can't select it.
            </div>
          }

          <div class="pg-tabs" role="tablist" aria-label="Project sections">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="tab() === 'tasks'"
              (click)="tab.set('tasks')"
            >
              Tasks
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
                [matterId]="p.matterId"
                [projectId]="p.projectId"
                [canCreate]="p.isActive"
              />
            }
            @case ('details') {
              <dl class="pg-dl">
                <dt>Name</dt>
                <dd>{{ p.name }}</dd>
                <dt>Description</dt>
                <dd>{{ p.description || 'No description' }}</dd>
                <dt>Matter</dt>
                <dd>{{ p.matterRef }} {{ p.matterName }}</dd>
                <dt>Status</dt>
                <dd>{{ p.isActive ? 'Active' : 'Archived' }}</dd>
                <dt>Created</dt>
                <dd>{{ p.createdAtUtc | localTime }}</dd>
                @if (p.modifiedAtUtc) {
                  <dt>Last changed</dt>
                  <dd>{{ p.modifiedAtUtc | localTime }}</dd>
                }
              </dl>
              <mf-custom-fields-view [versionId]="p.formVersionId" [values]="p.formValues ?? {}" />
            }
            @case ('activity') {
              <mf-entity-activity objectType="Project" [objectId]="p.projectId" />
            }
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

  private readonly api = inject(ProjectsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly state = signal<LoadState>('loading');
  protected readonly project = signal<ProjectResponse | null>(null);
  protected readonly tab = signal<Tab>('tasks');
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));

  constructor() {
    effect(() => {
      this.projectId();
      untracked(() => void this.load());
    });
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
