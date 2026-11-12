import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatterTeamClient, MatterTeamMemberResponse } from '../../../api/generated/api-client';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { personInitials } from '../../../shared/ui/person-initials';
import { personSubline } from '../../../shared/ui/person-subline';
import { PersonTypeBadge } from '../../../shared/ui/person-type';
import { SectionPanel } from '../../../shared/ui/section-panel';
import { StateBlock } from '../../../shared/ui/state-block';
import { Tip } from '../../../shared/ui/tip';
import { panelLoader } from '../../my-matters/panel-loader';
import { MatterTeamDialog } from './matter-team-dialog';

/** The team has no size limit of its own; the API gives at most this many rows of one page (the Summary panel and Show All read all of a realistic team). */
const TEAM_PAGE_SIZE = 100;
/** Rows shown before "Show All N": three at 1366x768, five from 900 px of window height (the side column has the room, D-82). */
const TALL_WINDOW = '(min-height: 900px)';

/**
 * The Team panel of the matter Summary (epic #1373, issue #1376; replaces the Team tab, D-44y): the first expandable panel of the side column (`mf-section-panel`), the Vendors panel
 * (#1379) goes under it. Header: chevron, "Team", the count chip and (with `Matter.Edit`) the text button Edit. Rows: an initials avatar, the person's name, the title they have on this matter
 * (muted) and the System User, Internal or External chip; at most three rows (five on a tall window) and then the text button "Show All N", which opens a read-only 768 px dialog with the
 * whole team (the same rows without the cap, with the title on this matter in a column of its own). A team of none is ONE line, "Team 0, No members" with "+ Add Member" for a person who may edit. Folding is per visit. Reading needs only `Matter.View`;
 * the team never grants access. Edit opens `mf-matter-team-dialog` (the inline empty row with the person combobox; changes are applied on Save).
 */
