import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  ReportsClient,
  RunReportResponse,
  RunnableReportResponse,
} from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { PageTitle, recordTitle } from '../../core/title/page-title';
import { ErrorReference } from '../../shared/ui/error-reference';
import { IntPipe } from '../../shared/ui/number-format';
import { Crumb, PageHeader } from '../../shared/ui/page-header';
import { SlidePanel } from '../../shared/ui/slide-panel';
import { StateBlock } from '../../shared/ui/state-block';
import { StatePage } from '../../shared/ui/state-page';
import { Tip } from '../../shared/ui/tip';
import { Button } from 'primeng/button';
import { ReportParameterForm } from './report-parameter-form';
import { RunBanner, outcomeOf } from './report-messages';
import {
  FormValues,
  OptionLabels,
  buildRequest,
  defaultValues,
  initialValues,
  summaryParts,
  urlParams,
} from './report-params';

type PageState = 'loading' | 'ready' | 'noAccess' | 'error';
type RunStatus = 'idle' | 'running' | 'done';

/** A description longer than this gets "Show More" (it is clamped to three lines). */
const LONG_DESCRIPTION = 240;

/**
 * Run page of a report (issue #719, spec section 3 of `docs/ux/reports-review/ui-spec-user-pages.md`): the crumb, the report name with its category,
 * the description and the help panel, the Parameters card (`mf-report-parameter-form`), then the result area. The values of the form travel in the
 * address (a name per parameter, `from.from=...`), so a run can be bookmarked; opening such an address fills the form and never runs it. Run Report
 * becomes Cancel while the report runs; after a run the form collapses to a summary bar with Change Parameters. Leaving the page while a report
 * runs cancels it without a word (owner decision 12). Limits and failures are one banner above the result (spec 3.5), never a toast.
 *
 * The result grid is the next task (#720): the area marked `data-result-slot` shows a neutral "finished with N rows" block until the grid replaces it.
 */
