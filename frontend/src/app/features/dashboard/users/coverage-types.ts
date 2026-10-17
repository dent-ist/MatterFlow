import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CoveragePerson } from '../../../api/generated/api-client';
import { CoverageTarget } from './coverage-drawer';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { STATUS_TEXT, TYPE_ROWS, TypeRow, namesText, notHandledBy, plural } from './coverage-model';

/** What the view needs to open the drawer (it adds the period). */
export type TypePick = Pick<CoverageTarget, 'user' | 'type' | 'count'>;

/**
 * The "By task type" orientation of Coverage (WP11, #134): one row per task type with the names of the people who completed at least one task of
 * it in the period (first 5, then "+N"), the number of people, the tasks completed and a status ("No one" neutral, "One person" amber with an
 * icon). Names are plain text in alphabetical order, never by count, so nothing ranks people; the counts per person sit only in the row's
 * details, where each opens the tasks behind it in the Coverage drawer. A real table from 561 px, cards below. The "not handled" list is limited
 * to the page scope's pod (it asks to pick a pod when the scope is all pods).
 */
@Component({
  selector: 'mf-coverage-types',
  imports: [TaskTypeIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #statusChip let-status>
      @if (status === 'none') {
        <span class="st st--none" data-status="none">
          <i class="pi pi-minus-circle" aria-hidden="true"></i>{{ statusText.none }}
        </span>
      } @else if (status === 'one') {
        <span class="st st--one" data-status="one">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>{{ statusText.one }}
        </span>
      }
    </ng-template>

    <ng-template #detail let-r="row" let-id="id">
      <div class="detail" [id]="id" data-type-detail>
        @if (r.people.length) {
          <ul class="plist" [attr.aria-label]="'People who handled ' + r.type.name">
            @for (p of r.people; track p.userId) {
              <li data-person>
                <span>{{ p.displayName }}</span>
                @if (!p.isActive) {
                  <span class="tag" data-inactive>Inactive</span>
                }
                <button
                  type="button"
                  class="count"
                  [attr.data-count-for]="p.userId + ':' + r.type.taskTypeId"
                  [attr.aria-label]="
                    p.completed +
                    ' ' +
                    r.type.name +
                    (p.completed === 1 ? ' task' : ' tasks') +
                    ' completed by ' +
                    p.displayName +
                    ': open the tasks'
                  "
                  (click)="pick(r, p)"
                >
                  {{ p.completed }}
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="none">No one completed a task of this type in this period.</p>
        }
        @if (roster(); as people) {
          <button
            type="button"
            class="mf-btn not"
            data-not-handled
            [attr.aria-expanded]="notOpen().has(r.type.taskTypeId)"
            (click)="toggleNot(r.type.taskTypeId)"
          >
            Show people in {{ scopeLabel() }} who have not handled this type
          </button>
          @if (notOpen().has(r.type.taskTypeId)) {
            @let missing = missingOf(people, r);
            @if (missing.length) {
              <ul class="plist plist--not" data-not-list>
                @for (name of missing; track $index) {
                  <li>
                    <span>{{ name }}</span>
                    <span class="zero">0<span class="sr-only"> completed</span></span>
                  </li>
                }
              </ul>
            } @else {
              <p class="none" data-not-list>
                Everyone in {{ scopeLabel() }} has handled this type in this period.
              </p>
            }
          }
        } @else {
          <p class="hint" data-pick-pod>
            Pick a pod in Scope to see who in it has not handled this type.
          </p>
        }
      </div>
    </ng-template>

    <div class="region" role="region" tabindex="0" aria-label="Task types" data-coverage-region>
      @if (!narrow()) {
        <table class="tbl" data-coverage-types-table>
          <caption class="sr-only">
            Task types, the people who completed tasks of each type
            {{
              phrase()
            }}, and how many
          </caption>
          <thead>
            <tr>
              <th scope="col" class="tog-col"><span class="sr-only">Show people</span></th>
              <th scope="col" class="type-col">Task type</th>
              <th scope="col">Handled by</th>
              <th scope="col" class="num">People</th>
              <th scope="col" class="num">Completed</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (r of visible(); track r.type.taskTypeId) {
              <tr
                data-type-row
                [attr.data-type]="r.type.taskTypeId"
                [attr.data-type-name]="r.type.name"
                [attr.data-people-count]="r.people.length"
              >
                <td class="tog-col">
                  <button
                    type="button"
                    class="tog"
                    data-toggle
                    [attr.aria-expanded]="isOpen(r)"
                    [attr.aria-controls]="isOpen(r) ? 'ct-d-' + r.type.taskTypeId : null"
                    [attr.aria-label]="'Show people who handled ' + r.type.name"
                    (click)="toggle(r)"
                  >
                    <i
                      class="pi"
                      [class]="isOpen(r) ? 'pi-chevron-down' : 'pi-chevron-right'"
                      aria-hidden="true"
                    ></i>
                  </button>
                </td>
                <th scope="row" class="type-col">
                  <span class="twrap">
                    <mf-task-type-icon [iconKey]="r.type.iconKey" size="sm" />
                    <span>{{ r.type.name }}</span>
                    @if (!r.type.isActive) {
                      <span class="tag" data-type-inactive>Inactive</span>
                    }
                  </span>
                </th>
                <td class="names" data-names>
                  @if (r.people.length) {
                    {{ names(r) }}
                  } @else {
                    <span class="muted">No one in this period</span>
                  }
                </td>
                <td class="num" data-people>{{ r.people.length }}</td>
                <td class="num" data-completed>{{ r.type.total }}</td>
                <td>
                  <ng-container
                    [ngTemplateOutlet]="statusChip"
                    [ngTemplateOutletContext]="{ $implicit: r.status }"
                  />
                </td>
              </tr>
              @if (isOpen(r)) {
                <tr class="detail-row">
                  <td></td>
                  <td colspan="5">
                    <ng-container
                      [ngTemplateOutlet]="detail"
                      [ngTemplateOutletContext]="{ row: r, id: 'ct-d-' + r.type.taskTypeId }"
                    />
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      } @else {
        <ul class="cards" aria-label="Task types" data-coverage-cards>
          @for (r of visible(); track r.type.taskTypeId) {
            <li class="card" data-type-card [attr.data-type]="r.type.taskTypeId">
              <div class="card-head">
                <span class="twrap">
                  <mf-task-type-icon [iconKey]="r.type.iconKey" size="sm" />
                  <strong>{{ r.type.name }}</strong>
                  @if (!r.type.isActive) {
                    <span class="tag">Inactive</span>
                  }
                </span>
                <ng-container
                  [ngTemplateOutlet]="statusChip"
                  [ngTemplateOutletContext]="{ $implicit: r.status }"
                />
              </div>
              <p class="facts">
                {{ plural(r.people.length, 'person', 'people') }}, {{ r.type.total }} completed
              </p>
              <button
                type="button"
                class="mf-btn card-tog"
                data-card-toggle
                [attr.aria-expanded]="isOpen(r)"
                [attr.aria-controls]="isOpen(r) ? 'cc-d-' + r.type.taskTypeId : null"
                (click)="toggle(r)"
              >
                {{ isOpen(r) ? 'Hide people' : 'Show people' }}
                <span class="sr-only"> for {{ r.type.name }}</span>
              </button>
              @if (isOpen(r)) {
                <ng-container
                  [ngTemplateOutlet]="detail"
                  [ngTemplateOutletContext]="{ row: r, id: 'cc-d-' + r.type.taskTypeId }"
                />
              }
            </li>
          }
        </ul>
      }

      @if (hidden() > 0) {
        <div class="more">
          <button type="button" class="mf-btn" data-types-more (click)="showMore()">
            Show {{ Math.min(hidden(), pageSize) }} more task
            {{ Math.min(hidden(), pageSize) === 1 ? 'type' : 'types' }}
          </button>
          <span class="muted">{{ visible().length }} of {{ rows().length }} shown</span>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .region {
      min-height: 14rem;
      max-height: calc(100vh - 22rem);
      overflow: auto;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .region {
        flex: 1 1 0;
        max-height: none;
      }
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .tbl {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: var(--mf-fs-sm);
    }
    th,
    td {
      padding: var(--mf-s2) var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
      text-align: left;
      vertical-align: top;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--mf-surface-alt);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .type-col {
      min-width: 13rem;
      font-weight: 600;
    }
    .tog-col {
      width: 2.5rem;
      padding-inline: var(--mf-s1);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .names {
      max-width: 34rem;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--mf-text-muted);
    }
    .twrap {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .tag {
      display: inline-flex;
      padding: 0 var(--mf-s1);
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
    }
    .st {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .st--none {
      color: var(--mf-text-muted);
      border: 1px solid var(--mf-border-strong);
    }
    .st--one {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
    }
    .tog,
    .count {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      cursor: pointer;
    }
    .tog {
      display: inline-grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: var(--mf-radius);
    }
    .tog:hover,
    .count:hover {
      background: var(--mf-surface-alt);
    }
    .tog:focus-visible,
    .count:focus-visible {
      outline: 3px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .detail-row > td {
      background: var(--mf-surface-alt);
    }
    .detail {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
    }
    .plist {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .plist li {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .count {
      min-width: 2rem;
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-decoration: underline;
    }
    .zero {
      color: var(--mf-text-muted);
      font-variant-numeric: tabular-nums;
    }
    .none,
    .hint {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .more {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s3);
    }
    .cards {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .card {
      display: grid;
      gap: var(--mf-s2);
      padding: var(--mf-s3);
      border-bottom: 1px solid var(--mf-border);
    }
    .card-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
    }
    .facts {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .card-tog {
      justify-self: start;
    }
  `,
})
export class CoverageTypes {
  readonly rows = input.required<TypeRow[]>();
  /** The scope's people (for "who has not handled it"); null when the scope is all pods. */
  readonly roster = input<readonly CoveragePerson[] | null>(null);
  readonly scopeLabel = input('this pod');
  readonly phrase = input('in this period');
  /** A person's count was chosen: the view opens the tasks behind it in the Coverage drawer. */
  readonly openTasks = output<TypePick>();

  /** Below 561 px each type is a card (one rendering at a time, so ids and landmarks stay unique). */
  protected readonly narrow = signal(false);

  constructor() {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 560px)');
    this.narrow.set(query.matches);
    const listener = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    query.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
  }

  protected readonly Math = Math;
  protected readonly pageSize = TYPE_ROWS;
  protected readonly statusText = STATUS_TEXT;
  protected readonly plural = plural;
  private readonly limit = signal(TYPE_ROWS);
  private readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly notOpen = signal<ReadonlySet<number>>(new Set());

  protected readonly visible = computed(() => this.rows().slice(0, this.limit()));
  protected readonly hidden = computed(() => Math.max(0, this.rows().length - this.limit()));

  protected isOpen(r: TypeRow): boolean {
    return this.expanded().has(r.type.taskTypeId);
  }

  protected toggle(r: TypeRow): void {
    this.expanded.update((s) => flip(s, r.type.taskTypeId));
  }

  protected toggleNot(typeId: number): void {
    this.notOpen.update((s) => flip(s, typeId));
  }

  protected showMore(): void {
    this.limit.update((n) => n + TYPE_ROWS);
  }

  protected names(r: TypeRow): string {
    return namesText(r);
  }

  protected missingOf(roster: readonly CoveragePerson[], r: TypeRow): string[] {
    return notHandledBy(roster, r);
  }

  protected pick(r: TypeRow, p: { userId: number; displayName: string; completed: number }) {
    this.openTasks.emit({
      user: { userId: p.userId, displayName: p.displayName },
      type: { taskTypeId: r.type.taskTypeId, name: r.type.name },
      count: p.completed,
    });
  }
}

function flip(set: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}
