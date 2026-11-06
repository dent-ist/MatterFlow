import { Badge } from '../../shared/ui/badge';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  ProductionCommentResponse,
  ProductionCommentsClient,
  ProductionHistoryEntry,
  ProductionResponse,
  ProductionSpecResponse,
  ProductionSpecsClient,
  ProductionsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { NotificationService } from '../../core/notify/notification.service';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { DropdownItem, Dropdown } from '../../shared/ui/dropdown';
import { GridFrame } from '../../shared/ui/grid-frame';
import { Pager } from '../../shared/ui/pager';
import { SearchBox } from '../../shared/ui/search-box';
import { Segmented } from '../../shared/ui/segmented';
import { FormDialog } from '../../shared/ui/form-dialog';
import { SlidePanel } from '../../shared/ui/slide-panel';
import { TextField } from '../../shared/ui/text-field';
import {
  DIRECTIONS,
  METADATA_FIELDS,
  MINIMUM_METADATA_FIELDS,
  batesRange,
  directionLabel,
  formatCount,
  historyText,
  parseCount,
  partyLabel,
} from './production-ui';
import { StateBlock } from '../../shared/ui/state-block';
import { NumericDatePipe } from '../../shared/ui/numeric-date';
import { IntPipe } from '../../shared/ui/number-format';

type View = 'productions' | 'specs';
type Panel = 'none' | 'production' | 'production-form' | 'spec' | 'spec-form';

const PAGE_SIZE = 25;

/** The values of the production form, as the person typed them. */
interface ProductionDraft {
  name: string;
  volumeNo: string;
  direction: string;
  partyName: string;
  productionSpecId: string;
  batesBegin: string;
  batesEnd: string;
  docCount: string;
  pageCount: string;
  deliveredOrDueOn: string;
  notes: string;
}

/** The values of the spec form. */
interface SpecDraft {
  name: string;
  sourceOfAgreement: string;
  description: string;
  imageFormat: string;
  colourMode: string;
  textMode: string;
  nativesRule: string;
  loadFile: string;
  metadataFields: string[];
  redactionRule: string;
  privilegeRule: string;
  dedupRule: string;
  dateTimeRule: string;
  numberingRule: string;
  deliveryRule: string;
  notes: string;
}

const emptyProduction = (): ProductionDraft => ({
  name: '',
  volumeNo: '',
  direction: 'OUT',
  partyName: '',
  productionSpecId: '',
  batesBegin: '',
  batesEnd: '',
  docCount: '',
  pageCount: '',
  deliveredOrDueOn: '',
  notes: '',
});

const emptySpec = (): SpecDraft => ({
  name: '',
  sourceOfAgreement: '',
  description: '',
  imageFormat: 'TIFF (Group IV, 300 dpi)',
  colourMode: 'Black and white',
  textMode: 'Extracted text, OCR when none',
  nativesRule: '',
  loadFile: 'DAT + OPT',
  metadataFields: [...MINIMUM_METADATA_FIELDS],
  redactionRule: '',
  privilegeRule: '',
  dedupRule: '',
  dateTimeRule: '',
  numberingRule: '',
  deliveryRule: '',
  notes: '',
});

/**
 * The Productions tab of a Matter (epic #1001, MD-11; owner decision AQ.8): a simple managed list of the matter's productions (name, volume, direction,
 * party, spec, Bates begin and end, documents, pages, delivered or due date, notes) with comments and a who-changed-what history, and the Specs
 * sub-view (list, create, edit, duplicate, retire) inside it. There is no status, no QC and no Bates overlap check. Create and edit use the shared
 * side panel; delete and retire ask in a centred confirmation. The server applies the sensitive-matter rule; the buttons follow the permissions
 * `Production.Edit`, `Production.Comment` and `ProductionSpec.Edit`.
 */
