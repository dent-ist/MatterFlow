import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardMine } from '../../../api/generated/api-client';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { FilterOption } from '../../../shared/filters/filter-def';
import { FilterChips } from '../../../shared/filters/filter-chips';
import { FilterControl } from '../../../shared/filters/filter-control';
import { ListFilters } from '../../../shared/filters/list-filters';
import { QueueChoices } from '../../../shared/work-queue/queue-choices';
import { ownWorkText, techFilterDefs } from '../dash-technician';

/**
 * The strip above the Technician's queue (S9): the Priority and Task type filters (the column-filter foundation: `mf-filter-control`, `mf-filter-chips`
 * and `ListFilters`, whose values live in the address as `sprio` and `stype`), the "You have N open, M overdue. Open My Work" line, and the quiet note for
 * a person who is in no pod. The Scope itself is the page-wide control in the heading row. The page reads the filters from the address and asks the Task Queue.
 * Loaded lazily (only this one variant needs it).
 */
@Component({
  selector: 'mf-dash-technician-bar',
  imports: [FilterControl, FilterChips, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" data-tech-bar>
      @if (mine(); as m) {
        <p class="own" data-own-work>
          {{ ownText() }}
          @if (canMyWork()) {
            <a routerLink="/my-work" data-my-work-link>Open My Work</a>
          }
        </p>
      }
      @if (notInPod()) {
        <p class="quiet" data-no-pod-note>You are not in a pod yet. Showing all pods.</p>
      }
      <div class="filters" role="group" aria-label="Filter the unassigned queue">
        @for (d of filters.defs(); track d.key) {
          <div class="field" [attr.data-field]="d.key">
            <span class="field-label">{{ d.label }}</span>
            <mf-filter-control [def]="d" [filters]="filters" />
          </div>
        }
      </div>
      <mf-filter-chips [filters]="filters" />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .bar {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .own,
    .quiet {
      margin: 0;
      font-size: var(--mf-fs-sm);
    }
    .quiet {
      color: var(--mf-text-muted);
    }
    /* A 24 px target even when the whole sentence fits on one line (the phone is now 343 px wide, #164). */
    .own a {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      margin-left: var(--mf-s1);
      color: var(--mf-link);
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
    }
    .field {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .field-label {
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      color: var(--mf-text-muted);
    }
    mf-filter-control {
      min-width: 9rem;
    }
  `,
})
export class DashTechnicianBar {
  private readonly lookups = inject(LookupStore);
  private readonly choices = inject(QueueChoices);

  /** The viewer's own open and overdue counts from the summary (null until it is read). */
  readonly mine = input<DashboardMine | null | undefined>(null);
  readonly canMyWork = input(false);
  /** The person is in no pod: the Scope is All pods and says why. */
  readonly notInPod = input(false);

  private readonly priorityOptions = computed<FilterOption[]>(() =>
    this.lookups.priorities().map((p) => ({
      value: String(p.id),
      label: p.label,
      ...(p.isActive ? {} : { hint: '(inactive)' }),
    })),
  );

  protected readonly filters = new ListFilters({
    defs: computed(() => techFilterDefs(this.priorityOptions(), this.choices.types())),
    screen: 'dashboard-unassigned',
    noun: 'tasks',
  });
  protected readonly ownText = computed(() => {
    const m = this.mine();
    return m ? ownWorkText(m.open, m.overdue) : '';
  });

  constructor() {
    void this.lookups.ensureLoaded();
    this.choices.ensure();
  }
}
