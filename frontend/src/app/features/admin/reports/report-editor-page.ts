import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AnalyzeResponse,
  PreviewResponse,
  ReportCategoryResponse,
  ReportAdminClient,
  ReportDefinitionsClient,
  ReportDetailResponse,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Crumb, PageHeader } from '../../../shared/ui/page-header';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { ParametersEditor } from './parameters-editor';
import { PreviewPanel } from './preview-panel';
import { ReportRolesTab } from './report-roles-tab';
import {
  DetectedPlaceholder,
  ParamDef,
  definitionProblems,
  listParameters,
  reconcile,
  toRequestParameters,
} from './report-model';
import { SchemaBrowserPanel } from './schema-browser-panel';
import { SqlEditor, SqlMark } from './sql-editor';
import { VersionsPanel } from './versions-panel';

export type EditorTab = 'details' | 'query' | 'parameters' | 'roles' | 'history';

/** The tab the address asks for; Roles needs the assign permission and a saved report, History a saved report. */
export function editorTabOf(
  value: string | null | undefined,
  isNew: boolean,
  canAssign: boolean,
): EditorTab {
  switch (value) {
    case 'query':
    case 'parameters':
      return value;
    case 'roles':
      return !isNew && canAssign ? 'roles' : 'details';
    case 'history':
      return isNew ? 'details' : 'history';
    default:
      return 'details';
  }
}

/** Where to mark a problem in the text: from the position to the end of the word (at least one character, at most 40). */
export function problemLength(sql: string, position: number): number {
  let end = position;
  while (end < sql.length && end - position < 40 && !/[\s,;()]/.test(sql[end])) end++;
  return Math.max(1, end - position);
}

interface Details {
  name: string;
  categoryId: number | null;
  description: string;
  helpText: string;
  sortOrder: string;
  timeoutSeconds: string;
  maxRows: string;
}

const EMPTY_DETAILS: Details = {
  name: '',
  categoryId: null,
  description: '',
  helpText: '',
  sortOrder: '0',
  timeoutSeconds: '',
  maxRows: '',
};

const STARTER_SQL = 'SELECT 1 AS Example';
const ANALYZE_DELAY_MS = 400;

const intOrNull = (text: string): number | null => {
  const t = text.trim();
  return t === '' || !Number.isFinite(Number(t)) ? null : Math.trunc(Number(t));
};

/**
 * The report editor (spec 9.2; issues #713 to #715). `/admin/reports/new` and `/admin/reports/:id` are the same page: a header with Save, Preview
 * and Activate over the tabs Details | Query | Parameters | Roles | History (`?tab=`, replaced, not added). The query is a plain textarea with line
 * numbers and highlighted `:NAME` placeholders; every pause in typing (400 ms) the server reads it (nothing is executed) and the parameter
 * list follows the placeholders. Saving is blocked, with explicit messages, while the query is invalid or a parameter is not defined. The preview
 * panel runs the unsaved text with sample values; Activate appears only after a successful preview of exactly the saved version. A concurrent
 * edit shows "Reload the latest version". Needs `Report.Manage`; the Roles tab also needs `Report.Assign`.
 */
