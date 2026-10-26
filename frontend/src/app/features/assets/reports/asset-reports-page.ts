import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  ElementRef,
  afterNextRender,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import {
  AssetReportDefinition,
  AssetReportFieldsResponse,
  AssetReportResponse,
  AssetReportResult,
  AssetReportRunClient,
  AssetReportsClient,
  AssetTypeResponse,
  AssetTypesClient,
} from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import { ChartPanel } from '../../../shared/charts/chart-panel';
import { ChartKind } from '../../../shared/charts/chart-types';
import { ScopeService } from '../../../shared/scope/scope.service';
import { ScopeSwitch } from '../../../shared/scope/scope-switch';
import { ExportMenu, ExportResult } from '../../../shared/ui/export-menu';
import { ExportService } from '../../../shared/ui/export.service';
import { ExportFormat } from '../../../shared/ui/list-export';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';
import { StillLoading } from '../../../shared/ui/still-loading';
import { exportFileName, reportDocument } from './report-csv';
import {
  DISPOSITIONS,
  MEASURES,
  NEW_DRAFT,
  ReportDraft,
  cellText,
  chartRows,
  formatCell,
  toDefinition,
  toDraft,
  undrawnGroups,
} from './report-model';
import { SavedReports, failure } from './saved-reports';

type LoadState = 'loading' | 'ready' | 'error';
type RunState = 'idle' | 'running' | 'ok' | 'error';

/**
 * The asset report builder (epic #851, issue #875; `/assets/reports`): a narrow, built-in flow, not the SQL Reports epic. The person names a
 * report, picks an asset type, a measure (Count, Sum or Average) with a number field and a group-by, and Runs it; the result is a TABLE
 * first, and Pie or Bar are buttons above it (with the graph field and a way back, the shared lazy chart panel). Saved reports are personal
 * and only a definition: every run uses the viewer's current visibility, so a matter hidden by the sensitive-matter rule contributes nothing.
 * The CSV file is built in the browser from the table on screen (UTF-8 with BOM, formula-protected).
 */
