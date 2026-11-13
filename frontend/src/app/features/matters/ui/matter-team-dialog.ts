import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  MatterListItemView,
  MatterTeamClient,
  MatterTeamMemberResponse,
  PersonLookupItem,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { personInitials } from '../../../shared/ui/person-initials';
import { PERSON_PICKER_MESSAGES, PersonPicker } from '../../../shared/ui/person-picker';
import { personSubline } from '../../../shared/ui/person-subline';
import { PersonTypeBadge } from '../../../shared/ui/person-type';
import { Tip } from '../../../shared/ui/tip';

/** The messages of the dialog (D-20: sentences are sentence case). */
export const TEAM_DIALOG_MESSAGES = {
  intro:
    'Type in the last row to find someone in People, pick them, then choose their title on this matter. A new empty row appears after each one. Nothing is saved until Save Changes.',
  needTitles: 'Choose a title for every row.',
  noTitles:
    'No team titles yet. An administrator adds them under Administration > Lists > Team Titles.',
} as const;

/** One line of the dialog: a person with a title, from the saved team or just picked. */
interface TeamRow {
  /** Stable for the list while the dialog is open. */
  key: number;
  personId: number;
  name: string;
  subline: string;
  personType: string;
  isSystemUser: boolean;
  /** The saved row (id and version) or null for a person picked in this dialog. */
  member: MatterTeamMemberResponse | null;
  /** The chosen Team Title id as text ('' until chosen). */
  titleId: string;
}

/**
 * The choices of a Title dropdown: the active titles in the administrator's order; the member's own title stays, as "Name (inactive)", only while it is the selected entry (a title an
 * administrator retired is kept on the rows that already have it).
 */
export function titleItems(
  list: readonly MatterListItemView[],
  current: { id: number; name: string; isActive: boolean } | null,
  selected: string,
): DropdownItem[] {
  const items = list
    .filter((t) => t.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => ({ value: String(t.id), label: t.name }));
  if (current && selected === String(current.id) && !items.some((i) => i.value === selected)) {
    items.unshift({
      value: selected,
      label: current.isActive ? current.name : `${current.name} (inactive)`,
    });
  }
  return items;
}

/**
 * Edit Team (epic #1373, issue #1376; mockup screen `matter-team-filled`): a large (768 px) `mf-form-dialog` for the people of a matter. The saved people are a list (avatar, name, the muted
 * "title or role, company or e-mail", the System User / Internal / External chip, the Title dropdown, a Remove icon button); under it is ALWAYS one empty row, the person combobox
 * (`mf-person-picker` with `clearOnPick`; Internal people only, #1383): type to search People, pick, and the person joins the list with no title yet and a new empty row appears, so several people go in quickly. Free
 * text is never accepted: text typed in the box with nothing picked refuses the save with "Choose a person from the list." A person who is not in People is created from the picker's own
 * inline form (`People.Manage`), always as an Internal person. Nothing is saved until Save Changes, which stays disabled until every row has a title; the footer-side summary line says what will change ("2 added, 1
 * removed."). A dirty Cancel asks "You have unsaved changes. Discard them?" (D-31).
 *
 * Save applies the difference with the existing endpoints, one after the other: removals, then title changes, then additions (a person already on the matter is a 409 from the API; the
 * people are never edited here). When one of them fails the dialog closes, the panel reloads to show the team as it is now, and a warning says so.
 */
