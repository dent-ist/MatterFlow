import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AssetLinkRoleView,
  AssetLinkRolesClient,
  TaskAssetLinkResponse,
  TaskAssetsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { AssetPicker } from '../../../shared/ui/asset-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { Badge } from '../../../shared/ui/badge';
import { PanelScroll } from '../../../shared/ui/panel-scroll';

export const ASSETS_EMPTY = 'No assets linked.';
export const ASSETS_CLOSED_NOTE =
  "Linked assets can't be changed while the task is Completed or Cancelled. Reopen it to change them.";

/**
 * The Assets section of a Task (UX S10): the linked Assets with their relationship (Source, Destination, Subject, Result, ...), linking through the
 * `AssetPicker` limited to the Task's Matter, changing the relationship and unlinking with a confirmation. Read-only when `readOnly` is set
 * (closed Task) or when the server says the caller cannot change links (missing Asset.Link or Task.Edit).
 *
 * It is the body of the Task page's Assets tab (#347): the tab carries the name and the count, so the only control above the list is Link asset.
 * The list loads with the page whichever tab is showing, so the count is right at once.
 *
 * Inputs: `taskId` and `matterId` (required), `readOnly`, `taskStatus` (only used to word the read-only note). Outputs: `countChange` (links
 * shown) and `changed` (a link was added, changed or removed).
 */