@Component({
  selector: 'mf-asset-reports-page',
  imports: [
    PageHeader,
    ScopeSwitch,
    ChartPanel,
    ExportMenu,
    ErrorReference,
    StillLoading,
    SavedReports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', '../../../shared/ui/form-field.scss'],
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .ar {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s5);
      align-items: start;
    }
    @media (min-width: 1100px) {
      .ar {
        grid-template-columns: minmax(0, 1fr) 20rem;
      }
    }
    .ar__main {
      display: grid;
      gap: var(--mf-s5);
      min-width: 0;
    }
    .ar__card {
      display: grid;
      gap: var(--mf-s4);
      min-width: 0;
      padding: var(--mf-s5);
      background: var(--mf-surface);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-1);
    }
    @media (max-width: 639.98px) {
      .ar__card {
        padding: var(--mf-s4) var(--mf-s3);
      }
    }
    .ar h2 {
      margin: 0;
      font-size: var(--mf-fs-h3);
    }
    .ar__fields {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s4);
    }
    @media (min-width: 768px) {
      .ar__fields {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .ar__wide {
        grid-column: 1 / -1;
      }
    }
    .ar__fields .mf-field {
      max-width: none;
    }
    .ar__measures {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s5);
    }
    .ar__measures label {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min);
    }
    fieldset.ar__set {
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .ar__legend {
      padding: 0;
      font-weight: 600;
    }
    .ar__buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .ar__alert {
      margin: 0;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
      background: var(--mf-danger-bg);
      color: var(--mf-danger);
    }
    .ar__units {
      display: flex;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-warning);
      border-radius: var(--mf-radius);
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
    }
    .ar__muted {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ar__empty {
      margin: 0;
      padding: var(--mf-s5);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius);
      text-align: center;
    }
    .ar__tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .ar__graph {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .ar__table {
      width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    .ar__table caption {
      padding-bottom: var(--mf-s2);
      color: var(--mf-text-muted);
      text-align: left;
    }
    .ar__table th,
    .ar__table td {
      padding: var(--mf-s2) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      text-align: left;
      overflow-wrap: anywhere;
    }
    .ar__table thead th {
      font-weight: 600;
      border-bottom-color: var(--mf-border-strong);
    }
    .ar__table .ar__num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .ar__table tfoot th,
    .ar__table tfoot td {
      font-weight: 700;
      border-top: 2px solid var(--mf-border-strong);
    }
    .ar__table tbody th {
      font-weight: 400;
    }
    .ar__saved {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
    }
  `,
  template: `
    <mf-page-header
      heading="Asset reports"
      [crumbs]="crumbs"
      description="Count, add up or average the data of your assets, then draw it. Your saved reports are yours alone."
    >
      <button mfActions type="button" class="mf-btn" data-new-report (click)="startNew()">
        New report
      </button>
    </mf-page-header>

    @if (typesState() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true" data-loading>
        Loading the report builder.
        <mf-still-loading (retry)="init()" />
      </div>
    } @else if (typesState() === 'error') {
      <div class="pg-alert" role="alert" data-load-error>
        The report builder could not be loaded.
        <mf-error-reference />
        <button type="button" class="mf-btn" data-retry (click)="init()">Retry</button>
      </div>
    } @else {
      <div class="ar">
        <div class="ar__main">
          <section class="ar__card" aria-labelledby="ar-define-h" data-define>
            <h2 id="ar-define-h">
              {{ openReport() ? 'Report: ' + openReport()!.name : 'Define the report' }}
            </h2>
            @if (notice()) {
              <p class="ar__alert" role="alert" data-notice>{{ notice() }}</p>
            }
            <form class="ar__fields" novalidate (submit)="$event.preventDefault(); run()">
              <div class="mf-field ar__wide">
                <label class="mf-field__label" for="ar-name">Report name</label>
                <input
                  id="ar-name"
                  class="mf-field__input"
                  type="text"
                  maxlength="100"
                  autocomplete="off"
                  data-name
                  [value]="draft().name"
                  [attr.aria-invalid]="errors().name ? 'true' : null"
                  [attr.aria-describedby]="errors().name ? 'ar-name-err' : 'ar-name-help'"
                  (input)="set('name', $any($event.target).value)"
                />
                @if (errors().name) {
                  <p id="ar-name-err" class="mf-field__error" data-name-error>
                    {{ errors().name }}
                  </p>
                } @else {
                  <p id="ar-name-help" class="mf-field__help">
                    Needed to save the report; not needed to run it.
                  </p>
                }
              </div>

              <div class="mf-field">
                <label class="mf-field__label" for="ar-type">Asset type</label>
                <select
                  id="ar-type"
                  class="mf-field__input"
                  data-type
                  (change)="onType($any($event.target).value)"
                >
                  <option value="" [selected]="draft().typeId === null">All asset types</option>
                  @for (t of types(); track t.assetTypeId) {
                    <option [value]="t.assetTypeId" [selected]="draft().typeId === t.assetTypeId">
                      {{ t.name }}{{ t.isActive ? '' : ' (inactive)' }}
                    </option>
                  }
                </select>
              </div>

              <div class="mf-field">
                <label class="mf-field__label" for="ar-group">Group by</label>
                <select
                  id="ar-group"
                  class="mf-field__input"
                  data-group
                  (change)="set('groupBy', $any($event.target).value)"
                >
                  @for (g of groupOptions(); track g.key) {
                    <option [value]="g.key" [selected]="draft().groupBy === g.key">
                      {{ g.label }}
                    </option>
                  }
                </select>
              </div>

              <fieldset class="ar__set" data-measure-set>
                <legend class="ar__legend">Measure</legend>
                <div class="ar__measures">
                  @for (m of measures; track m.value) {
                    <label>
                      <input
                        type="radio"
                        name="ar-measure"
                        [value]="m.value"
                        [checked]="draft().measure === m.value"
                        [attr.data-measure]="m.value"
                        (change)="onMeasure(m.value)"
                      />
                      {{ m.label }}
                    </label>
                  }
                </div>
              </fieldset>

              @if (draft().measure !== 'count') {
                @if (draft().typeId === null) {
                  <p class="ar__muted" data-default-size-note>
                    For all asset types, each type's default size field is used. Choose an asset
                    type to pick another number field.
                  </p>
                } @else if (numberFields().length === 0) {
                  <p class="ar__muted" data-no-number-fields>
                    This asset type has no number field to add up. Add one on the asset type, or
                    choose Count.
                  </p>
                } @else {
                  <div class="mf-field">
                    <label class="mf-field__label" for="ar-number">Number field</label>
                    <select
                      id="ar-number"
                      class="mf-field__input"
                      data-number-field
                      [attr.aria-invalid]="errors().numberField ? 'true' : null"
                      [attr.aria-describedby]="errors().numberField ? 'ar-number-err' : null"
                      (change)="
                        set('numberField', $any($event.target).value); set('numberUnit', '')
                      "
                    >
                      @for (f of numberFields(); track f.key) {
                        <option [value]="f.key" [selected]="draft().numberField === f.key">
                          {{ f.label
                          }}{{ f.isDefaultSize ? ' (default size, ' + f.unit + ')' : '' }}
                        </option>
                      }
                    </select>
                    @if (errors().numberField) {
                      <p id="ar-number-err" class="mf-field__error">{{ errors().numberField }}</p>
                    }
                  </div>
                  @if (needsUnit()) {
                    <div class="mf-field">
                      <label class="mf-field__label" for="ar-unit">Unit of this field</label>
                      <select
                        id="ar-unit"
                        class="mf-field__input"
                        data-number-unit
                        [attr.aria-invalid]="errors().numberUnit ? 'true' : null"
                        [attr.aria-describedby]="errors().numberUnit ? 'ar-unit-err' : null"
                        (change)="set('numberUnit', $any($event.target).value)"
                      >
                        <option value="" [selected]="draft().numberUnit === ''">
                          Choose the unit
                        </option>
                        @for (u of units(); track u) {
                          <option [value]="u" [selected]="draft().numberUnit === u">
                            {{ u }}
                          </option>
                        }
                      </select>
                      @if (errors().numberUnit) {
                        <p id="ar-unit-err" class="mf-field__error">{{ errors().numberUnit }}</p>
                      }
                    </div>
                  }
                }
              }

              <div class="mf-field">
                <label class="mf-field__label" for="ar-disp">Disposition</label>
                <select
                  id="ar-disp"
                  class="mf-field__input"
                  data-disposition
                  (change)="set('disposition', $any($event.target).value)"
                >
                  @for (d of dispositions; track d.value) {
                    <option [value]="d.value" [selected]="draft().disposition === d.value">
                      {{ d.label }}
                    </option>
                  }
                </select>
              </div>

              @if (scopes.canAll()) {
                <div class="mf-field">
                  <span class="mf-field__label" id="ar-scope-l">Matters</span>
                  <mf-scope-switch
                    [scope]="draft().scope"
                    [canAll]="true"
                    allLabel="All matters"
                    announceMine="Report on the matters you manage"
                    announceAll="Report on all matters"
                    (scopeChange)="set('scope', $event)"
                  />
                </div>
              }

              @if (fieldsError()) {
                <p class="ar__alert ar__wide" role="alert" data-fields-error>
                  The choices for this asset type could not be loaded. Choose the asset type again
                  to retry.
                </p>
              }

              <div class="ar__buttons ar__wide">
                <button
                  type="submit"
                  class="mf-btn mf-btn--primary"
                  data-run
                  [attr.aria-disabled]="runState() === 'running' ? 'true' : null"
                >
                  {{ runState() === 'running' ? 'Running...' : 'Run' }}
                </button>
                <button
                  type="button"
                  class="mf-btn"
                  data-save
                  [attr.aria-disabled]="saving() ? 'true' : null"
                  (click)="save(false)"
                >
                  {{ openReport() ? 'Save changes' : 'Save' }}
                </button>
                @if (openReport()) {
                  <button type="button" class="mf-btn" data-save-new (click)="save(true)">
                    Save as new report
                  </button>
                }
              </div>
              @if (saveError()) {
                <p class="ar__alert ar__wide" role="alert" data-save-error>{{ saveError() }}</p>
              }
            </form>
          </section>

          <section class="ar__card" aria-labelledby="ar-result-h" data-result #resultCard>
            <h2 id="ar-result-h">Result</h2>
            @switch (runState()) {
              @case ('idle') {
                <p class="ar__empty" data-result-idle>
                  Choose what to count, then Run. The result appears here as a table; you can then
                  draw it as a pie or bars.
                </p>
              }
              @case ('running') {
                <div class="ar__empty" role="status" aria-busy="true" data-result-loading>
                  Running the report.
                  <mf-still-loading (retry)="run()" />
                </div>
              }
              @case ('error') {
                <div class="ar__alert" role="alert" data-result-error>
                  {{ runError() }}
                  <mf-error-reference />
                  <button type="button" class="mf-btn" data-run-retry (click)="run()">
                    Try again
                  </button>
                </div>
              }
              @case ('ok') {
                @if (result(); as r) {
                  @if (r.unitsWarning) {
                    <p class="ar__units" role="note" data-units-warning>
                      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                      <span><strong>Check the units.</strong> {{ r.unitsWarning }}</span>
                    </p>
                  }
                  @if (stale()) {
                    <p class="ar__muted" role="status" data-stale>
                      You changed the settings after this result. Run again to update it.
                    </p>
                  }
                  <p class="ar__muted" role="status" data-summary>
                    {{ r.assets }} {{ r.assets === 1 ? 'asset' : 'assets' }} in {{ r.rows.length }}
                    {{ r.rows.length === 1 ? 'group' : 'groups' }}, grouped by
                    {{ r.groupByLabel.toLowerCase()
                    }}{{ r.assetTypeName ? ', ' + r.assetTypeName : ', all asset types' }}.
                  </p>
                  @if (r.rows.length === 0) {
                    <p class="ar__empty" data-result-empty>
                      No assets match this report. Try another disposition or asset type{{
                        scopes.canAll() && draft().scope === 'mine' ? ', or all matters' : ''
                      }}.
                    </p>
                  } @else {
                    <div class="ar__tools">
                      <mf-export-menu
                        [run]="exportRun"
                        [fileName]="exportName()"
                        [disabled]="r.rows.length === 0"
                        reason="Nothing to export."
                      />
                      @if (kind() !== 'table' && r.columns.length > 1) {
                        <div class="ar__graph">
                          <label class="pg-label" for="ar-graph">Graph field</label>
                          <select
                            id="ar-graph"
                            class="mf-control"
                            data-graph-field
                            (change)="graphChoice.set(+$any($event.target).value)"
                          >
                            @for (c of r.columns; track c.key; let i = $index) {
                              <option [value]="i" [selected]="graphIndex() === i">
                                {{ c.label }}
                              </option>
                            }
                          </select>
                        </div>
                      }
                    </div>
                    <mf-chart-panel
                      [customTable]="true"
                      [(kind)]="kind"
                      [heading]="graphHeading()"
                      [rows]="graphRows()"
                      [labelHeader]="r.groupByLabel"
                      [valueHeader]="graphColumn()?.label ?? 'Value'"
                      [unit]="graphColumn()?.unit ?? 'assets'"
                      [format]="format"
                      emptyText="Nothing to draw."
                    >
                      <table class="ar__table" data-result-table>
                        <caption>
                          {{
                            tableCaption()
                          }}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{{ r.groupByLabel }}</th>
                            @for (c of r.columns; track c.key) {
                              <th scope="col" class="ar__num">{{ c.label }}</th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of r.rows; track row.key) {
                            <tr data-result-row>
                              <th scope="row">{{ row.label || '(none)' }}</th>
                              @for (cell of row.cells; track $index) {
                                <td class="ar__num">{{ text(cell) }}</td>
                              }
                            </tr>
                          }
                        </tbody>
                        <tfoot>
                          <tr data-result-total>
                            <th scope="row">Total</th>
                            @for (cell of r.totals.cells; track $index) {
                              <td class="ar__num">{{ text(cell) }}</td>
                            }
                          </tr>
                        </tfoot>
                      </table>
                    </mf-chart-panel>
                    @if (undrawn() > 0 && kind() !== 'table') {
                      <p class="ar__muted" data-undrawn>
                        {{ undrawn() }} {{ undrawn() === 1 ? 'group has' : 'groups have' }} no value
                        for this field and {{ undrawn() === 1 ? 'is' : 'are' }} not drawn. The table
                        lists every group.
                      </p>
                    }
                    @if (r.hiddenGroups > 0) {
                      <p class="ar__muted" data-hidden-groups>
                        Top {{ r.rows.length }} groups by value. {{ r.hiddenGroups }} more
                        {{ r.hiddenGroups === 1 ? 'group is' : 'groups are' }} hidden; narrow the
                        report to see {{ r.hiddenGroups === 1 ? 'it' : 'them' }}. The export has the
                        same groups.
                      </p>
                    }
                  }
                }
              }
            }
          </section>
        </div>

        <aside class="ar__card ar__saved" aria-labelledby="ar-saved-h" data-saved>
          <h2 id="ar-saved-h">Saved reports</h2>
          <mf-saved-reports
            [reports]="saved()"
            [openId]="openReport()?.assetReportId ?? null"
            [state]="savedState()"
            (opened)="open($event)"
            (renamed)="renamed($event)"
            (deleted)="deleted($event)"
            (retry)="loadSaved()"
          />
        </aside>
      </div>
    }
  `,
})
export class AssetReportsPage {
  private readonly typesApi = inject(AssetTypesClient);
  private readonly reportsApi = inject(AssetReportsClient);
  private readonly runApi = inject(AssetReportRunClient);
  private readonly exports = inject(ExportService);
  private readonly quiet = inject(QuietRequests);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly scopes = inject(ScopeService);

  protected readonly crumbs = [{ label: 'Assets', link: ['/assets'] }, { label: 'Reports' }];
  protected readonly measures = MEASURES;
  protected readonly dispositions = DISPOSITIONS;
  protected readonly format = formatCell;

  protected readonly typesState = signal<LoadState>('loading');
  protected readonly savedState = signal<LoadState>('loading');
  protected readonly types = signal<readonly AssetTypeResponse[]>([]);
  protected readonly saved = signal<readonly AssetReportResponse[]>([]);
  protected readonly fields = signal<AssetReportFieldsResponse | null>(null);
  protected readonly fieldsError = signal(false);

  protected readonly draft = signal<ReportDraft>({ ...NEW_DRAFT });
  protected readonly errors = signal<{ name?: string; numberField?: string; numberUnit?: string }>(
    {},
  );
  protected readonly openReport = signal<AssetReportResponse | null>(null);
  protected readonly notice = signal('');

  protected readonly runState = signal<RunState>('idle');
  protected readonly runError = signal('');
  protected readonly result = signal<AssetReportResult | null>(null);
  /** The settings the shown result was run with (an export names them). */
  private readonly ranWith = signal<AssetReportDefinition | null>(null);
  protected readonly stale = signal(false);
  protected readonly kind = signal<ChartKind>('table');
  protected readonly graphChoice = signal<number | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');

  private readonly resultCard = viewChild<ElementRef<HTMLElement>>('resultCard');
  private runSeq = 0;
  private fieldsSeq = 0;

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly numberFields = computed(() => this.fields()?.numberFields ?? []);
  protected readonly units = computed(() => this.fields()?.units ?? []);
  protected readonly defaultSizeKey = computed(() => this.fields()?.defaultSizeFieldKey ?? null);
  protected readonly groupOptions = computed(
    () =>
      this.fields()?.groupBy ?? [
        { key: 'disposition', label: 'Disposition' },
        { key: 'matter', label: 'Matter' },
        { key: 'client', label: 'Client' },
        { key: 'assetType', label: 'Asset type' },
      ],
  );
  protected readonly needsUnit = computed(() => {
    const d = this.draft();
    return (
      d.measure !== 'count' &&
      d.typeId !== null &&
      d.numberField !== '' &&
      d.numberField !== this.defaultSizeKey()
    );
  });

  /** The column the graph draws: the one the person chose, else the measure column (or the count for a Count report). */
  protected readonly graphIndex = computed(() => {
    const r = this.result();
    if (!r) return 0;
    const chosen = this.graphChoice();
    if (chosen !== null && chosen < r.columns.length) return chosen;
    return r.columns.length > 1 ? 1 : 0;
  });
  protected readonly graphColumn = computed(
    () => this.result()?.columns[this.graphIndex()] ?? null,
  );
  protected readonly graphRows = computed(() => {
    const r = this.result();
    return r ? chartRows(r, this.graphIndex()) : [];
  });
  protected readonly undrawn = computed(() => {
    const r = this.result();
    return r ? undrawnGroups(r, this.graphIndex()) : 0;
  });
  protected readonly graphHeading = computed(() => {
    const r = this.result();
    const c = this.graphColumn();
    return r && c ? `${c.label} by ${r.groupByLabel.toLowerCase()}` : 'Result';
  });
  protected readonly tableCaption = computed(() => {
    const r = this.result();
    return r
      ? `${r.measure === 'count' ? 'Assets' : r.columns[1]?.label} by ${r.groupByLabel.toLowerCase()}`
      : '';
  });
  /** The file name of an export (the menu adds `.csv`): the report name and the time of the result. */
  protected readonly exportName = computed(() => {
    const r = this.result();
    return exportFileName(
      this.draft().name.trim() || 'asset-report',
      new Date(),
      (r?.hiddenGroups ?? 0) > 0,
    );
  });

  constructor() {
    this.init();
    // A link `?report=<id>` opens that saved report once the list is here.
    effect(() => {
      const state = this.savedState();
      const raw = this.params().get('report');
      untracked(() => {
        if (state !== 'ready' || !raw) return;
        const id = Number(raw);
        if (this.openReport()?.assetReportId === id) return;
        const found = this.saved().find((r) => r.assetReportId === id);
        if (found) void this.open(found, false);
        else
          this.notice.set(
            'That saved report was not found. It may have been deleted, or it is not yours.',
          );
      });
    });
  }

  init(): void {
    void this.loadTypes();
    void this.loadSaved();
    void this.loadFields(true);
  }

  private async loadTypes(): Promise<void> {
    this.typesState.set('loading');
    try {
      const page = await this.quiet.runInline(() =>
        firstValueFrom(
          this.typesApi.listAssetTypes(undefined, undefined, undefined, 1, 100, 'name'),
        ),
      );
      this.types.set(page.items);
      this.typesState.set('ready');
    } catch {
      this.typesState.set('error');
    }
  }

  protected async loadSaved(): Promise<void> {
    this.savedState.set('loading');
    try {
      this.saved.set(
        await this.quiet.runInline(() => firstValueFrom(this.reportsApi.listAssetReports())),
      );
      this.savedState.set('ready');
    } catch {
      this.savedState.set('error');
    }
  }

  /** The number fields, group-bys and units for the chosen asset type (`reset`: also pick the defaults for it). */
  private async loadFields(reset: boolean): Promise<void> {
    const seq = ++this.fieldsSeq;
    const typeId = this.draft().typeId;
    try {
      const f = await this.quiet.run(() =>
        firstValueFrom(this.reportsApi.getAssetReportFields(typeId ?? undefined)),
      );
      if (seq !== this.fieldsSeq) return;
      this.fieldsError.set(false);
      this.fields.set(f);
      if (reset) {
        this.draft.update((d) => ({
          ...d,
          numberField: f.defaultSizeFieldKey ?? f.numberFields[0]?.key ?? '',
          numberUnit: '',
          groupBy: f.groupBy.some((g) => g.key === d.groupBy) ? d.groupBy : 'disposition',
        }));
      }
    } catch {
      if (seq === this.fieldsSeq) this.fieldsError.set(true);
    }
  }

  // ---- form ----

  protected set<K extends keyof ReportDraft>(key: K, value: ReportDraft[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
    this.errors.update((e) => ({ ...e, [key]: undefined }));
    this.touch();
  }

  protected onType(value: string): void {
    this.draft.update((d) => ({ ...d, typeId: value ? Number(value) : null }));
    this.touch();
    void this.loadFields(true);
  }

  protected onMeasure(measure: ReportDraft['measure']): void {
    this.set('measure', measure);
  }

  private touch(): void {
    if (this.runState() === 'ok') this.stale.set(true);
    this.saveError.set('');
  }

  protected text = cellText;

  private definition() {
    return toDefinition(this.draft(), this.kind(), this.defaultSizeKey());
  }

  private validate(forSave: boolean): boolean {
    const d = this.draft();
    const e: { name?: string; numberField?: string; numberUnit?: string } = {};
    if (forSave && !d.name.trim()) e.name = 'Enter a name to save the report.';
    if (d.measure !== 'count' && d.typeId !== null) {
      if (!d.numberField) e.numberField = 'Choose the number field to add up.';
      else if (this.needsUnit() && !d.numberUnit) e.numberUnit = 'Choose the unit of this field.';
    }
    this.errors.set(e);
    if (Object.keys(e).length > 0) {
      focusFirstInvalid(this.injector);
      return false;
    }
    return true;
  }

  // ---- run ----

  protected async run(): Promise<void> {
    if (this.runState() === 'running' || !this.validate(false)) return;
    const definition = this.definition();
    await this.execute(() => this.runApi.runAssetReport(definition), definition);
    // The result is below the form: bring it into view (no animation), so Run visibly does something on a short window.
    afterNextRender(
      () =>
        this.resultCard()?.nativeElement.scrollIntoView?.({
          block: 'nearest',
          behavior: 'instant',
        }),
      { injector: this.injector },
    );
  }

  private async execute(
    call: () => Observable<AssetReportResult>,
    definition: AssetReportDefinition,
  ): Promise<void> {
    const seq = ++this.runSeq;
    this.runState.set('running');
    this.runError.set('');
    try {
      const r = await this.quiet.runInline(() => firstValueFrom(call()));
      if (seq !== this.runSeq) return;
      this.result.set(r);
      this.ranWith.set(definition);
      this.graphChoice.set(null);
      this.stale.set(false);
      this.runState.set('ok');
    } catch (e) {
      if (seq !== this.runSeq) return;
      this.runError.set(failure(e, 'The report could not be run.'));
      this.runState.set('error');
    }
  }

  // ---- export ----

  /**
   * The table on screen as a CSV or text document (the shared Export menu, PM v2 #879): built here from the result, then the export is logged
   * (surface, format, rows and the settings it ran with; never the data) as the other lists do.
   */
  protected readonly exportRun = async (format: ExportFormat): Promise<ExportResult> => {
    const r = this.result();
    if (!r) return { text: '', rows: 0 };
    const d = this.ranWith() ?? this.definition();
    const summary = [
      r.assetTypeName ?? 'all asset types',
      `${r.measure} by ${r.groupByLabel}`,
      `scope ${d.scope}`,
      `disposition ${d.dispositions?.join('+') ?? 'any'}`,
    ].join(', ');
    void this.exports.log('asset-report', format, r.rows.length, summary);
    return { text: reportDocument(format, r), rows: r.rows.length };
  };

  // ---- save, open, rename, delete ----

  protected async save(asNew: boolean): Promise<void> {
    if (this.saving() || !this.validate(true)) return;
    this.saving.set(true);
    this.saveError.set('');
    const name = this.draft().name.trim();
    const definition = this.definition();
    const current = this.openReport();
    try {
      const saved = await this.quiet.run(() =>
        firstValueFrom(
          current && !asNew
            ? this.reportsApi.updateAssetReport(current.assetReportId, {
                name,
                definition,
                rowVersion: current.rowVersion,
              })
            : this.reportsApi.createAssetReport({ name, definition }),
        ),
      );
      this.openReport.set(saved);
      this.notify.success('Report saved', saved.name);
      await this.loadSaved();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { report: saved.assetReportId },
        replaceUrl: true,
      });
    } catch (e) {
      this.saveError.set(failure(e, 'The report could not be saved.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async open(report: AssetReportResponse, navigate = true): Promise<void> {
    if (!report.definition) return;
    this.notice.set('');
    this.saveError.set('');
    this.errors.set({});
    this.openReport.set(report);
    this.draft.set(toDraft(report.name, report.definition));
    this.kind.set(chartOf(report.definition.chart));
    void this.loadFields(false);
    if (navigate)
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { report: report.assetReportId },
      });
    await this.execute(
      () => this.runApi.runSavedAssetReport(report.assetReportId),
      report.definition,
    );
  }

  protected renamed(report: AssetReportResponse): void {
    this.saved.update((list) =>
      list.map((r) => (r.assetReportId === report.assetReportId ? report : r)),
    );
    if (this.openReport()?.assetReportId === report.assetReportId) {
      this.openReport.set(report);
      this.draft.update((d) => ({ ...d, name: report.name }));
    }
  }

  protected deleted(id: number): void {
    this.saved.update((list) => list.filter((r) => r.assetReportId !== id));
    if (this.openReport()?.assetReportId === id) this.startNew();
  }

  protected startNew(): void {
    this.runSeq++;
    this.openReport.set(null);
    this.draft.set({ ...NEW_DRAFT });
    this.result.set(null);
    this.runState.set('idle');
    this.kind.set('table');
    this.errors.set({});
    this.notice.set('');
    this.saveError.set('');
    this.stale.set(false);
    void this.loadFields(true);
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }
}

function chartOf(value: string | undefined): ChartKind {
  return value === 'pie' || value === 'bar' ? value : 'table';
}
