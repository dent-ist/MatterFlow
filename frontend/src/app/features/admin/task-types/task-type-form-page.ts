import { DatePipe } from '@angular/common';
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
import {
  DefinitionDiff,
  DesignerDefinition,
  FormDesigner,
  diagnoseDefinition,
  diffDefinitions,
  fieldName,
  hasErrors,
} from 'form-engine';
import { firstValueFrom } from 'rxjs';

import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { FormDesignerApi, FormOwner, FormVersion, FormVersionSummary } from './form-designer-api';

type DialogKind = 'publish' | 'retire' | 'discard' | null;
type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Task Type > Form (UX S14). Hosts `<mf-form-designer>` against `FormDesignerApi` and owns
 * the version lifecycle: save draft, publish (with diff), retire, and "Create new draft" from a
 * published version. Published and retired versions open read-only.
 */
@Component({
  selector: 'mf-task-type-form-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormDesigner, Button, Dialog, FormsModule, DatePipe],
  templateUrl: './task-type-form-page.html',
  styleUrl: './task-type-form-page.scss',
})
export class TaskTypeFormPage implements HasUnsavedChanges {
  /** Route parameter `ownerId`; the unparameterised route shows the seeded Data Processing type. */
  readonly ownerId = input('data-processing');

  /** Screen title and the owner's kind in the breadcrumb; routes for other owners (Step Library) set them through route data. */
  readonly heading = input('Task Types & Forms');
  readonly ownerLabel = input('Task Type');

  private readonly api = inject(FormDesignerApi);

  protected readonly state = signal<LoadState>('loading');
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
    this.state.set('loading');
    this.failure.set('');
    try {
      const [owner, versions] = await Promise.all([
        firstValueFrom(this.api.getOwner(ownerId)),
        firstValueFrom(this.api.listVersions(ownerId)),
      ]);
      this.owner.set(owner);
      this.versions.set(versions);
      const pick =
        versions.find((v) => v.id === versionId) ??
        versions.find((v) => v.status === 'DRAFT') ??
        versions.find((v) => v.status === 'PUBLISHED') ??
        versions[0];
      if (pick) this.setCurrent(await firstValueFrom(this.api.getVersion(ownerId, pick.id)));
      else {
        this.current.set(null);
        this.working.set({ fields: [] });
      }
      this.state.set('ready');
    } catch (e) {
      this.failure.set(this.messageOf(e));
      this.state.set('error');
    }
  }

  protected retry(): void {
    void this.load(this.ownerId());
  }

  private setCurrent(v: FormVersion): void {
    this.current.set(v);
    this.working.set(structuredClone(v.definition));
  }

  private messageOf(e: unknown): string {
    return e instanceof Error ? e.message : 'Something went wrong. Try again.';
  }

  private async refreshVersions(): Promise<void> {
    this.versions.set(await firstValueFrom(this.api.listVersions(this.ownerId())));
  }

  // ---------------------------------------------------------------- actions

  protected onChange(definition: DesignerDefinition): void {
    this.working.set(definition);
    this.notice.set('');
  }

  protected async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await action();
      return true;
    } catch (e) {
      this.failure.set(this.messageOf(e));
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
        await firstValueFrom(this.api.saveDraft(this.ownerId(), v.id, this.working())),
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
    if (ok)
      this.notice.set(`Draft v${this.current()?.versionNo} created from the published version.`);
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
      let id = v.id;
      if (this.dirty()) {
        id = (await firstValueFrom(this.api.saveDraft(this.ownerId(), v.id, this.working()))).id;
      }
      this.setCurrent(
        await firstValueFrom(this.api.publish(this.ownerId(), id, this.publishNote())),
      );
      await this.refreshVersions();
    });
    this.dialog.set(null);
    if (ok)
      this.notice.set(`Version ${this.current()?.versionNo} is published. It can't be edited.`);
    else this.restoreFocus();
  }

  protected async confirmRetire(): Promise<void> {
    const v = this.current();
    if (!v) return;
    const ok = await this.run(async () => {
      this.setCurrent(await firstValueFrom(this.api.retire(this.ownerId(), v.id)));
      await this.refreshVersions();
    });
    this.dialog.set(null);
    if (ok) this.notice.set(`Version ${v.versionNo} is retired. New tasks can't use it.`);
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
