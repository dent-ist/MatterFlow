import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
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
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import {
  DefinitionDiff,
  DesignerDefinition,
  DesignerIssue,
  FormDesigner,
  diagnoseDefinition,
  diffDefinitions,
  fieldName,
  hasErrors,
} from 'form-engine';
import { firstValueFrom } from 'rxjs';

import { ApiError } from '../../../core/http/api-error';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { FormDesignerApi, FormOwner, FormVersion, FormVersionSummary } from './form-designer-api';
import { publishIssuesOf } from './form-mapping';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { QuietRequests } from '../../../core/http/interceptors';
import { PageTitle } from '../../../core/title/page-title';
import {
  RecordKind,
  RecordLoadFlow,
  RecordState,
  recordStateTitle,
} from '../../../shared/ui/record-state';
import { Crumb, PageHeader } from '../../../shared/ui/page-header';

type DialogKind = 'publish' | 'retire' | 'discard' | 'conflict' | null;

/**
 * Admin: Task Type > Form (UX S14). Hosts `<mf-form-designer>` against `FormDesignerApi` and owns
 * the version lifecycle: save draft, publish (with diff), retire, and "Create new draft" from a
 * published version. Published and retired versions open read-only.
 */
@Component({
  selector: 'mf-task-type-form-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeader,
    ErrorReference,
    RecordState,
    FormDesigner,
    Button,
    Dialog,
    DialogFocus,
    FormsModule,
    MfDatePipe,
  ],
  templateUrl: './task-type-form-page.html',
  styleUrl: './task-type-form-page.scss',
})
export class TaskTypeFormPage implements HasUnsavedChanges {
  /** Route parameter `ownerId`; the unparameterised route shows the seeded Data Processing type. */
  readonly ownerId = input('data-processing');
  /** Page title and owner label; other owners (Step Library, Asset Types) reuse this page with their own wording through route `data`. */
  readonly heading = input('Task Types');
  /** Where the breadcrumb's first segment leads. */
  readonly sectionPath = input('/admin/task-types');
  readonly ownerLabel = input('Task Type');
  /** Breadcrumb segments before the section (`Administration > Workflows` for a Step); empty for the other owners. */
  /** The router sets an input to `undefined` when the route's `data` has no such key, so a missing value means "none". */
  readonly parentCrumbs = input<readonly Crumb[], readonly Crumb[] | undefined>([], {
    transform: (v) => v ?? [],
  });
  /** `Task Types > Access Request > Form`: every segment is a link where the owner has a page of its own. */
  protected readonly formCrumbs = computed<Crumb[]>(() => {
    const o = this.owner();
    if (!o) return [];
    const hasPage = ['Task Type', 'Step'].includes(this.ownerLabel());
    return [
      ...this.parentCrumbs(),
      { label: this.heading(), link: this.sectionPath() },
      { label: o.name, link: hasPage ? [this.sectionPath(), this.ownerId()] : undefined },
      { label: 'Form' },
    ];
  });
  /** What the form's records are called in copy: tasks for Task Types, assets for Asset Types, records for custom fields. */
  protected readonly recordNoun = computed(() => {
    switch (this.ownerLabel()) {
      case 'Task Type':
        return 'tasks';
      case 'Asset Type':
        return 'assets';
      case 'Step':
        return 'step runs';
      default:
        return 'records';
    }
  });

  private readonly api = inject(FormDesignerApi);

  private readonly quiet = inject(QuietRequests);
  private readonly pageTitle = inject(PageTitle);
  /** The record kind whose 404, 403 and failure states the owner gets (#353); Asset Types and Custom Fields keep the plain failure block. */
  protected readonly recordKind = computed<RecordKind | null>(() => {
    switch (this.ownerLabel()) {
      case 'Task Type':
        return 'taskType';
      case 'Step':
        return 'step';
      default:
        return null;
    }
  });
  protected readonly flow = new RecordLoadFlow(() => this.recordKind() ?? 'taskType');
  protected readonly state = this.flow.state;
  protected readonly owner = signal<FormOwner | null>(null);
  protected readonly versions = signal<FormVersionSummary[]>([]);
  protected readonly current = signal<FormVersion | null>(null);
  protected readonly working = signal<DesignerDefinition>({ fields: [] });
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly failure = signal('');
  protected readonly dialog = signal<DialogKind>(null);
  protected readonly publishNote = signal('');
  protected readonly diff = signal<DefinitionDiff | null>(null);
  protected readonly publishedDefinition = signal<DesignerDefinition | undefined>(undefined);
  /** Problems the server reported when publishing; shown inline in the designer until the next edit. */
  protected readonly serverIssues = signal<readonly DesignerIssue[]>([]);
  private pendingVersionId: string | null = null;
  private invoker: HTMLElement | null = null;