@Component({
  selector: 'mf-productions-tab',
  imports: [
    Badge,
    IntPipe,
    NumericDatePipe,
    StateBlock,
    Button,
    ConfirmDialog,
    GridFrame,
    Dropdown,
    Pager,
    SearchBox,
    Segmented,
    SlidePanel,
    FormDialog,
    TextField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: '../../shared/ui/page.scss',
  styles: `
    .pt {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      min-height: 0;
      height: 100%;
    }
    .pt__bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .pt__spacer {
      flex: 1 1 auto;
    }
    .pt__search {
      flex: 0 1 18rem;
      min-width: 11rem;
    }
    .pt__count {
      margin-inline-start: var(--mf-s1);
      color: var(--mf-text-muted);
    }
    .pt__sub {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .pt__muted {
      color: var(--mf-text-muted);
    }
    .pt__dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--mf-s1) var(--mf-s3);
      margin: 0 0 var(--mf-s3);
    }
    .pt__dl dt {
      color: var(--mf-text-muted);
    }
    .pt__dl dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .pt__h {
      margin: var(--mf-s3) 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 600;
    }
    .pt__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .pt__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .pt__list li {
      padding: var(--mf-s2) 0;
      border-bottom: 1px solid var(--mf-border);
      overflow-wrap: anywhere;
    }
    .pt__meta .mf-btn {
      margin-inline-start: var(--mf-s2);
    }
    .pt__meta {
      display: block;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .pt__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      --mf-field-max: 100%;
    }
    .pt__row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--mf-s3);
    }
    .pt__label {
      display: block;
      margin-bottom: var(--mf-s1);
      font-weight: 600;
    }
    .pt__chk {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: var(--mf-s1) var(--mf-s3);
      margin-top: var(--mf-s1);
    }
    .pt__chk label {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .pt__comment-form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      margin-top: var(--mf-s2);
    }
  `,
  template: `
    <section class="pt" aria-label="Productions" data-productions-tab>
      <div class="pt__bar">
        <mf-search-box
          inputId="pt-search"
          [label]="view() === 'productions' ? 'Search productions' : 'Search specs'"
          [hideLabel]="true"
          [leadingIcon]="true"
          [compact]="true"
          class="pt__search"
          [placeholder]="view() === 'productions' ? 'Search productions' : 'Search specs'"
          [value]="query()"
          (searchChange)="onSearch($event)"
        />
        <div mfSegmented role="group" aria-label="Productions view">
          <button
            type="button"
            class="mf-btn"
            data-view="productions"
            [attr.aria-pressed]="view() === 'productions'"
            (click)="setView('productions')"
          >
            Productions <span class="pt__count">{{ productionTotal() | mfInt }}</span>
          </button>
          @if (canViewSpecs()) {
            <button
              type="button"
              class="mf-btn"
              data-view="specs"
              [attr.aria-pressed]="view() === 'specs'"
              (click)="setView('specs')"
            >
              Specs <span class="pt__count">{{ specTotal() | mfInt }}</span>
            </button>
          }
        </div>
        @if (view() === 'productions') {
          <mf-dropdown
            buttonId="pt-direction"
            label="Direction"
            prefix="Direction: "
            [items]="directionItems"
            [value]="direction()"
            (valueChange)="onDirection($event)"
          />
        } @else {
          <mf-dropdown
            buttonId="pt-status"
            label="Status"
            prefix="Status: "
            [items]="statusItems"
            [value]="specStatus()"
            (valueChange)="onSpecStatus($event)"
          />
        }
        <span class="pt__spacer"></span>
        @if (view() === 'productions' && canEdit()) {
          <p-button
            label="New Production"
            icon="pi pi-plus"
            data-new-production
            (onClick)="newProduction()"
          />
        }
        @if (view() === 'specs' && canEditSpecs()) {
          <p-button label="New Spec" icon="pi pi-plus" data-new-spec (onClick)="newSpec()" />
        }
      </div>

      @if (error()) {
        <p class="pg-reason" role="alert" data-productions-error>
          {{ error() }}
          <button type="button" class="mf-btn mf-btn--text" (click)="reload()">Retry</button>
        </p>
      } @else if (view() === 'productions') {
        @if (loaded() && productions().length === 0) {
          <mf-state-block data-productions-empty>
            {{
              query() || direction() ? 'No productions match these filters.' : 'No productions yet.'
            }}
          </mf-state-block>
        } @else {
          <mf-grid-frame scrollLabel="Productions" [resetKey]="page()">
            <table class="pg-table" data-productions-table>
              <caption class="pg-sr">
                Productions of this matter
              </caption>
              <thead>
                <tr>
                  <th scope="col">Production</th>
                  <th scope="col">Direction and Party</th>
                  <th scope="col">Bates Range</th>
                  <th scope="col" class="pg-num">Documents</th>
                  <th scope="col">Spec</th>
                  <th scope="col">Delivered or Due</th>
                </tr>
              </thead>
              <tbody>
                @for (p of productions(); track p.productionId) {
                  <tr data-production-row>
                    <td>
                      <button
                        type="button"
                        class="mf-btn mf-btn--text"
                        data-production-open
                        (click)="openProduction(p)"
                      >
                        {{ p.name }}
                      </button>
                      @if (p.volumeNo) {
                        <span class="pt__sub">{{ p.volumeNo }}</span>
                      }
                    </td>
                    <td>
                      {{ directionLabel(p.direction) }}
                      @if (p.partyName) {
                        <span class="pt__sub">{{ p.partyName }}</span>
                      }
                    </td>
                    <td>{{ bates(p) }}</td>
                    <td class="pg-num">{{ count(p.docCount) }}</td>
                    <td>
                      @if (p.productionSpecName) {
                        {{ p.productionSpecName }}
                        @if (p.productionSpecStatus === 'Retired') {
                          <mf-badge tone="warning">Retired</mf-badge>
                        }
                      } @else {
                        <span class="pt__muted">None</span>
                      }
                    </td>
                    <td>
                      @if (p.deliveredOrDueOn) {
                        {{ p.deliveredOrDueOn | mfNum: 'date' }}
                      } @else {
                        <span class="pt__muted">Not set</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </mf-grid-frame>
        }
        <mf-pager
          [page]="page()"
          [pageSize]="pageSize"
          [total]="productionCount()"
          (pageChange)="goTo($event)"
        />
      } @else {
        @if (loaded() && specs().length === 0) {
          <mf-state-block data-specs-empty>
            {{ query() || specStatus() ? 'No specs match these filters.' : 'No specs yet.' }}
            @if (!query() && !specStatus()) {
              <span mfStateReason>A spec is the agreed format of the productions.</span>
            }
          </mf-state-block>
        } @else {
          <mf-grid-frame scrollLabel="Production specs" [resetKey]="page()">
            <table class="pg-table" data-specs-table>
              <caption class="pg-sr">
                Production specs of this matter
              </caption>
              <thead>
                <tr>
                  <th scope="col">Spec</th>
                  <th scope="col">Status</th>
                  <th scope="col">Images and Text</th>
                  <th scope="col">Load File</th>
                  <th scope="col" class="pg-num">Used by</th>
                  <th scope="col">Last Updated</th>
                </tr>
              </thead>
              <tbody>
                @for (s of specs(); track s.productionSpecId) {
                  <tr data-spec-row>
                    <td>
                      <button
                        type="button"
                        class="mf-btn mf-btn--text"
                        data-spec-open
                        (click)="openSpec(s)"
                      >
                        {{ s.name }}
                      </button>
                      @if (s.sourceOfAgreement) {
                        <span class="pt__sub">Source: {{ s.sourceOfAgreement }}</span>
                      }
                    </td>
                    <td>
                      <mf-badge [tone]="s.status === 'Retired' ? 'warning' : 'success'">{{
                        s.status
                      }}</mf-badge>
                    </td>
                    <td>
                      {{ s.imageFormat }}
                      @if (s.textMode) {
                        <span class="pt__sub">{{ s.textMode }}</span>
                      }
                    </td>
                    <td>
                      {{ s.loadFile }}
                      <span class="pt__sub">{{ s.metadataFields.length }} metadata fields</span>
                    </td>
                    <td class="pg-num">{{ s.usedByCount | mfInt }}</td>
                    <td>{{ s.modifiedAtUtc ?? s.createdAtUtc | mfNum: 'date' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </mf-grid-frame>
        }
        <mf-pager
          [page]="page()"
          [pageSize]="pageSize"
          [total]="specCount()"
          (pageChange)="goTo($event)"
        />
      }
    </section>

    <!-- A production: details, comments, history -->
    <mf-slide-panel
      [title]="current()?.name ?? 'Production'"
      [subtitle]="current()?.volumeNo ?? ''"
      size="large"
      [showFooter]="false"
      [visible]="panel() === 'production'"
      (visibleChange)="!$event && closePanel()"
    >
      @if (current(); as p) {
        <div class="pt__actions">
          @if (canEdit()) {
            <p-button
              label="Edit"
              icon="pi pi-pencil"
              data-production-edit
              (onClick)="editProduction(p)"
            />
            <p-button
              label="Delete"
              icon="pi pi-trash"
              severity="danger"
              [outlined]="true"
              data-production-delete
              (onClick)="confirmDelete.set(true)"
            />
          }
        </div>
        <dl class="pt__dl" data-production-details>
          <dt>Direction</dt>
          <dd>{{ directionLabel(p.direction) }}</dd>
          <dt>{{ partyLabel(p.direction) }}</dt>
          <dd>{{ p.partyName || 'Not set' }}</dd>
          <dt>Spec</dt>
          <dd>
            @if (p.productionSpecName) {
              {{ p.productionSpecName }}
              @if (p.productionSpecStatus === 'Retired') {
                (retired)
              }
            } @else {
              None
            }
          </dd>
          <dt>Bates</dt>
          <dd>{{ bates(p) || 'Not set' }}</dd>
          <dt>Documents</dt>
          <dd>{{ count(p.docCount) || 'Not set' }}</dd>
          <dt>Pages</dt>
          <dd>{{ count(p.pageCount) || 'Not set' }}</dd>
          <dt>Delivered or Due</dt>
          <dd>{{ p.deliveredOrDueOn ? (p.deliveredOrDueOn | mfNum: 'date') : 'Not set' }}</dd>
          <dt>Notes</dt>
          <dd>{{ p.notes || 'None' }}</dd>
        </dl>

        <h3 class="pt__h">Comments ({{ comments().length }})</h3>
        <ul class="pt__list" data-production-comments>
          @for (c of comments(); track c.productionCommentId) {
            <li>
              @if (editingComment()?.productionCommentId === c.productionCommentId) {
                <div class="pt__comment-form">
                  <mf-text-field
                    inputId="pt-comment-edit"
                    label="Edit Comment"
                    [multiline]="true"
                    [maxLength]="4000"
                    [(value)]="commentText"
                  />
                  <div class="pt__actions">
                    <p-button
                      label="Cancel"
                      severity="secondary"
                      (onClick)="editingComment.set(null)"
                    />
                    <p-button label="Save Comment" data-comment-save (onClick)="saveComment(c)" />
                  </div>
                </div>
              } @else {
                {{ c.body }}
                <span class="pt__meta"
                  >{{ c.createdByName ?? 'Someone' }} on
                  {{ c.createdAtUtc | mfNum }}
                  @if (c.modifiedAtUtc) {
                    (edited)
                  }
                  @if (c.canEdit && canComment()) {
                    <button type="button" class="mf-btn mf-btn--text" (click)="startEdit(c)">
                      Edit
                    </button>
                    <button type="button" class="mf-btn mf-btn--text" (click)="deleteComment(c)">
                      Delete
                    </button>
                  }
                </span>
              }
            </li>
          } @empty {
            <li class="pt__muted">No comments yet.</li>
          }
        </ul>
        @if (canComment()) {
          <div class="pt__comment-form">
            <mf-text-field
              inputId="pt-comment"
              label="Add a Comment"
              [multiline]="true"
              [maxLength]="4000"
              [(value)]="newComment"
            />
            <div class="pt__actions">
              <p-button label="Add Comment" data-comment-add (onClick)="addComment(p)" />
            </div>
          </div>
        }

        <h3 class="pt__h">History</h3>
        <ul class="pt__list" data-production-history>
          @for (h of history(); track h.auditEventId) {
            <li>
              <b>{{ h.actorName ?? 'Someone' }}</b> {{ text(h) }}
              <span class="pt__meta">{{ h.occurredAtUtc | mfNum }}</span>
            </li>
          } @empty {
            <li class="pt__muted">No history yet.</li>
          }
        </ul>
      }
    </mf-slide-panel>

    <!-- New or edit production -->
    <mf-form-dialog
      [title]="draftId() ? 'Edit Production' : 'New Production'"
      size="large"
      [primaryLabel]="draftId() ? 'Save Production' : 'Create Production'"
      [busy]="busy()"
      [error]="formError()"
      [dirty]="dirty()"
      [visible]="panel() === 'production-form'"
      (visibleChange)="!$event && backFromForm()"
      (submitted)="saveProduction()"
    >
      @if (panel() === 'production-form') {
        <form class="pt__form" (submit)="$event.preventDefault()" data-production-form>
          <mf-text-field
            inputId="pf-name"
            label="Name"
            [required]="true"
            [maxLength]="200"
            [error]="fieldError('name')"
            [value]="pd().name"
            (valueChange)="setP('name', $event)"
          />
          <div class="pt__row">
            <mf-text-field
              inputId="pf-volume"
              label="Volume"
              [maxLength]="50"
              [value]="pd().volumeNo"
              (valueChange)="setP('volumeNo', $event)"
            />
            <div>
              <label class="pt__label" for="pf-direction">Direction</label>
              <mf-dropdown
                buttonId="pf-direction"
                label="Direction"
                data-direction-select
                [items]="directionChoices"
                [value]="pd().direction"
                (valueChange)="setP('direction', $event)"
              />
            </div>
          </div>
          <mf-text-field
            inputId="pf-party"
            [label]="partyLabel(pd().direction)"
            [maxLength]="200"
            [value]="pd().partyName"
            (valueChange)="setP('partyName', $event)"
          />
          <div>
            <label class="pt__label" for="pf-spec">Spec</label>
            <mf-dropdown
              buttonId="pf-spec"
              label="Spec"
              data-spec-select
              [items]="specChoices()"
              [value]="pd().productionSpecId"
              (valueChange)="setP('productionSpecId', $event)"
            />
          </div>
          <div class="pt__row">
            <mf-text-field
              inputId="pf-bates-begin"
              label="Bates Begin"
              help="For example ABC000001"
              [maxLength]="50"
              [value]="pd().batesBegin"
              (valueChange)="setP('batesBegin', $event)"
            />
            <mf-text-field
              inputId="pf-bates-end"
              label="Bates End"
              [maxLength]="50"
              [value]="pd().batesEnd"
              (valueChange)="setP('batesEnd', $event)"
            />
          </div>
          <div class="pt__row">
            <mf-text-field
              inputId="pf-docs"
              label="Documents"
              [error]="fieldError('docCount')"
              [value]="pd().docCount"
              (valueChange)="setP('docCount', $event)"
            />
            <mf-text-field
              inputId="pf-pages"
              label="Pages"
              [error]="fieldError('pageCount')"
              [value]="pd().pageCount"
              (valueChange)="setP('pageCount', $event)"
            />
          </div>
          <div>
            <label class="pt__label" for="pf-date">Delivered or Due Date</label>
            <input
              id="pf-date"
              type="date"
              class="mf-field__input"
              [value]="pd().deliveredOrDueOn"
              (input)="setP('deliveredOrDueOn', $any($event.target).value)"
            />
          </div>
          <mf-text-field
            inputId="pf-notes"
            label="Notes"
            [multiline]="true"
            [maxLength]="4000"
            [value]="pd().notes"
            (valueChange)="setP('notes', $event)"
          />
        </form>
      }
    </mf-form-dialog>

    <!-- A spec -->
    <mf-slide-panel
      [title]="currentSpec()?.name ?? 'Production Spec'"
      [subtitle]="currentSpec()?.status ?? ''"
      size="large"
      [showFooter]="false"
      [visible]="panel() === 'spec'"
      (visibleChange)="!$event && closePanel()"
    >
      @if (currentSpec(); as s) {
        <div class="pt__actions">
          @if (canEditSpecs()) {
            @if (s.status === 'Active') {
              <p-button label="Edit" icon="pi pi-pencil" data-spec-edit (onClick)="editSpec(s)" />
            }
            <p-button
              label="Duplicate"
              icon="pi pi-copy"
              severity="secondary"
              data-spec-duplicate
              (onClick)="duplicateSpec(s)"
            />
            @if (s.status === 'Active') {
              <p-button
                label="Retire"
                icon="pi pi-ban"
                severity="danger"
                [outlined]="true"
                data-spec-retire
                (onClick)="confirmRetire.set(true)"
              />
            } @else {
              <p-button
                label="Reinstate"
                icon="pi pi-undo"
                severity="secondary"
                data-spec-reinstate
                (onClick)="reinstateSpec(s)"
              />
            }
          }
        </div>
        <dl class="pt__dl" data-spec-details>
          <dt>Source</dt>
          <dd>{{ s.sourceOfAgreement || 'Not set' }}</dd>
          <dt>Description</dt>
          <dd>{{ s.description || 'None' }}</dd>
          <dt>Images</dt>
          <dd>{{ s.imageFormat || 'Not set' }}</dd>
          <dt>Colour</dt>
          <dd>{{ s.colourMode || 'Not set' }}</dd>
          <dt>Text</dt>
          <dd>{{ s.textMode || 'Not set' }}</dd>
          <dt>Natives</dt>
          <dd>{{ s.nativesRule || 'Not set' }}</dd>
          <dt>Load File</dt>
          <dd>{{ s.loadFile || 'Not set' }}</dd>
          <dt>Metadata Fields</dt>
          <dd>{{ s.metadataFields.length ? s.metadataFields.join(', ') : 'None' }}</dd>
          <dt>Redactions</dt>
          <dd>{{ s.redactionRule || 'Not set' }}</dd>
          <dt>Privilege</dt>
          <dd>{{ s.privilegeRule || 'Not set' }}</dd>
          <dt>De-duplication</dt>
          <dd>{{ s.dedupRule || 'Not set' }}</dd>
          <dt>Dates and Time</dt>
          <dd>{{ s.dateTimeRule || 'Not set' }}</dd>
          <dt>Numbering</dt>
          <dd>{{ s.numberingRule || 'Not set' }}</dd>
          <dt>Delivery</dt>
          <dd>{{ s.deliveryRule || 'Not set' }}</dd>
          <dt>Notes</dt>
          <dd>{{ s.notes || 'None' }}</dd>
        </dl>
        <h3 class="pt__h">Used by</h3>
        <ul class="pt__list" data-spec-used-by>
          @for (u of s.usedBy; track u.productionId) {
            <li>
              {{ u.name }}
              <span class="pt__meta">{{ bates(u) }}</span>
            </li>
          } @empty {
            <li class="pt__muted">No production uses this spec yet.</li>
          }
        </ul>
        <h3 class="pt__h">History</h3>
        <ul class="pt__list" data-spec-history>
          @for (h of history(); track h.auditEventId) {
            <li>
              <b>{{ h.actorName ?? 'Someone' }}</b> {{ text(h) }}
              <span class="pt__meta">{{ h.occurredAtUtc | mfNum }}</span>
            </li>
          } @empty {
            <li class="pt__muted">No history yet.</li>
          }
        </ul>
      }
    </mf-slide-panel>

    <!-- New, edit or duplicate spec -->
    <mf-form-dialog
      [title]="specFormTitle()"
      subtitle="A spec is the agreed format of productions: what you deliver and how."
      size="large"
      [primaryLabel]="draftId() ? 'Save Spec' : 'Create Spec'"
      [busy]="busy()"
      [error]="formError()"
      [dirty]="dirty()"
      [visible]="panel() === 'spec-form'"
      (visibleChange)="!$event && backFromForm()"
      (submitted)="saveSpec()"
    >
      @if (panel() === 'spec-form') {
        <form class="pt__form" (submit)="$event.preventDefault()" data-spec-form>
          <mf-text-field
            inputId="sf-name"
            label="Spec Name"
            [required]="true"
            [maxLength]="200"
            [error]="fieldError('name')"
            [value]="sd().name"
            (valueChange)="setS('name', $event)"
          />
          <mf-text-field
            inputId="sf-source"
            label="Source of the Agreement"
            help="Court order, ESI protocol, email, request letter"
            [maxLength]="300"
            [value]="sd().sourceOfAgreement"
            (valueChange)="setS('sourceOfAgreement', $event)"
          />
          <mf-text-field
            inputId="sf-desc"
            label="Description"
            [multiline]="true"
            [maxLength]="1000"
            [value]="sd().description"
            (valueChange)="setS('description', $event)"
          />
          <div class="pt__row">
            <mf-text-field
              inputId="sf-image"
              label="Image Format"
              [maxLength]="100"
              [value]="sd().imageFormat"
              (valueChange)="setS('imageFormat', $event)"
            />
            <mf-text-field
              inputId="sf-colour"
              label="Colour"
              [maxLength]="100"
              [value]="sd().colourMode"
              (valueChange)="setS('colourMode', $event)"
            />
            <mf-text-field
              inputId="sf-text"
              label="Text"
              [maxLength]="100"
              [value]="sd().textMode"
              (valueChange)="setS('textMode', $event)"
            />
          </div>
          <mf-text-field
            inputId="sf-natives"
            label="Files Produced Natively"
            [maxLength]="300"
            [value]="sd().nativesRule"
            (valueChange)="setS('nativesRule', $event)"
          />
          <mf-text-field
            inputId="sf-load"
            label="Load File"
            [maxLength]="100"
            [value]="sd().loadFile"
            (valueChange)="setS('loadFile', $event)"
          />
          <fieldset class="pt__fieldset">
            <legend class="pt__label">Metadata Fields ({{ sd().metadataFields.length }})</legend>
            <div class="pt__actions">
              <p-button
                label="Minimum Set"
                severity="secondary"
                (onClick)="setFields(minimumFields)"
              />
              <p-button label="All Fields" severity="secondary" (onClick)="setFields(allFields)" />
            </div>
            <div class="pt__chk">
              @for (f of allFields; track f) {
                <label
                  ><input
                    type="checkbox"
                    [checked]="sd().metadataFields.includes(f)"
                    (change)="toggleField(f)"
                  />
                  {{ f }}</label
                >
              }
            </div>
          </fieldset>
          <mf-text-field
            inputId="sf-redact"
            label="Redactions"
            [maxLength]="300"
            [value]="sd().redactionRule"
            (valueChange)="setS('redactionRule', $event)"
          />
          <mf-text-field
            inputId="sf-priv"
            label="Privilege"
            [maxLength]="300"
            [value]="sd().privilegeRule"
            (valueChange)="setS('privilegeRule', $event)"
          />
          <mf-text-field
            inputId="sf-dedup"
            label="De-duplication"
            [maxLength]="200"
            [value]="sd().dedupRule"
            (valueChange)="setS('dedupRule', $event)"
          />
          <mf-text-field
            inputId="sf-dates"
            label="Dates and Time"
            help="Format and time zone in the load file"
            [maxLength]="200"
            [value]="sd().dateTimeRule"
            (valueChange)="setS('dateTimeRule', $event)"
          />
          <mf-text-field
            inputId="sf-number"
            label="Numbering"
            [maxLength]="200"
            [value]="sd().numberingRule"
            (valueChange)="setS('numberingRule', $event)"
          />
          <mf-text-field
            inputId="sf-delivery"
            label="Encryption and Delivery"
            [maxLength]="300"
            [value]="sd().deliveryRule"
            (valueChange)="setS('deliveryRule', $event)"
          />
          <mf-text-field
            inputId="sf-notes"
            label="Notes"
            [multiline]="true"
            [maxLength]="2000"
            [value]="sd().notes"
            (valueChange)="setS('notes', $event)"
          />
        </form>
      }
    </mf-form-dialog>

    <mf-confirm-dialog
      title="Delete Production"
      confirmLabel="Delete Production"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="confirmDelete"
      (confirmed)="deleteProduction()"
    >
      <p>
        {{ current()?.name }} and its comments are deleted for good, and the history keeps a line
        that it was deleted.
      </p>
    </mf-confirm-dialog>
    <mf-confirm-dialog
      title="Retire Spec"
      confirmLabel="Retire Spec"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="confirmRetire"
      (confirmed)="retireSpec()"
    >
      <p>
        {{ currentSpec()?.name }} stays on the productions that use it ({{
          currentSpec()?.usedByCount | mfInt
        }}), but it can no longer be chosen for a new or changed production. You can reinstate it
        later.
      </p>
    </mf-confirm-dialog>
  `,
})
export class ProductionsTab {
  private readonly productionsApi = inject(ProductionsClient);
  private readonly specsApi = inject(ProductionSpecsClient);
  private readonly commentsApi = inject(ProductionCommentsClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly destroyed = signal(false);

  /** The matter whose productions are shown. */
  readonly matterId = input.required<number>();
  /** A production was created or deleted: the page refreshes the tab number. */
  readonly changed = output<void>();

  protected readonly pageSize = PAGE_SIZE;
  protected readonly directionLabel = directionLabel;
  protected readonly partyLabel = partyLabel;
  protected readonly minimumFields = MINIMUM_METADATA_FIELDS;
  protected readonly allFields = METADATA_FIELDS;

  protected readonly directionItems: DropdownItem[] = [
    { value: '', label: 'All' },
    ...DIRECTIONS.map((d) => ({ value: d.value as string, label: d.label })),
  ];
  protected readonly directionChoices: DropdownItem[] = DIRECTIONS.map((d) => ({
    value: d.value as string,
    label: d.label,
  }));
  protected readonly statusItems: DropdownItem[] = [
    { value: '', label: 'All' },
    { value: 'Active', label: 'Active' },
    { value: 'Retired', label: 'Retired' },
  ];

  protected readonly view = signal<View>('productions');
  protected readonly direction = signal('');
  protected readonly specStatus = signal('');
  protected readonly query = signal('');
  protected readonly page = signal(1);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');

  protected readonly productions = signal<ProductionResponse[]>([]);
  protected readonly productionCount = signal(0);
  protected readonly specs = signal<ProductionSpecResponse[]>([]);
  protected readonly specCount = signal(0);
  /** The tab badges: the totals of the matter, whatever the filters say. */
  protected readonly productionTotal = signal(0);
  protected readonly specTotal = signal(0);

  protected readonly panel = signal<Panel>('none');
  protected readonly current = signal<ProductionResponse | null>(null);
  protected readonly currentSpec = signal<ProductionSpecResponse | null>(null);
  protected readonly comments = signal<ProductionCommentResponse[]>([]);
  protected readonly history = signal<ProductionHistoryEntry[]>([]);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly confirmDelete = signal(false);
  protected readonly confirmRetire = signal(false);

  protected readonly draftId = signal<number | null>(null);
  private readonly draftRowVersion = signal('');
  private readonly duplicateOf = signal<ProductionSpecResponse | null>(null);
  protected readonly pd = signal<ProductionDraft>(emptyProduction());
  protected readonly sd = signal<SpecDraft>(emptySpec());
  private readonly startedWith = signal('');
  protected readonly dirty = computed(
    () =>
      JSON.stringify(this.panel() === 'spec-form' ? this.sd() : this.pd()) !== this.startedWith(),
  );
  protected readonly specChoices = signal<DropdownItem[]>([]);

  protected newComment = signal('');
  protected commentText = signal('');
  protected readonly editingComment = signal<ProductionCommentResponse | null>(null);

  protected readonly canEdit = computed(() => this.auth.has('Production.Edit'));
  protected readonly canComment = computed(() => this.auth.has('Production.Comment'));
  protected readonly canViewSpecs = computed(() => this.auth.has('ProductionSpec.View'));
  protected readonly canEditSpecs = computed(() => this.auth.has('ProductionSpec.Edit'));
  protected readonly specFormTitle = computed(() =>
    this.draftId()
      ? 'Edit production spec'
      : this.duplicateOf()
        ? 'Duplicate production spec'
        : 'New production spec',
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyed.set(true));
    effect(() => {
      // A different matter, view, filter or page loads again.
      this.matterId();
      this.view();
      this.direction();
      this.specStatus();
      this.query();
      this.page();
      untracked(() => void this.load());
    });
    effect(() => {
      const id = this.matterId();
      untracked(() => void this.loadTotals(id));
    });
  }

  protected bates(p: { batesBegin?: string | null; batesEnd?: string | null }): string {
    return batesRange(p.batesBegin, p.batesEnd);
  }

  protected count(n?: number | null): string {
    return formatCount(n);
  }

  protected text(h: ProductionHistoryEntry): string {
    return historyText(h);
  }

  protected fieldError(key: string): string {
    return this.fieldErrors()[key] ?? '';
  }

  // ---------------------------------------------------------------- list

  protected setView(view: View): void {
    if (this.view() === view) return;
    this.query.set('');
    this.page.set(1);
    this.view.set(view);
  }

  protected onDirection(value: string): void {
    this.page.set(1);
    this.direction.set(value);
  }

  protected onSpecStatus(value: string): void {
    this.page.set(1);
    this.specStatus.set(value);
  }

  protected onSearch(value: string): void {
    this.page.set(1);
    this.query.set(value.trim());
  }

  protected goTo(page: number): void {
    this.page.set(page);
  }

  protected reload(): void {
    void this.load();
    void this.loadTotals(this.matterId());
  }

  private async load(): Promise<void> {
    const matterId = this.matterId();
    const q = this.query() || undefined;
    try {
      if (this.view() === 'productions') {
        const result = await firstValueFrom(
          this.productionsApi.listProductions(
            matterId,
            this.direction() || undefined,
            undefined,
            q,
            this.page(),
            PAGE_SIZE,
          ),
        );
        this.productions.set(result.items);
        this.productionCount.set(result.total);
      } else {
        const result = await firstValueFrom(
          this.specsApi.listProductionSpecs(
            matterId,
            this.specStatus() || undefined,
            q,
            this.page(),
            PAGE_SIZE,
          ),
        );
        this.specs.set(result.items);
        this.specCount.set(result.total);
      }
      this.error.set('');
    } catch {
      this.error.set("Couldn't load the list.");
    } finally {
      this.loaded.set(true);
    }
  }

  private async loadTotals(matterId: number): Promise<void> {
    try {
      const s = await firstValueFrom(this.productionsApi.getMatterProductionsSummary(matterId));
      this.productionTotal.set(s.productionCount);
      this.changed.emit();
      this.specTotal.set(s.specCount);
    } catch {
      // The badges are a convenience; the list shows the real error.
    }
  }

  // ---------------------------------------------------------------- production panels

  protected async openProduction(p: ProductionResponse): Promise<void> {
    this.current.set(p);
    this.comments.set([]);
    this.history.set([]);
    this.panel.set('production');
    await this.refreshProduction(p.productionId);
  }

  private async refreshProduction(id: number): Promise<void> {
    try {
      const [fresh, comments, history] = await Promise.all([
        firstValueFrom(this.productionsApi.getProduction(id)),
        firstValueFrom(this.productionsApi.listProductionComments(id)),
        firstValueFrom(this.productionsApi.getProductionHistory(id)),
      ]);
      this.current.set(fresh);
      this.comments.set(comments);
      this.history.set(history.items);
    } catch (e) {
      this.fail(e, "Couldn't load the production.");
    }
  }

  protected closePanel(): void {
    this.panel.set('none');
    this.editingComment.set(null);
  }

  protected async newProduction(): Promise<void> {
    this.draftId.set(null);
    this.draftRowVersion.set('');
    this.setDraftP(emptyProduction());
    await this.loadSpecChoices(null);
    this.panel.set('production-form');
  }

  protected async editProduction(p: ProductionResponse): Promise<void> {
    this.draftId.set(p.productionId);
    this.draftRowVersion.set(p.rowVersion);
    this.setDraftP({
      name: p.name,
      volumeNo: p.volumeNo ?? '',
      direction: p.direction,
      partyName: p.partyName ?? '',
      productionSpecId: p.productionSpecId ? String(p.productionSpecId) : '',
      batesBegin: p.batesBegin ?? '',
      batesEnd: p.batesEnd ?? '',
      docCount: p.docCount === null || p.docCount === undefined ? '' : String(p.docCount),
      pageCount: p.pageCount === null || p.pageCount === undefined ? '' : String(p.pageCount),
      deliveredOrDueOn: p.deliveredOrDueOn ? String(p.deliveredOrDueOn).slice(0, 10) : '',
      notes: p.notes ?? '',
    });
    await this.loadSpecChoices(p);
    this.panel.set('production-form');
  }

  private setDraftP(draft: ProductionDraft): void {
    this.pd.set(draft);
    this.startedWith.set(JSON.stringify(draft));
    this.formError.set('');
    this.fieldErrors.set({});
  }

  /** The specs a production can use: the active ones, and the one it already has even if it is retired. */
  private async loadSpecChoices(existing: ProductionResponse | null): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.specsApi.listProductionSpecs(this.matterId(), 'Active', undefined, 1, 100),
      );
      const items: DropdownItem[] = [{ value: '', label: 'None (for a received production)' }];
      for (const s of result.items)
        items.push({ value: String(s.productionSpecId), label: s.name });
      if (
        existing?.productionSpecId &&
        !items.some((i) => i.value === String(existing.productionSpecId))
      ) {
        items.push({
          value: String(existing.productionSpecId),
          label: `${existing.productionSpecName} (retired)`,
        });
      }
      this.specChoices.set(items);
    } catch {
      this.specChoices.set([{ value: '', label: 'None' }]);
    }
  }

  protected setP<K extends keyof ProductionDraft>(key: K, value: ProductionDraft[K]): void {
    this.pd.update((d) => ({ ...d, [key]: value }));
  }

  protected backFromForm(): void {
    // Cancel or close of a form: back to the record it came from, or to the list for a new one.
    const wasSpec = this.panel() === 'spec-form';
    if (wasSpec && this.draftId()) this.panel.set('spec');
    else if (!wasSpec && this.draftId()) this.panel.set('production');
    else this.panel.set('none');
  }

  protected async saveProduction(): Promise<void> {
    const d = this.pd();
    const docs = parseCount(d.docCount);
    const pages = parseCount(d.pageCount);
    const errors: Record<string, string> = {};
    if (!d.name.trim()) errors['name'] = 'Enter a name.';
    if (Number.isNaN(docs)) errors['docCount'] = 'Enter a whole number or leave it empty.';
    if (Number.isNaN(pages)) errors['pageCount'] = 'Enter a whole number or leave it empty.';
    this.fieldErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    const body = {
      name: d.name.trim(),
      volumeNo: d.volumeNo.trim() || undefined,
      direction: d.direction,
      partyName: d.partyName.trim() || undefined,
      productionSpecId: d.productionSpecId ? Number(d.productionSpecId) : undefined,
      batesBegin: d.batesBegin.trim() || undefined,
      batesEnd: d.batesEnd.trim() || undefined,
      docCount: docs ?? undefined,
      pageCount: pages ?? undefined,
      deliveredOrDueOn: d.deliveredOrDueOn || undefined,
      notes: d.notes.trim() || undefined,
    };
    this.busy.set(true);
    this.formError.set('');
    try {
      const id = this.draftId();
      const saved = id
        ? await firstValueFrom(
            this.productionsApi.updateProduction(id, {
              ...body,
              rowVersion: this.draftRowVersion(),
            } as never),
          )
        : await firstValueFrom(
            this.productionsApi.createProduction({ ...body, matterId: this.matterId() } as never),
          );
      this.notify.success(id ? 'Production saved' : 'Production created');
      this.panel.set('production');
      this.current.set(saved);
      await Promise.all([
        this.load(),
        this.loadTotals(this.matterId()),
        this.refreshProduction(saved.productionId),
      ]);
    } catch (e) {
      this.formFail(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteProduction(): Promise<void> {
    const p = this.current();
    if (!p) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.productionsApi.deleteProduction(p.productionId, p.rowVersion));
      this.confirmDelete.set(false);
      this.closePanel();
      this.notify.success('Production deleted');
      await Promise.all([this.load(), this.loadTotals(this.matterId())]);
    } catch (e) {
      this.confirmDelete.set(false);
      this.fail(e, "Couldn't delete the production.");
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- comments

  protected async addComment(p: ProductionResponse): Promise<void> {
    const body = this.newComment().trim();
    if (!body) return;
    try {
      await firstValueFrom(this.productionsApi.addProductionComment(p.productionId, { body }));
      this.newComment.set('');
      await Promise.all([this.refreshProduction(p.productionId), this.load()]);
    } catch (e) {
      this.fail(e, "Couldn't add the comment.");
    }
  }

  protected startEdit(c: ProductionCommentResponse): void {
    this.commentText.set(c.body);
    this.editingComment.set(c);
  }

  protected async saveComment(c: ProductionCommentResponse): Promise<void> {
    const body = this.commentText().trim();
    if (!body) return;
    try {
      await firstValueFrom(
        this.commentsApi.updateProductionComment(c.productionCommentId, {
          body,
          rowVersion: c.rowVersion,
        }),
      );
      this.editingComment.set(null);
      await this.refreshProduction(c.productionId);
    } catch (e) {
      this.fail(e, "Couldn't save the comment.");
    }
  }

  protected async deleteComment(c: ProductionCommentResponse): Promise<void> {
    try {
      await firstValueFrom(
        this.commentsApi.deleteProductionComment(c.productionCommentId, c.rowVersion),
      );
      await Promise.all([this.refreshProduction(c.productionId), this.load()]);
    } catch (e) {
      this.fail(e, "Couldn't delete the comment.");
    }
  }

  // ---------------------------------------------------------------- spec panels

  protected async openSpec(s: ProductionSpecResponse): Promise<void> {
    this.currentSpec.set(s);
    this.history.set([]);
    this.panel.set('spec');
    await this.refreshSpec(s.productionSpecId);
  }

  private async refreshSpec(id: number): Promise<void> {
    try {
      const [fresh, history] = await Promise.all([
        firstValueFrom(this.specsApi.getProductionSpec(id)),
        firstValueFrom(this.specsApi.getProductionSpecHistory(id)),
      ]);
      this.currentSpec.set(fresh);
      this.history.set(history.items);
    } catch (e) {
      this.fail(e, "Couldn't load the spec.");
    }
  }

  protected newSpec(): void {
    this.draftId.set(null);
    this.duplicateOf.set(null);
    this.setDraftS(emptySpec());
    this.panel.set('spec-form');
  }

  protected editSpec(s: ProductionSpecResponse): void {
    this.draftId.set(s.productionSpecId);
    this.draftRowVersion.set(s.rowVersion);
    this.duplicateOf.set(null);
    this.setDraftS(this.specToDraft(s, s.name));
    this.panel.set('spec-form');
  }

  /** Duplicate opens the form with the copy's name filled in; nothing is created until Create spec. */
  protected duplicateSpec(s: ProductionSpecResponse): void {
    this.draftId.set(null);
    this.duplicateOf.set(s);
    this.setDraftS(this.specToDraft(s, `Copy of ${s.name}`.slice(0, 200)));
    this.panel.set('spec-form');
  }

  private specToDraft(s: ProductionSpecResponse, name: string): SpecDraft {
    return {
      name,
      sourceOfAgreement: s.sourceOfAgreement ?? '',
      description: s.description ?? '',
      imageFormat: s.imageFormat ?? '',
      colourMode: s.colourMode ?? '',
      textMode: s.textMode ?? '',
      nativesRule: s.nativesRule ?? '',
      loadFile: s.loadFile ?? '',
      metadataFields: [...s.metadataFields],
      redactionRule: s.redactionRule ?? '',
      privilegeRule: s.privilegeRule ?? '',
      dedupRule: s.dedupRule ?? '',
      dateTimeRule: s.dateTimeRule ?? '',
      numberingRule: s.numberingRule ?? '',
      deliveryRule: s.deliveryRule ?? '',
      notes: s.notes ?? '',
    };
  }

  private setDraftS(draft: SpecDraft): void {
    this.sd.set(draft);
    this.startedWith.set(JSON.stringify(draft));
    this.formError.set('');
    this.fieldErrors.set({});
  }

  protected setS<K extends keyof SpecDraft>(key: K, value: SpecDraft[K]): void {
    this.sd.update((d) => ({ ...d, [key]: value }));
  }

  protected setFields(fields: readonly string[]): void {
    this.setS('metadataFields', [...fields]);
  }

  protected toggleField(field: string): void {
    const has = this.sd().metadataFields.includes(field);
    this.setS(
      'metadataFields',
      has
        ? this.sd().metadataFields.filter((f) => f !== field)
        : [...this.sd().metadataFields, field],
    );
  }

  protected async saveSpec(): Promise<void> {
    const d = this.sd();
    if (!d.name.trim()) {
      this.fieldErrors.set({ name: 'Enter a name.' });
      return;
    }
    const text = (v: string) => v.trim() || undefined;
    const body = {
      name: d.name.trim(),
      sourceOfAgreement: text(d.sourceOfAgreement),
      description: text(d.description),
      imageFormat: text(d.imageFormat),
      colourMode: text(d.colourMode),
      textMode: text(d.textMode),
      nativesRule: text(d.nativesRule),
      loadFile: text(d.loadFile),
      metadataFields: d.metadataFields,
      redactionRule: text(d.redactionRule),
      privilegeRule: text(d.privilegeRule),
      dedupRule: text(d.dedupRule),
      dateTimeRule: text(d.dateTimeRule),
      numberingRule: text(d.numberingRule),
      deliveryRule: text(d.deliveryRule),
      notes: text(d.notes),
    };
    this.busy.set(true);
    this.formError.set('');
    try {
      const id = this.draftId();
      const saved = id
        ? await firstValueFrom(
            this.specsApi.updateProductionSpec(id, {
              ...body,
              rowVersion: this.draftRowVersion(),
            } as never),
          )
        : await firstValueFrom(
            this.specsApi.createProductionSpec({ ...body, matterId: this.matterId() } as never),
          );
      this.notify.success(id ? 'Spec saved' : 'Spec created');
      this.duplicateOf.set(null);
      this.panel.set('spec');
      this.currentSpec.set(saved);
      await Promise.all([
        this.load(),
        this.loadTotals(this.matterId()),
        this.refreshSpec(saved.productionSpecId),
      ]);
    } catch (e) {
      this.formFail(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async retireSpec(): Promise<void> {
    const s = this.currentSpec();
    if (!s) return;
    await this.changeStatus(s, true);
  }

  protected async reinstateSpec(s: ProductionSpecResponse): Promise<void> {
    await this.changeStatus(s, false);
  }

  private async changeStatus(s: ProductionSpecResponse, retire: boolean): Promise<void> {
    this.busy.set(true);
    try {
      const body = { rowVersion: s.rowVersion };
      const saved = await firstValueFrom(
        retire
          ? this.specsApi.retireProductionSpec(s.productionSpecId, body)
          : this.specsApi.unretireProductionSpec(s.productionSpecId, body),
      );
      this.confirmRetire.set(false);
      this.notify.success(retire ? 'Spec retired' : 'Spec reinstated');
      this.currentSpec.set(saved);
      await Promise.all([
        this.load(),
        this.loadTotals(this.matterId()),
        this.refreshSpec(saved.productionSpecId),
      ]);
    } catch (e) {
      this.confirmRetire.set(false);
      this.fail(e, "Couldn't change the spec.");
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- errors

  private formFail(e: unknown): void {
    if (e instanceof ApiError) {
      const fields: Record<string, string> = {};
      for (const [key, list] of Object.entries(e.problem?.errors ?? {})) {
        if (list[0]) fields[key.charAt(0).toLowerCase() + key.slice(1)] = list[0].message;
      }
      this.fieldErrors.set(fields);
      this.formError.set(
        e.status === 409 && e.code === 'CONCURRENCY_CONFLICT'
          ? 'Someone else changed this record. Close this panel, open it again and redo your change.'
          : Object.keys(fields).length > 0
            ? 'Check the highlighted fields.'
            : e.message,
      );
    } else {
      this.formError.set("Couldn't save. Try again.");
    }
  }

  private fail(e: unknown, fallback: string): void {
    this.notify.error(fallback, e instanceof ApiError ? e.message : undefined);
  }
}
