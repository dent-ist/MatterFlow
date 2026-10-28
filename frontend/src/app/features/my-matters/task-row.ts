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
 * The name a row's link has for a screen reader: the code and title the link shows, then what the lighter row left out - the matter, the priority, the
 * assignee and the one time text - so nothing a sighted person can read is lost to a person who listens (the task type is read from the badge through
 * `aria-describedby`). It starts with the visible text, as a name must (WCAG label in name).
 */
export function rowLinkName(
  t: Pick<MyMattersTaskItem, 'taskNumber' | 'title' | 'matterRef' | 'matterName' | 'priorityName'>,
  when: string,
  who = '',
): string {
  return [
    `${t.taskNumber} ${t.title}`,
    `${t.matterRef} ${t.matterName}`,
    t.priorityName ? `${t.priorityName} priority` : '',
    who,
    when,
  ]
    .filter((part) => part.length > 0)
    .join(', ');
}

/**
 * One task row of the My Matters lists (`li[mfMmTaskRow]`, epic #893 issue #897, built once for Needs my attention, Next 7 days and the Deadlines tab):
 * the task type's icon in its colour (28 px, so the colour reads), the code and the title as the one link, the matter's name as short grey text after the
 * title only where the page shows several matters, a pill only for what is unusual (High or Critical, At risk, On hold; "Normal" and "Low" are never
 * printed), and then the SAME TWO COLUMNS on the right in every list (issue #901): WHO (the assignee, or "Unassigned", muted) and WHEN (the time text:
 * the reason such as "23 d overdue", or the due day; the only coloured element of the row, red for overdue and amber for at risk). On a phone it is a card
 * (title, matter, pills, then who and when on one line, in the same order). The tooltip of the time text carries what was left out (the reason of a hold).
 * Row focus returns after Back (`rowKey`, `mfRowLink`).
 */
@Component({
  // A row is the list item itself (a list's children must be list items), so this component is an attribute on the li.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: '[mfMmTaskRow]',
  imports: [RouterLink, RowLink, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tr' },
  styles: `
    :host {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto var(--tr-who, 9rem) var(--tr-when, 9.5rem);
      grid-template-areas: 'icon main tags who when';
      column-gap: var(--mf-s2);
      align-items: center;
      min-height: 36px;
      padding: 2px 0;
      border-top: 1px solid var(--mf-border);
    }
    :host(:first-child) {
      border-top: 0;
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
    .tr__side {
      display: contents;
    }
    .tr__who {
      grid-area: who;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tr__when {
      grid-area: when;
      min-width: 0;
      overflow: hidden;
      color: var(--mf-text);
      font-variant-numeric: tabular-nums;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tr__when--overdue {
      color: var(--mf-danger);
      font-weight: 600;
    }
    .tr__when--atRisk {
      color: var(--mf-warning);
      font-weight: 600;
    }
    /* A phone: a card. Who and when sit on one line under the title, the matter and the pills, in the same order as on a wide screen (issues #923, #901);
       44 px targets. */
    @media (max-width: 639.98px) {
      :host {
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-areas:
          'icon main'
          '. tags'
          '. side';
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
      .tr__side {
        grid-area: side;
        display: flex;
        flex-wrap: wrap;
        gap: 0 var(--mf-s2);
        padding-bottom: var(--mf-s1);
        font-size: var(--mf-fs-sm);
      }
      .tr__who,
      .tr__when {
        grid-area: auto;
        overflow: visible;
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .tr__when {
        color: var(--mf-text-muted);
      }
      .tr__when--overdue,
      .tr__when--atRisk {
        font-weight: 600;
      }
      .tr__when--overdue {
        color: var(--mf-danger);
      }
      .tr__when--atRisk {
        color: var(--mf-warning);
      }
      .tr__tags {
        padding: 0 0 var(--mf-s1);
      }
    }
  `,
  template: `
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
    <span class="tr__side">
      <span class="tr__who" data-row-who>{{ who() }}</span>
      <span
        class="tr__when"
        [class.tr__when--overdue]="tone() === 'overdue'"
        [class.tr__when--atRisk]="tone() === 'atRisk'"
        data-fact
        [attr.title]="holdReason() || null"
        >{{ when() }}</span
      >
    </span>
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
  /** WHO, the first right-hand column: the assignee, or "Unassigned" (muted). */
  readonly who = input('');
  /** WHEN, the second right-hand column: the time text ("23 d overdue", "due today", "on hold 12 d", "Wed Oct 28"). */
  readonly when = input.required<string>();
  /** How loud the time text is: overdue is red and at risk amber, only where the text says so (the one coloured element of a row). */
  readonly tone = input<'overdue' | 'atRisk' | 'plain'>('plain');
  /** The time text already says the task is at risk or on hold: the pill would repeat it. */
  readonly statusIs = input<'atRisk' | 'onHold' | ''>('');

  protected readonly urgent = computed(() => isUrgentPriority(this.task()));
  protected readonly showRisk = computed(() => this.task().atRisk && this.statusIs() !== 'atRisk');
  protected readonly showHold = computed(
    () => this.task().statusCode === 'ON_HOLD' && this.statusIs() !== 'onHold',
  );
  /** Why the task is on hold: the tooltip of the time text (a long reason never crowds the row). */
  protected readonly holdReason = computed(() => this.task().onHold?.reasonName ?? '');
  protected readonly name = computed(() => rowLinkName(this.task(), this.when(), this.who()));
}
