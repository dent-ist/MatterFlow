import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient, MyMattersTaskItem } from '../../../api/generated/api-client';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { factText } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { OverviewStates } from '../overview-states';
import { panelLoader } from '../panel-loader';
import { ViewsMenu } from '../../../shared/ui/views-menu';
import { ExportMenu, ExportResult } from '../../../shared/ui/export-menu';
import { ExportService } from '../../../shared/ui/export.service';
import { ExportFormat, buildList } from '../../../shared/ui/list-export';
import { TASK_ITEM_HEADER, taskItemRow } from '../export-rows';
import { ViewState } from '../../../core/views/view-state';
import { SectionToolbar } from '../section-toolbar';
import { sectionPref } from '../section-prefs';
import { SectionTypes } from '../section-types';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/**
 * Needs my attention (README 6.2, epic #893 issue #905): ONE ranked list, one row per task, at most five rows. The server ranks: overdue (oldest first), at risk,
 * due today, unassigned with a due date in 7 days, on hold more than 7 days; a task that is several of these is listed once, under the most urgent. Each row ends
 * with its reason in a fixed right-hand column ("23 d overdue", "at risk", "due today", "no assignee", "on hold 12 d"). One "View all N" opens the Task Queue with
 * the filter that counts exactly these tasks (`needsAttention=true`); the counts per reason are the chips of the strip. A row opens the task and Back returns here.
 * Nothing here is about who manages a matter: a matter or a task nobody manages never appears as an item. Empty: "Nothing needs your attention."
 */
