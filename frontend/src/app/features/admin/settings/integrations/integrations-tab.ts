import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  AuditSearchClient,
  AuditSearchItem,
  EntraConnectionClient,
  EntraConnectionResponse,
  IntegrationResponse,
  IntegrationsClient,
  TestResultResponse,
} from '../../../../api/generated/api-client';
import { AuthStore } from '../../../../core/auth/auth.store';
import { ApiError } from '../../../../core/http/api-error';
import { NotificationService } from '../../../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE } from '../../../../core/time/clock';
import { MfDateLongPipe } from '../../../../shared/pipes/mf-date-long.pipe';
import { serverFormErrors } from '../../../../shared/forms/api-errors';
import { ActionMenu } from '../../../../shared/ui/action-menu';
import { ConfirmDialog } from '../../../../shared/ui/confirm-dialog';
import { ErrorReference } from '../../../../shared/ui/error-reference';
import { NumericDatePipe } from '../../../../shared/ui/numeric-date';
import {
  RecordCell,
  RecordGrid,
  RecordGridColumn,
  RecordGridState,
} from '../../../../shared/ui/record-grid';
import { rowActions } from '../../../../shared/ui/row-actions';
import { StatusChip } from '../../../../shared/ui/status-chip';
import { TextField } from '../../../../shared/ui/text-field';
import { Tip } from '../../../../shared/ui/tip';
import { IntegrationDialog, IntegrationDraft } from './integration-dialog';
import {
  STEP_LABELS,
  SecretExpiry,
  TYPE_LABELS,
  secretExpiry,
  testCopy,
  testToast,
} from './integration-text';
import { SecretDialog, SecretDraft } from './secret-dialog';

type LoadState = 'loading' | 'ready' | 'error';

/** The result panel under the grid: which integration was tested and what came back. */
interface PanelResult {
  readonly name: string;
  readonly baseUrl: string | null;
  readonly scope: string | null;
  readonly result: TestResultResponse;
}

const OBJECT_TYPES = 'Integration,EntraConnection';

/**
 * Administration > Settings > Integrations (epic #1389, issue #1395; `Integrations.Manage`, Administrator by default). LPT Hub has ONE Microsoft Entra ID app registration and asks Entra ID for
 * a different scope per external API. Top to bottom: a banner when the client secret expires within 30 days or has expired; the Microsoft Entra ID Connection card (Tenant ID, Client ID, the
 * write-only Client Secret with its own dialog, Test Connection, `[Cancel] [Save Changes]` for the two IDs only); the Integrations card (grid, Add Integration, row menu, the result of
 * the last test under the grid) and Recent Changes (the audit lines of this page, when the person may read the audit). The secret is never read back: the page only knows "set" and the
 * expiry date. Changing a credential clears the last test result (the server does it; the page reloads what it returns). No keyboard shortcut is added (#420).
 */
