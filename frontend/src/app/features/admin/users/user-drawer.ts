import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { firstValueFrom } from 'rxjs';
import { availabilityDisplay } from '../../../core/availability/availability';
import { ApiError } from '../../../core/http/api-error';
import {
  IdentityAdminApi,
  PermissionGroupDto,
  PodChoice,
  RoleSummaryDto,
  UserDetailDto,
  UserSummaryDto,
} from '../../../core/identity-admin/identity-admin-api';
import { NotificationService } from '../../../core/notify/notification.service';
import { UndoService } from '../../../core/notify/undo.service';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import { Badge } from '../../../shared/ui/badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { ScrollRegion } from '../../../shared/ui/scroll-region';
import { impactLine } from '../shared/dialog-copy';
import { availabilityShown } from './user-availability';
import { permissionsOfRoles, summarizePermissions } from './user-access';
import { PodsChange, UserPodsCell } from './user-pods-cell';

/**
 * Where the drawer starts: nothing special, with the deactivation question already on screen (the row menu's Deactivate), or with the
 * person activated at once (the row menu's Activate: no question is needed).
 */
export type UserDrawerIntent = 'deactivate' | 'activate' | null;

/** The Task Queue address behind "View their tasks": that person's open tasks (the same statuses the count uses). */
export function openTasksQuery(userId: number): Record<string, string | string[]> {
  return { assignee: String(userId), status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] };
}

/** What the drawer tells the person who cannot change everything. Null when they can change it all. */
export function readOnlyReason(canManage: boolean, canEditPods: boolean): string | null {
  if (canManage) return null;
  return canEditPods
    ? "Read only, except pods: you can change this person's pods but not their roles, profile or status."
    : 'Read only: you can see this person but not change them.';
}

/**
 * The user drawer (#438 to #443, U3): one modal side drawer replaces the inline panel. It is `?user=<id>` in the address (the page owns that,
 * so Back closes it and Back from "View their tasks" reopens it). Header: name (two lines at most), status, availability where it informs,
 * last seen, open tasks and the Deactivate / Activate control. Body, in order: Access (roles with description and permission count, the
 * grouped permissions after the save, a System Admin warning), Pods, Availability, Profile. Footer: Save changes and Cancel, always in view.
 *
 * Save semantics are the ones the panel had and the muted lines say so: Save changes writes roles and profile; pods and availability save
 * on their own, at once (with Undo for pods); Deactivate asks first in a confirm dialog that states the open tasks. Without `User.Manage`
 * everything is read only (with the reason), except pods for `Pod.ManageMembers`. Focus goes to the heading when it opens and back to the
 * control that opened it when it closes (`mfDialogFocus`); Esc, the X and Cancel close it, asking first while there are unsaved edits.
 */