@Component({
  selector: 'mf-matter-team-panel',
  imports: [SectionPanel, PersonTypeBadge, StateBlock, Tip, FormDialog, MatterTeamDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .tp__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .tp__row {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-grid-row-h);
      padding: var(--mf-s1) var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
      min-width: 0;
    }
    .tp__row:hover {
      background: var(--mf-row-hover);
    }
    .tp__avatar {
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
    .tp__text {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-width: 0;
      line-height: 1.25;
    }
    .tp__name {
      overflow: hidden;
      font-weight: var(--mf-fw-semibold);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tp__sub {
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tp__foot {
      display: flex;
      align-items: center;
      min-height: var(--mf-grid-row-h-compact);
      padding: 0 var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    .tp__sk {
      height: var(--mf-grid-row-h);
      border-top: 1px solid var(--mf-border-soft);
    }
    .tp__sk::before {
      content: '';
      display: block;
      width: 60%;
      height: var(--mf-s3);
      margin: calc((var(--mf-grid-row-h) - var(--mf-s3)) / 2) var(--mf-s3);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
    }
    .tp__err {
      padding: var(--mf-s2) var(--mf-s3);
      border-top: 1px solid var(--mf-border-soft);
    }
    /* Show All: the same rows without the cap, a heading line over them, the title on this matter in its own column (as in Edit Team). */
    .tp__all {
      display: block;
    }
    .tp__heads {
      display: flex;
      gap: var(--mf-s2);
      padding: 0 var(--mf-s3) var(--mf-s1);
      font-size: var(--mf-fs-sm);
      font-weight: var(--mf-fw-semibold);
    }
    .tp__heads span:first-child {
      flex: 1 1 auto;
    }
    .tp__heads span:nth-child(2) {
      flex: none;
      width: var(--mf-col-title-w);
    }
    .tp__heads span:last-child {
      flex: none;
      width: var(--mf-col-status-w);
    }
    .tp__list--all {
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .tp__list--all .tp__row:first-child {
      border-top: 0;
    }
    .tp__list--all .tp__title {
      flex: none;
      width: var(--mf-col-title-w);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tp__list--all mf-person-type-badge {
      flex: none;
      width: var(--mf-col-status-w);
    }
  `,
  template: `
    <mf-section-panel
      title="Team"
      key="team"
      [count]="total()"
      [empty]="state() === 'ready' && total() === 0"
      emptyText="No members"
      [(expanded)]="open"
    >
      @if (canEdit() && state() !== 'loading') {
        <button
          mfPanelAction
          type="button"
          class="mf-btn mf-btn--text"
          [attr.aria-label]="total() === 0 ? 'Add a team member' : 'Edit Team'"
          [attr.data-team-edit]="total() === 0 ? null : ''"
          [attr.data-team-add]="total() === 0 ? '' : null"
          (click)="openEdit()"
        >
          @if (total() === 0) {
            <i class="pi pi-plus" aria-hidden="true"></i> Add Member
          } @else {
            <i class="pi pi-pencil" aria-hidden="true"></i> Edit
          }
        </button>
      }

      @if (state() === 'loading') {
        <div role="status" aria-label="Loading the team" data-team-loading>
          <div class="tp__sk"></div>
          <div class="tp__sk"></div>
        </div>
      } @else if (state() === 'error') {
        <div class="tp__err" data-team-error>
          <mf-state-block kind="error">
            Couldn't load the team.
            <button type="button" mfStateAction class="mf-btn" (click)="team.load()">Retry</button>
          </mf-state-block>
        </div>
      } @else {
        <ul class="tp__list" aria-label="Team members">
          @for (m of shown(); track m.id) {
            <li class="tp__row" data-team-row>
              <span class="tp__avatar" aria-hidden="true">{{ initials(m.name) }}</span>
              <span class="tp__text" [mfTip]="m.name + ', ' + m.title.name">
                <span class="tp__name" data-member-name>{{ m.name }}</span>
                <span class="tp__sub" data-member-title>{{ m.title.name }}</span>
              </span>
              <mf-person-type-badge [person]="m" />
            </li>
          }
        </ul>
        @if (rows().length > cap()) {
          <div class="tp__foot">
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-team-show-all
              (click)="allOpen.set(true)"
            >
              Show All {{ total() }}
            </button>
          </div>
        }
      }
    </mf-section-panel>

    @if (allOpen()) {
      <mf-form-dialog
        size="large"
        [title]="'Team (' + total() + ')'"
        [subtitle]="matterName() + ' (' + matterRef() + ')'"
        secondaryLabel="Close"
        [showPrimary]="false"
        [visible]="allOpen()"
        (visibleChange)="allOpen.set($event)"
      >
        <div class="tp__all" data-team-all>
          <div class="tp__heads" aria-hidden="true">
            <span>Person</span>
            <span>Title on This Matter</span>
            <span>Type</span>
          </div>
          <ul class="tp__list tp__list--all" aria-label="Team members">
            @for (m of rows(); track m.id) {
              <li class="tp__row" data-team-all-row>
                <span class="tp__avatar" aria-hidden="true">{{ initials(m.name) }}</span>
                <span class="tp__text" [mfTip]="m.name + ', ' + subline(m)">
                  <span class="tp__name">{{ m.name }}</span>
                  <span class="tp__sub">{{ subline(m) }}</span>
                </span>
                <span class="tp__title" [mfTip]="m.title.name">{{ m.title.name }}</span>
                <mf-person-type-badge [person]="m" />
              </li>
            }
          </ul>
        </div>
      </mf-form-dialog>
    }

    @if (editUsed()) {
      <mf-matter-team-dialog
        [matterId]="matterId()"
        [matterRef]="matterRef()"
        [matterName]="matterName()"
        [members]="rows()"
        [(visible)]="editOpen"
        (changed)="team.load()"
      />
    }
  `,
})
export class MatterTeamPanel {
  readonly matterId = input.required<number>();
  /** The CM Number, the subtitle of the dialogs. */
  readonly matterRef = input('');
  readonly matterName = input('');
  /** Edit and Add Member (`Matter.Edit`, the same permission as the matter header's Edit button). */
  readonly canEdit = input(false);

  private readonly api = inject(MatterTeamClient);

  protected readonly team = panelLoader(
    () => this.matterId(),
    () => this.api.listMatterTeam(this.matterId(), 1, TEAM_PAGE_SIZE, 'name'),
  );
  protected readonly state = this.team.state;
  protected readonly rows = computed<readonly MatterTeamMemberResponse[]>(
    () => this.team.data()?.items ?? [],
  );
  protected readonly total = computed(() => this.team.data()?.total ?? 0);

  protected readonly open = signal(true);
  protected readonly allOpen = signal(false);
  protected readonly editUsed = signal(false);
  protected readonly editOpen = signal(false);

  private readonly tall = signal(false);
  protected readonly cap = computed(() => (this.tall() ? 5 : 3));
  protected readonly shown = computed(() => this.rows().slice(0, this.cap()));

  constructor() {
    if (typeof matchMedia === 'function') {
      const query = matchMedia(TALL_WINDOW);
      this.tall.set(query.matches);
      const listener = (e: MediaQueryListEvent): void => this.tall.set(e.matches);
      query.addEventListener('change', listener);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
    }
  }

  protected initials(name: string): string {
    return personInitials(name);
  }

  protected subline(m: MatterTeamMemberResponse): string {
    return personSubline({ title: m.personTitle, companyName: m.companyName, email: m.email });
  }

  protected openEdit(): void {
    this.editUsed.set(true);
    this.editOpen.set(true);
  }
}
