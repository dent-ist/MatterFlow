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
import { StepDefinitionDetail, StepDefinitionsClient } from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TextField } from '../../../shared/ui/text-field';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageTitle } from '../../../core/title/page-title';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/** True for an empty value or a full http(s) address (mirrors the server rule). */
export function isValidDocumentationUrl(value: string): boolean {
  const text = value.trim();
  if (text === '') return true;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Admin: create or edit a library step (UX S15). Title, description, instructions and documentation link live here; the data inputs are
 * the step's form, edited with the form designer at `/admin/steps/:id/form`. Editing never changes published workflows (addendum A);
 * deactivating hides the step from new workflow drafts. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-step-edit-page',
  imports: [PageHeader, ErrorReference, RouterLink, Button, TextField, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      [crumbs]="[
        { label: 'Workflow Steps', link: '/admin/steps' },
        { label: isEdit() ? original()?.title || 'Edit' : 'New' },
      ]"
      [heading]="isEdit() ? 'Edit step' : 'New step'"
    />

    @if (state() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true">Loading the step...</div>
    } @else if (state() === 'error') {
      <div class="pg-alert" role="alert">
        We couldn't load that step.
        <mf-error-reference />
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else {
      @if (isEdit()) {
        <div class="pg-banner" data-banner>
          Editing this step doesn't change workflows that are already published. Workflows pick up
          changes only when you publish a new workflow version.
        </div>
      }
      @if (conflict()) {
        <div class="pg-alert" role="alert" data-conflict>
          This step was changed by someone else.
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
        </div>
      }

      <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
        <mf-text-field
          inputId="step-title"
          label="Title"
          [required]="true"
          [maxLength]="200"
          [error]="titleError()"
          [(value)]="title"
        />
        <mf-text-field
          inputId="step-description"
          label="Description"
          help="A short explanation shown in the workflow."
          [maxLength]="1000"
          [error]="fieldError('description')"
          [(value)]="description"
        />
        <mf-text-field
          inputId="step-instructions"
          label="Instructions"
          help="The detailed procedure. Plain text with line breaks."
          [multiline]="true"
          [maxLength]="20000"
          [error]="fieldError('instructions')"
          [(value)]="instructions"
        />
        <mf-text-field
          inputId="step-url"
          label="Documentation URL"
          help="Optional link to the full procedure, starting with https://"
          [maxLength]="1000"
          [error]="urlError()"
          [(value)]="documentationUrl"
        />

        <section aria-labelledby="step-inputs-heading" data-inputs>
          <h2 id="step-inputs-heading" class="pg-label">Data inputs</h2>
          <p class="pg-muted">
            Operational values recorded on the task (for example items in, items out, QC result).
            These are not staff or billing metrics.
          </p>
          @if (original(); as o) {
            <p class="pg-muted" data-inputs-state>{{ inputsSummary() }}</p>
            @if (o.formDefinitionId) {
              <a
                class="pg-link"
                data-form-link
                [routerLink]="['/admin/steps', o.stepDefinitionId, 'form']"
                >Edit inputs in the form designer</a
              >
            }
          } @else {
            <p class="pg-muted" data-inputs-state>Save the step first, then add its inputs.</p>
          }
        </section>

        @if (original(); as o) {
          <section aria-labelledby="step-usage-heading" data-usage>
            <h2 id="step-usage-heading" class="pg-label">Used by</h2>
            @if (o.usage.length === 0) {
              <p class="pg-muted">No workflow uses this step yet.</p>
            } @else {
              <ul>
                @for (u of o.usage; track u.workflowVersionId) {
                  <li>
                    {{ u.workflowName }} v{{ u.versionNo }}
                    <span class="pg-muted">({{ statusLabel(u.status) }})</span>
                  </li>
                }
              </ul>
            }
          </section>
        }

        <div class="pg-actions">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : isEdit() ? 'Save changes' : 'Create step'"
            [disabled]="busy()"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
          @if (original(); as o) {
            @if (o.isActive) {
              <p-button
                label="Deactivate"
                severity="secondary"
                [disabled]="busy()"
                (onClick)="deactivateOpen.set(true)"
              />
            } @else {
              <p-button
                label="Activate"
                severity="secondary"
                [disabled]="busy()"
                (onClick)="activate()"
              />
            }
          }
        </div>
      </form>
    }

    <mf-confirm-dialog
      title="Deactivate step?"
      confirmLabel="Deactivate step"
      cancelLabel="Keep active"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="deactivateOpen"
      (confirmed)="deactivate()"
    >
      <p>
        This step will be hidden from new workflow drafts. Published workflows that already use it
        are not changed, and you can activate it again later.
      </p>
    </mf-confirm-dialog>
  `,
})
export class StepEditPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly stepId = input<string>();

  private readonly api = inject(StepDefinitionsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);

  protected readonly isEdit = computed(() => this.stepId() !== undefined);
  protected readonly state = signal<LoadState>('ready');
  protected readonly original = signal<StepDefinitionDetail | null>(null);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly instructions = signal('');
  protected readonly documentationUrl = signal('');
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly deactivateOpen = signal(false);
  private saved = false;

  protected readonly titleError = computed(() => {
    if (this.submitted() && this.title().trim() === '') return 'Enter a title.';
    return this.fieldError('title');
  });

  protected readonly urlError = computed(() => {
    if (this.submitted() && !isValidDocumentationUrl(this.documentationUrl())) {
      return 'Enter a full web address starting with http:// or https://.';
    }
    return this.fieldError('documentationUrl');
  });

  protected readonly inputsSummary = computed(() => {
    const o = this.original();
    if (!o) return '';
    if (o.publishedFormVersionId) {
      return o.draftFormFieldCount > 0
        ? 'The inputs are published. A newer draft is in progress.'
        : 'The inputs are published.';
    }
    return o.draftFormFieldCount > 0
      ? 'The inputs are in draft. Publish them before this step can be published in a workflow.'
      : 'This step has no inputs yet.';
  });

  constructor() {
    effect(() => {
      if (this.stepId() !== undefined) untracked(() => void this.load());
    });
    effect(() => {
      const title = this.original()?.title;
      if (title) this.pageTitle.set(title);
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const o = this.original();
    if (this.isEdit()) {
      return (
        !!o &&
        (this.title() !== o.title ||
          this.description() !== (o.description ?? '') ||
          this.instructions() !== (o.instructions ?? '') ||
          this.documentationUrl() !== (o.documentationUrl ?? ''))
      );
    }
    return (
      this.title().trim() !== '' ||
      this.description().trim() !== '' ||
      this.instructions().trim() !== '' ||
      this.documentationUrl().trim() !== ''
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected statusLabel(status: string): string {
    return status === 'Published' ? 'published' : status === 'Draft' ? 'draft' : 'retired';
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    this.summary.set([]);
    try {
      this.apply(await firstValueFrom(this.api.getStepDefinition(Number(this.stepId()))));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.resetErrors();

    const problems: string[] = [];
    if (this.title().trim() === '') problems.push('Enter a title.');
    if (!isValidDocumentationUrl(this.documentationUrl())) {
      problems.push('Enter a full web address starting with http:// or https://.');
    }
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

    const body = {
      title: this.title().trim(),
      description: this.description().trim() || undefined,
      instructions: this.instructions().trim() || undefined,
      documentationUrl: this.documentationUrl().trim() || undefined,
    };
    const result = await this.run(() =>
      this.isEdit()
        ? firstValueFrom(
            this.api.updateStepDefinition(Number(this.stepId()), {
              ...body,
              isActive: this.original()!.isActive,
              rowVersion: this.original()!.rowVersion,
            }),
          )
        : firstValueFrom(this.api.createStepDefinition(body)),
    );
    if (!result) return;
    this.notify.success(`Step ${result.title} saved`);
    if (this.isEdit()) {
      this.apply(result);
    } else {
      this.saved = true;
      await this.router.navigate(['/admin/steps', result.stepDefinitionId]);
    }
  }

  protected async deactivate(): Promise<void> {
    const o = this.original();
    this.deactivateOpen.set(false);
    if (!o) return;
    const result = await this.run(() =>
      firstValueFrom(
        this.api.deactivateStepDefinition(o.stepDefinitionId, { rowVersion: o.rowVersion }),
      ),
    );
    if (result) {
      this.apply(result);
      this.notify.success('Step deactivated');
    }
  }

  protected async activate(): Promise<void> {
    const o = this.original();
    if (!o) return;
    this.resetErrors();
    const result = await this.run(() =>
      firstValueFrom(
        this.api.activateStepDefinition(o.stepDefinitionId, { rowVersion: o.rowVersion }),
      ),
    );
    if (result) {
      this.apply(result);
      this.notify.success('Step activated');
    }
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  protected cancel(): void {
    void this.router.navigateByUrl('/admin/steps');
  }

  private resetErrors(): void {
    this.serverErrors.set({});
    this.summary.set([]);
    this.conflict.set(false);
  }

  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await work();
    } catch (err) {
      const errors = serverFormErrors(err);
      this.serverErrors.set(errors.fields);
      this.summary.set(
        errors.summary.length > 0 || errors.conflict
          ? errors.summary
          : ['We could not save the step. Try again.'],
      );
      this.conflict.set(errors.conflict);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private apply(step: StepDefinitionDetail): void {
    this.original.set(step);
    this.title.set(step.title);
    this.description.set(step.description ?? '');
    this.instructions.set(step.instructions ?? '');
    this.documentationUrl.set(step.documentationUrl ?? '');
  }
}
