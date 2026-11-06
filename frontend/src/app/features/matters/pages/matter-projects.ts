import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Button } from 'primeng/button';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { ProjectResponse } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActiveBadge } from '../../../shared/ui/badge';
import { GridFrame } from '../../../shared/ui/grid-frame';
import { RowLink, registerTableSkip, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskCount } from '../../../shared/ui/task-count';
import { groupProjects } from './matter-project-groups';

/**
 * The Projects tab of a Matter (MD3, #273): the shared grid with Name (the one link, the description as a muted second line only when
 * there is one), Open tasks and Overdue (left out without Task.View) and Status. Active projects come first in natural order; Archived
 * projects are one collapsed group row, "Archived (7)", below them (a 36 px button row, `aria-expanded`, Enter and Space toggle it; the
 * state is kept for this visit only, and the group starts open when every project is archived). Rows are 44 px. The empty tab keeps its
 * New project action. New Project is a button above the grid and an entry of the page header's New menu.
 */
@Component({
  selector: 'mf-matter-projects',
  imports: [
    NgTemplateOutlet,
    Button,
    HasPermissionDirective,
    ActiveBadge,
    GridFrame,
    TaskCount,
    RowLink,
    ListToolbar,
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
    .mp-group .pi {
      font-size: var(--mf-icon-xs);
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
          label="New Project"
          icon="pi pi-plus"
          severity="secondary"
          data-empty-new-project
          (onClick)="newProject.emit()"
        />
      </div>
    } @else {
      <!-- A tab has no H1: its primary action ends the row above the grid (LC-07, #1045), as "New Task" does on the Tasks tab. The header's New menu keeps its Project entry. -->
      <mf-list-toolbar [filters]="filters" searchLabel="Search projects">
        <p-button
          mfPrimary
          *mfHasPermission="'Project.Create'"
          label="New Project"
          icon="pi pi-plus"
          data-new-project
          (onClick)="newProject.emit()"
        />
      </mf-list-toolbar>
      <mf-grid-frame scrollLabel="Projects list">
        <table class="pg-table tt" data-matter-projects>
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
                <th scope="col" class="pg-num">Open Tasks</th>
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
                    class="mf-btn mf-btn--text"
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
      </mf-grid-frame>
      @if (shown() < total()) {
        <p class="pg-reason" data-projects-truncated>Showing the first {{ shown() }} projects.</p>
      }
    }

    <ng-template #row let-p>
      <tr data-project-row>
        <td class="mp-name" [class.mp-name--desc]="!!p.description">
          <div class="pg-namecell">
            <a
              class="mf-link pg-name"
              data-project-name
              [attr.href]="'/projects/' + p.projectId"
              (click)="open($event, p)"
              mfRowLink="matter-projects"
              [rowKey]="p.projectId"
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
  /** The empty tab's New project button: the page opens the side panel. */
  readonly newProject = output<void>();
  /** A project row was chosen: the page opens the side panel with the project's linked tasks (a modified click still opens the project page). */
  readonly openProject = output<ProjectResponse>();

  private readonly auth = inject(AuthStore);

  constructor() {
    registerTableSkip();
    // The projects arrive with the matter, so the rows are there as soon as the tab is.
    // A project left from the collapsed Archived group: focus goes to the group's toggle (the group stays collapsed, as on every visit).
    restoreRowFocus(
      'matter-projects',
      () => true,
      (key) =>
        this.groups().archived.some((p) => String(p.projectId) === key)
          ? document.querySelector<HTMLElement>('[data-archived-toggle]')
          : null,
    );
  }

  /** Counts come back empty without Task.View: the two columns are not drawn then. */
  protected readonly counts = computed(() => this.auth.has('Task.View'));
  protected readonly columns = computed(() => (this.counts() ? 4 : 2));
  protected readonly shown = computed(() => this.projects().length);
  /** Search finds a project by name among the ones the tab loaded (all of a matter's projects, a few dozen at most). */
  protected readonly filters = new ListFilters({
    screen: 'matter-projects',
    noun: 'projects',
    defs: [{ key: 'pname', label: 'Name', type: 'text', search: true }],
  });
  private readonly visible = computed(() => {
    const q = this.filters.text('pname').trim().toLowerCase();
    return q ? this.projects().filter((p) => p.name.toLowerCase().includes(q)) : this.projects();
  });
  protected readonly groups = computed(() =>
    groupProjects(this.visible(), this.total() <= this.projects().length),
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

  protected open(event: MouseEvent, p: ProjectResponse): void {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.openProject.emit(p);
  }

  protected toggleArchived(): void {
    this.chosen.set(!this.archivedOpen());
  }
}