@Component({
  selector: 'mf-integrations-tab',
  imports: [
    ActionMenu,
    Button,
    ConfirmDialog,
    ErrorReference,
    IntegrationDialog,
    MfDateLongPipe,
    NumericDatePipe,
    RecordCell,
    RecordGrid,
    RouterLink,
    SecretDialog,
    StatusChip,
    TextField,
    Tip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--mf-frame-min]': 'frameMin()' },
  styleUrl: '../../../../shared/ui/page.scss',
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s4);
      min-width: 0;
      /* The integrations grid is a short list on a scrolling page: it takes the height of its rows, not the 412 px floor of a full-height grid. */
    }
    .ig__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mf-s3);
    }
    .ig__head p,
    .ig__sub {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ig__card-title {
      margin: 0 0 var(--mf-s1);
    }
    .ig__ids {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s4);
      margin-top: var(--mf-s3);
    }
    .ig__secret {
      margin-top: var(--mf-s3);
    }
    .ig__secret-field {
      display: grid;
      gap: var(--mf-s1);
    }
    .ig__secret-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
    }
    /* The read-only look of the secret: a field-sized box that says only "Secret set" or "Not set" (never a value). */
    .ig__box {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 16rem;
      height: var(--mf-ctl-h);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      font-weight: var(--mf-fw-semibold);
    }
    .ig__label {
      font-weight: var(--mf-fw-semibold);
    }
    .ig__test {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      margin-top: var(--mf-s4);
      padding-top: var(--mf-s3);
      border-top: 1px solid var(--mf-border);
    }
    .ig__foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s3);
      margin-top: var(--mf-s4);
      padding-top: var(--mf-s3);
      border-top: 1px solid var(--mf-border);
    }
    .ig__foot-note {
      flex: 1 1 auto;
      color: var(--mf-text-muted);
    }
    .ig__foot-actions {
      display: flex;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .ig__none {
      color: var(--mf-text-muted);
    }
    .ig__mono {
      font-family: var(--mf-font-mono);
    }
    td.ig__spring {
      width: 100%;
      max-width: 0;
    }
    td.ig__clip {
      max-width: 0;
    }
    .ig__result {
      margin-top: var(--mf-s3);
      padding: var(--mf-s3);
      border: 1px solid var(--mf-sem-neutral-line);
      border-radius: var(--mf-radius);
      background: var(--mf-sem-neutral-bg);
      color: var(--mf-sem-neutral-fg);
    }
    .ig__result[data-tone='ok'] {
      border-color: var(--mf-sem-healthy-line);
      background: var(--mf-sem-healthy-bg);
      color: var(--mf-sem-healthy-fg);
    }
    .ig__result[data-tone='info'] {
      border-color: var(--mf-sem-info-line);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
    }
    .ig__result[data-tone='bad'] {
      border-color: var(--mf-sem-overdue-line);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
    .ig__result-title {
      display: flex;
      justify-content: space-between;
      gap: var(--mf-s3);
      font-weight: var(--mf-fw-bold);
    }
    .ig__result-when {
      font-weight: 400;
    }
    .ig__result p {
      margin: var(--mf-s1) 0 0;
    }
    .ig__steps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      margin: var(--mf-s2) 0 0;
      padding: 0;
      list-style: none;
    }
    .ig__steps li {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .ig__steps .pi {
      font-size: var(--mf-icon-sm);
    }
    .ig__changes {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ig__changes li {
      display: flex;
      gap: var(--mf-s3);
      padding: var(--mf-s2) 0;
      border-bottom: 1px solid var(--mf-border);
    }
    .ig__changes time {
      flex: none;
      width: 8.5rem;
      color: var(--mf-text-muted);
    }
    .ig__changes-foot {
      margin: var(--mf-s2) 0 0;
    }
  `,
  template: `
    @switch (state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true" data-integrations-loading>
          Loading integrations
        </div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert" data-integrations-error>
          Couldn't load integrations.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }
      @default {
        @if (conn(); as c) {
          @if (expiry(); as e) {
            @if (e.state === 'soon' || e.state === 'expired') {
              <div
                class="pg-banner"
                [class.pg-banner--danger]="e.state === 'expired'"
                [attr.role]="e.state === 'expired' ? 'alert' : 'status'"
                data-secret-banner
                [attr.data-state]="e.state"
              >
                <i
                  class="pi"
                  [class]="e.state === 'expired' ? 'pi-times-circle' : 'pi-exclamation-triangle'"
                  aria-hidden="true"
                ></i>
                <span>
                  @if (e.state === 'expired') {
                    The client secret expired {{ c.secretExpiresOn | mfNum }}. Integrations cannot
                    get a token until you replace it.
                  } @else {
                    The client secret expires {{ c.secretExpiresOn | mfNum }}. Replace it before
                    then so integrations keep working.
                  }
                </span>
                <button type="button" class="mf-btn" data-banner-replace (click)="openSecret()">
                  Replace Secret
                </button>
              </div>
            }
          }

          <section class="mf-card" aria-labelledby="ig-entra-h" data-entra-card>
            <div class="ig__head">
              <div>
                <h2 class="mf-card__title ig__card-title" id="ig-entra-h">
                  Microsoft Entra ID Connection
                </h2>
                <p class="ig__sub">
                  One app registration for every integration. Each integration asks Entra ID for its
                  own scope.
                </p>
              </div>
              <mf-status-chip kind="integration" [code]="connectionStatus()" data-entra-status />
            </div>
            <form
              novalidate
              (submit)="$event.preventDefault(); saveIds()"
              aria-labelledby="ig-entra-h"
              data-entra-form
            >
              @if (summary().length > 0) {
                <div class="pg-summary" role="alert" data-summary>
                  Fix the following to save:
                  <ul>
                    @for (m of summary(); track m) {
                      <li>{{ m }}</li>
                    }
                  </ul>
                </div>
              }
              @if (conflict()) {
                <div class="pg-alert" role="alert" data-conflict>
                  Someone else changed the connection while you were editing. Reload to see the
                  latest values; your changes are not saved.
                  <p-button label="Reload Latest" severity="secondary" (onClick)="load()" />
                </div>
              }
              <div class="ig__ids">
                <mf-text-field
                  inputId="ig-tenant"
                  label="Tenant ID"
                  [required]="true"
                  [maxLength]="100"
                  help="The Directory (tenant) ID on the Overview page of the app registration."
                  [error]="idError('tenantId')"
                  [(value)]="tenant"
                />
                <mf-text-field
                  inputId="ig-client"
                  label="Client ID"
                  [required]="true"
                  [maxLength]="100"
                  help="The Application (client) ID on the same page. LPT Hub signs in as this app."
                  [error]="idError('clientId')"
                  [(value)]="clientId"
                />
              </div>

              <div class="ig__secret" data-secret-row>
                <div class="ig__secret-field">
                  <span class="ig__label" id="ig-secret-l">
                    Client Secret <span class="mf-field__req">(required)</span>
                  </span>
                  <div class="ig__secret-line">
                    <span class="ig__box">
                      <i class="pi pi-lock" aria-hidden="true"></i>
                      <span data-secret-state>{{ c.secretIsSet ? 'Secret set' : 'Not set' }}</span>
                    </span>
                    <button
                      type="button"
                      class="mf-btn"
                      [class.mf-btn--primary]="!c.secretIsSet"
                      data-secret-open
                      aria-describedby="ig-secret-l"
                      (click)="openSecret()"
                    >
                      <i class="pi pi-key" aria-hidden="true"></i>
                      {{ c.secretIsSet ? 'Replace Secret' : 'Set Secret' }}
                    </button>
                    @if (expiry(); as e) {
                      <mf-status-chip
                        kind="integration"
                        [code]="e.chip"
                        [label]="e.label"
                        data-secret-chip
                      />
                      @if (c.secretIsSet) {
                        <span
                          [attr.title]="'Expires ' + (c.secretExpiresOn | mfDateLong)"
                          data-secret-expiry
                        >
                          Expires On {{ c.secretExpiresOn | mfNum }}
                        </span>
                      } @else {
                        <span class="ig__none">No secret yet, so nothing can sign in.</span>
                      }
                    }
                  </div>
                </div>
              </div>
              <p class="mf-field__help" data-secret-help>
                Stored encrypted. It can't be shown again, not even to administrators. LPT Hub warns
                30 days before it expires. Replacing it saves at once and is not part of Save
                Changes.
              </p>

              <div class="ig__test" data-entra-test>
                <button
                  type="button"
                  class="mf-btn"
                  data-test-entra
                  [disabled]="entraTesting()"
                  (click)="testEntra()"
                >
                  <i class="pi pi-bolt" aria-hidden="true"></i>
                  {{ entraTesting() ? 'Testing...' : 'Test Connection' }}
                </button>
                @if (c.lastTest; as t) {
                  @let copy = copyOf(t, null, null, null);
                  <span data-entra-last-test>
                    Last Tested {{ t.testedAt | mfNum }}
                    @if (t.testedBy) {
                      by {{ t.testedBy }}
                    }
                  </span>
                  <mf-status-chip
                    kind="integration"
                    [code]="
                      t.outcome === 'OK'
                        ? 'CONNECTED'
                        : t.outcome === 'NOT_SET_UP'
                          ? 'NOT_SET_UP'
                          : 'FAILED'
                    "
                  />
                  <span data-entra-last-reason>{{ copy.detail }}</span>
                } @else {
                  <span class="ig__none" data-entra-last-test>Not tested yet.</span>
                }
              </div>
              <p class="mf-field__help">
                Checks that Entra ID can be reached and accepts the credentials. Each integration is
                tested on its own row below.
              </p>

              <div class="ig__foot">
                @if (!dirty()) {
                  <span class="ig__foot-note" data-no-changes>No unsaved changes</span>
                }
                @if (c.updatedAt) {
                  <span class="ig__foot-note" data-last-updated>
                    Last Updated {{ c.updatedAt | mfNum }}
                    @if (c.updatedBy) {
                      by {{ c.updatedBy }}
                    }
                    . Changes go to Audit Logs; the secret value never does.
                  </span>
                }
                <div class="ig__foot-actions">
                  <p-button
                    label="Cancel"
                    severity="secondary"
                    data-cancel-ids
                    [disabled]="!dirty() || idsBusy()"
                    (onClick)="resetIds()"
                  />
                  <p-button
                    type="submit"
                    [label]="idsBusy() ? 'Saving...' : 'Save Changes'"
                    data-save-ids
                    [disabled]="!dirty() || idsBusy()"
                  />
                </div>
              </div>
            </form>
          </section>

          <section class="mf-card" aria-labelledby="ig-list-h" data-integrations-card>
            <div class="ig__head">
              <div>
                <h2 class="mf-card__title ig__card-title" id="ig-list-h">Integrations</h2>
                <p>
                  Each integration is one API that LPT Hub calls. It uses the connection above and
                  asks Entra ID for its own scope.
                </p>
              </div>
              <p-button
                label="Add Integration"
                icon="pi pi-plus"
                data-add-integration
                (onClick)="openAdd()"
              />
            </div>

            <mf-record-grid
              label="Integrations list"
              caption="Integrations"
              noun="integrations"
              [grid]="grid"
              [rows]="rows()"
              [rowKey]="rowKey"
              [loadState]="state()"
              [empty]="rows().length === 0"
              [bones]="bones"
              [actions]="true"
              (retry)="load()"
            >
              <p-button
                mfEmptyAction
                label="Add Integration"
                icon="pi pi-plus"
                data-empty-add
                (onClick)="openAdd()"
              />
              <ng-template mfCell="name" let-i>
                <td class="ig__spring">
                  <button
                    type="button"
                    class="mf-btn mf-btn--text mf-btn--name"
                    data-integration-name
                    [mfTip]="i.name"
                    (click)="openEdit(i)"
                  >
                    {{ i.name }}
                  </button>
                </td>
              </ng-template>
              <ng-template mfCell="type" let-i>
                <td data-integration-type>{{ typeLabel(i.typeCode) }}</td>
              </ng-template>
              <ng-template mfCell="baseUrl" let-i>
                <td class="ig__clip">
                  @if (i.baseUrl) {
                    <span class="pg-clip" data-integration-base [mfTip]="i.baseUrl">{{
                      i.baseUrl
                    }}</span>
                  } @else {
                    <span class="ig__none" data-integration-base>-</span>
                  }
                </td>
              </ng-template>
              <ng-template mfCell="scope" let-i>
                <td class="ig__clip">
                  @if (i.scope) {
                    <span class="pg-clip ig__mono" data-integration-scope [mfTip]="i.scope">{{
                      i.scope
                    }}</span>
                  } @else {
                    <span class="ig__none" data-integration-scope>-</span>
                  }
                </td>
              </ng-template>
              <ng-template mfCell="enabled" let-i>
                <td data-integration-enabled>{{ i.isEnabled ? 'Yes' : 'No' }}</td>
              </ng-template>
              <ng-template mfCell="status" let-i>
                <td data-integration-status>
                  <mf-status-chip kind="integration" [code]="i.status" />
                </td>
              </ng-template>
              <ng-template mfCell="tested" let-i>
                <td data-integration-tested>
                  @if (i.lastTest; as t) {
                    {{ t.testedAt | mfNum }}
                  } @else {
                    <span class="ig__none">Never</span>
                  }
                </td>
              </ng-template>
              <ng-template mfCell="actions" let-i>
                <td class="mf-col-actions" data-row-actions>
                  @let menu = menuFor(i);
                  <mf-action-menu [floating]="true" [label]="menu.label" [items]="menu.items" />
                </td>
              </ng-template>
            </mf-record-grid>

            @if (panel(); as p) {
              @let copy = copyOf(p.result, p.name, p.baseUrl, p.scope);
              <section
                class="ig__result"
                [attr.data-tone]="copy.tone"
                aria-live="polite"
                data-test-result
              >
                <h3 class="mf-section-title" data-result-heading>Test Result: {{ p.name }}</h3>
                <div class="ig__result-title">
                  <span data-result-title>{{ copy.title }}</span>
                  <span class="ig__result-when" data-result-when>
                    {{ p.result.testedAt | mfNum }}
                    @if (p.result.testedBy) {
                      , {{ p.result.testedBy }}
                    }
                  </span>
                </div>
                <p data-result-detail>{{ copy.detail }}</p>
                <ul class="ig__steps" aria-label="Steps of the test" data-result-steps>
                  @for (s of p.result.steps; track s.key) {
                    <li [attr.data-step]="s.key" [attr.data-state]="s.state">
                      <i
                        class="pi"
                        [class]="
                          s.state === 'PASSED'
                            ? 'pi-check-circle'
                            : s.state === 'FAILED'
                              ? 'pi-times-circle'
                              : 'pi-minus-circle'
                        "
                        aria-hidden="true"
                      ></i>
                      {{ stepLabel(s.key) }}
                      @if (s.state === 'FAILED') {
                        <strong>Stopped here</strong>
                      } @else if (s.state === 'NOT_REACHED') {
                        <span class="ig__none">Not reached</span>
                      }
                    </li>
                  }
                </ul>
              </section>
            }
          </section>

          @if (canReadAudit()) {
            <section class="mf-card" aria-labelledby="ig-changes-h" data-recent-changes>
              <h2 class="mf-card__title" id="ig-changes-h">Recent Changes</h2>
              @if (changes().length === 0) {
                <p class="ig__sub" data-no-changes-yet>No changes yet.</p>
              } @else {
                <ul class="ig__changes">
                  @for (a of changes(); track a.auditEventId) {
                    <li data-change>
                      <time [attr.datetime]="a.occurredAtUtc">{{ a.occurredAtUtc | mfNum }}</time>
                      <span>{{ a.actor.displayName }}: {{ a.summary }}</span>
                    </li>
                  }
                </ul>
              }
              <p class="ig__changes-foot">
                <a
                  class="mf-link"
                  data-open-audit
                  routerLink="/admin/audit"
                  [queryParams]="{ objectType: auditTypes }"
                  >Open Audit Logs</a
                >
              </p>
            </section>
          }
        }
      }
    }

    <mf-secret-dialog
      [(open)]="secretOpen"
      [replacing]="conn()?.secretIsSet ?? false"
      [busy]="secretBusy()"
      [secretError]="secretMsg('secret')"
      [expiresError]="secretMsg('expiresOn')"
      [saveError]="secretFailure()"
      (save)="saveSecret($event)"
    />
    <mf-integration-dialog
      [(open)]="dialogOpen"
      [integration]="editing()"
      [busy]="dialogBusy()"
      [fieldErrors]="dialogErrors()"
      [saveError]="dialogFailure()"
      (save)="saveIntegration($event)"
    />
    <mf-confirm-dialog
      title="Delete Integration"
      confirmLabel="Delete Integration"
      [danger]="true"
      [busy]="deleting()"
      [error]="deleteError()"
      size="small"
      [(visible)]="confirmOpen"
      (confirmed)="confirmDelete()"
    >
      <p data-delete-text>
        Delete <strong>{{ target()?.name }}</strong
        >? Anything that uses it stops working until you add it again. This cannot be undone.
      </p>
    </mf-confirm-dialog>
  `,
})
export class IntegrationsTab implements OnInit {
  private readonly entra = inject(EntraConnectionClient);
  private readonly api = inject(IntegrationsClient);
  private readonly audit = inject(AuditSearchClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  protected readonly auditTypes = OBJECT_TYPES;
  protected readonly state = signal<LoadState>('loading');
  protected readonly conn = signal<EntraConnectionResponse | null>(null);
  protected readonly rows = signal<readonly IntegrationResponse[]>([]);
  protected readonly changes = signal<readonly AuditSearchItem[]>([]);
  protected readonly canReadAudit = computed(() => this.auth.has('Audit.View'));

  // The two IDs (Save Changes covers only these).
  protected readonly tenant = signal('');
  protected readonly clientId = signal('');
  protected readonly idsBusy = signal(false);
  protected readonly idErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly conflict = signal(false);
  protected readonly summary = computed(() => Object.values(this.idErrors()));
  protected readonly dirty = computed(() => {
    const c = this.conn();
    return (
      !!c &&
      (this.tenant().trim() !== (c.tenantId ?? '') || this.clientId().trim() !== (c.clientId ?? ''))
    );
  });
  protected readonly entraTesting = signal(false);
  /** The chip at the top of the connection card: Not Set Up until the two IDs and a secret exist, then the last test (Not Tested before the first). */
  protected readonly connectionStatus = computed(() => {
    const c = this.conn();
    if (!c || !c.tenantId || !c.clientId || !c.secretIsSet) return 'NOT_SET_UP';
    if (!c.lastTest) return 'NOT_TESTED';
    return c.lastTest.outcome === 'OK' ? 'CONNECTED' : 'FAILED';
  });

  // The secret dialog.
  protected readonly secretOpen = signal(false);
  protected readonly secretBusy = signal(false);
  protected readonly secretErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly secretFailure = signal('');
  protected readonly expiry = computed<SecretExpiry | null>(() => {
    const c = this.conn();
    return c ? secretExpiry(c.secretIsSet, c.secretExpiresOn, this.clock.now(), this.zone) : null;
  });

  // The integration dialog and the delete confirm.
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<IntegrationResponse | null>(null);
  protected readonly dialogBusy = signal(false);
  protected readonly dialogErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly dialogFailure = signal('');
  protected readonly confirmOpen = signal(false);
  protected readonly target = signal<IntegrationResponse | null>(null);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');

  // The result panel: this session's last test, else the most recent stored one.
  private readonly lastRun = signal<PanelResult | null>(null);
  protected readonly panel = computed<PanelResult | null>(() => {
    const run = this.lastRun();
    if (run) return run;
    const tested = this.rows()
      .filter((r) => !!r.lastTest)
      .sort((a, b) => (b.lastTest!.testedAt > a.lastTest!.testedAt ? 1 : -1))[0];
    return tested
      ? {
          name: tested.name,
          baseUrl: tested.baseUrl ?? null,
          scope: tested.scope ?? null,
          result: tested.lastTest!,
        }
      : null;
  });

  private readonly defs = signal<readonly RecordGridColumn[]>([
    { key: 'name', label: 'Name', locked: true, pinned: true, minWidth: '160px' },
    { key: 'type', label: 'Type', width: '128px', minWidth: '128px' },
    { key: 'baseUrl', label: 'Base URL', width: '240px', minWidth: '160px' },
    { key: 'scope', label: 'Scope', width: '232px', minWidth: '160px' },
    { key: 'enabled', label: 'Enabled', width: '88px', minWidth: '88px' },
    { key: 'status', label: 'Status', width: '136px', minWidth: '136px' },
    { key: 'tested', label: 'Last Tested', width: '144px', minWidth: '144px' },
  ]);
  protected readonly grid = new RecordGridState('integrations', this.defs);
  protected readonly bones: Readonly<Record<string, string>> = {
    name: '10rem',
    type: '6rem',
    baseUrl: '10rem',
    scope: '10rem',
    enabled: '2rem',
    status: '5rem',
    tested: '5rem',
  };
  /** The grid is a short list on a scrolling page: the frame takes the height of its header (40 px), its rows (44 px, three to eight, more scroll inside) and the 2 px of border, not the 412 px floor of a full-height grid. */
  protected readonly frameMin = computed(
    () => `${40 + Math.min(Math.max(this.rows().length, 3), 8) * 44 + 2}px`,
  );
  protected readonly rowKey = (i: IntegrationResponse): number => i.integrationId;
  protected readonly typeLabel = (code: string): string => TYPE_LABELS[code] ?? code;
  protected readonly stepLabel = (key: string): string => STEP_LABELS[key] ?? key;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    try {
      const [conn, list] = await Promise.all([
        firstValueFrom(this.entra.getEntraConnection()),
        firstValueFrom(this.api.listIntegrations()),
      ]);
      this.applyConnection(conn);
      this.rows.set(list);
      this.state.set('ready');
      void this.loadChanges();
    } catch {
      this.state.set('error');
    }
  }

  private applyConnection(c: EntraConnectionResponse): void {
    this.conn.set(c);
    this.tenant.set(c.tenantId ?? '');
    this.clientId.set(c.clientId ?? '');
    this.idErrors.set({});
  }

  private async loadChanges(): Promise<void> {
    if (!this.canReadAudit()) return;
    try {
      const page = await firstValueFrom(
        this.audit.searchAuditEvents(
          OBJECT_TYPES,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          4,
        ),
      );
      this.changes.set(page.items);
    } catch {
      this.changes.set([]); // the card is a convenience: a failure here is not worth a message
    }
  }

  protected secretMsg(field: string): string {
    return this.secretErrors()[field] ?? '';
  }

  protected idError(field: string): string {
    return this.idErrors()[field] ?? '';
  }

  protected resetIds(): void {
    const c = this.conn();
    if (!c) return;
    this.tenant.set(c.tenantId ?? '');
    this.clientId.set(c.clientId ?? '');
    this.idErrors.set({});
  }

  protected async saveIds(): Promise<void> {
    const c = this.conn();
    if (!c || !this.dirty() || this.idsBusy()) return;
    this.idsBusy.set(true);
    this.idErrors.set({});
    try {
      const saved = await firstValueFrom(
        this.entra.updateEntraConnection({
          tenantId: this.tenant().trim(),
          clientId: this.clientId().trim(),
          rowVersion: c.rowVersion,
        }),
      );
      this.applyConnection(saved);
      this.rows.set(await firstValueFrom(this.api.listIntegrations()));
      this.lastRun.set(null);
      this.notify.success('Connection saved', 'Test it to check the new credentials.');
      void this.loadChanges();
    } catch (err) {
      const e = serverFormErrors(err);
      if (e.conflict) this.conflict.set(true);
      else if (Object.keys(e.fields).length > 0) this.idErrors.set(e.fields);
    } finally {
      this.idsBusy.set(false);
    }
  }

  // ---- the secret ----

  protected openSecret(): void {
    this.secretErrors.set({});
    this.secretFailure.set('');
    this.secretOpen.set(true);
  }

  protected async saveSecret(draft: SecretDraft): Promise<void> {
    this.secretBusy.set(true);
    this.secretErrors.set({});
    this.secretFailure.set('');
    const replacing = this.conn()?.secretIsSet ?? false;
    try {
      const saved = await firstValueFrom(
        this.entra.setEntraClientSecret({ secret: draft.secret, expiresOn: draft.expiresOn }),
      );
      this.applyConnection(saved);
      this.rows.set(await firstValueFrom(this.api.listIntegrations()));
      this.lastRun.set(null);
      this.secretOpen.set(false);
      this.notify.success(
        replacing ? 'Client secret replaced' : 'Client secret set',
        'It is stored encrypted and never shown again. Test the connection to check it.',
      );
      void this.loadChanges();
    } catch (err) {
      const e = serverFormErrors(err);
      if (Object.keys(e.fields).length > 0) this.secretErrors.set(e.fields);
      else if (err instanceof ApiError && err.code === 'SECRET_STORE_UNAVAILABLE')
        this.secretFailure.set(err.message);
      else this.secretFailure.set("Couldn't save the client secret. Try again.");
    } finally {
      this.secretBusy.set(false);
    }
  }

  // ---- tests ----

  protected copyOf(
    result: TestResultResponse,
    subject: string | null,
    baseUrl: string | null,
    scope: string | null,
  ) {
    return testCopy(result.outcome, subject, { baseUrl, scope, tokenSeconds: result.tokenSeconds });
  }

  protected async testEntra(): Promise<void> {
    if (this.entraTesting()) return;
    this.entraTesting.set(true);
    try {
      const result = await firstValueFrom(this.entra.testEntraConnection());
      const c = this.conn();
      if (c)
        this.conn.set({
          ...c,
          lastTest: { ...result, rowVersion: undefined },
          rowVersion: result.rowVersion ?? c.rowVersion,
        });
      this.toastTest(result, null, null, null);
    } catch {
      // the shared error toast already says it
    } finally {
      this.entraTesting.set(false);
    }
  }

  protected async test(row: IntegrationResponse): Promise<void> {
    try {
      const result = await firstValueFrom(this.api.testIntegration(row.integrationId));
      this.lastRun.set({
        name: row.name,
        baseUrl: row.baseUrl ?? null,
        scope: row.scope ?? null,
        result,
      });
      this.rows.set(await firstValueFrom(this.api.listIntegrations()));
      this.toastTest(result, row.name, row.baseUrl ?? null, row.scope ?? null);
    } catch {
      // the shared error toast already says it
    }
  }

  private toastTest(
    result: TestResultResponse,
    subject: string | null,
    baseUrl: string | null,
    scope: string | null,
  ): void {
    const copy = this.copyOf(result, subject, baseUrl, scope);
    const t = testToast(result.outcome, subject, copy);
    if (t.ok) this.notify.success(t.summary, t.detail);
    else this.notify.error(t.summary, t.detail);
  }

  // ---- the list ----

  protected menuFor(row: IntegrationResponse) {
    return rowActions(
      row.name,
      [
        { id: 'edit', label: 'Edit', icon: 'pi-pencil', run: () => this.openEdit(row) },
        { id: 'test', label: 'Test Connection', icon: 'pi-bolt', run: () => void this.test(row) },
        row.isEnabled
          ? {
              id: 'disable',
              label: 'Disable',
              icon: 'pi-ban',
              kind: 'state' as const,
              run: () => void this.setEnabled(row, false),
            }
          : {
              id: 'enable',
              label: 'Enable',
              icon: 'pi-check-circle',
              kind: 'state' as const,
              run: () => void this.setEnabled(row, true),
            },
        {
          id: 'delete',
          label: 'Delete',
          icon: 'pi-trash',
          danger: true,
          run: () => this.askDelete(row),
        },
      ],
      { can: (p) => this.auth.has(p as never) },
    );
  }

  private async setEnabled(row: IntegrationResponse, enable: boolean): Promise<void> {
    try {
      await firstValueFrom(
        enable
          ? this.api.enableIntegration(row.integrationId)
          : this.api.disableIntegration(row.integrationId),
      );
      this.rows.set(await firstValueFrom(this.api.listIntegrations()));
      this.notify.success(
        `${row.name} ${enable ? 'enabled' : 'disabled'}`,
        enable ? 'It can be used again.' : 'It stays in the list and can be turned on again.',
      );
      void this.loadChanges();
    } catch {
      // the shared error toast already says it
    }
  }

  protected openAdd(): void {
    this.editing.set(null);
    this.dialogErrors.set({});
    this.dialogFailure.set('');
    this.dialogOpen.set(true);
  }

  protected openEdit(row: IntegrationResponse): void {
    this.editing.set(row);
    this.dialogErrors.set({});
    this.dialogFailure.set('');
    this.dialogOpen.set(true);
  }

  protected async saveIntegration(draft: IntegrationDraft): Promise<void> {
    const current = this.editing();
    this.dialogBusy.set(true);
    this.dialogErrors.set({});
    this.dialogFailure.set('');
    try {
      const body = {
        name: draft.name,
        typeCode: draft.typeCode,
        baseUrl: draft.baseUrl || undefined,
        scope: draft.scope || undefined,
        isEnabled: draft.isEnabled,
      };
      if (current)
        await firstValueFrom(
          this.api.updateIntegration(current.integrationId, {
            ...body,
            rowVersion: current.rowVersion,
          }),
        );
      else await firstValueFrom(this.api.createIntegration(body));
      this.rows.set(await firstValueFrom(this.api.listIntegrations()));
      this.dialogOpen.set(false);
      this.notify.success(current ? 'Integration saved' : 'Integration added', draft.name);
      void this.loadChanges();
    } catch (err) {
      const e = serverFormErrors(err);
      if (e.conflict)
        this.dialogFailure.set(
          'Someone else changed this integration. Close this and open it again.',
        );
      else if (Object.keys(e.fields).length > 0) this.dialogErrors.set(e.fields);
      else this.dialogFailure.set("Couldn't save the integration. Try again.");
    } finally {
      this.dialogBusy.set(false);
    }
  }

  protected askDelete(row: IntegrationResponse): void {
    this.target.set(row);
    this.deleteError.set('');
    this.confirmOpen.set(true);
  }

  protected async confirmDelete(): Promise<void> {
    const row = this.target();
    if (!row) return;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.api.deleteIntegration(row.integrationId));
      this.rows.set(await firstValueFrom(this.api.listIntegrations()));
      if (this.lastRun()?.name === row.name) this.lastRun.set(null);
      this.confirmOpen.set(false);
      this.notify.success('Integration deleted', row.name);
      void this.loadChanges();
    } catch {
      this.deleteError.set("Couldn't delete the integration. Try again.");
    } finally {
      this.deleting.set(false);
    }
  }
}
