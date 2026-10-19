import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DynamicForm, FormDefinition } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { FormsClient } from '../../../api/generated/api-client';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { decorateLinks, descriptionToHtml } from '../panels/rich-text';
import { TaskDetailStore } from './task-detail.store';
import { TaskEditDialog } from './task-edit-dialog';

/**
 * Details panel (UX S10) of the Task page, in the side panel of `mf-detail-layout` (the layout adds the "Details" heading): the
 * read view (requestor, dates, project, request-form values; Due, Pod and the type are in the header) and, behind "Edit details" (or the header's Edit), the
 * Edit dialog (`mf-task-edit-dialog`). Closing the dialog returns to the same page.
 */
@Component({
  selector: 'mf-task-details-tab',
  imports: [DynamicForm, MfDatePipe, TaskEditDialog],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', '../../../shared/ui/form-field.scss'],
  template: `
    @if (store.task(); as t) {
      <div data-details-tab>
        @if (t.allowedActions.canEdit) {
          <div class="pg-panel-actions dt__corner">
            <button
              type="button"
              class="mf-btn mf-btn--icon"
              data-edit-details
              aria-label="Edit details"
              title="Edit details"
              (click)="openEdit()"
            >
              <i class="pi pi-pencil" aria-hidden="true"></i>
            </button>
          </div>
        }

        @if (t.description) {
          <div class="dt__description">
            <h3 class="dt__sub dt__sub--first">Description</h3>
            <div
              class="mf-rich"
              data-description
              [attr.data-format]="t.descriptionFormat"
              [innerHTML]="descriptionHtml()"
            ></div>
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
          <section class="dt__request" aria-labelledby="td-request-h" data-request-form>
            <h3 id="td-request-h" class="dt__sub">
              Request details (form version {{ t.formVersionNo }})
            </h3>
            <mf-dynamic-form [definition]="definition" [values]="formValues()" [readOnly]="true" />
          </section>
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
    /* Edit sits in the top right corner of the panel as an icon. */
    .dt__corner {
      justify-content: flex-end;
      margin-bottom: var(--mf-s1);
    }
    /* Task information: label / value rows, slightly indented under its heading (as the Request details block below). */
    .dt__facts {
      margin-left: var(--mf-s3);
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
      margin-left: var(--mf-s3);
    }
    .dt__request > .dt__sub {
      margin-left: calc(var(--mf-s3) * -1);
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

  protected readonly formValues = computed(
    () => (this.store.task()?.formValues ?? {}) as Record<string, unknown>,
  );

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

  protected openEdit(): void {
    this.store.editOrigin.set('panel');
    this.store.editing.set(true);
  }
}
