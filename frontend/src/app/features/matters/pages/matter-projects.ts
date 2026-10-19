import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { ProjectResponse } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge } from '../../../shared/ui/badge';
import { ScrollArea } from '../../../shared/ui/fixed-page';
import { TaskCount } from '../../../shared/ui/task-count';
import { groupProjects } from './matter-project-groups';

/**
 * The Projects tab of a Matter (MD3, #273): the shared grid with Name (the one link, the description as a muted second line only when
 * there is one), Open tasks and Overdue (left out without Task.View) and Status. Active projects come first in natural order; Archived
 * projects are one collapsed group row, "Archived (7)", below them (a 36 px button row, `aria-expanded`, Enter and Space toggle it; the
 * state is kept for this visit only, and the group starts open when every project is archived). Rows are 44 px. The empty tab keeps its
 * New project action. New project itself lives in the page header's overflow.
 */
@Component({
  selector: 'mf-matter-projects',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    Button,
    HasPermissionDirective,
    ActiveBadge,
    ScrollArea,
    TaskCount,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .mp-name {
      width: 100%;
      min-width: 14rem;
      max-width: 0;
    }
    .mp-name--desc .pg-name {
      display: -webkit-box;
      -webkit-line-clamp: 1;
      line-clamp: 1;
    }
    .mp-desc {
      display: block;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pg-table .mp-group th {
      height: 36px;
      padding: 0 var(--mf-s2);
      border-bottom: 1px solid var(--mf-border-strong);
    }
    .mp-group button {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
      padding: 0 var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .mp-group button:hover {
      background: var(--mf-surface);
    }
    .mp-group .pi {
      font-size: var(--mf-fs-xs);
    }
    .mp-group__count {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
  `,
  template: `
    @if (projects().length === 0) {
      <div class="pg-state" data-empty="projects">
        No projects in this matter yet.
        <p-button
          *mfHasPermission="'Project.Create'"
          label="New project"
          icon="pi pi-plus"
          severity="secondary"
          data-empty-new-project
          (onClick)="go('/projects/new?matterId=' + matterId())"
        />
      </div>
    } @else {
      <div class="mf-scroll" mfScrollArea="Projects list">
        <table class="pg-table" data-matter-projects>
          <caption class="pg-sr">
            Projects of
            {{
              matterRef()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              @if (counts()) {
                <th scope="col" class="pg-num">Open tasks</th>
                <th scope="col" class="pg-num">Overdue</th>
              }
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (p of groups().active; track p.projectId) {
              <ng-container *ngTemplateOutlet="row; context: { $implicit: p }" />
            }
            @if (groups().archived.length > 0) {
              <tr class="mp-group" data-group="archived">
                <th scope="colgroup" [attr.colspan]="columns()">
                  <button
                    type="button"
                    data-archived-toggle
                    [attr.aria-expanded]="archivedOpen() ? 'true' : 'false'"
                    (click)="toggleArchived()"
                  >
                    <i
                      class="pi"
                      [class.pi-chevron-down]="archivedOpen()"
                      [class.pi-chevron-right]="!archivedOpen()"
                      aria-hidden="true"
                    ></i>
                    <span
                      >Archived
                      <span class="mp-group__count"
                        >({{ groups().archived.length
                        }}<span class="mf-sr-only">{{ archivedWord() }}</span
                        >)</span
                      ></span
                    >
                  </button>
                </th>
              </tr>
              @if (archivedOpen()) {
                @for (p of groups().archived; track p.projectId) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: p }" />
                }
              }
            }
          </tbody>
        </table>
      </div>
      @if (shown() < total()) {
        <p class="pg-reason" data-projects-truncated>Showing the first {{ shown() }} projects.</p>
      }
    }

    <ng-template #row let-p>
      <tr data-project-row>
        <td class="mp-name" [class.mp-name--desc]="!!p.description">
          <div class="pg-namecell">
            <a
              class="pg-link pg-name"
              data-project-name
              [routerLink]="['/projects', p.projectId]"
              [title]="p.name"
              >{{ p.name }}</a
            >
          </div>
          @if (p.description) {
            <span class="mp-desc" data-project-description [title]="p.description">{{
              p.description
            }}</span>
          }
        </td>
        @if (counts()) {
          <td class="pg-num">
            <mf-task-count
              kind="open"
              scope="project"
              [recordId]="p.projectId"
              [name]="p.name"
              [count]="p.openTaskCount ?? 0"
            />
          </td>
          <td class="pg-num">
            <mf-task-count
              kind="overdue"
              scope="project"
              [recordId]="p.projectId"
              [name]="p.name"
              [count]="p.overdueTaskCount ?? 0"
            />
          </td>
        }
        <td><mf-active-badge [active]="p.isActive" inactiveLabel="Archived" /></td>
      </tr>
    </ng-template>
  `,
})
export class MatterProjects {
  readonly matterId = input.required<number>();
  readonly matterRef = input('');
  /** The matter's projects as loaded (one request at the API's page maximum). */
  readonly projects = input.required<readonly ProjectResponse[]>();
  /** How many projects the matter has, so a list cut at the page maximum says so instead of looking complete. */
  readonly total = input(0);

  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);

  /** Counts come back empty without Task.View: the two columns are not drawn then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly columns = computed(() => (this.counts() ? 4 : 2));
  protected readonly shown = computed(() => this.projects().length);
  protected readonly groups = computed(() =>
    groupProjects(this.projects(), this.total() <= this.projects().length),
  );
  /** What the person chose for this visit; until then the group is open only when there is nothing else to show. */
  private readonly chosen = signal<boolean | null>(null);
  protected readonly archivedOpen = computed(
    () => this.chosen() ?? this.groups().active.length === 0,
  );

  /** What the count counts, for assistive technology: " project" or " projects" (the visible group header is just "Archived (7)"). */
  protected readonly archivedWord = computed(() =>
    this.groups().archived.length === 1 ? ' project' : ' projects',
  );

  protected toggleArchived(): void {
    this.chosen.set(!this.archivedOpen());
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
