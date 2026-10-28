import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyMattersTaskItem } from '../../api/generated/api-client';
import { TaskTypeBadge } from '../../shared/task-type/task-type-badge';
import { RowLink } from '../../shared/ui/row-nav';
import { TaskOriginLinks } from '../../shared/work-queue/task-origin';

/** The most urgent priority ranks (1 = Critical, 2 = High): only these are worth a pill, "Normal" and "Low" say nothing (issue #897). */
export const URGENT_PRIORITY_RANK = 2;

/** True for a High or Critical task: the one case where the row prints the priority. */
export function isUrgentPriority(t: Pick<MyMattersTaskItem, 'priorityRank'>): boolean {
  return t.priorityRank >= 1 && t.priorityRank <= URGENT_PRIORITY_RANK;
}

/**
 * The name a row's link has for a screen reader: the code and title the link shows, then what the lighter row left out - the matter, the priority and the
 * one status text - so nothing a sighted person can read is lost to a person who listens (the task type is read from the badge through `aria-describedby`).
 * It starts with the visible text, as a name must (WCAG label in name).
 */
export function rowLinkName(
  t: Pick<MyMattersTaskItem, 'taskNumber' | 'title' | 'matterRef' | 'matterName' | 'priorityName'>,
  status: string,
  lead = '',
): string {
  return [
    `${t.taskNumber} ${t.title}`,
    `${t.matterRef} ${t.matterName}`,
    t.priorityName ? `${t.priorityName} priority` : '',
    lead ? `due ${lead}` : '',
    status,
  ]
    .filter((part) => part.length > 0)
    .join(', ');
}

/**
 * One task row of the My Matters lists (`li[mfMmTaskRow]`, epic #893 issue #897, built once for Needs my attention, Next 7 days and the Deadlines tab):
 * the task type's icon in its colour (28 px, so the colour reads), the code and the title as the one link, the matter's name as short grey text after the
 * title only where the page shows several matters, a pill only for what is unusual (High or Critical, At risk, On hold; "Normal" and "Low" are never
 * printed), and ONE status text on the right in a fixed column (the reason, or the assignee). On a phone it is a card of two lines (title, then the matter,
 * the pills and the status). The tooltip of the status carries what was left out (the reason of a hold). Row focus returns after Back (`rowKey`, `mfRowLink`).
 */