@Component({
  selector: 'mf-user-drawer',
  imports: [
    Dialog,
    DialogFocus,
    Button,
    RouterLink,
    Badge,
    AvailabilityChip,
    UserPodsCell,
    ConfirmDialog,
    ScrollRegion,
    MfDatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-drawer.html',
  styleUrl: './user-drawer.scss',
})
export class UserDrawer {
  private readonly api = inject(IdentityAdminApi);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);
  private readonly leave = inject(LeaveConfirmService);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  /** Below 640 px the drawer is the whole window and its sections fold: Access is open, the others a tap away. */
  protected readonly phone = phoneCards();
  private readonly openSections = signal<ReadonlySet<string>>(new Set(['access']));

  /** The person to show; null keeps the drawer closed. */
  readonly userId = input<number | null>(null);
  /** The person's row of the list (availability, pods): the list reloads after a save, so these stay current. */
  readonly summary = input<UserSummaryDto | null>(null);
  readonly roles = input<readonly RoleSummaryDto[]>([]);
  readonly canManage = input(false);
  /** The person may change pods (`Pod.ManageMembers`). */
  readonly canEditPods = input(false);
  readonly podChoices = input<readonly PodChoice[] | null>(null);
  readonly podChoicesFailed = input(false);
  readonly podsBusy = input(false);
  readonly intent = input<UserDrawerIntent>(null);

  /** The drawer wants to close (X, Esc, Cancel, mask), after the unsaved-changes question: the page removes `?user` from the address. */
  readonly closed = output<void>();
  /** A save changed the person: the list and its counts reload. `granted` is true when a pending person just received their first role. */
  readonly changed = output<{ userId: number; granted: boolean }>();
  readonly editAvailability = output<void>();
  readonly podsChange = output<PodsChange>();
  readonly podsOpened = output<void>();

  protected readonly open = computed(() => this.userId() !== null);
  protected readonly detail = signal<UserDetailDto | null>(null);
  protected readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly draftRoleIds = signal<number[]>([]);
  protected readonly draftName = signal('');
  protected readonly draftEmail = signal('');
  protected readonly saving = signal(false);
  protected readonly panelError = signal('');
  protected readonly deactivateOpen = signal(false);
  protected readonly deactivateBusy = signal(false);

  private readonly catalog = signal<PermissionGroupDto[]>([]);
  /** Permission codes per role, read the first time they are needed (roles ticked in the draft). */
  protected readonly codesByRole = signal<ReadonlyMap<number, readonly string[]>>(new Map());
  private requestId = 0;

  protected readonly name = computed(
    () => this.detail()?.displayName ?? this.summary()?.displayName ?? 'User details',
  );
  protected readonly readOnlyReason = computed(() =>
    readOnlyReason(this.canManage(), this.canEditPods()),
  );

  protected readonly dirty = computed(() => {
    const u = this.detail();
    if (!u || !this.canManage()) return false;
    return (
      !sameIds(this.draftRoleIds(), u.roleIds) ||
      this.draftName().trim() !== u.displayName ||
      (this.draftEmail().trim() || undefined) !== (u.email ?? undefined)
    );
  });
  protected readonly rolesChanged = computed(() => {
    const u = this.detail();
    return !!u && !sameIds(this.draftRoleIds(), u.roleIds);
  });

  /** Open tasks of the person; null when the API did not return a number (no Task.View), so nothing is shown or linked. */
  protected readonly openTasks = computed<number | null>(
    () => this.detail()?.openTaskCount ?? this.summary()?.openTaskCount ?? null,
  );
  protected readonly tasksQuery = computed(() => openTasksQuery(this.userId() ?? 0));
  /** The consequence sentence of the deactivation question ("This user has 7 open tasks. ..."), shared with the other admin dialogs. */
  protected readonly deactivateText = computed(
    () => impactLine('deactivateUser', { openTasks: this.openTasks() }).text,
  );

  /** The availability chip (header) and sentence (section): the chip only where it informs (#434). */
  protected readonly availabilityKind = computed(() => {
    const u = this.detail();
    return u ? availabilityShown({ ...u, availability: this.summary()?.availability }) : 'none';
  });
  protected readonly availabilitySentence = computed(() => {
    const a = this.summary()?.availability;
    const label = availabilityDisplay(a, this.zone).label;
    return a?.note ? `${label}. ${a.note}` : label;
  });

  protected readonly sysAdminTicked = computed(() => {
    const admin = this.roles().find((r) => r.isSystemAdmin);
    return !!admin && this.draftRoleIds().includes(admin.roleId);
  });
  /** The role the person is in or about to be in, for the `Data Technician` of the grant message. */
  private roleNames(ids: readonly number[]): string {
    return this.roles()
      .filter((r) => ids.includes(r.roleId))
      .map((r) => r.name)
      .join(', ');
  }

  /** The permissions summary: the saved ones, or (while the ticks differ) the ones the ticked roles give, grouped like the Roles tab. */
  protected readonly permissionGroups = computed(() => {
    const u = this.detail();
    if (!u) return [];
    const codes = this.rolesChanged()
      ? permissionsOfRoles(this.draftRoleIds(), this.codesByRole())
      : u.effectivePermissions;
    return summarizePermissions(codes, this.catalog());
  });
  protected readonly permissionTotal = computed(() =>
    this.permissionGroups().reduce((n, g) => n + g.count, 0),
  );
  /** True while a ticked role's permissions are still being read (the summary then shows the last complete one). */
  protected readonly previewLoading = signal(false);

  constructor() {
    // On a phone the on-screen keyboard shrinks the visual viewport, not the layout one: the drawer follows the visual viewport, so the
    // footer (Save changes) stays above the keyboard (#446). The page's CSS reads --ud-vh and --ud-top.
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (vv) {
      const apply = (): void => {
        const root = document.documentElement.style;
        root.setProperty('--ud-vh', `${vv.height}px`);
        root.setProperty('--ud-top', `${vv.offsetTop}px`);
      };
      const clear = (): void => {
        document.documentElement.style.removeProperty('--ud-vh');
        document.documentElement.style.removeProperty('--ud-top');
      };
      vv.addEventListener('resize', apply);
      vv.addEventListener('scroll', apply);
      effect(() => (this.open() ? untracked(apply) : untracked(clear)));
      inject(DestroyRef).onDestroy(() => {
        vv.removeEventListener('resize', apply);
        vv.removeEventListener('scroll', apply);
        clear();
      });
    }
    // A new person (or none): load the detail; the drafts start from it.
    effect(() => {
      const id = this.userId();
      untracked(() => (id === null ? this.reset() : void this.load(id)));
    });
    // Ticking a role reads its permissions once (the preview of what the person would have after the save).
    effect(() => {
      const ids = this.draftRoleIds();
      const changed = this.rolesChanged();
      if (changed) untracked(() => void this.readRoles(ids));
    });
    // The row menu's Deactivate / Activate: once the person is loaded, the question is on screen / the person is activated.
    effect(() => {
      const intent = this.intent();
      const u = this.detail();
      if (!intent || this.loadState() !== 'ready' || !u || this.intentDone) return;
      untracked(() => {
        this.intentDone = true;
        if (intent === 'deactivate' && u.isActive) this.deactivateOpen.set(true);
        else if (intent === 'activate' && !u.isActive) void this.activate();
      });
    });
  }

  private intentDone = false;

  /** True while there are unsaved edits (the page asks before it leaves). */
  hasUnsavedChanges(): boolean {
    return this.open() && this.dirty();
  }

  private reset(): void {
    this.requestId++;
    this.intentDone = false;
    this.detail.set(null);
    this.panelError.set('');
    this.deactivateOpen.set(false);
    this.draftRoleIds.set([]);
    this.loadState.set('loading');
  }

  protected async load(id = this.userId()): Promise<void> {
    if (id === null) return;
    const request = ++this.requestId;
    this.intentDone = false;
    this.loadState.set('loading');
    this.panelError.set('');
    this.deactivateOpen.set(false);
    void this.loadCatalog();
    try {
      const user = await firstValueFrom(this.api.getUser(id));
      if (request !== this.requestId) return;
      this.show(user);
      this.loadState.set('ready');
    } catch {
      if (request !== this.requestId) return;
      this.loadState.set('error');
    }
  }

  private async loadCatalog(): Promise<void> {
    if (this.catalog().length > 0) return;
    try {
      this.catalog.set(await firstValueFrom(this.api.listPermissions()));
    } catch {
      /* the summary then shows its counts under "Other" */
    }
  }

  private async readRoles(ids: readonly number[]): Promise<void> {
    const missing = ids.filter((id) => !this.codesByRole().has(id));
    if (missing.length === 0) return;
    this.previewLoading.set(true);
    try {
      const loaded = await Promise.all(
        missing.map(
          async (id) => [id, (await firstValueFrom(this.api.getRole(id))).permissionCodes] as const,
        ),
      );
      this.codesByRole.update((map) => new Map([...map, ...loaded]));
    } catch {
      /* the saved summary stays; the save still works */
    } finally {
      this.previewLoading.set(false);
    }
  }

  /** Shows a person and starts the drafts from them. */
  private show(user: UserDetailDto): void {
    this.detail.set(user);
    this.draftRoleIds.set([...user.roleIds]);
    this.draftName.set(user.displayName);
    this.draftEmail.set(user.email ?? '');
  }

  /** The person after a save of something other than the drafts (status): the drafts the administrator is typing stay. */
  private refresh(user: UserDetailDto): void {
    this.detail.set(user);
  }

  /** Desktop and tablet show every section; a phone shows the open ones. */
  protected expanded(key: string): boolean {
    return !this.phone() || this.openSections().has(key);
  }

  protected toggleSection(key: string): void {
    this.openSections.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected toggleRole(roleId: number, checked: boolean): void {
    const ids = new Set(this.draftRoleIds());
    if (checked) ids.add(roleId);
    else ids.delete(roleId);
    this.draftRoleIds.set([...ids].sort((a, b) => a - b));
  }

  // ---- closing

  /**
   * Esc closes the drawer, asking first when there are unsaved edits. The dialog's own Escape is off (it would hide the drawer before the
   * question is answered); this listens on the document and yields to any dialog above it (the Leave question, the Deactivate question, the
   * availability dialog), which handle their own Escape.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (!this.open() || event.defaultPrevented) return;
    // Dialogs stack by z-index (a dialog may sit inline in the page, so the order in the document says nothing): when a mask above ours
    // exists, a dialog above the drawer (the question, the availability dialog) is the one Esc is for.
    const mine = document.querySelector<HTMLElement>('.mf-user-drawer-mask');
    if (!mine) return;
    const z = (el: Element): number => Number(getComputedStyle(el).zIndex) || 0;
    const above = Array.from(document.querySelectorAll('.p-dialog-mask')).some(
      (m) => m !== mine && z(m) > z(mine),
    );
    if (above) return;
    void this.requestClose();
  }

  /** X, Esc, the mask and Cancel: asks first when there are unsaved edits (the same question as leaving the Roles tab). */
  protected async requestClose(): Promise<void> {
    if (this.saving() || this.deactivateBusy()) return;
    if (this.dirty() && !(await this.leave.ask())) return;
    this.closed.emit();
  }

  /** Every open drawer starts with focus on its heading, whether or not the person has loaded yet. */
  protected focusHeading(): void {
    document.querySelector<HTMLElement>('.mf-user-drawer [data-panel-heading]')?.focus();
  }

  // ---- save (roles and profile)

  protected async save(): Promise<void> {
    const user = this.detail();
    if (!user || !this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.panelError.set('');
    const wasPending = user.isPending;
    try {
      let current = user;
      const name = this.draftName().trim();
      const email = this.draftEmail().trim() || undefined;
      if (name !== current.displayName || email !== (current.email ?? undefined)) {
        current = await firstValueFrom(
          this.api.updateUserProfile(current.userId, name, email, current.rowVersion),
        );
      }
      let granted = false;
      if (!sameIds(this.draftRoleIds(), current.roleIds)) {
        current = await firstValueFrom(
          this.api.setUserRoles(current.userId, this.draftRoleIds(), current.rowVersion),
        );
        granted = wasPending && current.roleIds.length > 0;
      }
      this.show(current);
      if (granted) this.offerGrantUndo(current);
      else this.notify.success('User saved', current.displayName);
      this.changed.emit({ userId: current.userId, granted });
    } catch (err) {
      await this.handleError(err, user.userId);
    } finally {
      this.saving.set(false);
    }
  }

  /** A first grant of access: "Alex now has access (Data Technician)" with one Undo that puts the empty role set back. */
  private offerGrantUndo(user: UserDetailDto): void {
    const names = this.roleNames(user.roleIds);
    this.undo.offer(
      `${user.displayName} now has access${names ? ` (${names})` : ''}.`,
      () => this.undoGrant(user),
      { hint: 'Takes the roles back: the person returns to Pending access.' },
    );
  }

  /** Undo: removes the roles again, unless someone changed the person since (then nothing is overwritten). */
  private async undoGrant(granted: UserDetailDto): Promise<void> {
    try {
      await firstValueFrom(this.api.setUserRoles(granted.userId, [], granted.rowVersion));
      this.notify.success(`Access of ${granted.displayName} taken back.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY_CONFLICT') {
        this.notify.info(`Not undone: ${granted.displayName} was changed by someone else since.`);
      } else if (!(err instanceof ApiError) || err.hasFieldErrors) {
        this.notify.error(
          err instanceof ApiError ? err.message : "We couldn't undo that. Try again.",
        );
      } else {
        this.notify.error(`Couldn't take back the access of ${granted.displayName}.`);
      }
    } finally {
      this.changed.emit({ userId: granted.userId, granted: false });
      if (this.userId() === granted.userId) void this.load(granted.userId);
    }
  }

  // ---- status

  /** "View their tasks" in the question: leaves for the Task Queue (Back returns to this drawer, it is in the address). */
  protected viewTasks(): void {
    this.deactivateOpen.set(false);
    void this.router.navigate(['/tasks'], { queryParams: this.tasksQuery() });
  }

  protected askDeactivate(): void {
    this.panelError.set('');
    this.deactivateOpen.set(true);
  }

  /** Deactivates the saved person (not the drafts): roles and profile edits stay as typed. */
  protected async deactivate(): Promise<void> {
    const user = this.detail();
    if (!user || this.deactivateBusy()) return;
    this.deactivateBusy.set(true);
    try {
      this.refresh(
        await firstValueFrom(this.api.setUserActive(user.userId, false, user.rowVersion)),
      );
      this.deactivateOpen.set(false);
      this.notify.success('User deactivated', user.displayName);
      this.changed.emit({ userId: user.userId, granted: false });
    } catch (err) {
      // Closing the question first: the reason is read in the drawer, where the Deactivate control is (and nothing toasts twice).
      this.deactivateOpen.set(false);
      await this.handleError(err, user.userId);
    } finally {
      this.deactivateBusy.set(false);
    }
  }

  protected async activate(): Promise<void> {
    const user = this.detail();
    if (!user || this.deactivateBusy()) return;
    this.deactivateBusy.set(true);
    this.panelError.set('');
    try {
      this.refresh(
        await firstValueFrom(this.api.setUserActive(user.userId, true, user.rowVersion)),
      );
      this.notify.success('User activated', user.displayName);
      this.changed.emit({ userId: user.userId, granted: false });
    } catch (err) {
      await this.handleError(err, user.userId);
    } finally {
      this.deactivateBusy.set(false);
    }
  }

  private async handleError(err: unknown, userId: number): Promise<void> {
    if (!(err instanceof ApiError)) {
      this.panelError.set('Something went wrong. Try again.');
      return;
    }
    if (err.code === 'LAST_ADMIN') {
      this.panelError.set('At least one active System Admin is required.');
    } else if (err.code === 'CONCURRENCY_CONFLICT') {
      this.panelError.set('This user was changed by someone else. The latest values are shown.');
      try {
        this.show(await firstValueFrom(this.api.getUser(userId)));
        this.changed.emit({ userId, granted: false });
      } catch {
        /* keep the stale drawer; the message tells the administrator to retry */
      }
    } else {
      this.panelError.set(err.message);
    }
  }
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
