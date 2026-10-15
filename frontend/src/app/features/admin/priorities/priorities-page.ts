import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { PrioritiesClient, PriorityView } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { hasReadableText, isHexColor } from '../../../shared/ui/color-contrast';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ListState } from '../../../shared/ui/data-table';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

/** Moves focus to an invalid field after a failed submit (the message is announced by its role=alert). */
function focusById(id: string): void {
  queueMicrotask(() => document.getElementById(id)?.focus());
}

/** Color choices offered in the picker; `custom` reveals the color input. */
export const PRIORITY_COLOR_TOKENS = [
  { value: 'critical', label: 'Critical red' },
  { value: 'high', label: 'High amber' },
  { value: 'normal', label: 'Normal gray' },
  { value: 'low', label: 'Low gray' },
  { value: 'neutral', label: 'Neutral' },
] as const;

export const CONTRAST_MESSAGE = 'Text must be readable: 4.5:1 minimum';

/**
 * Admin: Priorities (UX S18). Labels only (users never see numbers); drag a row or use the arrow buttons to order from most to
 * least urgent; exactly one default; existing tasks keep a deactivated priority. Needs `Priority.Manage`.
 */
@Component({
  selector: 'mf-priorities-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FixedPage,
    ScrollArea,
    PageHeader,
    ListState,
    ConfirmDialog,
    FormsModule,
    RouterLink,
    Button,
    HasPermissionDirective,
    PriorityBadge,
  ],
  templateUrl: './priorities-page.html',
  styleUrl: '../admin-lookup.scss',
})
export class PrioritiesPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(PrioritiesClient);
  private readonly lookups = inject(LookupStore);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly canManage = computed(() => this.auth.has('Priority.Manage'));

  protected readonly colorTokens = PRIORITY_COLOR_TOKENS;
  protected readonly contrastMessage = CONTRAST_MESSAGE;

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<PriorityView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  /** Polite live-region text for reorder and save results. */
  protected readonly announcement = signal('');

  protected readonly editingId = signal<number | null>(null);
  protected readonly draftLabel = signal('');
  protected readonly editError = signal('');
  /** The priority the delete dialog is asking about. */
  protected readonly deleting = signal<PriorityView | null>(null);

  protected readonly newLabel = signal('');
  protected readonly newColor = signal('normal');
  protected readonly newCustom = signal('#336699');
  protected readonly addError = signal('');
  private dragIndex: number | null = null;

  protected readonly newColorValue = computed(() =>
    this.newColor() === 'custom' ? this.newCustom() : this.newColor(),
  );
  protected readonly newContrastOk = computed(
    () => this.newColor() !== 'custom' || hasReadableText(this.newCustom()),
  );

  /** An half-typed new label or a rename in progress is unsaved work (UXR-39). */
  hasUnsavedChanges(): boolean {
    return this.newLabel().trim().length > 0 || this.editingId() !== null;
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.apply(await firstValueFrom(this.api.listPriorities()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  // ---- helpers

  protected isCustom(color: string): boolean {
    return isHexColor(color);
  }

  protected selectValue(color: string): string {
    return isHexColor(color) ? 'custom' : color;
  }

  protected hexOf(color: string): string {
    return isHexColor(color) ? color : '#336699';
  }

  protected contrastOk(color: string): boolean {
    return !isHexColor(color) || hasReadableText(color);
  }

  private apply(list: PriorityView[]): void {
    this.rows.set(list);
    this.lookups.setPriorities(list);
  }

  private async run<T>(
    work: () => Promise<T>,
    fail?: (e: ApiError) => void,
  ): Promise<T | undefined> {
    this.busy.set(true);
    this.failure.set('');
    try {
      return await work();
    } catch (e) {
      const error = e instanceof ApiError ? e : null;
      if (error?.code === 'CONCURRENCY_CONFLICT') {
        this.failure.set('Someone else changed the priorities. The list was reloaded; try again.');
        await this.load();
      } else if (fail && error) {
        fail(error);
      } else {
        this.failure.set(error?.message ?? 'Couldn’t save. Try again.');
      }
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private replace(updated: PriorityView): void {
    this.apply(this.rows().map((r) => (r.id === updated.id ? updated : r)));
  }

  // ---- add

  protected async add(): Promise<void> {
    const label = this.newLabel().trim();
    this.addError.set('');
    if (!label) {
      this.addError.set('Enter a label.');
      focusById('new-label');
      return;
    }
    if (!this.newContrastOk()) {
      this.addError.set(CONTRAST_MESSAGE);
      return;
    }
    const created = await this.run(
      () =>
        firstValueFrom(
          this.api.createPriority({ label, color: this.newColorValue(), isActive: true }),
        ),
      (e) => this.addError.set(this.fieldMessage(e, 'label')),
    );
    if (created) {
      this.apply([...this.rows(), created]);
      this.newLabel.set('');
      this.announcement.set(`Priority ${created.label} added.`);
      this.notify.success('Saved.');
    }
  }

  // ---- edit

  protected startRename(p: PriorityView): void {
    this.editingId.set(p.id);
    this.draftLabel.set(p.label);
    this.editError.set('');
  }

  protected cancelRename(): void {
    this.editingId.set(null);
    this.editError.set('');
  }

  protected async commitRename(p: PriorityView): Promise<void> {
    const label = this.draftLabel().trim();
    if (!label) {
      this.editError.set('Enter a label.');
      return;
    }
    if (label === p.label) {
      this.cancelRename();
      return;
    }
    const ok = await this.save(p, { label }, (e) =>
      this.editError.set(this.fieldMessage(e, 'label')),
    );
    if (ok) this.cancelRename();
  }

  protected async setColor(p: PriorityView, value: string): Promise<void> {
    await this.save(p, { color: value === 'custom' ? this.hexOf(p.color) : value });
  }

  protected async setCustomColor(p: PriorityView, hex: string): Promise<void> {
    if (!hasReadableText(hex)) {
      this.failure.set(CONTRAST_MESSAGE);
      return;
    }
    await this.save(p, { color: hex.toUpperCase() });
  }

  protected async toggleActive(p: PriorityView, active: boolean): Promise<void> {
    const ok = await this.save(p, { isActive: active });
    if (ok) {
      this.announcement.set(`${p.label} ${active ? 'activated' : 'deactivated'}.`);
    } else {
      this.rows.set([...this.rows()]); // re-render the checkbox with the server value
    }
  }

  private async save(
    p: PriorityView,
    patch: Partial<Pick<PriorityView, 'label' | 'color' | 'isActive'>>,
    fail?: (e: ApiError) => void,
  ): Promise<boolean> {
    const updated = await this.run(
      () =>
        firstValueFrom(
          this.api.updatePriority(p.id, {
            label: patch.label ?? p.label,
            color: patch.color ?? p.color,
            isActive: patch.isActive ?? p.isActive,
            rowVersion: p.rowVersion,
          }),
        ),
      fail ??
        ((e) => {
          this.failure.set(e.message);
        }),
    );
    if (!updated) return false;
    this.replace(updated);
    this.notify.success('Saved.');
    return true;
  }

  protected async makeDefault(p: PriorityView): Promise<void> {
    const list = await this.run(
      () => firstValueFrom(this.api.setDefaultPriority(p.id)),
      (e) => this.failure.set(e.message),
    );
    if (list) {
      this.apply(list);
      this.announcement.set(`${p.label} is now the default priority.`);
      this.notify.success('Saved.');
    }
  }

  // ---- delete

  protected askDelete(p: PriorityView): void {
    this.deleting.set(p);
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected async confirmDelete(): Promise<void> {
    const p = this.deleting();
    if (!p) return;
    const done = await this.run(
      async () => {
        await firstValueFrom(this.api.deletePriority(p.id));
        return true;
      },
      (e) =>
        this.failure.set(
          e.code === 'IN_USE'
            ? `Tasks use ${p.label}, so it can't be deleted. Deactivate it instead.`
            : e.message,
        ),
    );
    this.deleting.set(null);
    if (done) {
      this.apply(this.rows().filter((r) => r.id !== p.id));
      this.announcement.set(`${p.label} deleted.`);
    }
  }

  // ---- order

  protected canMove(index: number, delta: number): boolean {
    const target = index + delta;
    return target >= 0 && target < this.rows().length;
  }

  protected async move(index: number, delta: number): Promise<void> {
    await this.reorder(index, index + delta);
  }

  protected onDragStart(index: number, event: DragEvent): void {
    this.dragIndex = index;
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(event: DragEvent): void {
    if (this.dragIndex !== null) event.preventDefault();
  }

  protected async onDrop(index: number, event: DragEvent): Promise<void> {
    event.preventDefault();
    const from = this.dragIndex;
    this.dragIndex = null;
    if (from !== null) await this.reorder(from, index);
  }

  private async reorder(from: number, to: number): Promise<void> {
    const before = this.rows();
    if (from === to || to < 0 || to >= before.length || this.busy() || !this.canManage()) return;
    const next = [...before];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.rows.set(next); // optimistic; the server answer (or a reload) replaces it
    const list = await this.run(() =>
      firstValueFrom(this.api.reorderPriorities({ ids: next.map((r) => r.id) })),
    );
    if (list) {
      this.apply(list);
      this.announcement.set(`${moved.label} moved to position ${to + 1} of ${list.length}.`);
    } else {
      this.rows.set(before);
    }
  }

  private fieldMessage(e: ApiError, field: string): string {
    return e.problem?.errors?.[field]?.[0]?.message ?? e.message;
  }
}
