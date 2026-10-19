import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { FormsClient } from '../../../api/generated/api-client';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { AuthStore } from '../../../core/auth/auth.store';
import { ClampedRich } from '../panels/clamped-rich';
import { decorateLinks, descriptionToHtml } from '../panels/rich-text';
import { requestInitiallyOpen, requestOpenKey, saveOpen } from '../panels/section-state';
import { RequestSection, requestHeadingText } from './request-section';
import { TaskDetailStore } from './task-detail.store';
import { TaskEditDialog } from './task-edit-dialog';

/**
 * Details panel (UX S10) of the Task page, in the side panel of `mf-detail-layout` (the layout adds the "Details" heading): the
 * read view (requestor, dates, project, request-form values; Due, Pod and the type are in the header) and, behind "Edit details" (or the header's Edit), the
 * Edit dialog (`mf-task-edit-dialog`). Closing the dialog returns to the same page.
 */
@Component({
  selector: 'mf-task-details-tab',
  imports: [ClampedRich, DynamicForm, MfDatePipe, RequestSection, TaskEditDialog],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', '../../../shared/ui/form-field.scss'],
  template: `
    @if (store.task(); as t) {
      <div data-details-tab>
        @if (t.description) {
          <div class="dt__description">
            <h3 class="dt__sub dt__sub--first">Description</h3>
            <mf-clamped-rich [html]="descriptionHtml()" [format]="t.descriptionFormat" />
          </div>
        }

        <section class="dt__info" aria-labelledby="td-info-h" data-view>
          <h3 id="td-info-h" class="dt__sub">Task information</h3>
          <dl class="pg-dl dt__facts">
            <dt>Requestor</dt>
            <dd>
              {{ t.requestorName }}
              @if (t.requestorEmail) {
                &lt;<a class="pg-link" [href]="'mailto:' + t.requestorEmail">{{
                  t.requestorEmail
                }}</a
                >&gt;
              }
            </dd>
            @if (t.requestedAtUtc) {
              <dt>Request sent</dt>
              <dd>{{ t.requestedAtUtc | mfDate }}</dd>
            }
            <dt>Project</dt>
            <dd>{{ t.project?.name ?? 'No project' }}</dd>
            <!-- One wrapper div around the dt/dd pairs is valid in a dl: Created and Last updated share one row. -->
            <div class="dt__pair">
              <dt>Created</dt>
              <dd>{{ t.createdBy?.displayName ?? 'Unknown' }}, {{ t.createdAtUtc | mfDate }}</dd>
              @if (t.modifiedAtUtc) {
                <dt class="dt__pair-gap">Last updated</dt>
                <dd>{{ t.modifiedAtUtc | mfDate }}</dd>
              }
            </div>
          </dl>
        </section>

        @if (!editing() && schema(); as definition) {
          <div class="dt__request" data-request-form>
            <mf-request-section
              [heading]="requestHeading()"
              [count]="definition.fields.length"
              [open]="requestOpen()"
              (openChange)="rememberRequestOpen($event)"
            >
              <mf-dynamic-form
                [definition]="definition"
                [values]="formValues()"
                [readOnly]="true"
              />
            </mf-request-section>
          </div>
        }

        <mf-task-edit-dialog [definition]="schema()" />
      </div>
    }
  `,
  styles: `
    .dt__sub {
      margin: var(--mf-s4) 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .dt__sub--first {
      margin-top: 0;
    }
    /* Task information: label / value rows. Every sub-heading and block starts at the panel's left edge. */
    .dt__facts {
      gap: var(--mf-s1) var(--mf-s4);
      font-size: var(--mf-fs-sm);
    }
    .dt__facts dt {
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    .dt__facts dd {
      overflow-wrap: anywhere;
    }
    .dt__pair {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mf-s1) var(--mf-s2);
    }
    .dt__pair-gap {
      margin-left: var(--mf-s4);
    }
    .dt__request {
      margin-top: var(--mf-s4);
    }
    .pre {
      white-space: pre-wrap;
    }
  `,
})
export class TaskDetailsTab {
  protected readonly store = inject(TaskDetailStore);
  private readonly forms = inject(FormsClient);
  protected readonly editing = this.store.editing;

  protected readonly schema = signal<FormDefinition | null>(null);

  private readonly auth = inject(AuthStore);

  protected readonly formValues = computed(
    () => (this.store.task()?.formValues ?? {}) as Record<string, unknown>,
  );

  protected readonly requestHeading = computed(() => requestHeadingText(this.store.task()));

  /** Open for a short form (6 fields or fewer), closed for a longer one, unless the person chose for this task type (#313). */
  protected readonly requestOpen = linkedSignal(() =>
    requestInitiallyOpen(
      this.auth.profile()?.userId,
      this.store.task()?.taskType?.taskTypeId,
      this.schema()?.fields.length ?? 0,
    ),
  );

  protected rememberRequestOpen(open: boolean): void {
    this.requestOpen.set(open);
    saveOpen(
      requestOpenKey(this.auth.profile()?.userId, this.store.task()?.taskType?.taskTypeId),
      open,
    );
  }

  /** The description for reading: saved text is escaped, saved rich text is already sanitized; links show their real host. */
  protected readonly descriptionHtml = computed(() => {
    const t = this.store.task();
    return t ? decorateLinks(descriptionToHtml(t.description, t.descriptionFormat)) : '';
  });

  constructor() {
    // The request form's asset picker (read view) offers the assets of the task's own matter.
    const pickerContext = inject(AssetPickerContext);
    effect(() => pickerContext.matterId.set(this.store.task()?.matter.matterId ?? null));
    effect(() => {
      const id = this.store.task()?.formVersionId;
      untracked(() => void this.loadSchema(id));
    });
  }

  private async loadSchema(id: number | undefined): Promise<void> {
    if (id == null) {
      this.schema.set(null);
      return;
    }
    try {
      const detail = await firstValueFrom(this.forms.getFormVersionSchema(id));
      const definition = toFormDefinition(detail);
      this.schema.set(definition.fields.length > 0 ? definition : null);
    } catch {
      this.schema.set(null);
    }
  }
}
