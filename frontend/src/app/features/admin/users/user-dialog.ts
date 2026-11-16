import { TagChip } from '../../../shared/ui/tag-chip';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { firstValueFrom } from 'rxjs';
import { availabilityDisplay } from '../../../core/availability/availability';
import { ApiError } from '../../../core/http/api-error';
import {
  IdentityAdminApi,
  PermissionGroupDto,
  PersonListItemView,
  PodChoice,
  RoleSummaryDto,
  UserDetailDto,
  UserSummaryDto,
} from '../../../core/identity-admin/identity-admin-api';
import { NotificationService } from '../../../core/notify/notification.service';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import { Badge } from '../../../shared/ui/badge';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { TextField } from '../../../shared/ui/text-field';
import { impactLine } from '../shared/dialog-copy';
import { availabilityShown } from './user-availability';
import { permissionsOfRoles, summarizePermissions } from './user-access';
import { UserCalendarField } from '../holidays/user-calendar-field';
import { PodsChange, UserPodsCell } from './user-pods-cell';
import {
  MONTH_NAMES,
  MonthYearPipe,
  NumericDatePipe,
  readableMonthYear,
  yearsSinceMonth,
  yearsText,
} from '../../../shared/ui/numeric-date';
import { IntPipe } from '../../../shared/ui/number-format';
import { shortAccountName } from '../../../shared/ui/person-name';

/**
 * Where the dialog starts: nothing special, with the deactivation question already on screen (the row menu's Deactivate), or with the
 * person activated at once (the row menu's Activate: no question is needed).
 */
export type UserDialogIntent = 'deactivate' | 'activate' | null;