@Component({
  selector: 'mf-matter-team-dialog',
  imports: [FormDialog, PersonPicker, PersonTypeBadge, Dropdown, Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .td__intro {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .td__heads {
      display: flex;
      gap: var(--mf-s2);
      padding: 0 var(--mf-s3) var(--mf-s1);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .td__heads span:first-child {
      flex: 1 1 auto;
    }
    /* The title column is as wide as the Title column of the lists (--mf-col-title-w) plus the 36 px Remove button and the gap; the heading line and every row share it. */
    .td__heads span:last-child {
      flex: none;
      width: calc(var(--mf-col-title-w) + var(--mf-ctl-h) + var(--mf-s2));
    }
    .td__rows {
      max-height: 20rem;
      overflow-y: auto;
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .td__rows:empty {
      display: none;
    }
    .td__row {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: calc(var(--mf-ctl-h) + var(--mf-s3));
      padding: var(--mf-s1) var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    .td__row:first-child {
      border-top: 0;
    }
    .td__row--added {
      background: var(--mf-sem-info-bg);
    }
    .td__avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: var(--mf-radius-pill);
      background: var(--mf-sem-info-bg);
      color: var(--mf-sem-info-fg);
      font-size: var(--mf-fs-xs);
      font-weight: var(--mf-fw-bold);
    }
    .td__row--added .td__avatar {
      background: var(--mf-surface);
    }
    .td__text {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-width: 0;
      line-height: 1.25;
    }
    .td__name {
      overflow: hidden;
      font-weight: var(--mf-fw-semibold);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td__sub {
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td__title {
      flex: none;
      width: var(--mf-col-title-w);
    }
    .td__add {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin-top: var(--mf-s2);
    }
    .td__add mf-person-picker {
      flex: 1 1 auto;
      min-width: 0;
    }
    .td__summary {
      margin: var(--mf-s3) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <mf-form-dialog
      size="large"
      title="Edit Team"
      [subtitle]="matterName() + ' (' + matterRef() + ')'"
      primaryLabel="Save Changes"
      [busy]="busy()"
      [dirty]="dirty()"
      [canSubmit]="canSave()"
      focusId="team-add"
      [(visible)]="visible"
      (submitted)="save()"
    >
      <p class="td__intro" data-team-intro>{{ intro }}</p>
      <div class="td__heads" aria-hidden="true">
        <span>Person</span>
        <span>Title on This Matter</span>
      </div>
      <div class="td__rows" role="list" aria-label="People on the team" data-team-rows>
        @for (r of rows(); track r.key) {
          <div
            class="td__row"
            role="listitem"
            data-team-row
            [class.td__row--added]="!r.member"
            [attr.data-added]="!r.member ? '' : null"
          >
            <span class="td__avatar" aria-hidden="true">{{ initials(r.name) }}</span>
            <span class="td__text" [mfTip]="r.name + (r.subline ? ', ' + r.subline : '')">
              <span class="td__name" data-row-name>{{ r.name }}</span>
              <span class="td__sub">{{ r.subline }}</span>
            </span>
            <mf-person-type-badge [person]="r" />
            <div class="td__title">
              <mf-dropdown
                field
                [buttonId]="'team-title-' + r.key"
                [label]="'Title on this matter for ' + r.name"
                placeholder="Choose a title"
                data-row-title
                [items]="titleChoices(r)"
                [search]="titleChoices(r).length > 10"
                [disabled]="noTitles()"
                [invalid]="r.titleId === '' && !noTitles()"
                [value]="r.titleId"
                (valueChange)="setTitle(r.key, $event)"
              />
            </div>
            <button
              type="button"
              class="mf-btn mf-btn--icon"
              data-remove-row
              [attr.aria-label]="'Remove ' + r.name"
              [mfTip]="'Remove ' + r.name"
              (click)="remove(r.key)"
            >
              <i class="pi pi-trash" aria-hidden="true"></i>
            </button>
          </div>
        }
      </div>
      <div class="td__add" data-team-add-row>
        <mf-person-picker
          inputId="team-add"
          label="Add a Person"
          placeholder="Search People by name, email or company"
          [clearOnPick]="true"
          onlyType="INTERNAL"
          help="Only Internal people can be on a matter team."
          [taken]="takenIds()"
          [error]="pickError()"
          (picked)="add($event)"
          (draftChange)="draftChanged($event)"
        />
      </div>
      @if (noTitles()) {
        <p class="td__summary" data-no-titles role="status">{{ messages.noTitles }}</p>
      } @else {
        <p class="td__summary" data-team-summary role="status">{{ summary() }}</p>
      }
    </mf-form-dialog>
  `,
})
export class MatterTeamDialog {
  readonly matterId = input.required<number>();
  readonly matterRef = input('');
  readonly matterName = input('');
  /** The saved team (the panel's rows): the dialog starts from it each time it opens. */
  readonly members = input<readonly MatterTeamMemberResponse[]>([]);
  readonly visible = model(false);
  /** The team changed (or a save stopped half way): the panel asks for it again. */
  readonly changed = output<void>();

  private readonly api = inject(MatterTeamClient);
  private readonly titlesApi = inject(TeamTitlesClient);
  private readonly notify = inject(NotificationService);
  private readonly quiet = inject(QuietRequests);

  protected readonly messages = TEAM_DIALOG_MESSAGES;
  protected readonly intro = TEAM_DIALOG_MESSAGES.intro;
  protected readonly rows = signal<readonly TeamRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly pickError = signal<string | null>(null);
  private readonly draft = signal('');
  private readonly titleList = signal<readonly MatterListItemView[] | null>(null);
  private readonly removed = signal<readonly MatterTeamMemberResponse[]>([]);
  private nextKey = 1;

  protected readonly noTitles = computed(
    () =>
      this.titleList() !== null &&
      this.titleList()!.every((t) => !t.isActive) &&
      this.rows().every((r) => !r.member),
  );
  protected readonly takenIds = computed(() => this.rows().map((r) => r.personId));

  /** Added, removed and retitled rows against the saved team. */
  protected readonly changes = computed(() => {
    const rows = this.rows();
    const added = rows.filter((r) => !r.member).length;
    const retitled = rows.filter((r) => r.member && r.titleId !== String(r.member.title.id)).length;
    return { added, removed: this.removed().length, retitled };
  });
  protected readonly dirty = computed(() => {
    const c = this.changes();
    return c.added + c.removed + c.retitled > 0 || this.draft().trim() !== '';
  });
  protected readonly missingTitle = computed(() => this.rows().some((r) => r.titleId === ''));
  /** Save stays disabled until something changed and every row has a title (nothing to save with no change). */
  protected readonly canSave = computed(() => {
    const c = this.changes();
    return c.added + c.removed + c.retitled > 0 && !this.missingTitle();
  });
  protected readonly summary = computed(() => {
    const c = this.changes();
    const parts = [
      c.added ? `${c.added} added` : '',
      c.removed ? `${c.removed} removed` : '',
      c.retitled ? `${c.retitled} retitled` : '',
    ].filter(Boolean);
    const done = parts.length ? parts.join(', ') + '.' : 'No changes yet.';
    return this.missingTitle() ? `${done} ${TEAM_DIALOG_MESSAGES.needTitles}` : done;
  });

  constructor() {
    // Each opening starts from the saved team and reads the titles again (an administrator may have changed them).
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.rows.set(
          this.members().map((m) => ({
            key: this.nextKey++,
            personId: m.personId,
            name: m.name,
            subline: personSubline({
              title: m.personTitle,
              companyName: m.companyName,
              email: m.email,
            }),
            personType: m.personType,
            isSystemUser: m.isSystemUser,
            member: m,
            titleId: String(m.title.id),
          })),
        );
        this.removed.set([]);
        this.draft.set('');
        this.pickError.set(null);
        void this.loadTitles();
      });
    });
  }

  private async loadTitles(): Promise<void> {
    try {
      this.titleList.set(
        await firstValueFrom(this.quiet.run(() => this.titlesApi.listTeamTitles())),
      );
    } catch {
      this.titleList.set([]);
    }
  }

  protected titleChoices(r: TeamRow): DropdownItem[] {
    return titleItems(this.titleList() ?? [], r.member?.title ?? null, r.titleId);
  }

  protected initials(name: string): string {
    return personInitials(name);
  }

  protected setTitle(key: number, value: string): void {
    this.rows.update((all) => all.map((r) => (r.key === key ? { ...r, titleId: value } : r)));
  }

  protected remove(key: number): void {
    const row = this.rows().find((r) => r.key === key);
    if (!row) return;
    this.rows.update((all) => all.filter((r) => r.key !== key));
    if (row.member) this.removed.update((all) => [...all, row.member!]);
  }

  /** A person was picked (or just created) in the empty row: they join the list with no title yet; the picker empties itself. */
  protected add(p: PersonLookupItem): void {
    if (this.rows().some((r) => r.personId === p.personId)) return;
    // A person removed in this dialog and picked again is the saved row again: nothing to add and nothing to remove.
    const back = this.removed().find((m) => m.personId === p.personId);
    if (back) {
      this.removed.update((all) => all.filter((m) => m !== back));
      this.rows.update((all) => [
        ...all,
        {
          key: this.nextKey++,
          personId: back.personId,
          name: back.name,
          subline: personSubline({
            title: back.personTitle,
            companyName: back.companyName,
            email: back.email,
          }),
          personType: back.personType,
          isSystemUser: back.isSystemUser,
          member: back,
          titleId: String(back.title.id),
        },
      ]);
      return;
    }
    this.rows.update((all) => [
      ...all,
      {
        key: this.nextKey++,
        personId: p.personId,
        name: p.displayName,
        subline: personSubline({ title: p.title, companyName: p.companyName, email: p.email }),
        personType: p.personType,
        isSystemUser: p.isSystemUser,
        member: null,
        titleId: '',
      },
    ]);
  }

  protected draftChanged(text: string): void {
    this.draft.set(text);
    if (this.pickError()) this.pickError.set(null);
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    // Free text is never a value: something typed in the empty row and not picked stops the save.
    if (this.draft().trim() !== '') {
      this.pickError.set(PERSON_PICKER_MESSAGES.pick);
      return;
    }
    if (!this.canSave()) return;
    this.busy.set(true);
    let failed = false;
    try {
      for (const gone of this.removed()) {
        // The API answers 204 also when the member is already gone, so "removed by someone else" reads as success.
        await firstValueFrom(this.api.removeMatterTeamMember(this.matterId(), gone.id));
      }
      for (const r of this.rows()) {
        if (r.member && r.titleId !== String(r.member.title.id)) {
          await firstValueFrom(
            this.api.updateMatterTeamMember(this.matterId(), r.member.id, {
              teamTitleId: Number(r.titleId),
              rowVersion: r.member.rowVersion,
            }),
          );
        }
      }
      for (const r of this.rows()) {
        if (!r.member) {
          await firstValueFrom(
            this.api.addMatterTeamMember(this.matterId(), {
              personId: r.personId,
              teamTitleId: Number(r.titleId),
            }),
          );
        }
      }
    } catch {
      // The HTTP layer already toasted the reason; what was applied before the failure stays.
      failed = true;
    } finally {
      this.busy.set(false);
    }
    this.visible.set(false);
    this.changed.emit();
    if (failed) {
      this.notify.warn(
        'Team partly saved',
        'Some changes were not saved. The Team panel shows the team as it is now.',
      );
    } else {
      this.notify.success('Team saved', this.summary());
    }
  }
}