@Component({
  selector: 'mf-task-asset-links',
  imports: [Badge, AssetPicker, ConfirmDialog, Dropdown, PanelScroll, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tl" aria-label="Assets">
      <h2 class="mf-sr-only" tabindex="-1" data-section-heading>Assets</h2>
      @if (canSee() && editable() && !linking()) {
        <div class="tl__bar">
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-link-open
            aria-label="Link Asset"
            title="Link Asset"
            (click)="openLinking()"
          >
            <i class="pi pi-link" aria-hidden="true"></i>
            <span class="tl__act">Link Asset</span>
          </button>
        </div>
      }
      <div class="tl__panel" [id]="panelId">
        @if (!canSee()) {
          <p class="tl__note" data-no-access>
            You don't have access to assets, so linked assets aren't shown here.
          </p>
        } @else if (closedNote()) {
          <p class="tl__note" data-closed-note>{{ closedNoteText }}</p>
        }

        @if (editable() && linking()) {
          <form class="tl__form" data-link-form (submit)="link($event)">
            <div class="tl__field">
              <label for="tl-asset">Asset</label>
              <mf-asset-picker
                inputId="tl-asset"
                label="Asset to Link"
                [matterId]="matterId()"
                [(value)]="pickedAssetId"
              />
            </div>
            <div class="tl__field">
              <label for="tl-role">Relationship</label>
              <mf-dropdown
                field
                buttonId="tl-role"
                label="Relationship"
                data-link-role
                [items]="roleItems()"
                [value]="pickedRoleId() === null ? '' : '' + pickedRoleId()"
                (valueChange)="pickRole($event)"
              />
            </div>
            <div class="tl__buttons">
              <button
                type="submit"
                class="mf-btn mf-btn--primary"
                data-link-submit
                [disabled]="busy() || pickedAssetId() === null"
              >
                Link Asset
              </button>
              <button type="button" class="mf-btn" data-link-cancel (click)="closeLinking()">
                Cancel
              </button>
            </div>
            @if (formError()) {
              <p class="tl__alert" role="alert" data-link-error>{{ formError() }}</p>
            }
          </form>
        }

        @if (canSee()) {
          @switch (state()) {
            @case ('loading') {
              <p class="tl__muted" role="status" aria-busy="true">Loading assets</p>
            }
            @case ('error') {
              <p class="tl__alert" role="alert" data-load-error>
                Couldn't load assets.
                <button type="button" class="mf-btn mf-btn--text" (click)="reload()">Retry</button>
              </p>
            }
            @default {
              @if (items().length === 0) {
                <p class="tl__muted" data-empty>{{ emptyText }}</p>
              } @else {
                <div mfPanelScroll="Linked assets" class="tl__scroll" data-assets-scroll>
                  <ul class="tl__list" aria-label="Linked assets">
                    @for (a of items(); track a.assetId) {
                      <li class="tl__item" [attr.data-asset-id]="a.assetId">
                        <div class="tl__name">
                          <!-- The panel is shown only with Asset.View, so the link always opens (decision V). -->
                          <a class="tl__open" [routerLink]="['/assets', a.assetId]" data-asset-link
                            ><strong>{{ a.displayName }}</strong></a
                          >
                          @if (!a.isActive) {
                            <mf-badge>Inactive</mf-badge>
                          }
                        </div>
                        @if (a.assetTypeName) {
                          <p class="tl__meta" data-type>
                            {{ a.assetTypeName }}
                            @if (a.assetNumber) {
                              -
                              <span class="tl__number" data-asset-number>{{ a.assetNumber }}</span>
                            }
                          </p>
                        }
                        @if (a.externalReference) {
                          <p class="tl__meta tl__ref" data-ref>
                            @if (isUrl(a.externalReference)) {
                              <a
                                [href]="a.externalReference"
                                target="_blank"
                                rel="noopener noreferrer"
                                >{{ a.externalReference }}</a
                              >
                            } @else {
                              {{ a.externalReference }}
                            }
                          </p>
                        }
                        <div class="tl__row">
                          @if (editable()) {
                            <mf-dropdown
                              field
                              size="sm"
                              data-role-select
                              [label]="'Relationship of ' + a.displayName"
                              [disabled]="busy()"
                              [items]="rowRoleItems().get(a.assetId) ?? []"
                              [value]="roleValue(a)"
                              (valueChange)="changeRole(a, $event)"
                            />
                            <button
                              type="button"
                              class="mf-btn"
                              data-unlink
                              [attr.aria-label]="'Remove link to ' + a.displayName"
                              [disabled]="busy()"
                              (click)="askUnlink(a)"
                            >
                              Remove Link
                            </button>
                          } @else {
                            <span class="tl__meta"
                              >Relationship:
                              <span data-role>{{ a.assetLinkRoleName ?? 'None' }}</span></span
                            >
                          }
                        </div>
                      </li>
                    }
                  </ul>
                </div>
              }
              @if (rowError()) {
                <p class="tl__alert" role="alert" data-row-error>{{ rowError() }}</p>
              }
            }
          }
        }
      </div>

      <mf-confirm-dialog
        title="Remove Link"
        confirmLabel="Remove Link"
        [danger]="true"
        [busy]="busy()"
        [(visible)]="unlinkOpen"
        (confirmed)="confirmUnlink()"
      >
        <p data-unlink-body>
          The link to {{ unlinking?.displayName }} is removed, but the asset itself is not deleted.
        </p>
      </mf-confirm-dialog>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .tl {
      display: grid;
      gap: var(--mf-s3);
    }
    .tl__bar {
      display: flex;
      justify-content: flex-end;
    }
    .tl__panel {
      display: grid;
      gap: var(--mf-s3);
    }
    .tl__list {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tl__scroll {
      margin: 0 calc(var(--mf-s1) * -1);
      padding: var(--mf-s1);
    }
    .tl__item {
      display: grid;
      gap: var(--mf-s1);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      overflow-wrap: anywhere;
    }
    .tl__name {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .tl__number {
      font-family: var(--mf-font-mono);
    }
    .tl__meta {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .tl__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin-top: var(--mf-s1);
    }
    .tl__row select {
      flex: 1 1 8rem;
      min-width: 0;
    }
    .tl__form {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--mf-s3);
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .tl__field {
      display: grid;
      gap: var(--mf-s1);
      min-width: 14rem;
      flex: 1 1 14rem;
    }
    .tl__field label {
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .tl__buttons {
      display: flex;
      gap: var(--mf-s2);
    }
    .tl__muted,
    .tl__note {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .tl__alert {
      margin: 0;
      color: var(--mf-danger-text, var(--mf-danger));
    }
    .tl__open {
      color: var(--mf-link);
      text-underline-offset: 2px;
    }
  `,
})
export class TaskAssetLinks {
  readonly taskId = input.required<number>();
  /** The Task's Matter: the picker offers only its Assets. */
  readonly matterId = input.required<number>();
  /** True for a closed Task (or when the host wants no changes). */
  readonly readOnly = input(false);
  /** Task status code (`COMPLETED`, ...); only used to word the read-only note. */
  readonly taskStatus = input<string | null>(null);

  readonly countChange = output<number>();
  readonly changed = output<void>();

  protected readonly emptyText = ASSETS_EMPTY;
  protected readonly closedNoteText = ASSETS_CLOSED_NOTE;

  private readonly api = inject(TaskAssetsClient);
  private readonly rolesApi = inject(AssetLinkRolesClient);
  private readonly notify = inject(NotificationService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly items = signal<TaskAssetLinkResponse[]>([]);
  private readonly serverCanEdit = signal(false);
  private readonly roles = signal<AssetLinkRoleView[]>([]);
  protected readonly activeRoles = computed(() => this.roles().filter((r) => r.isActive));
  protected readonly roleItems = computed<DropdownItem[]>(() => [
    { value: '', label: 'None' },
    ...this.activeRoles().map((r) => ({ value: String(r.id), label: r.name })),
  ]);
  /** The role dropdown items of each linked asset: the active roles plus the link's own role when it has since been deactivated. */
  protected readonly rowRoleItems = computed(
    () =>
      new Map(
        this.items().map((a) => [
          a.assetId,
          [
            { value: '', label: 'None' },
            ...this.rolesFor(a).map((r) => ({ value: String(r.id), label: r.name })),
          ] as DropdownItem[],
        ]),
      ),
  );
  private readonly chosenRole = signal<Record<number, string>>({});

  private readonly auth = inject(AuthStore);
  /** Linked assets are Asset.View data; without it a note replaces the list (the API would only return placeholder names). */
  protected readonly canSee = computed(() => this.auth.has('Asset.View'));
  protected readonly editable = computed(() => !this.readOnly() && this.serverCanEdit());
  protected readonly closedNote = computed(() => {
    const status = this.taskStatus();
    return this.readOnly() && (status === 'COMPLETED' || status === 'CANCELLED');
  });

  protected readonly panelId = 'tl-panel';
  protected readonly linking = signal(false);
  protected readonly pickedAssetId = signal<number | null>(null);
  protected readonly pickedRoleId = signal<number | null>(null);
  protected readonly formError = signal('');
  protected readonly rowError = signal('');
  protected readonly busy = signal(false);

  protected readonly unlinkOpen = signal(false);
  protected unlinking: TaskAssetLinkResponse | null = null;

  constructor() {
    effect(() => {
      this.taskId();
      const canSee = this.canSee();
      untracked(() => {
        this.state.set('loading');
        this.closeLinking();
        if (canSee) void this.load();
      });
    });
    effect(() => {
      if (this.canSee()) untracked(() => void this.loadRoles());
    });
  }

  protected reload(): void {
    this.state.set('loading');
    void this.load();
  }

  protected isUrl(value: string | undefined | null): boolean {
    return !!value && /^https?:\/\//i.test(value);
  }

  /** The active roles plus the link's current role if it has since been deactivated. */
  protected rolesFor(link: TaskAssetLinkResponse): AssetLinkRoleView[] {
    const current = this.roles().find((r) => r.id === link.assetLinkRoleId);
    return current && !current.isActive ? [...this.activeRoles(), current] : this.activeRoles();
  }

  /** Link asset: show the link form and put the cursor in the asset picker. */
  protected openLinking(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#tl-asset')?.focus(),
      { injector: this.injector },
    );
    this.pickedAssetId.set(null);
    this.pickedRoleId.set(null);
    this.formError.set('');
    this.linking.set(true);
  }

  protected closeLinking(): void {
    this.linking.set(false);
    this.formError.set('');
  }

  protected pickRole(value: string): void {
    this.pickedRoleId.set(value === '' ? null : Number(value));
  }

  protected async link(event: Event): Promise<void> {
    event.preventDefault();
    const assetId = this.pickedAssetId();
    if (assetId === null || this.busy()) return;
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(
        this.api.linkTaskAsset(this.taskId(), {
          assetId,
          assetLinkRoleId: this.pickedRoleId() ?? undefined,
        }),
      );
      this.linking.set(false);
      this.notify.success('Asset linked');
      await this.load();
      this.changed.emit();
    } catch (error) {
      this.formError.set(messageOf(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** The role a row shows: the one just chosen while it is being saved, else the saved one. */
  protected roleValue(link: TaskAssetLinkResponse): string {
    return (
      this.chosenRole()[link.assetId] ??
      (link.assetLinkRoleId === undefined || link.assetLinkRoleId === null
        ? ''
        : String(link.assetLinkRoleId))
    );
  }

  protected async changeRole(link: TaskAssetLinkResponse, value: string): Promise<void> {
    const roleId = value === '' ? undefined : Number(value);
    this.chosenRole.update((m) => ({ ...m, [link.assetId]: value }));
    this.busy.set(true);
    this.rowError.set('');
    try {
      await firstValueFrom(
        this.api.changeTaskAssetRole(this.taskId(), link.assetId, {
          assetLinkRoleId: roleId,
          rowVersion: link.rowVersion,
        }),
      );
      await this.load();
      this.changed.emit();
    } catch (error) {
      this.rowError.set(messageOf(error));
      await this.load();
    } finally {
      this.chosenRole.update((m) => {
        const rest = { ...m };
        delete rest[link.assetId];
        return rest;
      });
      this.busy.set(false);
    }
  }

  protected askUnlink(link: TaskAssetLinkResponse): void {
    this.unlinking = link;
    this.unlinkOpen.set(true);
  }

  protected async confirmUnlink(): Promise<void> {
    const link = this.unlinking;
    if (!link || this.busy()) return;
    this.busy.set(true);
    this.rowError.set('');
    try {
      await firstValueFrom(this.api.unlinkTaskAsset(this.taskId(), link.assetId));
      this.unlinkOpen.set(false);
      this.unlinking = null;
      this.notify.success('Link removed');
      await this.load();
      this.changed.emit();
    } catch (error) {
      this.unlinkOpen.set(false);
      this.rowError.set(messageOf(error));
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    const taskId = this.taskId();
    try {
      const list = await firstValueFrom(this.api.listTaskAssets(taskId));
      if (taskId !== this.taskId()) return;
      this.items.set(list.items);
      this.serverCanEdit.set(list.canEdit);
      this.state.set('ready');
      this.countChange.emit(list.items.length);
    } catch {
      if (taskId === this.taskId()) this.state.set('error');
    }
  }

  private async loadRoles(): Promise<void> {
    try {
      this.roles.set(await firstValueFrom(this.rolesApi.listAssetLinkRoles()));
    } catch {
      this.roles.set([]);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof ApiError && error.message
    ? error.message
    : "Couldn't update the asset links. Try again.";
}