@Component({
  selector: 'mf-report-editor-page',
  imports: [
    ConfirmDialog,
    PageHeader,
    ParametersEditor,
    PreviewPanel,
    ReportRolesTab,
    SchemaBrowserPanel,
    SqlEditor,
    Tabs,
    VersionsPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-editor-page.html',
  styleUrl: './report-editor-page.scss',
})
export class ReportEditorPage implements HasUnsavedChanges, OnDestroy {
  /** Route parameter `id`; absent on `/admin/reports/new`. */
  readonly id = input<string | undefined>(undefined);
  /** `?tab=` */
  readonly tab = input<string | undefined>(undefined);

  private readonly admin = inject(ReportAdminClient);
  private readonly api = inject(ReportDefinitionsClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);
  private readonly editor = viewChild(SqlEditor);

  protected readonly state = signal<'loading' | 'ready' | 'notFound' | 'error'>('loading');
  protected readonly report = signal<ReportDetailResponse | null>(null);
  protected readonly categories = signal<ReportCategoryResponse[]>([]);

  protected readonly details = signal<Details>({ ...EMPTY_DETAILS });
  protected readonly sql = signal(STARTER_SQL);
  protected readonly defs = signal<ParamDef[]>([]);
  protected readonly unused = signal<ReadonlySet<string>>(new Set());
  protected readonly changeNote = signal('');
  protected readonly keepActive = signal(true);

  protected readonly analysis = signal<AnalyzeResponse | null>(null);
  protected readonly analyzing = signal(false);
  protected readonly busy = signal(false);
  protected readonly conflict = signal(false);
  protected readonly failure = signal('');
  protected readonly summary = signal<string[]>([]);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly parameterErrors = signal<Record<string, string[]>>({});
  protected readonly announcement = signal('');
  protected readonly preview = signal<PreviewResponse | null>(null);
  protected readonly previewOpen = signal(false);
  protected readonly previewBusy = signal(false);
  protected readonly schemaOpen = signal(false);
  protected readonly deactivateOpen = signal(false);
  protected readonly versionsKey = signal(0);

  private baseline = '';
  private analyzeTimer: ReturnType<typeof setTimeout> | undefined;
  private analyzeId = 0;
  private loadedFor: string | undefined | null = null;

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly canAssign = computed(() => this.auth.has('Report.Assign'));
  protected readonly current = computed<EditorTab>(() =>
    editorTabOf(this.tab(), this.isNew(), this.canAssign()),
  );
  protected readonly reportId = computed(() => this.report()?.reportId ?? null);
  protected readonly isActive = computed(() => this.report()?.isActive ?? false);

  /** What the page would save, as text: the dirty check and nothing else. The parameters the query no longer uses do not count. */
  private readonly key = computed(() =>
    JSON.stringify({
      d: this.details(),
      s: this.sql(),
      p: toRequestParameters(this.defs(), this.unused()),
    }),
  );
  /** Moves whenever the baseline does, so `dirty` is recomputed after a load or a save. */
  private readonly baselineVersion = signal(0);
  protected readonly dirty = computed(() => {
    this.baselineVersion();
    return this.state() === 'ready' && this.key() !== this.baseline;
  });

  protected readonly canActivate = computed(
    () => !this.isNew() && !this.isActive() && !!this.report()?.canActivate && !this.dirty(),
  );
  protected readonly activateReason = computed(() => {
    if (this.isNew() || this.isActive()) return '';
    if (this.dirty()) return 'Save your changes, then preview the saved version to activate it.';
    return this.report()?.canActivate ? '' : 'Preview the current version to activate it.';
  });

  protected readonly tabs = computed<MfTab[]>(() => {
    const list: MfTab[] = [
      { key: 'details', label: 'Details' },
      { key: 'query', label: 'Query' },
      { key: 'parameters', label: 'Parameters', count: this.activeDefs().length },
    ];
    if (this.canAssign()) {
      list.push({
        key: 'roles',
        label: 'Roles',
        ...(this.isNew() ? { disabledReason: 'Save the report first.' } : {}),
      });
    }
    list.push({
      key: 'history',
      label: 'History',
      ...(this.isNew() ? { disabledReason: 'Save the report first.' } : {}),
    });
    return list;
  });

  protected readonly crumbs = computed<Crumb[]>(() => [
    { label: 'Administration', plain: true },
    { label: 'Reports', link: '/admin/reports' },
    { label: this.isNew() ? 'New report' : (this.report()?.name ?? 'Report') },
  ]);

  protected readonly activeDefs = computed(() =>
    this.defs().filter((d) => !this.unused().has(d.name)),
  );
  protected readonly placeholders = computed<DetectedPlaceholder[]>(
    () => this.analysis()?.placeholders ?? [],
  );

  /** Highlighted pieces of the query: placeholders (built-in ones apart) and the spots of problems. */
  protected readonly marks = computed<SqlMark[]>(() => {
    const a = this.analysis();
    if (!a) return [];
    const builtIn = new Set(a.placeholders.filter((p) => p.isBuiltIn).map((p) => p.name));
    const sql = this.sql();
    return [
      ...a.occurrences.map((o) => ({
        start: o.start,
        length: o.length,
        kind: (builtIn.has(o.name) ? 'builtin' : 'param') as SqlMark['kind'],
      })),
      ...this.sqlProblems().map((p) => ({
        start: p.position,
        length: problemLength(sql, p.position),
        kind: 'error' as const,
      })),
    ];
  });

  /** The problems with the query text (scanner issues and validator errors, once each), as shown under the editor. */
  protected readonly sqlProblems = computed(() => {
    const a = this.analysis();
    if (!a) return [];
    const seen = new Set<string>();
    return [...a.issues, ...a.validation.errors].filter((e) => {
      const key = `${e.line}:${e.column}:${e.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  protected readonly builtIns = computed(() => this.placeholders().filter((p) => p.isBuiltIn));
  protected readonly detected = computed(() => this.placeholders().filter((p) => !p.isBuiltIn));
  protected readonly missingDefinitions = computed(() => {
    const covered = new Set(
      this.activeDefs().flatMap((d) =>
        d.type === 'dateRange' ? [`${d.name}_FROM`, `${d.name}_TO`] : [d.name],
      ),
    );
    return this.detected()
      .filter((p) => !covered.has(p.name))
      .map((p) => p.name);
  });

  protected readonly isPhone = (): boolean => window.matchMedia('(max-width: 639.98px)').matches;

  protected readonly previewBlocked = computed(() =>
    this.isNew() ? 'Save the report first, then preview it.' : '',
  );
  protected readonly restoreBlocked = computed(() =>
    this.dirty() ? 'Save or discard your changes before restoring a version.' : '',
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // The query is read again 400 ms after the last keystroke or change of a list parameter.
    effect(() => {
      this.sql();
      this.listKey();
      untracked(() => this.scheduleAnalyze());
    });
    effect(() => {
      const state = this.state();
      const name = this.report()?.name;
      if (this.isNew()) this.pageTitle.set('New report');
      else if (state === 'ready' && name) this.pageTitle.set(shortTitleText(name));
      else if (state === 'notFound') this.pageTitle.set('Report not found');
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.analyzeTimer);
  }

  private readonly listKey = computed(() => JSON.stringify(listParameters(this.defs())));

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  // ---- loading

  protected async load(id: string | undefined): Promise<void> {
    this.loadedFor = id;
    this.state.set('loading');
    this.failure.set('');
    this.conflict.set(false);
    this.summary.set([]);
    try {
      this.categories.set(await firstValueFrom(this.api.listReportCategories()));
      if (id === undefined) {
        this.report.set(null);
        this.apply(null);
        this.state.set('ready');
        return;
      }
      if (!/^\d+$/.test(id)) {
        this.state.set('notFound');
        return;
      }
      const report = await firstValueFrom(this.api.getAdminReport(Number(id)));
      if (this.loadedFor !== id) return;
      this.report.set(report);
      this.apply(report);
      this.state.set('ready');
    } catch (e) {
      this.state.set(e instanceof ApiError && e.status === 404 ? 'notFound' : 'error');
    }
  }

  protected retry(): void {
    void this.load(this.id());
  }

  private apply(report: ReportDetailResponse | null): void {
    this.details.set(
      report
        ? {
            name: report.name,
            categoryId: report.categoryId,
            description: report.description ?? '',
            helpText: report.helpText ?? '',
            sortOrder: String(report.sortOrder),
            timeoutSeconds: report.timeoutSeconds == null ? '' : String(report.timeoutSeconds),
            maxRows: report.maxRows == null ? '' : String(report.maxRows),
          }
        : {
            ...EMPTY_DETAILS,
            categoryId: this.categories().find((c) => c.isActive)?.categoryId ?? null,
          },
    );
    this.sql.set(report?.sql ?? STARTER_SQL);
    this.defs.set(Array.isArray(report?.parameters) ? (report!.parameters as ParamDef[]) : []);
    this.unused.set(new Set());
    this.changeNote.set('');
    this.fieldErrors.set({});
    this.parameterErrors.set({});
    this.summary.set([]);
    this.keepActive.set(true);
    this.baseline = this.key();
    this.baselineVersion.update((n) => n + 1);
    this.scheduleAnalyze(0);
  }

  // ---- editing

  protected patchDetails(change: Partial<Details>): void {
    this.details.update((d) => ({ ...d, ...change }));
    this.fieldErrors.set({});
  }

  protected setDefs(defs: ParamDef[]): void {
    this.defs.set(defs);
    this.parameterErrors.set({});
  }

  protected selectTab(key: string): void {
    const to = editorTabOf(key, this.isNew(), this.canAssign());
    if (to === this.current()) return;
    void this.router.navigate([], {
      queryParams: { tab: to === 'details' ? null : to },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---- analysis

  private scheduleAnalyze(delay = ANALYZE_DELAY_MS): void {
    clearTimeout(this.analyzeTimer);
    this.analyzing.set(true);
    this.analyzeTimer = setTimeout(() => void this.analyze(), delay);
  }

  /** Reads the query now (nothing is executed) and brings the parameter list in step. */
  protected async analyze(): Promise<void> {
    clearTimeout(this.analyzeTimer);
    const id = ++this.analyzeId;
    this.analyzing.set(true);
    try {
      const result = await firstValueFrom(
        this.admin.analyzeReportSql({ sql: this.sql(), lists: listParameters(this.defs()) }),
      );
      if (id !== this.analyzeId) return;
      this.analysis.set(result);
      const reconciled = reconcile(this.defs(), result.placeholders, result.dateRangeCandidates);
      if (reconciled.added.length > 0) {
        this.defs.set(reconciled.defs);
        this.announcement.set(`Parameter ${reconciled.added.join(', ')} added.`);
      }
      this.unused.set(reconciled.unused);
    } catch {
      if (id === this.analyzeId) this.analysis.set(null);
    } finally {
      if (id === this.analyzeId) this.analyzing.set(false);
    }
  }

  protected goToProblem(line: number, column: number): void {
    if (this.current() !== 'query') this.selectTab('query');
    afterNextRender(() => this.editor()?.goTo(line, column), { injector: this.injector });
  }

  protected insert(text: string): void {
    this.editor()?.insertAtCursor(text);
    if (this.schemaOpen() && window.matchMedia('(max-width: 639.98px)').matches) this.closeSchema();
  }

  protected openSchema(): void {
    this.schemaOpen.set(true);
  }

  protected closeSchema(): void {
    this.schemaOpen.set(false);
    afterNextRender(() => document.getElementById('schema-toggle')?.focus(), {
      injector: this.injector,
    });
  }

  // ---- saving

  /** Everything that stops a save, in the words the author reads; empty when it can be saved. */
  protected problems(): string[] {
    const list: string[] = [];
    const d = this.details();
    if (!d.name.trim()) list.push('Enter a name for the report.');
    if (d.categoryId === null) list.push('Choose a category.');
    if (!this.sql().trim()) list.push('Enter a query.');
    for (const p of this.sqlProblems())
      list.push(`Query, line ${p.line}, column ${p.column}: ${p.message}`);
    for (const name of this.missingDefinitions())
      list.push(`Parameter ${name} has no definition yet. Open Parameters.`);
    list.push(...definitionProblems(this.defs(), this.unused()));
    return list;
  }

  protected async save(): Promise<boolean> {
    if (this.busy()) return false;
    if (this.analyzing()) await this.analyze();
    const problems = this.problems();
    this.failure.set('');
    this.conflict.set(false);
    if (problems.length > 0) {
      this.summary.set(problems);
      this.announcement.set(
        `Not saved. ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} to fix.`,
      );
      afterNextRender(() => document.getElementById('editor-summary')?.focus(), {
        injector: this.injector,
      });
      return false;
    }
    this.summary.set([]);
    const d = this.details();
    const body = {
      name: d.name.trim(),
      categoryId: d.categoryId!,
      description: d.description.trim() || undefined,
      helpText: d.helpText.trim() || undefined,
      sortOrder: intOrNull(d.sortOrder) ?? 0,
      timeoutSeconds: intOrNull(d.timeoutSeconds) ?? undefined,
      maxRows: intOrNull(d.maxRows) ?? undefined,
      sql: this.sql(),
      parameters: toRequestParameters(this.defs(), this.unused()),
      changeNote: this.changeNote().trim() || undefined,
    };
    this.busy.set(true);
    try {
      const current = this.report();
      if (!current) {
        const created = await firstValueFrom(this.api.createReport(body));
        this.baseline = this.key();
        this.baselineVersion.update((n) => n + 1);
        this.notify.success('Report created. It is inactive until you preview and activate it.');
        await this.router.navigate(['/admin/reports', created.reportId], { replaceUrl: true });
        return true;
      }
      const result = await firstValueFrom(
        this.api.updateReport(
          current.reportId,
          { ...body, keepActive: current.isActive && this.keepActive(), sampleValues: undefined },
          current.rowVersion,
        ),
      );
      if (result.preview) this.preview.set(result.preview);
      await this.reloadAfterSave();
      this.versionsKey.update((n) => n + 1);
      if (result.deactivated) {
        this.announcement.set(`Saved as version ${result.versionNo}. Preview it to activate.`);
        this.notify.warn(`Saved as version ${result.versionNo}. Preview it to activate.`);
      } else if (result.unchanged) {
        this.announcement.set(
          'Saved. The query and parameters did not change, so no new version was written.',
        );
        this.notify.success('Saved.');
      } else {
        this.announcement.set(`Saved as version ${result.versionNo}.`);
        this.notify.success(`Saved as version ${result.versionNo}.`);
      }
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async reloadAfterSave(): Promise<void> {
    const id = this.report()?.reportId;
    if (id === undefined) return;
    const fresh = await firstValueFrom(this.api.getAdminReport(id));
    this.report.set(fresh);
    this.baseline = this.key();
    this.changeNote.set('');
    this.baselineVersion.update((n) => n + 1);
  }

  private fail(e: unknown): void {
    const errors = serverFormErrors(e);
    if (errors.conflict) {
      this.conflict.set(true);
      return;
    }
    if (errors.code === 'DUPLICATE_NAME') {
      this.fieldErrors.set({ name: 'Another report already has this name.' });
      this.summary.set(['Another report already has this name.']);
      if (this.current() !== 'details') this.selectTab('details');
      return;
    }
    const fields = Object.entries(errors.fields);
    if (fields.length > 0) {
      const byParameter: Record<string, string[]> = {};
      const other: string[] = [];
      const detailFields: Record<string, string> = {};
      for (const [key, message] of fields) {
        const m = /^parameters\.([^.]+)\./.exec(key);
        if (m) (byParameter[m[1]] ??= []).push(message);
        else if (key === 'sql') other.push(`Query: ${message}`);
        else {
          detailFields[key] = message;
          other.push(message);
        }
      }
      this.fieldErrors.set(detailFields);
      this.parameterErrors.set(byParameter);
      this.summary.set([
        ...other,
        ...Object.entries(byParameter).flatMap(([n, ms]) => ms.map((m) => `Parameter ${n}: ${m}`)),
      ]);
      afterNextRender(() => document.getElementById('editor-summary')?.focus(), {
        injector: this.injector,
      });
      return;
    }
    this.failure.set(e instanceof Error && e.message ? e.message : 'Couldn’t save. Try again.');
  }

  protected async reload(): Promise<void> {
    await this.load(this.id());
  }

  // ---- preview, activate, deactivate, restore

  protected async runPreview(samples: Record<string, unknown> = {}): Promise<void> {
    const current = this.report();
    if (!current || this.previewBusy()) return;
    this.previewOpen.set(true);
    if (this.analyzing()) await this.analyze();
    this.previewBusy.set(true);
    this.preview.set(null);
    try {
      const result = await firstValueFrom(
        this.admin.previewReport(current.reportId, {
          sql: this.sql(),
          parameters: toRequestParameters(this.defs(), this.unused()),
          sampleValues: samples,
        }),
      );
      this.preview.set(result);
      if (result.countsForActivation && result.rowVersion) {
        // The preview marked the saved version: take the new row version and the "can activate" fact, or the next save would be a conflict.
        this.report.update((r) =>
          r ? { ...r, rowVersion: result.rowVersion!, canActivate: true } : r,
        );
        this.announcement.set('Preview passed. This version can now be activated.');
      } else if (result.success) {
        this.announcement.set(
          'Preview passed. It does not count for activation because the editor has unsaved changes.',
        );
      } else {
        this.announcement.set(`The preview did not run (${result.status}).`);
      }
    } catch (e) {
      this.preview.set(null);
      this.failure.set(e instanceof ApiError ? e.message : 'The preview could not be run.');
    } finally {
      this.previewBusy.set(false);
    }
  }

  protected showPreview(): void {
    this.previewOpen.set(true);
    afterNextRender(
      () => document.getElementById('pp-title')?.scrollIntoView({ block: 'nearest' }),
      { injector: this.injector },
    );
  }

  protected async activate(): Promise<void> {
    const current = this.report();
    if (!current || this.busy()) return;
    await this.changeState(
      () => firstValueFrom(this.admin.activateReport(current.reportId)),
      `${current.name} is active. Roles it is assigned to can run it.`,
    );
  }

  protected async deactivate(): Promise<void> {
    const current = this.report();
    this.deactivateOpen.set(false);
    if (!current || this.busy()) return;
    await this.changeState(
      () => firstValueFrom(this.admin.deactivateReport(current.reportId)),
      `${current.name} is inactive. It is hidden from people and cannot run.`,
    );
  }

  private async changeState(call: () => Promise<unknown>, message: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      const id = this.report()?.reportId;
      if (id !== undefined) {
        const fresh = await firstValueFrom(this.api.getAdminReport(id));
        this.report.set(fresh);
      }
      this.announcement.set(message);
      this.notify.success(message);
    } catch (e) {
      this.failure.set(e instanceof ApiError ? e.message : 'The state could not be changed.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async restore(versionNo: number): Promise<void> {
    const current = this.report();
    if (!current || this.busy()) return;
    this.busy.set(true);
    this.failure.set('');
    try {
      const result = await firstValueFrom(
        this.api.restoreReportVersion(current.reportId, versionNo, current.rowVersion),
      );
      const fresh = await firstValueFrom(this.api.getAdminReport(current.reportId));
      this.report.set(fresh);
      this.apply(fresh);
      this.preview.set(null);
      this.versionsKey.update((n) => n + 1);
      const text = `Version ${versionNo} restored as version ${result.versionNo}. Preview it to activate.`;
      this.announcement.set(text);
      this.notify.success(text);
    } catch (e) {
      if (serverFormErrors(e).conflict) this.conflict.set(true);
      else
        this.failure.set(e instanceof ApiError ? e.message : 'The version could not be restored.');
    } finally {
      this.busy.set(false);
    }
  }
}