  protected readonly readOnly = computed(() => this.current()?.status !== 'DRAFT');
  protected readonly hasDraft = computed(() => this.versions().some((v) => v.status === 'DRAFT'));
  protected readonly published = computed(() =>
    this.versions().find((v) => v.status === 'PUBLISHED'),
  );
  protected readonly issues = computed(() => diagnoseDefinition(this.working().fields));
  protected readonly errorCount = computed(
    () => this.issues().filter((i) => i.severity === 'error').length,
  );
  protected readonly dirty = computed(() => {
    const c = this.current();
    return !!c && JSON.stringify(c.definition) !== JSON.stringify(this.working());
  });
  protected readonly canPublish = computed(
    () => !this.readOnly() && !this.busy() && !hasErrors(this.issues()),
  );
  protected readonly dialogOpen = computed(() => this.dialog() !== null);

  constructor() {
    effect(() => {
      const kind = this.recordKind();
      const state = this.state();
      if (kind && this.flow.failed()) this.pageTitle.set(recordStateTitle(kind, state));
    });
    effect(() => {
      const id = this.ownerId();
      untracked(() => void this.load(id));
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  protected title(v: FormVersion | null): string {
    if (!v) return '';
    const status =
      v.status === 'DRAFT' ? 'Draft' : v.status === 'PUBLISHED' ? 'Published' : 'Retired';
    return `${status} v${v.versionNo}`;
  }

  /** Display name for a field key in the publish diff (current draft first, then the published form). */
  protected label(key: string): string {
    const f =
      this.working().fields.find((x) => x.key === key) ??
      this.publishedDefinition()?.fields.find((x) => x.key === key);
    return f ? fieldName(f) : key;
  }

  protected labels(keys: readonly string[]): string {
    return keys.map((k) => this.label(k)).join(', ');
  }

  // ---------------------------------------------------------------- loading

  protected async load(ownerId: string, versionId?: string): Promise<void> {
    this.failure.set('');
    await this.flow.run(
      async () => {
        const [owner, versions] = await Promise.all([
          firstValueFrom(this.api.getOwner(ownerId)),
          firstValueFrom(this.api.listVersions(ownerId)),
        ]);
        const pick =
          versions.find((v) => v.id === versionId) ??
          versions.find((v) => v.status === 'DRAFT') ??
          versions.find((v) => v.status === 'PUBLISHED') ??
          versions[0];
        // The second request starts after an answer, so it is marked quiet on its own.
        const current = pick
          ? await this.quiet.runInline(() => firstValueFrom(this.api.getVersion(ownerId, pick.id)))
          : null;
        return { owner, versions, current };
      },
      ({ owner, versions, current }) => {
        this.owner.set(owner);
        this.versions.set(versions);
        if (current) this.setCurrent(current);
        else {
          this.current.set(null);
          this.working.set({ fields: [] });
        }
      },
    );
    if (this.flow.failed() && !this.recordKind())
      this.failure.set('Something went wrong. Try again.');
  }

  protected retry(): void {
    void this.load(this.ownerId());
  }

  private setCurrent(v: FormVersion): void {
    this.current.set(v);
    this.working.set(structuredClone(v.definition));
    this.serverIssues.set([]);
  }

  private messageOf(e: unknown): string {
    return e instanceof Error ? e.message : 'Something went wrong. Try again.';
  }

  private isConflict(e: unknown): boolean {
    return e instanceof ApiError && e.code === 'CONCURRENCY_CONFLICT';
  }

  private async refreshVersions(): Promise<void> {
    this.versions.set(await firstValueFrom(this.api.listVersions(this.ownerId())));
  }

  // ---------------------------------------------------------------- actions

  protected onChange(definition: DesignerDefinition): void {
    this.working.set(definition);
    this.notice.set('');
    this.serverIssues.set([]);
  }

  protected async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await action();
      return true;
    } catch (e) {
      const issues = publishIssuesOf(e);
      if (issues) {
        this.serverIssues.set(issues);
        this.failure.set(
          `The server found ${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} in this form. Fix them under Validation, then publish again.`,
        );
      } else if (this.isConflict(e)) {
        this.failure.set('');
        this.show('conflict');
      } else {
        this.failure.set(this.messageOf(e));
      }
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveDraft(): Promise<void> {
    const v = this.current();
    if (!v || this.readOnly()) return;
    const ok = await this.run(async () => {
      this.setCurrent(
        await firstValueFrom(
          this.api.saveDraft(this.ownerId(), v.id, this.working(), v.rowVersion),
        ),
      );
      await this.refreshVersions();
    });
    if (ok) this.notice.set(`Draft v${v.versionNo} saved.`);
  }

  protected async createDraft(): Promise<void> {
    const ok = await this.run(async () => {
      const draft = await firstValueFrom(this.api.createDraft(this.ownerId()));
      await this.refreshVersions();
      this.setCurrent(draft);
    });
    if (ok) {
      this.notice.set(
        this.published()
          ? `Draft v${this.current()?.versionNo} created from the published version.`
          : `Draft v${this.current()?.versionNo} created.`,
      );
    }
  }

  protected open(versionId: string, invoker?: HTMLElement): void {
    if (versionId === this.current()?.id) return;
    if (this.dirty()) {
      this.pendingVersionId = versionId;
      this.show('discard', invoker);
      return;
    }
    void this.switchTo(versionId);
  }

  private async switchTo(versionId: string): Promise<void> {
    await this.run(async () => {
      this.setCurrent(await firstValueFrom(this.api.getVersion(this.ownerId(), versionId)));
    });
    this.notice.set('');
  }

  // ---------------------------------------------------------------- dialogs

  private show(kind: Exclude<DialogKind, null>, invoker?: HTMLElement): void {
    this.invoker = invoker ?? (document.activeElement as HTMLElement | null);
    this.dialog.set(kind);
  }

  protected async openPublish(invoker?: HTMLElement): Promise<void> {
    const pub = this.published();
    this.diff.set(null);
    if (pub) {
      const v = await firstValueFrom(this.api.getVersion(this.ownerId(), pub.id));
      this.diff.set(diffDefinitions(v.definition.fields, this.working().fields));
      this.publishedDefinition.set(v.definition);
    } else {
      this.publishedDefinition.set(undefined);
      this.diff.set(diffDefinitions([], this.working().fields));
    }
    this.publishNote.set('');
    this.show('publish', invoker);
  }

  protected openRetire(invoker?: HTMLElement): void {
    this.show('retire', invoker);
  }

  protected closeDialog(): void {
    this.dialog.set(null);
    this.pendingVersionId = null;
    const el = this.invoker;
    this.invoker = null;
    queueMicrotask(() => el?.focus());
  }

  protected async confirmPublish(): Promise<void> {
    const v = this.current();
    if (!v) return;
    const ok = await this.run(async () => {
      let saved = v;
      if (this.dirty()) {
        saved = await firstValueFrom(
          this.api.saveDraft(this.ownerId(), v.id, this.working(), v.rowVersion),
        );
        this.setCurrent(saved);
      }
      this.setCurrent(
        await firstValueFrom(
          this.api.publish(this.ownerId(), saved.id, this.publishNote(), saved.rowVersion),
        ),
      );
      await this.refreshVersions();
    });
    // A conflict opens its own dialog; every other outcome closes the publish dialog.
    if (this.dialog() === 'publish') this.dialog.set(null);
    if (ok) this.notice.set(`Version ${this.current()?.versionNo} published.`);
    else if (this.dialog() === null) this.restoreFocus();
  }

  /** Conflict dialog: take the other admin's saved draft (dropping mine) or keep my edits on top of it. */
  protected async resolveConflict(keepMine: boolean): Promise<void> {
    const mine = this.working();
    this.dialog.set(null);
    await this.run(async () => {
      const latest = await firstValueFrom(this.api.getVersion(this.ownerId(), this.current()!.id));
      this.setCurrent(latest);
      if (keepMine) this.working.set(mine);
      await this.refreshVersions();
    });
    this.notice.set(
      keepMine
        ? 'Reloaded the latest draft. Your edits are kept; save to overwrite the other changes.'
        : 'Reloaded the latest draft.',
    );
    this.restoreFocus();
  }

  protected async confirmRetire(): Promise<void> {
    const v = this.current();
    if (!v) return;
    const ok = await this.run(async () => {
      this.setCurrent(await firstValueFrom(this.api.retire(this.ownerId(), v.id)));
      await this.refreshVersions();
    });
    this.dialog.set(null);
    if (ok)
      this.notice.set(`Version ${v.versionNo} is retired. New ${this.recordNoun()} can't use it.`);
    this.restoreFocus();
  }

  protected async confirmDiscard(): Promise<void> {
    const id = this.pendingVersionId;
    this.dialog.set(null);
    this.pendingVersionId = null;
    if (id) await this.switchTo(id);
    this.restoreFocus();
  }

  private restoreFocus(): void {
    const el = this.invoker;
    this.invoker = null;
    queueMicrotask(() => el?.focus());
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible && this.dialog() !== null) this.closeDialog();
  }
}
