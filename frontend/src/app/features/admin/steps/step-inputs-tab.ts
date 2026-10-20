import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { controlLabel } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { FormsClient } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { Badge } from '../../../shared/ui/badge';
import { DRAFT_INPUTS_NOTE, InputRow, InputsFacts, inputRows } from './step-record';

/**
 * The Inputs tab of the Step page (SE3, #405): the step's input form, read-only. The status (Published vN, Draft vN), the fields as label, type
 * and required, one 44 px row each, and the button that opens the form designer. States: none (no inputs yet), draft (with the sentence that
 * they must be published before the step can be published in a workflow), published, and published with a newer draft (the published fields
 * are listed, the draft is named).
 *
 * Reading a form needs `Task.View` on the server; a person without it (a `Workflow.Manage`-only administrator) gets one explanatory sentence
 * and the state the step record itself knows, never a toast or an empty list that looks like "no inputs".
 */
@Component({
  selector: 'mf-step-inputs-tab',
  imports: [Badge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './step-tabs.scss',
  template: `
    <section class="st" aria-labelledby="st-inputs-h" data-inputs-tab>
      <h2 id="st-inputs-h" class="st__h">Inputs</h2>
      <p class="st__muted">
        Operational values recorded on the task (for example items in, items out, QC result). These
        are not staff or billing metrics.
      </p>

      @if (facts().state === 'none') {
        <p data-inputs-none>This step has no inputs yet.</p>
      } @else {
        <p class="st__status" data-inputs-status>
          @if (facts().state === 'draft') {
            <mf-badge tone="warning" data-status-draft>{{ draftLabel() }}</mf-badge>
          } @else {
            <mf-badge tone="success" icon="pi-check-circle" data-status-published>{{
              publishedLabel()
            }}</mf-badge>
          }
        </p>
        @if (facts().state === 'draft') {
          <p data-draft-note>The inputs are a draft. {{ draftNote }}</p>
        }
        @if (facts().state === 'both') {
          <p class="st__muted" data-newer-draft>
            A newer draft ({{ draftLabel() }}) is in progress. Workflows use the published inputs
            until it is published.
          </p>
        }

        @if (loading()) {
          <p class="st__muted" role="status" data-inputs-loading>Loading the inputs...</p>
        } @else if (denied()) {
          <p class="st__muted" data-inputs-denied>
            The list of inputs is not shown because reading forms needs permission to view tasks.
            @if (!canEdit()) {
              The form designer needs it too.
            }
          </p>
        } @else if (failed()) {
          <p class="st__muted" role="alert" data-inputs-failed>
            Couldn't load the inputs.
            <button type="button" class="mf-btn mf-btn--text" (click)="reload()" data-inputs-retry>
              Try again
            </button>
          </p>
        } @else if (rows().length === 0) {
          <p class="st__muted" data-inputs-empty>This version has no fields.</p>
        } @else {
          <table class="it" data-inputs-table>
            <caption class="mf-sr-only">
              Inputs of this step
            </caption>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col" class="it__type">Type</th>
                <th scope="col" class="it__req">Required</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.key) {
                <tr [attr.data-input]="r.key">
                  <th scope="row" class="it__label">
                    <span class="it__clamp" [attr.title]="r.label">{{ r.label }}</span>
                  </th>
                  <td class="it__type">
                    <span class="it__clamp">{{ type(r) }}</span>
                  </td>
                  <td class="it__req">{{ r.required ? 'Yes' : 'No' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      }

      @if (canEdit()) {
        <div>
          <button type="button" class="mf-btn" (click)="edit.emit()" data-open-inputs>
            Edit inputs
          </button>
        </div>
      }
    </section>
  `,
})
export class StepInputsTab {
  readonly facts = input.required<InputsFacts>();
  /** The version whose fields are listed: the published one, else the draft. Absent when it is not known. */
  readonly versionId = input<number | null>(null);
  /** The version list could not be read for lack of permission (so the draft's id is not known either). */
  readonly unreadable = input(false);
  /** The form designer can be opened (reading forms is allowed). */
  readonly canEdit = input(true);
  /** Edit inputs: the page opens the form designer. */
  readonly edit = output<void>();

  private readonly forms = inject(FormsClient);
  private readonly quiet = inject(QuietRequests);
  protected readonly draftNote = DRAFT_INPUTS_NOTE;
  protected readonly rows = signal<InputRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly denied = signal(false);
  protected readonly failed = signal(false);
  private request = 0;

  protected readonly publishedLabel = computed(() => {
    const p = this.facts().published;
    return p ? `Published v${p.versionNo}` : 'Published';
  });
  protected readonly draftLabel = computed(() => {
    const d = this.facts().draft;
    if (!d) return 'Draft';
    const v = d.versionNo ? `Draft v${d.versionNo}` : 'Draft';
    return `${v}, ${d.fieldCount} ${d.fieldCount === 1 ? 'field' : 'fields'}`;
  });

  constructor() {
    effect(() => {
      const id = this.versionId();
      const unreadable = this.unreadable();
      untracked(() => {
        if (unreadable) {
          this.denied.set(true);
          this.loading.set(false);
        } else if (id !== null) void this.load(id);
      });
    });
  }

  protected reload(): void {
    const id = this.versionId();
    if (id !== null) void this.load(id);
  }

  protected type(r: InputRow): string {
    return controlLabel(r.control as never);
  }

  private async load(id: number): Promise<void> {
    const mine = ++this.request;
    this.loading.set(true);
    this.denied.set(false);
    this.failed.set(false);
    try {
      // Quiet: a refusal is shown here as a sentence, not as a toast on top of it.
      const detail = await this.quiet.run(() =>
        firstValueFrom(this.forms.getFormVersionSchema(id)),
      );
      if (mine === this.request) this.rows.set(inputRows(detail.fields));
    } catch (e) {
      if (mine !== this.request) return;
      if (e instanceof ApiError && e.status === 403) this.denied.set(true);
      else this.failed.set(true);
    } finally {
      if (mine === this.request) this.loading.set(false);
    }
  }
}