@Component({
  selector: 'mf-mm-attention',
  imports: [ExportMenu, ViewsMenu, PanelBox, RouterLink, RowLink, SectionToolbar, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    PANEL_LIST_STYLES,
    `
      /* The reason has its own fixed column (about a quarter of the row) so the eye can run down it. */
      .at__row {
        grid-template-columns: minmax(0, 1fr) 9.5rem;
      }
      .at__reason {
        font-weight: 600;
      }
      .at__reason--overdue {
        color: var(--mf-danger);
      }
      .at__reason--atRisk {
        color: var(--mf-warning);
      }
      /* The reason a task is on hold can be long: it gives way (ellipsis, the whole text is the tooltip) before the matter name or the title do. */
      .pl__meta--flex > .at__why {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .at__more {
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      @media (max-width: 639.98px) {
        .at__row {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      name="attention"
      title="Needs my attention"
      [state]="loader.state()"
      [busy]="loader.busy()"
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (!bare()) {
        <mf-views-menu
          mfPanelActions
          surface="my-matters.attention"
          [defaults]="false"
          [capture]="captureView"
          [apply]="pref.restore"
        />
      }
      @if (!bare()) {
        <mf-export-menu
          mfPanelActions
          fileName="needs-my-attention"
          [run]="exportRun"
          [disabled]="items().length === 0"
          reason="Nothing to export."
        />
      }
      @if (!bare()) {
        <mf-mm-section-toolbar
          label="Needs my attention"
          [options]="typeChoices.options()"
          [types]="pref.value().types"
          [focused]="pref.focused()"
          [sorts]="false"
          (typesChange)="pref.setTypes($event)"
        />
      }
      @if (items().length === 0) {
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
        <ul class="pl__list" data-attention-list>
          @for (t of items(); track t.taskId) {
            <li class="pl__row at__row" data-attention-item [attr.data-reason]="reasonKind(t)">
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
                  [rowKey]="t.taskId"
                  [routerLink]="['/tasks', t.taskId]"
                  [queryParams]="origin.params('my-matters')"
                  [state]="origin.state()"
                  [attr.aria-describedby]="tt.descriptionId"
                  [attr.aria-label]="rowName(t)"
                  >{{ t.taskNumber }} {{ t.title }}</a
                >
              </span>
              <span class="pl__meta pl__meta--flex"
                ><span class="pl__matter" [attr.title]="t.matterRef + ' ' + t.matterName"
                  >{{ t.matterRef }} {{ t.matterName }}</span
                >
                <span class="pl__prio" data-priority>{{ t.priorityName }}</span>
                @if (t.atRisk && t.factCode !== 'AT_RISK') {
                  <span class="pl__risk" data-at-risk
                    ><i class="pi pi-clock" aria-hidden="true"></i> At risk</span
                  >
                }
                @if (t.onHold?.reasonName; as why) {
                  <span class="at__why" data-hold-reason [attr.title]="why">{{ why }}</span>
                }
              </span>
              <span
                class="pl__fact at__reason"
                [class.at__reason--overdue]="reasonKind(t) === 'overdue'"
                [class.at__reason--atRisk]="reasonKind(t) === 'atRisk'"
                data-fact
                >{{ fact(t) }}</span
              >
            </li>
          }
        </ul>
        <a
          class="pl__all"
          data-view-all
          routerLink="/tasks"
          [queryParams]="allParams()"
          [attr.aria-label]="'View all ' + total() + ' tasks that need attention'"
          >View all {{ total() }}</a
        >
        @if (unfiltered() !== null) {
          <span class="at__more" data-unfiltered> ({{ unfiltered() }} with all task types)</span>
        }
      }
    </mf-mm-panel>
  `,
})
export class AttentionPanel {
  readonly filters = input.required<MmFilters>();
  /** The ids of the tasks listed, for the page: the same task is not listed again in the Upcoming deadlines (issue #905). */
  readonly listed = output<number[]>();

  protected readonly origin = inject(TaskOriginLinks);
  private readonly exports = inject(ExportService);
  private readonly api = inject(MyMattersClient);
  protected readonly typeChoices = inject(SectionTypes);
  protected readonly pref = sectionPref('my-matters.attention', { sort: false });
  protected readonly filtered = computed(() => this.pref.value().types.length > 0);
  private readonly states = inject(OverviewStates, { optional: true });

  protected readonly loader = panelLoader(
    () => [this.filters(), this.pref.value()],
    () => {
      const a = commonArgs(this.filters());
      const p = this.pref.value();
      return this.api.getMyMattersAttention(
        p.types.length > 0 ? p.types : undefined,
        undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  protected readonly items = computed<MyMattersTaskItem[]>(() => this.loader.data()?.items ?? []);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly unfiltered = computed(() => this.loader.data()?.totalUnfiltered ?? null);

  /** Nothing needs attention and no type filter is hiding anything: one muted line, no toolbar (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && this.items().length === 0 && !this.filtered(),
  );

  constructor() {
    this.typeChoices.ensure();
    restoreRowFocus('my-matters-attention', () => this.loader.state() === 'ready');
    effect(() => this.states?.report('attention', this.bare() ? 'empty' : 'content'));
    effect(() => this.listed.emit(this.items().map((t) => t.taskId)));
  }

  protected readonly fact = factText;

  /** The reason as a short key for the style and the tests. */
  protected reasonKind(t: MyMattersTaskItem): string {
    switch (t.factCode) {
      case 'OVERDUE':
        return 'overdue';
      case 'AT_RISK':
        return 'atRisk';
      case 'DUE_TODAY':
        return 'dueToday';
      case 'NO_ASSIGNEE':
        return 'unassigned';
      default:
        return 'onHold';
    }
  }

  /** The link's name keeps the task, the matter and the reason ("TSK-1 Title, 90001-80006 Employment, 3 d overdue"). */
  protected rowName(t: MyMattersTaskItem): string {
    return `${t.taskNumber} ${t.title}, ${t.matterRef} ${t.matterName}, ${factText(t)}`;
  }

  /** The state a saved view keeps (PV-29): the section's own task type filter. */
  protected readonly captureView = (): ViewState => {
    const p = this.pref.value();
    return { types: p.types, sort: p.sort, dir: p.dir };
  };

  /** The rows on screen as a list (PM v2, #879): one line per task, the reason first; the export is logged, never the data. */
  protected readonly exportRun = async (format: ExportFormat): Promise<ExportResult> => {
    const rows = this.items().map((t) => [factText(t), ...taskItemRow(t)]);
    const text = buildList(format, ['Reason', ...TASK_ITEM_HEADER], rows);
    void this.exports.log(
      'my-matters.attention',
      format,
      rows.length,
      this.pref.value().types.length > 0 ? 'task types chosen' : '',
    );
    return { text, rows: rows.length };
  };

  /** "View all N": the Task Queue with the filter that counts these tasks, the soonest due first. */
  protected readonly allParams = computed(() => queryToParams(this.loader.data()?.query ?? ''));
}