/** The Task Queue address behind "View their tasks": that person's open tasks (the same statuses the count uses). */
export function openTasksQuery(userId: number): Record<string, string | string[]> {
  return { assignee: String(userId), status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'] };
}

/** What the dialog tells the person who cannot change everything. Null when they can change it all. */
export function readOnlyReason(canManage: boolean, canEditPods: boolean): string | null {
  if (canManage) return null;
  return canEditPods
    ? "Read only, except pods: you can change this person's pods but not their roles, profile or status."
    : 'Read only: you can see this person but not change them.';
}

/**
 * The user dialog (epic #1389, issue #1390; before it was the user drawer of #438 to #443): the record of one person in a large (768 px) centred
 * `mf-form-dialog` (D-31, D-32), not a side panel. It is `?user=<id>` in the address (the page owns that, so Back closes it and Back from "View their
 * tasks" reopens it). Header: the name and, under it, the Windows account; the first lines of the body are the status, availability where it informs,
 * last seen, open tasks and the Deactivate / Activate control. Body, in order, in one scroll: Access (roles with description and permission count,
 * the grouped permissions after the save, a System Admin warning), Pods, Availability, Profile. Footer: Cancel and Save Changes.
 *
 * Save semantics are the ones the drawer had and the muted lines say so: Save Changes writes roles, profile and the person fields (title, office, employment status, industry join date, comments); pods and availability save on their
 * own, at once (with Undo for pods). Deactivate asks first, in the footer (D-31a: no dialog opens another dialog), and states the open tasks. Without
 * `User.Manage` everything is read only (with the reason), except pods for `Pod.ManageMembers`; the footer then has just Close. Esc, the X, the scrim and
 * Cancel close it, asking first while there are unsaved edits (the shared "You have unsaved changes. Discard them?" in the footer).
 */
@Component({
  selector: 'mf-user-dialog',
  imports: [
    IntPipe,
    NumericDatePipe,
    MonthYearPipe,
    Dropdown,
    TextField,
    FormDialog,
    Button,
    RouterLink,
    Badge,
    TagChip,
    AvailabilityChip,
    UserPodsCell,
    UserCalendarField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-dialog.html',
  styleUrl: './user-dialog.scss',
})
export class UserDialog {
  private readonly api = inject(IdentityAdminApi);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly router = inject(Router);
  private readonly clock = inject(Clock);

  /** The person to show; null keeps the dialog closed. */
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
  readonly intent = input<UserDialogIntent>(null);
  /**
   * Another dialog is open for this person (Edit Availability): this one steps aside and comes back when that one closes, because a dialog never
   * opens on top of another (D-31); what was typed stays. Focus goes back to the button that asked.
   */
  readonly suspended = input(false);

  /** The dialog wants to close (X, Esc, Cancel, mask), after the unsaved-changes question: the page removes `?user` from the address. */
  readonly closed = output<void>();
  /** A save changed the person: the list and its counts reload. `granted` is true when a pending person just received their first role. */
  readonly changed = output<{ userId: number; granted: boolean }>();
  readonly editAvailability = output<void>();
  readonly podsChange = output<PodsChange>();
  readonly podsOpened = output<void>();

  protected readonly open = computed(() => this.userId() !== null);
  /** True once the person has been read (or the read failed) after the dialog was asked for: it opens with its content, so focus can start in it. */
  private readonly opened = signal(false);
  /** The dialog was aside for another one and is back: it starts on the button that asked. */
  private readonly cameBack = signal(false);
  protected readonly focusTarget = computed(() =>
    this.cameBack() ? 'ud-edit-availability' : 'ud-start',
  );
  protected readonly shown = computed(() => this.open() && this.opened() && !this.suspended());
  protected readonly detail = signal<UserDetailDto | null>(null);
  protected readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly draftRoleIds = signal<number[]>([]);
  protected readonly draftName = signal('');
  protected readonly draftEmail = signal('');
  // The person fields (epic #1389, issue #1394). The two lists are ids as text ('' = none); the join date is a month ('01' to '12') and a year, both '' for none.
  protected readonly draftTitle = signal('');
  protected readonly draftNotes = signal('');
  protected readonly draftOffice = signal('');
  protected readonly draftStatus = signal('');
  protected readonly draftJoinMonth = signal('');
  protected readonly draftJoinYear = signal('');
  /** Office and Employment Status lists, read the first time an editor opens (only `User.Manage` edits them); null before. */
  protected readonly offices = signal<readonly PersonListItemView[] | null>(null);
  protected readonly statuses = signal<readonly PersonListItemView[] | null>(null);
  protected readonly saving = signal(false);
  protected readonly panelError = signal('');
  protected readonly deactivateOpen = signal(false);
  protected readonly deactivateBusy = signal(false);

  private readonly catalog = signal<PermissionGroupDto[]>([]);
  /** Permission codes per role, read the first time they are needed (roles ticked in the draft). */
  protected readonly codesByRole = signal<ReadonlyMap<number, readonly string[]>>(new Map());
  private requestId = 0;

  /** The header's subtitle: the Windows account, and "Seeded" for the seeded administrator. */
  protected readonly account = computed(() => {
    const u = this.detail();
    return u ? u.windowsAccount + (u.isSeededAdmin ? ' \u00b7 Seeded' : '') : '';
  });
  protected readonly name = computed(
    () =>
      shortAccountName(this.detail()?.displayName ?? this.summary()?.displayName) || 'User details',
  );
  protected readonly readOnlyReason = computed(() =>
    readOnlyReason(this.canManage(), this.canEditPods()),
  );

  protected readonly dirty = computed(() => {
    const u = this.detail();
    if (!u || !this.canManage()) return false;
    return (
      !sameIds(this.draftRoleIds(), u.roleIds) || this.profileChanged() || this.personChanged()
    );
  });
  /** Name or email differ from the saved ones (the user row). */
  private readonly profileChanged = computed(() => {
    const u = this.detail();
    return (
      !!u &&
      (this.draftName().trim() !== u.displayName ||
        (this.draftEmail().trim() || undefined) !== (u.email ?? undefined))
    );
  });
  /** Title, comments, office, employment status or industry join date differ from the saved ones (the person row). */
  private readonly personChanged = computed(() => {
    const u = this.detail();
    if (!u) return false;
    return (
      this.draftTitle().trim() !== (u.title ?? '') ||
      this.draftNotes().trim() !== (u.notes ?? '') ||
      this.draftOffice() !== idText(u.officeId) ||
      this.draftStatus() !== idText(u.employmentStatusId) ||
      this.joinMonthDraft() !== (u.industryJoinMonth ?? '')
    );
  });
  /** The industry join date as `yyyy-MM` ('' for none, also while only one of month and year is chosen). */
  private readonly joinMonthDraft = computed(() =>
    this.draftJoinMonth() && this.draftJoinYear()
      ? `${this.draftJoinYear()}-${this.draftJoinMonth()}`
      : '',
  );
  /** Why the join date cannot be saved yet ('' when it can): one of month and year alone, or a month in the future. */
  protected readonly joinError = computed(() => {
    const month = this.draftJoinMonth();
    const year = this.draftJoinYear();
    if (!month && !year) return '';
    if (!month || !year) return 'Choose both a month and a year.';
    const now = this.clock.now();
    const chosen = Number(year) * 12 + Number(month);
    return chosen > now.getFullYear() * 12 + now.getMonth() + 1
      ? 'The month cannot be in the future.'
      : '';
  });
  protected readonly saveBlocked = computed(() => this.joinError() !== '');

  protected readonly monthItems: readonly DropdownItem[] = [
    { value: '', label: 'None' },
    ...MONTH_NAMES.map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label })),
  ];
  /** The years from this year back to 1950 (the first year the API takes). */
  protected readonly yearItems = computed<readonly DropdownItem[]>(() => {
    const items: DropdownItem[] = [{ value: '', label: 'None' }];
    for (let y = this.clock.now().getFullYear(); y >= 1950; y--) {
      items.push({ value: String(y), label: String(y) });
    }
    return items;
  });
  protected readonly officeItems = computed(() =>
    listItems(this.offices(), this.draftOffice(), this.detail()?.officeName),
  );
  protected readonly statusItems = computed(() =>
    listItems(this.statuses(), this.draftStatus(), this.detail()?.employmentStatusName),
  );
  /** "8 years in the industry" under the join date (the experience a manager looks for); empty without a valid date. */
  protected readonly experience = computed(() => {
    const value = this.joinMonthDraft() || this.detail()?.industryJoinMonth || '';
    const years = yearsSinceMonth(value, this.clock.now(), this.zone);
    return years === null ? '' : `${yearsText(years)} in the industry.`;
  });
  protected readonly joinReadable = computed(() =>
    readableMonthYear(this.detail()?.industryJoinMonth),
  );
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
  /**
   * The role whose landing page the person gets: the first of their roles by name (the order `/me` returns, epic #1330). Follows the
   * ticks, so the line says what will be true after Save; null for a person with no role.
   */
  protected readonly landingRole = computed(() => {
    const ids = this.draftRoleIds();
    const names = this.roles()
      .filter((r) => ids.includes(r.roleId))
      .map((r) => r.name)
      .sort((a, b) => a.localeCompare(b));
    return names[0] ?? null;
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
    // Esc while the deactivation question is in the footer closes the question, not the dialog (heard first, before the dialog's own Esc).
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !this.deactivateOpen()) return;
      e.stopPropagation();
      this.deactivateOpen.set(false);
    };
    document.addEventListener('keydown', onEsc, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('keydown', onEsc, true));
    // The deactivation question replaces the footer: focus goes to its safe choice, Keep User; when it closes (Keep User, Esc, or the person is now
    // deactivated) focus goes back to the control that asked, which is Activate once the person is deactivated.
    let questionWasOpen = false;
    effect(() => {
      const open = this.deactivateOpen();
      if (open) {
        setTimeout(() =>
          document.querySelector<HTMLElement>('.mf-formdlg [data-deactivate-keep] button')?.focus(),
        );
      } else if (questionWasOpen && this.open()) {
        setTimeout(() =>
          document
            .querySelector<HTMLElement>(
              '.mf-formdlg [data-deactivate], .mf-formdlg [data-activate]',
            )
            ?.focus(),
        );
      }
      questionWasOpen = open;
    });
    // While this dialog is aside for another one, the next time it opens focus goes back to the button that asked (Edit Availability).
    effect(() => {
      if (this.suspended() && this.open()) this.cameBack.set(true);
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
    this.opened.set(false);
    this.cameBack.set(false);
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
      this.opened.set(true);
    } catch {
      if (request !== this.requestId) return;
      this.loadState.set('error');
      this.opened.set(true);
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
    this.draftTitle.set(user.title ?? '');
    this.draftNotes.set(user.notes ?? '');
    this.draftOffice.set(idText(user.officeId));
    this.draftStatus.set(idText(user.employmentStatusId));
    this.draftJoinYear.set(user.industryJoinMonth?.slice(0, 4) ?? '');
    this.draftJoinMonth.set(user.industryJoinMonth?.slice(5, 7) ?? '');
    if (this.canManage()) void this.loadLists();
  }

  /** The Office and Employment Status choices (once per dialog; a failed read leaves the fields on the saved value only). */
  private async loadLists(): Promise<void> {
    if (this.offices() !== null || this.listsLoading) return;
    this.listsLoading = true;
    try {
      const [offices, statuses] = await Promise.all([
        firstValueFrom(this.api.listOffices()),
        firstValueFrom(this.api.listEmploymentStatuses()),
      ]);
      this.offices.set(offices);
      this.statuses.set(statuses);
    } catch {
      /* the saved office and status stay selectable; the lists are read again the next time */
    } finally {
      this.listsLoading = false;
    }
  }

  private listsLoading = false;

  /** The person after a save of something other than the drafts (status): the drafts the administrator is typing stay. */
  private refresh(user: UserDetailDto): void {
    this.detail.set(user);
  }

  protected toggleRole(roleId: number, checked: boolean): void {
    const ids = new Set(this.draftRoleIds());
    if (checked) ids.add(roleId);
    else ids.delete(roleId);
    this.draftRoleIds.set([...ids].sort((a, b) => a - b));
  }

  // ---- closing

  /** The dialog closed itself (X, Esc, scrim, Cancel, Close), after its own unsaved-changes question: the page removes `?user` from the address. */
  protected onCancelled(): void {
    this.closed.emit();
  }

  // ---- save (roles and profile)

  protected async save(): Promise<void> {
    const user = this.detail();
    if (!user || !this.dirty() || this.saving() || this.saveBlocked()) return;
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
        this.refresh(current);
      }
      if (this.personChanged()) {
        current = await firstValueFrom(
          this.api.updateUserPersonDetails(current.userId, {
            title: this.draftTitle().trim() || undefined,
            notes: this.draftNotes().trim() || undefined,
            officeId: this.draftOffice() ? Number(this.draftOffice()) : undefined,
            employmentStatusId: this.draftStatus() ? Number(this.draftStatus()) : undefined,
            industryJoinMonth: this.joinMonthDraft() || undefined,
            rowVersion: current.personRowVersion ?? '',
          }),
        );
        this.refresh(current);
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
          "Couldn't undo the access.",
          err instanceof ApiError ? err.message : 'Try again.',
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

  /** "View their tasks" in the question: leaves for the Task Queue (Back returns to this dialog, it is in the address). */
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
      // Closing the question first: the reason is read in the dialog, where the Deactivate control is (and nothing toasts twice).
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
      this.panelError.set("Couldn't save the user. Try again.");
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
        /* keep the stale dialog; the message tells the administrator to retry */
      }
    } else {
      this.panelError.set(err.message);
    }
  }
}

/** An id as the text a dropdown holds ('' for none). */
function idText(id: number | null | undefined): string {
  return id === null || id === undefined ? '' : String(id);
}

/** The items of an Office or Employment Status dropdown: None, the active items and the one the person has (even when it is deactivated). */
function listItems(
  list: readonly PersonListItemView[] | null,
  chosen: string,
  chosenName: string | undefined,
): DropdownItem[] {
  const items: DropdownItem[] = [{ value: '', label: 'None' }];
  for (const item of list ?? []) {
    if (item.isActive || String(item.id) === chosen) {
      items.push({
        value: String(item.id),
        label: item.isActive ? item.name : `${item.name} (Inactive)`,
      });
    }
  }
  if (chosen && !items.some((i) => i.value === chosen) && chosenName) {
    items.push({ value: chosen, label: chosenName });
  }
  return items;
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
