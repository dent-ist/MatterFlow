import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersClient } from '../../../api/generated/api-client';
import { RowLink, restoreRowFocus } from '../../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { factText } from '../facts';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

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
  imports: [PanelBox, RouterLink, RowLink],
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
      @if (groups().length === 0) {
        <p class="pl__empty" data-empty>Nothing needs your attention.</p>
      } @else {
        @for (g of groups(); track g.kind) {
          <section
            class="pl__group"
            [attr.data-group]="g.kind"
            [attr.aria-labelledby]="'mm-att-' + g.kind"
          >
            <h3 class="pl__sub" [id]="'mm-att-' + g.kind">
              {{ title(g.kind) }} <span class="pl__n">({{ g.total }})</span>
            </h3>
            <ul class="pl__list">
              @for (t of g.items; track t.taskId) {
                <li class="pl__row">
                  <a
                    class="pl__link"
                    data-attention-row
                    mfRowLink="my-matters-attention"
                    [rowKey]="g.kind + '-' + t.taskId"
                    [routerLink]="['/tasks', t.taskId]"
                    [queryParams]="origin.params('my-matters')"
                    [state]="origin.state()"
                    >{{ t.taskNumber }} {{ t.title }}</a
                  >
                  <span class="pl__meta">{{ t.matterRef }} {{ t.matterName }}</span>
                  <span class="pl__fact" data-fact>{{ fact(t) }}</span>
                </li>
              }
            </ul>
            <a
              class="pl__all"
              data-view-all
              routerLink="/tasks"
              [queryParams]="params(g.query)"
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

  protected readonly loader = panelLoader(
    () => this.filters(),
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersAttention(
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
    restoreRowFocus('my-matters-attention', () => this.loader.state() === 'ready');
  }

  /** Groups with something in them, in the API's order. */
  protected readonly groups = computed(() =>
    (this.loader.data()?.groups ?? []).filter((g) => g.total > 0),
  );
  protected readonly fact = factText;
  protected readonly params = queryToParams;

  protected title(kind: string): string {
    if (kind === 'stuckOnHold') {
      return `On hold more than ${this.loader.data()?.stuckOnHoldDays ?? 7} days`;
    }
    return GROUP_TITLES[kind] ?? kind;
  }
}
