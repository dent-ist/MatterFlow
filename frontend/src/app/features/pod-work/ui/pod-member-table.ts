import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PodMemberLoad } from '../../../api/generated/api-client';
import { AvailabilityChip } from '../../../shared/availability/availability-chip';
import {
  RecordCard,
  RecordCardDef,
  RecordCardList,
  phoneCards,
} from '../../../shared/ui/record-card-list';

export type MemberSortKey = 'member' | 'open' | 'overdue' | 'onHold';
export interface MemberSort {
  key: MemberSortKey;
  dir: 'asc' | 'desc';
}

const NAMES: Record<MemberSortKey, string> = {
  member: 'Member',
  open: 'Open',
  overdue: 'Overdue',
  onHold: 'On hold',
};

/**
 * The next sort after a click on a heading (#568): ascending, then descending, then back to the default (alphabetical, no sort). A click on
 * another heading starts that one ascending. The viewer decides; nothing sorts by load by itself (UX principle 12).
 */
export function nextSort(current: MemberSort | null, key: MemberSortKey): MemberSort | null {
  if (current?.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

/** The name order every sort ends in: people compare by name (case and accents ignored), then by id, so equal values never shuffle. */
function byName(a: PodMemberLoad, b: PodMemberLoad): number {
  return (
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) ||
    a.userId - b.userId
  );
}

/** Sorts a copy of the loads: the chosen column (ties by name, ascending), or alphabetical when there is no sort. An inactive member sorts like any other. */
export function sortLoads(
  loads: readonly PodMemberLoad[],
  sort: MemberSort | null,
): PodMemberLoad[] {
  const out = [...loads];
  if (!sort || sort.key === 'member') {
    out.sort(byName);
    if (sort?.dir === 'desc') out.reverse();
    return out;
  }
  const sign = sort.dir === 'asc' ? 1 : -1;
  out.sort((a, b) => sign * (a[sort.key] - b[sort.key]) || byName(a, b));
  return out;
}

/** The people with open work and the idle ones (nothing open); both in the loads' order. */
export function splitLoads(loads: readonly PodMemberLoad[]): {
  working: PodMemberLoad[];
  idle: PodMemberLoad[];
} {
  return {
    working: loads.filter((m) => m.open > 0),
    idle: loads.filter((m) => m.open === 0),
  };
}

/** The bar of an Open number as a fraction of the largest load in the list (0 to 1): one neutral length, no rank, no colour. */
export function barFraction(open: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, open / max)) : 0;
}

/** "5 open, 0 overdue, 1 on hold" as the card line (the table has columns for the same three numbers). */
export function loadLine(m: Pick<PodMemberLoad, 'open' | 'overdue' | 'onHold'>): string {
  return `${m.open} open · ${m.overdue} overdue · ${m.onHold} on hold`;
}

type CardItem = { kind: 'unassigned' } | { kind: 'member'; load: PodMemberLoad } | { kind: 'fold' };

/**
 * The By member workload table (W1, #566; sort #568; phone cards #569): a table that grows with the page (no scroll box of its own). First
 * "Not assigned to a person" (the unassigned count, a way to the Unassigned tab), then the people with open work, then one folded row
 * "Show 16 members with no open work" (idle members stay one click away: they are who you assign to), whose people carry their availability.
 * Every member's row says Open (a number and a neutral bar), Overdue and On hold and offers View tasks (`aria-pressed`: the Assignee filter
 * and its address). The heading cells sort (viewer's choice, never load-first by default). Below 640 px every row is a card.
 * Workload facts, not a ranking. Takes the loads as data, so a later move into the Task Queue (#351) can reuse it.
 */