@Component({
  selector: 'mf-report-run-page',
  imports: [
    Button,
    ErrorReference,
    IntPipe,
    PageHeader,
    ReportParameterForm,
    RouterLink,
    SlidePanel,
    StateBlock,
    StatePage,
    Tip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .rp__about {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      max-width: 60rem;
      margin: 0 0 var(--mf-s4);
    }
    .rp__desc {
      flex: 0 1 auto;
      margin: 0;
      color: var(--mf-text);
      overflow-wrap: anywhere;
      white-space: pre-line;
    }
    .rp__desc--clamped {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      overflow: hidden;
    }
    .rp__help {
      flex: none;
      margin-top: -6px;
    }
    .rp__hidden {
      display: none;
    }
    .rp__summary {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding-block: var(--mf-s2);
    }
    .rp__summary-text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rp__summary-label {
      font-weight: var(--mf-fw-semibold);
    }
    .rp__running {
      margin: var(--mf-s3) 0 0;
      color: var(--mf-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .rp__result {
      margin-top: var(--mf-s4);
    }
    .rp__bar {
      display: block;
      height: 14px;
      border-radius: var(--mf-radius);
      background: var(--mf-border);
      opacity: 0.55;
    }
    .rp__skeleton {
      display: grid;
      gap: var(--mf-s3);
    }
    @media (prefers-reduced-motion: no-preference) {
      .rp__bar {
        animation: rp-pulse 1.4s ease-in-out infinite;
      }
    }
    @keyframes rp-pulse {
      50% {
        opacity: 0.25;
      }
    }
    .rp__help-body {
      margin: 0;
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <div class="mf-sr-only" role="status" aria-live="polite" data-announce>
      {{ announcement() }}
    </div>
    @if (state() === 'noAccess') {
      <mf-state-page
        icon="pi pi-ban"
        heading="You don't have access to this report."
        [showBrand]="false"
        data-no-access
      >
        <a mfPrimary class="mf-btn mf-btn--primary" routerLink="/reports">Back to Reports</a>
      </mf-state-page>
    } @else {
      <mf-page-header
        icon="pi pi-chart-bar"
        [crumbs]="crumbs()"
        [heading]="report()?.name ?? (state() === 'error' ? 'Report' : '')"
        [description]="report()?.categoryName ?? ''"
      />

      @switch (state()) {
        @case ('loading') {
          <div class="mf-card rp__skeleton" aria-busy="true" data-form-skeleton>
            <span class="mf-sr-only" role="status">Loading report</span>
            <span class="rp__bar" style="width: 12rem"></span>
            <span class="rp__bar" style="width: 100%"></span>
            <span class="rp__bar" style="width: 100%"></span>
          </div>
        }
        @case ('error') {
          <mf-state-block kind="error" data-definition-error>
            Couldn't load this report.
            <mf-error-reference mfStateReason />
            <p-button mfStateAction label="Retry" severity="secondary" (onClick)="load()" />
          </mf-state-block>
        }
        @default {
          @if (report(); as r) {
            @if (r.description || r.helpText) {
              <div class="rp__about" data-about>
                @if (r.description) {
                  <p
                    class="rp__desc"
                    [class.rp__desc--clamped]="long() && !showAll()"
                    data-description
                  >
                    {{ r.description }}
                  </p>
                  @if (long()) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-show-more
                      [attr.aria-expanded]="showAll()"
                      (click)="showAll.set(!showAll())"
                    >
                      {{ showAll() ? 'Show Less' : 'Show More' }}
                    </button>
                  }
                }
                @if (r.helpText) {
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon rp__help"
                    aria-label="About This Report"
                    mfTip="About This Report"
                    data-help
                    (click)="helpOpen.set(true)"
                  >
                    <i class="pi pi-info-circle" aria-hidden="true"></i>
                  </button>
                }
              </div>
            }

            @if (collapsed()) {
              <div class="mf-card rp__summary" data-summary-bar>
                <span class="rp__summary-text" [attr.title]="summaryText()">
                  <span class="rp__summary-label">Parameters:</span> {{ summaryText() }}
                </span>
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-change-parameters
                  (click)="expanded.set(true)"
                >
                  Change Parameters
                </button>
              </div>
            }
            <div [class.rp__hidden]="collapsed()">
              <mf-report-parameter-form
                [reportId]="r.reportId"
                [defs]="r.parameters"
                [(values)]="values"
                [serverErrors]="serverErrors()"
                [running]="status() === 'running'"
                (run)="run()"
                (cancelRun)="cancel()"
                (resetValues)="reset()"
                (optionLabels)="optionLabels.set($event)"
              />
            </div>

            @if (status() === 'running') {
              <p class="rp__running" data-running>Running... {{ seconds() }} s</p>
            }

            <div class="rp__result" data-result-area>
              @if (banner(); as b) {
                <div
                  class="pg-banner"
                  [class.pg-banner--danger]="b.tone === 'danger'"
                  [class.pg-banner--info]="b.tone === 'info'"
                  role="alert"
                  data-run-banner
                >
                  <i
                    class="pi"
                    [class]="b.tone === 'info' ? 'pi-info-circle' : 'pi-exclamation-triangle'"
                    aria-hidden="true"
                  ></i>
                  <span class="rp__banner-text">
                    {{ b.text }}
                    @if (b.reference) {
                      <mf-error-reference [reference]="b.reference" />
                    }
                  </span>
                  @if (b.action === 'cancelRunning') {
                    <button
                      type="button"
                      class="mf-btn"
                      data-cancel-running
                      (click)="cancelRunning()"
                    >
                      Cancel Running Report
                    </button>
                  }
                </div>
              }
              @switch (status()) {
                @case ('running') {
                  <div class="rp__skeleton" aria-hidden="true" data-result-skeleton>
                    <span class="rp__bar" style="width: 100%"></span>
                    <span class="rp__bar" style="width: 100%"></span>
                    <span class="rp__bar" style="width: 100%"></span>
                  </div>
                }
                @case ('done') {
                  @if (result(); as res) {
                    @if (res.rowCount === 0) {
                      <mf-state-block icon="pi-table" data-no-rows
                        >No rows returned.</mf-state-block
                      >
                    } @else {
                      @if (res.truncated) {
                        <div class="pg-banner pg-banner--info" role="status" data-truncated>
                          <i class="pi pi-info-circle" aria-hidden="true"></i>
                          <span
                            >Showing the first {{ res.maxRows | mfInt }} rows. Narrow the parameters
                            to see the rest.</span
                          >
                        </div>
                      }
                      <!-- RESULT GRID GOES HERE (issue #720). Until then this neutral block says only what is true: the run finished and how many rows it returned. -->
                      <section aria-label="Result" data-result-slot [attr.data-run-id]="res.runId">
                        <mf-state-block icon="pi-check-circle" data-result-placeholder>
                          The report finished with {{ res.rowCount | mfInt }}
                          {{ res.rowCount === 1 ? 'row' : 'rows' }}.
                        </mf-state-block>
                      </section>
                    }
                  }
                }
                @default {
                  @if (!banner()) {
                    <mf-state-block icon="pi-table" data-before-run
                      >Run the report to see results.</mf-state-block
                    >
                  }
                }
              }
            </div>

            @if (r.helpText) {
              <mf-slide-panel
                title="About This Report"
                [subtitle]="r.name"
                closeLabel="Close help"
                [showFooter]="false"
                [(visible)]="helpOpen"
              >
                <p class="rp__help-body" data-help-body>{{ r.helpText }}</p>
              </mf-slide-panel>
            }
          }
        }
      }
    }
  `,
})
export class ReportRunPage {
  private readonly api = inject(ReportsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(PageTitle);
  private readonly paramMap = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly formRef = viewChild(ReportParameterForm);

  protected readonly state = signal<PageState>('loading');
  protected readonly report = signal<RunnableReportResponse | null>(null);
  protected readonly values = signal<FormValues>({});
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly optionLabels = signal<OptionLabels>({});

  protected readonly status = signal<RunStatus>('idle');
  protected readonly result = signal<RunReportResponse | null>(null);
  protected readonly banner = signal<RunBanner | null>(null);
  protected readonly seconds = signal(0);
  /** The values the shown result was run with (the summary bar says these, not what is typed since). */
  private readonly ranValues = signal<FormValues>({});
  protected readonly expanded = signal(false);
  protected readonly showAll = signal(false);
  protected readonly helpOpen = signal(false);
  protected readonly announcement = signal('');

  private runSub: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly crumbs = computed<Crumb[]>(() => [
    { label: 'Reports', link: ['/reports'] },
    this.report()
      ? { label: this.report()!.name }
      : this.state() === 'loading'
        ? { label: '', skeleton: true }
        : { label: 'Report' },
  ]);
  protected readonly long = computed(
    () => (this.report()?.description?.length ?? 0) > LONG_DESCRIPTION,
  );
  /** The form is replaced by its summary bar after a successful run, until Change Parameters is pressed. */
  protected readonly collapsed = computed(
    () =>
      this.status() === 'done' && !this.expanded() && (this.report()?.parameters.length ?? 0) > 0,
  );
  protected readonly summaryText = computed(() => {
    const r = this.report();
    if (!r) return '';
    return (
      summaryParts(r.parameters, this.ranValues(), this.optionLabels()).join(', ') || 'None set'
    );
  });

  constructor() {
    effect(() => {
      const id = Number(this.paramMap().get('reportId'));
      untracked(() => void this.load(id));
    });
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.leave();
      this.title.unpin();
    });
  }

  /** Reads the definition of the report (`GET /reports/{id}`); 404 and 403 are the same "no access" page, because the server never says which. */
  protected async load(id = Number(this.paramMap().get('reportId'))): Promise<void> {
    this.leave();
    this.resetRun();
    if (!Number.isInteger(id) || id <= 0) {
      this.state.set('noAccess');
      return;
    }
    this.state.set('loading');
    try {
      const report = await this.quiet.runInline(() => firstValueFrom(this.api.getMyReport(id)));
      this.report.set(report);
      this.values.set(initialValues(report.parameters, this.route.snapshot.queryParamMap));
      this.title.pin(recordTitle(report.name, 'Reports'));
      this.state.set('ready');
    } catch (error) {
      this.report.set(null);
      this.state.set(
        error instanceof ApiError && (error.status === 404 || error.status === 403)
          ? 'noAccess'
          : 'error',
      );
    }
  }

  protected run(): void {
    const r = this.report();
    if (!r || this.status() === 'running') return;
    this.banner.set(null);
    this.serverErrors.set({});
    const values = this.values();
    // The address carries the values, so this run can be bookmarked or shared; it replaces the entry, so Back does not walk through every run.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: urlParams(r.parameters, values) as Params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.ranValues.set(values);
    this.result.set(null);
    this.status.set('running');
    this.announcement.set('Running the report.');
    this.startTimer();
    this.runSub = this.quiet.run(() =>
      this.api.runReport(r.reportId, { parameters: buildRequest(r.parameters, values) }).subscribe({
        next: (res) => this.finish(res),
        error: (error: unknown) => this.fail(error),
      }),
    );
  }

  /** Cancel while running: the call is dropped (the server stops the query when the request ends) and the person's cancel is sent too; no toast. */
  protected cancel(): void {
    this.runSub?.unsubscribe();
    this.runSub = null;
    this.stopTimer();
    this.status.set(this.result() ? 'done' : 'idle');
    this.announcement.set('The report was cancelled.');
    this.sendCancel();
  }

  /** "Cancel Running Report" in the 409 banner: another run of this person holds the one place. */
  protected cancelRunning(): void {
    this.sendCancel();
    this.banner.set(null);
  }

  protected reset(): void {
    const r = this.report();
    if (!r) return;
    this.values.set(defaultValues(r.parameters));
    this.serverErrors.set({});
    this.banner.set(null);
  }

  private finish(res: RunReportResponse): void {
    this.stopTimer();
    this.runSub = null;
    this.result.set(res);
    this.status.set('done');
    this.expanded.set(false);
    this.announcement.set(
      res.rowCount === 0
        ? 'The report returned no rows.'
        : `The report finished with ${res.rowCount} ${res.rowCount === 1 ? 'row' : 'rows'}.`,
    );
  }

  private fail(error: unknown): void {
    this.stopTimer();
    this.runSub = null;
    this.status.set('idle');
    this.expanded.set(true);
    const outcome = outcomeOf(error, { timeoutSeconds: this.report()?.timeoutSeconds ?? 0 });
    switch (outcome.kind) {
      case 'cancelled':
        this.announcement.set('The report was cancelled.');
        return;
      case 'notAvailable':
        this.state.set('noAccess');
        return;
      case 'fields':
        this.placeFieldErrors(outcome.errors);
        return;
      case 'banner':
        this.banner.set(outcome.banner);
        this.announcement.set(outcome.banner.text);
        return;
    }
  }

  /** The server's per-parameter messages go under their fields; one it cannot place (an unknown name) becomes the banner. */
  private placeFieldErrors(errors: Readonly<Record<string, string>>): void {
    const defs = this.report()?.parameters ?? [];
    const placed: Record<string, string> = {};
    let unplaced = false;
    for (const [key, message] of Object.entries(errors)) {
      const upper = key.toUpperCase();
      const d = defs.find((x) => upper === x.name || upper.startsWith(`${x.name}_`));
      if (d) placed[d.name] = message;
      else unplaced = true;
    }
    this.serverErrors.set(placed);
    if (unplaced || Object.keys(placed).length === 0) {
      this.banner.set({ tone: 'danger', text: 'Some parameter values are not valid.' });
    }
    this.formRef()?.focusFirstProblem();
  }

  private sendCancel(): void {
    this.quiet.run(() =>
      this.api.cancelMyReportRun().subscribe({
        error: () => undefined,
      }),
    );
  }

  /** Leaving the page (or opening another report) cancels a live run, and drops the person's finished result, without a word (decision 12). */
  private leave(): void {
    const live = this.status() === 'running';
    const finished = this.result();
    this.runSub?.unsubscribe();
    this.runSub = null;
    this.stopTimer();
    if (live) this.sendCancel();
    if (finished) {
      this.quiet.run(() =>
        this.api.dropReportResult(finished.runId).subscribe({ error: () => undefined }),
      );
    }
  }

  private resetRun(): void {
    this.status.set('idle');
    this.result.set(null);
    this.banner.set(null);
    this.serverErrors.set({});
    this.expanded.set(false);
    this.showAll.set(false);
    this.seconds.set(0);
  }

  private startTimer(): void {
    this.stopTimer();
    this.seconds.set(0);
    this.timer = setInterval(() => this.seconds.update((n) => n + 1), 1000);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
