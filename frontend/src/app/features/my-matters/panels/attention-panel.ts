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
import { restoreRowFocus } from '../../../shared/ui/row-nav';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { dayHeading, dueDay, factText } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { OverviewStates } from '../overview-states';
import { panelLoader } from '../panel-loader';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { ExportMenu, ExportResult } from '../../../shared/ui/export-menu';
import { ExportService } from '../../../shared/ui/export.service';
import { ExportFormat, buildList } from '../../../shared/ui/list-export';
import { TASK_ITEM_HEADER, taskItemRow } from '../export-rows';
import { MyMattersFocus } from '../focus';
import { MmTaskRow } from '../task-row';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/**
 * Needs my attention (README 6.2, epic #893 issues #905, #894 and #897): ONE ranked list, one row per task, at most five rows. The server ranks: overdue
 * (oldest first), at risk, due today, unassigned with a due date in 7 days, on hold more than 7 days; a task that is several of these is listed once, under
 * the most urgent. Each row is one line (`mfMmTaskRow`) and ends with its reason in a fixed right-hand column ("23 d overdue", "at risk", "due today", "no
 * assignee", "on hold 12 d"). One "View all N" in the heading opens the Task Queue with the filter that counts exactly these tasks (`needsAttention=true`);
 * the counts per reason are the chips of the strip. The only control of the list is its Options menu (Export); there is no task-type filter of its own, the
 * person's Focus applies (issue #907). A row opens the task and Back returns here. Nothing here is about who manages a matter. Empty: "Nothing needs your
 * attention."
 */
@Component({
  selector: 'mf-mm-attention',
  imports: [ExportMenu, MmTaskRow, OptionsMenu, PanelBox, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    PANEL_LIST_STYLES,
    `
      .at__more {
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .at__all {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        color: var(--mf-link);
        font-weight: 600;
      }
      @media (max-width: 639.98px) {
        .at__all {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      name="attention"
      title="Needs my attention"
      [flat]="true"
      [skeleton]="5"
      [state]="loader.state()"
      [busy]="loader.busy()"
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (!bare() && items().length > 0) {
        <a
          mfPanelActions
          class="at__all"
          data-view-all
          routerLink="/tasks"
          [queryParams]="allParams()"
          [attr.aria-label]="'View all ' + total() + ' tasks that need attention'"
          >View all {{ total() }}</a
        >
      }
      @if (!bare()) {
        <mf-options-menu mfPanelActions label="Needs my attention">
          <mf-export-menu
            [inline]="true"
            fileName="needs-my-attention"
            [run]="exportRun"
            [disabled]="items().length === 0"
            reason="Nothing to export."
          />
        </mf-options-menu>
      }
      @if (items().length === 0) {
        @if (focused()) {
          <p class="pl__empty" data-empty data-filtered-empty>
            Nothing in your Focus needs your attention.
            <button type="button" class="mf-btn mf-btn--text" data-show-all (click)="focus.clear()">
              Clear Focus
            </button>
          </p>
        } @else {
          <p class="pl__empty" data-empty>Nothing needs your attention.</p>
        }
      } @else {
        <ul class="pl__list" data-attention-list>
          @for (t of items(); track t.taskId) {
            <li
              mfMmTaskRow
              data-attention-item
              kind="attention"
              rowScope="my-matters-attention"
              [attr.data-reason]="reasonKind(t)"
              [task]="t"
              [showMatter]="showMatter()"
              [who]="who(t)"
              [when]="when(t)"
              [tone]="tone(t)"
              [statusIs]="statusIs(t)"
            ></li>
          }
        </ul>
        @if (unfiltered() !== null) {
          <span class="at__more" data-unfiltered> ({{ unfiltered() }} with all task types)</span>
        }
      }
    </mf-mm-panel>
  `,
})
export class AttentionPanel {
  readonly filters = input.required<MmFilters>();
  /** The matter's name is drawn on each row: the person has several matters (a matter named on every row says nothing for one). */
  readonly showMatter = input(false);
  /** The ids of the tasks listed, for the page: the same task is not listed again in the Upcoming deadlines (issue #905). */
  readonly listed = output<number[]>();

  private readonly exports = inject(ExportService);
  private readonly api = inject(MyMattersClient);
  private readonly zone = inject(USER_TIME_ZONE);
  protected readonly focus = inject(MyMattersFocus);
  /** The task types of the person's Focus: the list's only type filter (issue #907). */
  protected readonly focused = computed(() => this.focus.types().length > 0);
  private readonly states = inject(OverviewStates, { optional: true });

  protected readonly loader = panelLoader(
    () => [this.filters(), this.focus.types()],
    () => {
      const a = commonArgs(this.filters());
      const types = this.focus.types();
      return this.api.getMyMattersAttention(
        types.length > 0 ? types : undefined,
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

  /** Nothing needs attention and no Focus is hiding anything: one muted line, no Options (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && this.items().length === 0 && !this.focused(),
  );

  constructor() {
    this.focus.ensure();
    restoreRowFocus('my-matters-attention', () => this.loader.state() === 'ready');
    effect(() => this.states?.report('attention', this.bare() ? 'empty' : 'content'));
    effect(() => this.listed.emit(this.items().map((t) => t.taskId)));
  }

  protected readonly fact = factText;

  /** WHO, the first right-hand column: the assignee, or "No assignee" (issue #901: the same columns in every list). */
  protected who(t: MyMattersTaskItem): string {
    return t.assigneeName ?? 'No assignee';
  }

  /**
   * WHEN, the second right-hand column: the reason as a time text ("23 d overdue", "at risk", "due today", "on hold 12 d"). An unassigned task's reason is
   * the assignee column ("No assignee"), so its time text is the day it is due.
   */
  protected when(t: MyMattersTaskItem): string {
    if (this.reasonKind(t) !== 'unassigned') return factText(t);
    const day = dueDay(t, this.zone);
    return day ? `due ${dayHeading(day)}` : 'ASAP';
  }

  protected tone(t: MyMattersTaskItem): 'overdue' | 'atRisk' | 'plain' {
    const k = this.reasonKind(t);
    return k === 'overdue' ? 'overdue' : k === 'atRisk' ? 'atRisk' : 'plain';
  }

  /** The reason already says the task is at risk or on hold, so the row's pill is not drawn twice. */
  protected statusIs(t: MyMattersTaskItem): 'atRisk' | 'onHold' | '' {
    const k = this.reasonKind(t);
    return k === 'atRisk' ? 'atRisk' : k === 'onHold' ? 'onHold' : '';
  }

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

  /** The rows on screen as a list (PM v2, #879): one line per task, the reason first; the export is logged, never the data. */
  protected readonly exportRun = async (format: ExportFormat): Promise<ExportResult> => {
    const rows = this.items().map((t) => [factText(t), ...taskItemRow(t)]);
    const text = buildList(format, ['Reason', ...TASK_ITEM_HEADER], rows);
    void this.exports.log(
      'my-matters.attention',
      format,
      rows.length,
      this.focused() ? 'focus applied' : '',
    );
    return { text, rows: rows.length };
  };

  /** "View all N": the Task Queue with the filter that counts these tasks, the soonest due first. */
  protected readonly allParams = computed(() => queryToParams(this.loader.data()?.query ?? ''));
}