@Component({
  selector: 'mf-pod-member-table',
  imports: [AvailabilityChip, NgTemplateOutlet, RecordCard, RecordCardDef, RecordCardList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pod-member-table.scss',
  template: `
    @if (cards()) {
      <mf-record-card-list
        class="pm-cards"
        noun="members"
        label="Open work per person"
        state="ready"
        [empty]="false"
        data-members
      >
        <ng-template [mfRecordCard]="cardItems()" let-item>
          @switch (item.kind) {
            @case ('unassigned') {
              <mf-record-card
                name="Not assigned to a person"
                [activate]="showUnassignedFn"
                data-member-row="unassigned"
              >
                <span mfCardMeta class="rc-line">{{ unassigned() }} open</span>
                <span mfCardAside>
                  <button type="button" class="mf-btn pm-view" (click)="showUnassigned.emit()">
                    View tasks<span class="pm-sr"> not assigned to a person</span>
                  </button>
                </span>
              </mf-record-card>
            }
            @case ('member') {
              <mf-record-card
                [name]="item.load.displayName"
                [activate]="toggleFn(item.load.userId)"
                data-member-row
                [attr.data-user]="item.load.userId"
              >
                <span mfCardBadges>
                  @if (item.load.availability?.state === 'OUT_OF_OFFICE') {
                    <mf-availability-chip [availability]="item.load.availability" />
                  }
                </span>
                <span mfCardMeta class="rc-line">
                  {{ line(item.load) }}
                  @if (!item.load.isActive) {
                    <span class="pm-note">(inactive)</span>
                  }
                </span>
                <span mfCardAside>
                  <button
                    type="button"
                    class="mf-btn pm-view"
                    [attr.aria-pressed]="on(item.load.userId)"
                    (click)="memberToggle.emit(item.load.userId)"
                  >
                    View tasks<span class="pm-sr"> of {{ item.load.displayName }}</span>
                  </button>
                </span>
              </mf-record-card>
            }
            @default {
              <div class="pm-fold-card" data-member-fold>
                <button
                  type="button"
                  class="mf-btn pm-fold"
                  [attr.aria-expanded]="expanded()"
                  (click)="expanded.set(!expanded())"
                >
                  {{ foldLabel() }}
                </button>
                @if (outOfOffice() > 0) {
                  <span class="pm-note">{{ outOfOffice() }} out of office</span>
                }
              </div>
            }
          }
        </ng-template>
      </mf-record-card-list>
    } @else {
      <table class="pm-table" data-members>
        <caption class="pm-help">
          Open work per person. These are workload facts, not a ranking. Select a column heading to
          sort.
        </caption>
        <thead>
          <tr>
            @for (col of columns; track col.key) {
              <th
                scope="col"
                [attr.aria-sort]="ariaSort(col.key)"
                [class.pm-num]="col.key !== 'member'"
              >
                <button type="button" class="pm-sort" (click)="sortBy(col.key)">
                  {{ col.label }}
                  <i class="pi" [class]="sortIcon(col.key)" aria-hidden="true"></i>
                </button>
              </th>
            }
            <th scope="col"><span class="pm-sr">View tasks</span></th>
          </tr>
        </thead>
        <tbody>
          <tr data-member-row="unassigned">
            <th scope="row" class="pm-who"><em>Not assigned to a person</em></th>
            <td class="pm-num">{{ unassigned() }}</td>
            <td class="pm-num">
              <span aria-hidden="true">&ndash;</span><span class="pm-sr">not counted</span>
            </td>
            <td class="pm-num">
              <span aria-hidden="true">&ndash;</span><span class="pm-sr">not counted</span>
            </td>
            <td class="pm-act">
              <button type="button" class="mf-btn pm-view" (click)="showUnassigned.emit()">
                View tasks<span class="pm-sr"> not assigned to a person</span>
              </button>
            </td>
          </tr>
          @for (m of working(); track m.userId) {
            <tr data-member-row [attr.data-user]="m.userId">
              <ng-container *ngTemplateOutlet="row; context: { $implicit: m }" />
            </tr>
          }
          @if (idle().length > 0) {
            <tr data-member-fold>
              <td colspan="5" class="pm-foldrow">
                <button
                  type="button"
                  class="mf-btn pm-fold"
                  [attr.aria-expanded]="expanded()"
                  (click)="expanded.set(!expanded())"
                >
                  {{ foldLabel() }}
                </button>
                @if (outOfOffice() > 0) {
                  <span class="pm-note">{{ outOfOffice() }} out of office</span>
                }
              </td>
            </tr>
          }
        </tbody>
        @if (expanded()) {
          <tbody id="pm-idle">
            @for (m of idleSorted(); track m.userId) {
              <tr data-member-row data-idle [attr.data-user]="m.userId">
                <ng-container *ngTemplateOutlet="row; context: { $implicit: m }" />
              </tr>
            }
          </tbody>
        }
      </table>
    }
    <ng-template #row let-m>
      <th scope="row" class="pm-who">
        <button
          type="button"
          class="pm-name"
          [attr.aria-pressed]="on(m.userId)"
          (click)="memberToggle.emit(m.userId)"
        >
          {{ m.displayName }}
        </button>
        @if (!m.isActive) {
          <span class="pm-note">(inactive)</span>
        }
        @if (m.availability?.state === 'OUT_OF_OFFICE') {
          <mf-availability-chip [availability]="m.availability" />
        }
      </th>
      <td class="pm-num">
        <span class="pm-open">{{ m.open }}</span>
        <span class="pm-bar" aria-hidden="true" [style.width.rem]="bar(m.open)"></span>
      </td>
      <td class="pm-num">{{ m.overdue }}</td>
      <td class="pm-num">{{ m.onHold }}</td>
      <td class="pm-act">
        <button
          type="button"
          class="mf-btn pm-view"
          [attr.aria-pressed]="on(m.userId)"
          (click)="memberToggle.emit(m.userId)"
        >
          View tasks<span class="pm-sr"> of {{ m.displayName }}</span>
        </button>
      </td>
    </ng-template>
  `,
})
export class PodMemberTable {
  /** Every member of the pod with their numbers (and anyone else holding the pod's work), as the API sends them. */
  readonly loads = input.required<readonly PodMemberLoad[]>();
  /** Open tasks of the pod that nobody holds (the "Not assigned to a person" row). */
  readonly unassigned = input(0);
  /** The people whose tasks the grid shows (the Assignee filter): their View tasks is pressed. */
  readonly selected = input<readonly number[]>([]);

  readonly memberToggle = output<number>();
  readonly showUnassigned = output<void>();

  protected readonly columns = (Object.keys(NAMES) as MemberSortKey[]).map((key) => ({
    key,
    label: NAMES[key],
  }));
  protected readonly cards = phoneCards();
  protected readonly sort = signal<MemberSort | null>(null);
  protected readonly expanded = signal(false);

  private readonly split = computed(() => splitLoads(this.loads()));
  protected readonly working = computed(() => sortLoads(this.split().working, this.sort()));
  protected readonly idle = computed(() => this.split().idle);
  protected readonly idleSorted = computed(() => sortLoads(this.idle(), this.sort()));
  private readonly maxOpen = computed(() => Math.max(0, ...this.loads().map((m) => m.open)));
  protected readonly outOfOffice = computed(
    () => this.idle().filter((m) => m.availability?.state === 'OUT_OF_OFFICE').length,
  );

  protected readonly foldLabel = computed(() => {
    const n = this.idle().length;
    const noun = `${n} ${n === 1 ? 'member' : 'members'} with no open work`;
    return `${this.expanded() ? 'Hide' : 'Show'} ${noun}`;
  });

  protected readonly cardItems = computed<CardItem[]>(() => {
    const items: CardItem[] = [{ kind: 'unassigned' }];
    for (const load of this.working()) items.push({ kind: 'member', load });
    if (this.idle().length > 0) {
      items.push({ kind: 'fold' });
      if (this.expanded())
        for (const load of this.idleSorted()) items.push({ kind: 'member', load });
    }
    return items;
  });

  protected readonly showUnassignedFn = () => this.showUnassigned.emit();
  protected toggleFn(userId: number): () => void {
    return () => this.memberToggle.emit(userId);
  }

  protected on(userId: number): boolean {
    return this.selected().includes(userId);
  }
  protected bar(open: number): number {
    return barFraction(open, this.maxOpen()) * 6;
  }
  protected line(m: PodMemberLoad): string {
    return loadLine(m);
  }

  protected sortBy(key: MemberSortKey): void {
    this.sort.set(nextSort(this.sort(), key));
  }
  protected ariaSort(key: MemberSortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sort();
    if (s?.key !== key) return 'none';
    return s.dir === 'asc' ? 'ascending' : 'descending';
  }
  protected sortIcon(key: MemberSortKey): string {
    const s = this.sort();
    if (s?.key !== key) return 'pi-sort-alt';
    return s.dir === 'asc' ? 'pi-sort-amount-up-alt' : 'pi-sort-amount-down';
  }
}
