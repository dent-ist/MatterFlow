import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  Injector,
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
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TagInput } from '../../../shared/ui/tag-input';
import { TextField } from '../../../shared/ui/text-field';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { DIALOG_COPY } from '../shared/dialog-copy';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { PageHeader } from '../../../shared/ui/page-header';

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

/** True when both lists hold the same tags in the same order (ignoring case). */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t.toLowerCase() === b[i].toLowerCase());
}

/**
 * Admin: create or edit a library step (UX S15). Title, description, instructions, documentation link and tags live here; the data inputs are
 * the step's form, edited with the form designer at `/admin/steps/:id/form`. Editing never changes published workflows (addendum A);
 * deactivating hides the step from new workflow drafts. Needs `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-step-edit-page',
  imports: [PageHeader, RecordState, RouterLink, Button, TextField, TagInput, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (flow.failed()) {
      <mf-record-state
        kind="step"
        [state]="state()"
        [busy]="flow.retrying()"
        [focusHeading]="true"
        (retried)="load()"
      />
    } @else {
      <mf-page-header
        [crumbs]="[
          { label: 'Administration' },
          { label: 'Task Types', link: '/admin/task-types' },
          { label: 'Workflow Steps', link: '/admin/steps' },
          { label: isEdit() ? original()?.title || 'Edit' : 'New' },
        ]"
        [heading]="isEdit() ? 'Edit step' : 'New step'"
      />

      <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
      @if (state() === 'loading') {
        <div class="pg-state" role="status" aria-busy="true">Loading the step...</div>
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
          <mf-tag-input
            inputId="step-tags"
            label="Tags"
            placeholder="Add a tag"
            help="Optional labels such as Relativity or Processing, used to find the step. Press Enter or comma to add one. Up to 20 tags, 40 characters each."
            [error]="fieldError('tags')"
            [suggestions]="tagSuggestions()"
            (queryChange)="suggestTags($event)"
            [(value)]="tags"
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

          <div class="pg-actions mf-form-actions--sticky">
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
    }

    <mf-confirm-dialog
      [title]="copy.title"
      [confirmLabel]="copy.confirm"
      [cancelLabel]="copy.cancel"
      [danger]="copy.danger"
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
  private readonly injector = inject(Injector);

  protected readonly isEdit = computed(() => this.stepId() !== undefined);
  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('step');
  protected readonly state = this.flow.state;
  protected readonly original = signal<StepDefinitionDetail | null>(null);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly instructions = signal('');
  protected readonly documentationUrl = signal('');
  protected readonly tags = signal<string[]>([]);
  protected readonly tagSuggestions = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly copy = DIALOG_COPY.deactivateStep;
  protected readonly deactivateOpen = signal(false);
  private saved = false;
  private suggestRequest = 0;

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
      else untracked(() => this.flow.state.set('ready'));
    });
    effect(() => {
      const state = this.state();
      const title = this.original()?.title;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('step', state));
      } else if (title) this.pageTitle.set(shortTitleText(title));
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
          this.documentationUrl() !== (o.documentationUrl ?? '') ||
          !sameTags(this.tags(), o.tags))
      );
    }
    return (
      this.title().trim() !== '' ||
      this.description().trim() !== '' ||
      this.instructions().trim() !== '' ||
      this.documentationUrl().trim() !== '' ||
      this.tags().length > 0
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
    this.conflict.set(false);
    this.summary.set([]);
    await this.flow.run(
      () => firstValueFrom(this.api.getStepDefinition(Number(this.stepId()))),
      (step) => this.apply(step),
    );
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
      focusFirstInvalid(this.injector);
      return;
    }

    const body = {
      title: this.title().trim(),
      description: this.description().trim() || undefined,
      instructions: this.instructions().trim() || undefined,
      documentationUrl: this.documentationUrl().trim() || undefined,
      tags: this.tags(),
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
      focusFirstInvalid(this.injector);
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
    this.tags.set([...step.tags]);
  }

  /** Existing tags that match what was typed, for the tag box (the latest answer wins; failures just offer nothing). */
  protected async suggestTags(text: string): Promise<void> {
    const request = ++this.suggestRequest;
    try {
      const found = await firstValueFrom(
        this.api.listStepTags(text.trim() || undefined, undefined, 12),
      );
      if (request === this.suggestRequest) this.tagSuggestions.set(found.map((t) => t.name));
    } catch {
      if (request === this.suggestRequest) this.tagSuggestions.set([]);
    }
  }
}
