import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
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
import { NotificationService } from '../../../core/notify/notification.service';
import { metaNumber, serverFormErrors } from '../../../shared/forms/api-errors';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { TextField } from '../../../shared/ui/text-field';

type LoadState = 'loading' | 'ready' | 'error';

function matterOption(m: MatterResponse): PickerOption {
  return { id: m.matterId, label: `${m.matterRef} ${m.name}`, inactive: !m.isActive };
}

/**
 * Create and edit a Project (UX S07). The Matter is prefilled and locked when launched from a Matter (`?matterId=`) and on edit;
 * otherwise it is chosen with the typeahead. Archiving is a separate action on the detail page.
 */
@Component({
  selector: 'mf-project-form-page',
  imports: [RouterLink, Button, TextField, EntityPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <div>
        <p class="pg-crumbs">
          <a routerLink="/projects">Projects</a> &gt; {{ isEdit() ? 'Edit' : 'New' }}
        </p>
        <h1 class="pg-title">{{ isEdit() ? 'Edit Project' : 'New Project' }}</h1>
      </div>
    </header>

    @if (state() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true">Loading...</div>
    } @else if (state() === 'error') {
      <div class="pg-alert" role="alert">
        We couldn't load that.
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else {
      @if (conflict()) {
        <div class="pg-alert" role="alert" data-conflict>
          This project was changed by someone else.
          <p-button label="Reload latest" severity="secondary" (onClick)="load()" />
        </div>
      }
      @if (summary().length > 0) {
        <div class="pg-summary" role="alert" data-summary>
          Fix the following to save:
          <ul>
            @for (message of summary(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
          @if (existingId(); as existing) {
            <a class="pg-link" [routerLink]="['/projects', existing]">View the existing project</a>
          }
        </div>
      }

      <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
        <mf-entity-picker
          inputId="project-matter"
          label="Matter"
          placeholder="343-12 or matter name"
          [required]="true"
          [locked]="matterLocked()"
          [search]="searchMatters"
          [error]="matterError()"
          [(selected)]="matter"
        />

        <mf-text-field
          inputId="project-name"
          label="Project name"
          [required]="true"
          [maxLength]="200"
          [error]="nameError()"
          [(value)]="name"
        />

        <mf-text-field
          inputId="project-description"
          label="Description"
          [multiline]="true"
          [maxLength]="2000"
          [error]="fieldError('description')"
          [(value)]="description"
        />

        <div class="pg-actions">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : 'Save project'"
            [disabled]="busy()"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
        </div>
      </form>
    }
  `,
})
export class ProjectFormPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly projectId = input<string>();
  /** Query parameter: the Matter to create the Project in. */
  readonly matterId = input<string>();

  private readonly api = inject(ProjectsClient);
  private readonly matters = inject(MattersClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  protected readonly isEdit = computed(() => this.projectId() !== undefined);
  protected readonly matterLocked = computed(() => this.isEdit() || !!this.matterId());
  protected readonly state = signal<LoadState>('ready');
  protected readonly original = signal<ProjectResponse | null>(null);
  protected readonly matter = signal<PickerOption | null>(null);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly existingId = signal<number | null>(null);
  private saved = false;

  protected readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.matters.listMatters(query, undefined, undefined, undefined, 1, 8, undefined),
    );
    return page.items.map(matterOption);
  };

  protected readonly matterError = computed(() => {
    if (this.submitted() && !this.matter()) return 'Select a matter.';
    return this.fieldError('matterId');
  });

  protected readonly nameError = computed(() => {
    if (this.submitted() && this.name().trim() === '') return 'Enter a project name.';
    return this.fieldError('name');
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      const preselected = this.matterId();
      untracked(() => {
        if (id !== undefined) void this.load();
        else if (preselected) void this.preselectMatter(Number(preselected));
      });
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const o = this.original();
    if (this.isEdit()) {
      return !!o && (this.name() !== o.name || this.description() !== (o.description ?? ''));
    }
    return this.name().trim() !== '' || this.description().trim() !== '';
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    this.summary.set([]);
    try {
      const project = await firstValueFrom(this.api.getProject(Number(this.projectId())));
      this.original.set(project);
      this.name.set(project.name);
      this.description.set(project.description ?? '');
      this.matter.set({
        id: project.matterId,
        label: `${project.matterRef} ${project.matterName}`,
        inactive: !project.matterIsActive,
      });
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private async preselectMatter(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      this.matter.set(matterOption(await firstValueFrom(this.matters.getMatter(id))));
    } catch {
      // The picker simply stays empty; the user can search.
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    this.conflict.set(false);
    this.existingId.set(null);

    const problems: string[] = [];
    if (!this.matter()) problems.push('Select a matter.');
    if (this.name().trim() === '') problems.push('Enter a project name.');
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

    this.busy.set(true);
    try {
      const description = this.description().trim() || undefined;
      const saved = this.isEdit()
        ? await firstValueFrom(
            this.api.updateProject(Number(this.projectId()), {
              name: this.name().trim(),
              description,
              rowVersion: this.original()!.rowVersion,
            }),
          )
        : await firstValueFrom(
            this.api.createProject({
              matterId: this.matter()!.id,
              name: this.name().trim(),
              description,
            }),
          );
      this.saved = true;
      this.notify.success(`Project ${saved.name} saved`);
      await this.router.navigate(['/projects', saved.projectId]);
    } catch (err) {
      const errors = serverFormErrors(err);
      this.serverErrors.set(errors.fields);
      this.summary.set(errors.summary);
      this.conflict.set(errors.conflict);
      this.existingId.set(metaNumber(err, 'existingId'));
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    const id = this.projectId();
    const matter = this.matterId();
    void this.router.navigateByUrl(
      id ? `/projects/${id}` : matter ? `/matters/${matter}` : '/projects',
    );
  }
}
