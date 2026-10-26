import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { OLDEST_FIRST, rowFactText } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { SectionToolbar } from '../section-toolbar';
import { sectionPref } from '../section-prefs';
import { SectionTypes } from '../section-types';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/** What a task that is also overdue is called in the Overdue row that replaces its second row. */
const TAG_WORDS: Record<string, string> = {
  unassigned: 'No assignee',
  stuckOnHold: 'On hold',
  dueSoon: 'Due soon',
};

const GROUP_TITLES: Record<string, string> = {
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  unassigned: 'Unassigned',
  stuckOnHold: 'On hold',
};

/**
 * Needs my attention (README 6.2): four groups (Overdue, Due soon, Unassigned, On hold for more than 7 days), at most ten rows each, "View
 * all" opening the matching Task Queue. A row opens the task and Back returns here. Nothing here is about who manages a matter: a matter or
 * a task nobody manages never appears as an item. Empty: "Nothing needs your attention."
 */
@Component({
  selector: 'mf-mm-attention',
  imports: [PanelBox, RouterLink, RowLink, SectionToolbar, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: PANEL_LIST_STYLES,
  template: `
    <mf-mm-panel
      name="attention"
      title="Needs my attention"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <mf-mm-section-toolbar
        label="Needs my attention"
        [options]="typeChoices.options()"
        [types]="pref.value().types"
        [focused]="pref.focused()"
        [sort]="pref.value().sort"
        [dir]="pref.value().dir"
        (typesChange)="pref.setTypes($event)"
        (sortChange)="pref.setSort($event)"
        (dirChange)="pref.setDir($event)"
      />
      @if (groups().groups.length === 0) {
        @if (filtered()) {
          <p class="pl__empty" data-empty data-filtered-empty>
            Nothing of the selected types needs your attention.
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-show-all
              (click)="pref.showAll()"
            >
              Show all types
            </button>
          </p>
        } @else {
          <p class="pl__empty" data-empty>Nothing needs your attention.</p>
        }
      } @else {
        @for (g of groups().groups; track g.kind) {
          <section
            class="pl__group"
            [attr.data-group]="g.kind"
            [attr.aria-labelledby]="'mm-att-' + g.kind"
          >
            <h3 class="pl__sub" [id]="'mm-att-' + g.kind">
              {{ title(g.kind) }}
              <span class="pl__n" data-count
                >({{
                  g.totalUnfiltered !== undefined && g.totalUnfiltered !== null
                    ? g.total + ' of ' + g.totalUnfiltered
                    : g.total
                }})</span
              >
            </h3>
            <ul class="pl__list">
              @for (t of g.items; track t.taskId) {
                <li class="pl__row">
                  <span class="pl__line">
                    <mf-task-type-badge
                      #tt
                      [iconKey]="t.taskTypeIconKey"
                      [colourKey]="t.taskTypeColourKey"
                      [name]="t.taskTypeName"
                    />
                    <a
                      class="pl__link"
                      data-attention-row
                      mfRowLink="my-matters-attention"
                      [rowKey]="g.kind + '-' + t.taskId"
                      [routerLink]="['/tasks', t.taskId]"
                      [queryParams]="origin.params('my-matters')"
                      [state]="origin.state()"
                      [attr.aria-describedby]="tt.descriptionId"
                      >{{ t.taskNumber }} {{ t.title }}</a
                    >
                  </span>
                  <span class="pl__meta"
                    >{{ t.matterRef }} {{ t.matterName }}
                    <span class="pl__prio" data-priority>{{ t.priorityName }}</span>
                    @for (tag of groups().tags.get(t.taskId) ?? []; track tag) {
                      <span class="pl__tag" data-also-tag>{{ tag }}</span>
                    }
                    @if (t.atRisk) {
                      <span class="pl__risk" data-at-risk
                        ><i class="pi pi-clock" aria-hidden="true"></i> At risk</span
                      >
                    }
                  </span>
                  <span class="pl__fact" data-fact>{{ fact(t) }}</span>
                </li>
              }
            </ul>
            @if (g.repeated > 0) {
              <p class="pl__repeat" data-repeated>{{ g.repeated }} also listed under Overdue.</p>
            }
            <a
              class="pl__all"
              data-view-all
              routerLink="/tasks"
              [queryParams]="allParams(g)"
              [attr.aria-label]="'View all ' + title(g.kind).toLowerCase() + ' tasks'"
              >View all</a
            >
          </section>
        }
      }
    </mf-mm-panel>
  `,
})
export class AttentionPanel {
  readonly filters = input.required<MmFilters>();
  protected readonly origin = inject(TaskOriginLinks);
  private readonly api = inject(MyMattersClient);
  protected readonly typeChoices = inject(SectionTypes);
  protected readonly pref = sectionPref('my-matters.attention', { sort: true });
  protected readonly filtered = computed(() => this.pref.value().types.length > 0);

  protected readonly loader = panelLoader(
    () => [this.filters(), this.pref.value()],
    () => {
      const a = commonArgs(this.filters());
      const p = this.pref.value();
      return this.api.getMyMattersAttention(
        p.types.length > 0 ? p.types : undefined,
        p.sort || undefined,
        p.sort ? p.dir : undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  constructor() {
    this.typeChoices.ensure();
    restoreRowFocus('my-matters-attention', () => this.loader.state() === 'ready');
  }

  /**
   * Groups with something in them, in the API's order, with no task shown twice (PV-08 #859): a task in the Overdue group is left out of the
   * other groups' rows and carries a text tag for what it also is ("No assignee", "On hold") instead. The counts in the headings stay the true
   * totals of the lists they open, so a group may say "(6)" and show fewer rows; `repeated` says how many are listed under Overdue.
   */
  protected readonly groups = computed(() => {
    const all = (this.loader.data()?.groups ?? []).filter((g) => g.total > 0);
    const overdue = all.find((g) => g.kind === 'overdue');
    const first = new Set(overdue?.items.map((t) => t.taskId) ?? []);
    const tags = new Map<number, string[]>();
    const shown = all.map((g) => {
      if (g.kind === 'overdue' || first.size === 0) return { ...g, repeated: 0 };
      const items = g.items.filter((t) => {
        if (!first.has(t.taskId)) return true;
        tags.set(t.taskId, [...(tags.get(t.taskId) ?? []), TAG_WORDS[g.kind] ?? g.kind]);
        return false;
      });
      return { ...g, items, repeated: g.items.length - items.length };
    });
    return { groups: shown.filter((g) => g.total > 0), tags };
  });
  protected readonly fact = rowFactText;
  protected readonly params = queryToParams;

  /** "View all": the group's list; overdue opens oldest first (issue #817). */
  protected allParams(g: { kind: string; query: string }): Params {
    return g.kind === 'overdue' && !this.pref.value().sort
      ? { ...queryToParams(g.query), ...OLDEST_FIRST }
      : queryToParams(g.query);
  }

  protected title(kind: string): string {
    if (kind === 'stuckOnHold') {
      return `On hold more than ${this.loader.data()?.stuckOnHoldDays ?? 7} days`;
    }
    return GROUP_TITLES[kind] ?? kind;
  }
}
