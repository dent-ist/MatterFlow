import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ServerFieldError } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import {
  CustomFieldsEditor,
  customFieldsProblems,
  splitFormErrors,
} from '../../../shared/ui/custom-fields';
import { SlidePanel } from '../../../shared/ui/slide-panel';
import { TextField } from '../../../shared/ui/text-field';

/**
 * Create or edit a Project in the shared side panel (MD-01 and MD-05, epic #1001). The Matter is fixed (the panel is opened from a Matter page or
 * from a project that already has one); it shows as the panel's subtitle. Leave `project` empty to create. After a save the panel closes and
 * `saved` carries the project, so the page refreshes its list (no navigation away from the page).
 */
@Component({
  selector: 'mf-project-panel',
  imports: [SlidePanel, TextField, CustomFieldsEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-slide-panel
      [title]="project() ? 'Edit project' : 'New project'"
      [subtitle]="matterLabel()"
      [primaryLabel]="project() ? 'Save changes' : 'Create project'"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [(visible)]="visible"
      (submitted)="save()"
    >
      @if (summary().length > 0) {
        <div class="pp__summary" role="alert" data-summary>
          Fix the following to save:
          <ul>
            @for (message of summary(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
        </div>
      }
      <form class="pp__form" novalidate (submit)="$event.preventDefault(); save()">
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
          [error]="serverErrors()['description']"
          [(value)]="description"
        />
        <mf-custom-fields-editor
          [versionId]="customVersionId()"
          [values]="customValues()"
          [serverErrors]="customErrors()"
          (touched)="customTouched.set(true)"
        />
      </form>
    </mf-slide-panel>
  `,
  styles: `
    .pp__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .pp__summary {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-overdue-solid);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
  `,
})
export class ProjectPanel {
  readonly matterId = input.required<number>();
  /** "00107-00001 Name", shown under the title. */
  readonly matterLabel = input('');
  /** The project to edit; null creates a new one. */
  readonly project = input<ProjectResponse | null>(null);
  readonly visible = model(false);
  readonly saved = output<ProjectResponse>();

  private readonly api = inject(ProjectsClient);
  private readonly notify = inject(NotificationService);
  private readonly customEditor = viewChild(CustomFieldsEditor);

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly summary = signal<string[]>([]);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly customVersionId = signal<number | null>(null);
  protected readonly customValues = signal<Record<string, unknown>>({});
  protected readonly customErrors = signal<ServerFieldError[]>([]);
  protected readonly customTouched = signal(false);

  protected readonly nameError = computed(() =>
    this.submitted() && this.name().trim() === ''
      ? 'Enter a project name.'
      : (this.serverErrors()['name'] ?? null),
  );
  protected readonly dirty = computed(() => {
    const p = this.project();
    return p
      ? this.name() !== p.name ||
          this.description() !== (p.description ?? '') ||
          this.customTouched()
      : this.name().trim() !== '' || this.description().trim() !== '' || this.customTouched();
  });

  constructor() {
    // Each opening starts from the project (or empty) so a cancelled edit never shows in the next one.
    effect(() => {
      if (!this.visible()) return;
      const p = this.project();
      untracked(() => {
        this.name.set(p?.name ?? '');
        this.description.set(p?.description ?? '');
        this.submitted.set(false);
        this.summary.set([]);
        this.serverErrors.set({});
        this.customErrors.set([]);
        this.customTouched.set(false);
        this.error.set('');
        if (p) {
          this.customVersionId.set(p.publishedFormVersionId ?? null);
          this.customValues.set({ ...(p.formValues ?? {}) });
        } else {
          this.customValues.set({});
          void this.loadCustomForm();
        }
      });
    });
  }

  private async loadCustomForm(): Promise<void> {
    try {
      const form = await firstValueFrom(this.api.getProjectCustomFieldForm());
      this.customVersionId.set(form.publishedFormVersionId ?? null);
    } catch {
      this.customVersionId.set(null);
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    this.error.set('');
    const existing = this.project();
    const problems: string[] = [];
    if (this.name().trim() === '') problems.push('Enter a project name.');
    this.customErrors.set([]);
    const custom = this.customEditor()?.collect(existing ? this.customValues() : undefined);
    problems.push(...customFieldsProblems(custom));
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }
    this.busy.set(true);
    try {
      const description = this.description().trim() || undefined;
      const saved = existing
        ? await firstValueFrom(
            this.api.updateProject(existing.projectId, {
              name: this.name().trim(),
              description,
              formValues: custom?.values,
              rowVersion: existing.rowVersion,
            }),
          )
        : await firstValueFrom(
            this.api.createProject({
              matterId: this.matterId(),
              name: this.name().trim(),
              description,
              formValues: custom?.values,
            }),
          );
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.notify.success(`Project ${saved.name} saved`);
      this.visible.set(false);
      this.saved.emit(saved);
    } catch (err) {
      const errors = serverFormErrors(err);
      const split = splitFormErrors(errors.fields);
      this.serverErrors.set(split.base);
      this.customErrors.set(split.form);
      this.summary.set(errors.summary);
      if (errors.conflict)
        this.error.set('This project was changed by someone else. Close the panel and reopen it.');
    } finally {
      this.busy.set(false);
    }
  }
}
