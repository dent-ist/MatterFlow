import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { AssetLinkRoleView, AssetLinkRolesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Admin: Asset link roles, i.e. the roles an Asset can have on a Task (Source, Destination, Subject, Result, ...). Add, rename,
 * deactivate, reorder (drag or arrows) and delete when unused. Needs `AssetType.Manage`.
 */
@Component({
  selector: 'mf-asset-link-roles-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Button, HasPermissionDirective],
  templateUrl: './asset-link-roles-page.html',
  styleUrl: '../admin-lookup.scss',
})
export class AssetLinkRolesPage implements OnInit {
  private readonly api = inject(AssetLinkRolesClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly canManage = computed(() => this.auth.has('AssetType.Manage'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<AssetLinkRoleView[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly announcement = signal('');

  protected readonly editingId = signal<number | null>(null);
  protected readonly draftName = signal('');
  protected readonly editError = signal('');
  protected readonly confirmDeleteId = signal<number | null>(null);
  protected readonly newName = signal('');
  protected readonly addError = signal('');
  private dragIndex: number | null = null;

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.rows.set(await firstValueFrom(this.api.listAssetLinkRoles()));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
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
        this.failure.set(
          'Someone else changed the asset link roles. The list was reloaded; try again.',
        );
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

  private message(e: ApiError, field: string): string {
    return e.problem?.errors?.[field]?.[0]?.message ?? e.message;
  }

  protected async add(): Promise<void> {
    const name = this.newName().trim();
    this.addError.set('');
    if (!name) {
      this.addError.set('Enter a name.');
      return;
    }
    const created = await this.run(
      () => firstValueFrom(this.api.createAssetLinkRole({ name, isActive: true })),
      (e) => this.addError.set(this.message(e, 'name')),
    );
    if (created) {
      this.rows.set([...this.rows(), created]);
      this.newName.set('');
      this.announcement.set(`Asset link role ${created.name} added.`);
      this.notify.success('Saved.');
    }
  }

  protected startRename(r: AssetLinkRoleView): void {
    this.editingId.set(r.id);
    this.draftName.set(r.name);
    this.editError.set('');
  }

  protected cancelRename(): void {
    this.editingId.set(null);
    this.editError.set('');
  }

  protected async commitRename(r: AssetLinkRoleView): Promise<void> {
    const name = this.draftName().trim();
    if (!name) {
      this.editError.set('Enter a name.');
      return;
    }
    if (name === r.name) {
      this.cancelRename();
      return;
    }
    if (await this.save(r, { name }, (e) => this.editError.set(this.message(e, 'name'))))
      this.cancelRename();
  }

  protected async toggleActive(r: AssetLinkRoleView, active: boolean): Promise<void> {
    if (await this.save(r, { isActive: active })) {
      this.announcement.set(`${r.name} ${active ? 'activated' : 'deactivated'}.`);
    } else {
      this.rows.set([...this.rows()]);
    }
  }

  private async save(
    r: AssetLinkRoleView,
    patch: Partial<Pick<AssetLinkRoleView, 'name' | 'isActive'>>,
    fail?: (e: ApiError) => void,
  ): Promise<boolean> {
    const updated = await this.run(
      () =>
        firstValueFrom(
          this.api.updateAssetLinkRole(r.id, {
            name: patch.name ?? r.name,
            isActive: patch.isActive ?? r.isActive,
            rowVersion: r.rowVersion,
          }),
        ),
      fail,
    );
    if (!updated) return false;
    this.rows.set(this.rows().map((x) => (x.id === updated.id ? updated : x)));
    this.notify.success('Saved.');
    return true;
  }

  protected askDelete(r: AssetLinkRoleView): void {
    this.confirmDeleteId.set(r.id);
  }

  protected cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  protected async confirmDelete(r: AssetLinkRoleView): Promise<void> {
    const done = await this.run(
      async () => {
        await firstValueFrom(this.api.deleteAssetLinkRole(r.id));
        return true;
      },
      (e) =>
        this.failure.set(
          e.code === 'IN_USE'
            ? `Links use ${r.name}, so it can't be deleted. Deactivate it instead.`
            : e.message,
        ),
    );
    this.confirmDeleteId.set(null);
    if (done) {
      this.rows.set(this.rows().filter((x) => x.id !== r.id));
      this.announcement.set(`${r.name} deleted.`);
    }
  }

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
    this.rows.set(next);
    const list = await this.run(() =>
      firstValueFrom(this.api.reorderAssetLinkRoles({ ids: next.map((r) => r.id) })),
    );
    if (list) {
      this.rows.set(list);
      this.announcement.set(`${moved.name} moved to position ${to + 1} of ${list.length}.`);
    } else {
      this.rows.set(before);
    }
  }
}