@Component({
  // A row is the list item itself (a list's children must be list items), so this component is an attribute on the li.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: '[mfMmTaskRow]',
  imports: [RouterLink, RowLink, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tr', '[class.tr--lead]': 'lead().length > 0' },
  styles: `
    :host {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto var(--tr-status, 9.5rem);
      grid-template-areas: 'icon main tags status';
      column-gap: var(--mf-s2);
      align-items: center;
      min-height: 36px;
      padding: 2px 0;
      border-top: 1px solid var(--mf-border);
    }
    :host(:first-child) {
      border-top: 0;
    }
    /* A row with a leading day (Next 7 days): the day is a muted first column. */
    :host(.tr--lead) {
      grid-template-columns: 5.5rem auto minmax(0, 1fr) auto var(--tr-status, 9.5rem);
      grid-template-areas: 'lead icon main tags status';
    }
    .tr__lead {
      grid-area: lead;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    mf-task-type-badge {
      grid-area: icon;
    }
    .tr__main {
      grid-area: main;
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .tr__link {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-link);
      line-height: 24px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tr__matter {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tr__tags {
      grid-area: tags;
      display: inline-flex;
      gap: var(--mf-s1);
      align-items: center;
    }
    .tr__tags:empty {
      display: none;
    }
    .tr__pill {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong, var(--mf-border));
      border-radius: var(--mf-radius);
      color: var(--mf-text);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    .tr__pill--risk {
      border-color: var(--mf-warning-border, #b45309);
      background: var(--mf-warning-bg, #fef3c7);
      color: var(--mf-warning-text, #5c3b00);
    }
    .tr__status {
      grid-area: status;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text);
      font-variant-numeric: tabular-nums;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tr__status--overdue {
      color: var(--mf-danger);
      font-weight: 600;
    }
    .tr__status--atRisk {
      color: var(--mf-warning);
      font-weight: 600;
    }
    /* A phone: a card of two lines. The status wraps under the title instead of squeezing it (issue #923), 44 px targets. */
    @media (max-width: 639.98px) {
      :host,
      :host(.tr--lead) {
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-areas:
          'icon main'
          '. lead'
          '. tags'
          '. status';
        row-gap: 0;
        min-height: 44px;
        padding: var(--mf-s1) 0;
      }
      .tr__main {
        flex-direction: column;
        gap: 0;
      }
      .tr__link {
        display: flex;
        align-items: center;
        min-height: 44px;
        overflow: visible;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .tr__matter {
        flex: none;
        max-width: 100%;
      }
      .tr__status {
        padding-bottom: var(--mf-s1);
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .tr__status--overdue,
      .tr__status--atRisk {
        font-weight: 600;
      }
      .tr__status--overdue {
        color: var(--mf-danger);
      }
      .tr__status--atRisk {
        color: var(--mf-warning);
      }
      .tr__tags {
        padding: 0 0 var(--mf-s1);
      }
      .tr__lead {
        padding-top: 0;
      }
    }
  `,
  template: `
    @if (lead()) {
      <span class="tr__lead" data-row-day>{{ lead() }}</span>
    }
    <mf-task-type-badge
      #tt
      [large]="true"
      [iconKey]="task().taskTypeIconKey"
      [colourKey]="task().taskTypeColourKey"
      [name]="task().taskTypeName"
    />
    <span class="tr__main">
      <a
        class="tr__link"
        [attr.data-attention-row]="kind() === 'attention' ? '' : null"
        [attr.data-deadline-row]="kind() === 'deadline' ? '' : null"
        [mfRowLink]="rowScope()"
        [rowKey]="task().taskId"
        [routerLink]="['/tasks', task().taskId]"
        [queryParams]="origin.params('my-matters')"
        [state]="origin.state()"
        [attr.aria-describedby]="tt.descriptionId"
        [attr.aria-label]="name()"
        [attr.title]="task().taskNumber + ' ' + task().title"
        >{{ task().taskNumber }} {{ task().title }}</a
      >
      @if (showMatter()) {
        <span
          class="tr__matter"
          data-row-matter
          [attr.title]="task().matterRef + ' ' + task().matterName"
          >{{ task().matterName }}</span
        >
      }
    </span>
    <span class="tr__tags">
      @if (urgent()) {
        <span class="tr__pill" data-priority>{{ task().priorityName }}</span>
      }
      @if (showRisk()) {
        <span class="tr__pill tr__pill--risk" data-at-risk
          ><i class="pi pi-clock" aria-hidden="true"></i> At risk</span
        >
      }
      @if (showHold()) {
        <span class="tr__pill" data-hold-pill [attr.title]="holdReason()">On hold</span>
      }
    </span>
    <span
      class="tr__status"
      [class.tr__status--overdue]="tone() === 'overdue'"
      [class.tr__status--atRisk]="tone() === 'atRisk'"
      data-fact
      [attr.title]="holdReason() || null"
      >{{ status() }}</span
    >
  `,
})
export class MmTaskRow {
  protected readonly origin = inject(TaskOriginLinks);

  readonly task = input.required<MyMattersTaskItem>();
  /** `attention` (Needs my attention) or `deadline` (Next 7 days, the Deadlines tab): the hooks the tests and the skip links look for. */
  readonly kind = input<'attention' | 'deadline'>('deadline');
  /** The row-focus scope: where Back puts the focus (`my-matters-attention`, `my-matters-deadlines`). */
  readonly rowScope = input.required<string>();
  /** The matter's name is drawn after the title: only on a page that shows several matters (a matter named on every row says nothing). */
  readonly showMatter = input(false);
  /** The one status text of the right-hand column ("23 d overdue", "Dana Rao", "no assignee"). */
  readonly status = input.required<string>();
  /** How loud the status is: overdue is red and at risk amber, only where the status says so. */
  readonly tone = input<'overdue' | 'atRisk' | 'plain'>('plain');
  /** A short text before the icon (the due day of a deadline), muted; none draws no column. */
  readonly lead = input('');
  /** The status already says the task is at risk or on hold: the pill would repeat it. */
  readonly statusIs = input<'atRisk' | 'onHold' | ''>('');

  protected readonly urgent = computed(() => isUrgentPriority(this.task()));
  protected readonly showRisk = computed(() => this.task().atRisk && this.statusIs() !== 'atRisk');
  protected readonly showHold = computed(
    () => this.task().statusCode === 'ON_HOLD' && this.statusIs() !== 'onHold',
  );
  /** Why the task is on hold: the tooltip of the status (a long reason never crowds the row). */
  protected readonly holdReason = computed(() => this.task().onHold?.reasonName ?? '');
  protected readonly name = computed(() => rowLinkName(this.task(), this.status(), this.lead()));
}
