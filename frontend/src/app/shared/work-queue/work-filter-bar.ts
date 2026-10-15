import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LookupStore } from '../../core/lookups/lookup-store';
import {
  ALL_STATUSES,
  BUILT_IN_VIEWS,
  BuiltInViewKey,
  ChipNames,
  FilterChip,
  QueueFilters,
  ViewContext,
  activeBuiltIn,
  buildChips,
  filterCount,
} from './queue-filters';
import { NgTemplateOutlet } from '@angular/common';
import { DateInput } from 'form-engine';
import { SearchBox } from '../ui/search-box';

export { SEARCH_DEBOUNCE_MS } from '../ui/search-box';

export interface PodOption {
  id: number;
  name: string;
}

/**
 * Search, quick views, filter panel and removable chips shared by Task Queue, My Work and Pod Work (UX 5.2, S03). It never owns the
 * state: every change is emitted as a whole `QueueFilters` and the page writes it to the URL, which is the single source of truth.
 */
@Component({
  selector: 'mf-work-filter-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateInput, NgTemplateOutlet, SearchBox],
  styleUrl: './work-filter-bar.scss',
  template: `
    <div class="fb">
      <ng-template #searchTpl>
        <mf-search-box
          class="fb-search"
          role="search"
          inputId="fb-q"
          label="Search title or ref"
          placeholder="Search title or ref"
          [hideLabel]="true"
          [hintOnFocus]="true"
          [value]="filters().q"
          (searchChange)="update({ q: $event })"
        />
      </ng-template>
      <ng-template #filtersTpl>
        <button
          type="button"
          class="mf-btn fb-button"
          [attr.aria-controls]="open() ? 'fb-panel' : null"
          [attr.aria-expanded]="open()"
          (click)="open.set(!open())"
        >
          <i class="pi pi-filter" aria-hidden="true"></i>
          Filters
          @if (count() > 0) {
            <span class="fb-count" data-filter-count>({{ count() }})</span>
          }
        </button>
      </ng-template>
      <ng-template #endTpl><ng-content select="[fb-end]" /></ng-template>

      @if (hasTabs()) {
        <div class="fb-tabrow">
          <div class="fb-tabs"><ng-content select="[fb-tabs]" /></div>
          <ng-container *ngTemplateOutlet="searchTpl" />
        </div>
      }
      <div class="fb-row">
        @if (!hasTabs()) {
          <ng-container *ngTemplateOutlet="searchTpl" />
        }
        <ng-container *ngTemplateOutlet="filtersTpl" />
        <div class="fb-end"><ng-container *ngTemplateOutlet="endTpl" /></div>
      </div>

      @if (showViews()) {
        <div class="fb-views" role="group" aria-label="Quick views">
          @for (view of views; track view.key) {
            <button
              type="button"
              class="fb-view"
              [attr.aria-pressed]="activeView() === view.key"
              [disabled]="view.key === 'myPod' && !viewContext().primaryPodId"
              [title]="
                view.key === 'myPod' && !viewContext().primaryPodId
                  ? 'You have no primary Pod'
                  : null
              "
              (click)="viewSelect.emit(view.key)"
            >
              {{ view.label }}
            </button>
          }
        </div>
      }

      @if (open()) {
        <div id="fb-panel" class="fb-panel" role="group" aria-label="Filters">
          @if (!hidden().includes('status')) {
            <fieldset class="fb-fieldset">
              <legend>Status</legend>
              @for (code of statuses; track code) {
                <label class="fb-check">
                  <input
                    type="checkbox"
                    [checked]="filters().status.includes(code)"
                    (change)="toggleStatus(code)"
                  />
                  {{ lookups.statusLabel(code) }}
                </label>
              }
            </fieldset>
          }
          <fieldset class="fb-fieldset">
            <legend>Priority</legend>
            @for (p of lookups.priorities(); track p.id) {
              <label class="fb-check">
                <input
                  type="checkbox"
                  [checked]="filters().priority.includes(p.id)"
                  (change)="togglePriority(p.id)"
                />
                {{ p.label }}
              </label>
            }
          </fieldset>
          @if (!hidden().includes('pod')) {
            <div class="fb-field">
              <label for="fb-pod">Pod</label>
              <select
                id="fb-pod"
                class="mf-control fb-input"
                [value]="podValue()"
                (change)="setPod($any($event.target).value)"
              >
                <option value="">Any pod</option>
                <option value="none" [selected]="podValue() === 'none'">No pod</option>
                @for (pod of pods(); track pod.id) {
                  <option [value]="pod.id" [selected]="filters().pod[0] === pod.id">
                    {{ pod.name }}
                  </option>
                }
              </select>
            </div>
          }
          @if (!hidden().includes('assignee')) {
            <div class="fb-field">
              <label for="fb-assignee">Assignee</label>
              <select
                id="fb-assignee"
                class="mf-control fb-input"
                [value]="assigneeValue()"
                (change)="setAssignee($any($event.target).value)"
              >
                <option value="any">Anyone</option>
                <option value="me">Me</option>
                <option value="unassigned">Unassigned</option>
                @if (assigneeValue() === 'other') {
                  <option value="other">Other person (see chips)</option>
                }
              </select>
            </div>
          }
          <div class="fb-field">
            <label for="fb-asap">ASAP</label>
            <select
              id="fb-asap"
              class="mf-control fb-input"
              [value]="triState(filters().asap)"
              (change)="update({ asap: fromTriState($any($event.target).value) })"
            >
              <option value="any">Any</option>
              <option value="yes">ASAP only</option>
              <option value="no">Has a due date</option>
            </select>
          </div>
          <div class="fb-field">
            <label for="fb-overdue">Overdue</label>
            <select
              id="fb-overdue"
              class="mf-control fb-input"
              [value]="triState(filters().overdue)"
              (change)="update({ overdue: fromTriState($any($event.target).value) })"
            >
              <option value="any">Any</option>
              <option value="yes">Overdue only</option>
              <option value="no">Not overdue</option>
            </select>
          </div>
          <div class="fb-field">
            <label for="fb-due-from">Due from</label>
            <mf-date-input
              inputId="fb-due-from"
              label="due from"
              [commitOnly]="true"
              [isoValue]="filters().dueFrom ?? null"
              (isoChange)="update({ dueFrom: $event })"
            />
          </div>
          <div class="fb-field">
            <label for="fb-due-to">Due to</label>
            <mf-date-input
              inputId="fb-due-to"
              label="due to"
              [commitOnly]="true"
              [isoValue]="filters().dueTo ?? null"
              (isoChange)="update({ dueTo: $event })"
            />
          </div>
          <div class="fb-field">
            <label for="fb-created-from">Created from</label>
            <mf-date-input
              inputId="fb-created-from"
              label="created from"
              [commitOnly]="true"
              [isoValue]="filters().createdFrom ?? null"
              (isoChange)="update({ createdFrom: $event })"
            />
          </div>
          <div class="fb-field">
            <label for="fb-created-to">Created to</label>
            <mf-date-input
              inputId="fb-created-to"
              label="created to"
              [commitOnly]="true"
              [isoValue]="filters().createdTo ?? null"
              (isoChange)="update({ createdTo: $event })"
            />
          </div>
        </div>
      }

      @if (chips().length > 0) {
        <ul class="fb-chips" aria-label="Active filters">
          @for (chip of chips(); track chip.key) {
            <li class="fb-chip">
              <span>{{ chip.label }}</span>
              <button
                type="button"
                class="fb-chip-x"
                [attr.aria-label]="'Remove filter ' + chip.label"
                (click)="removeChip(chip)"
              >
                <i class="pi pi-times" aria-hidden="true"></i>
              </button>
            </li>
          }
          <li>
            <button type="button" class="mf-btn mf-btn--text fb-clear" (click)="clearAll.emit()">
              Clear all filters
            </button>
          </li>
        </ul>
      }
    </div>
  `,
})
export class WorkFilterBar {
  protected readonly lookups = inject(LookupStore);

  readonly filters = input.required<QueueFilters>();
  readonly names = input.required<ChipNames>();
  readonly pods = input<readonly PodOption[]>([]);
  readonly userId = input<number | null>(null);
  readonly viewContext = input<ViewContext>({ userId: null, primaryPodId: null, recentFrom: '' });
  readonly showViews = input(false);
  /** True when the page projects `mf-work-tabs` (`fb-tabs`): the tabs share a row with the search box. */
  readonly hasTabs = input(false);
  /**
   * The status set the page starts on ("All open" on the Task Queue). While the status filter equals it, it is not shown as a chip
   * and not counted, and "Clear all filters" only appears once something else is set (UXR-10).
   */
  readonly defaultStatus = input<readonly string[]>([]);
  /** Parts of the panel to leave out: `status`, `pod`, `assignee`. */
  readonly hidden = input<readonly string[]>([]);

  readonly filtersChange = output<QueueFilters>();
  readonly viewSelect = output<BuiltInViewKey>();
  readonly clearAll = output<void>();

  protected readonly open = signal(false);
  protected readonly views = BUILT_IN_VIEWS;
  protected readonly statuses = ALL_STATUSES;
  /** True while the status filter is the page's default, which is then shown quietly or not at all. */
  private readonly quietStatus = computed(() => {
    const wanted = this.defaultStatus();
    const current = this.filters().status;
    return (
      wanted.length > 0 &&
      wanted.length === current.length &&
      wanted.every((code) => current.includes(code))
    );
  });
  protected readonly count = computed(
    () => filterCount(this.filters()) - (this.quietStatus() ? 1 : 0),
  );
  protected readonly chips = computed(() =>
    buildChips(this.filters(), this.names()).filter(
      (chip) => !(this.quietStatus() && chip.key.startsWith('status:')),
    ),
  );
  protected readonly activeView = computed(() =>
    this.showViews() ? activeBuiltIn(this.filters(), this.viewContext()) : null,
  );
  protected readonly podValue = computed(() => {
    const f = this.filters();
    if (f.pod.length) return String(f.pod[0]);
    return f.noPod ? 'none' : '';
  });
  protected readonly assigneeValue = computed(() => {
    const f = this.filters();
    if (f.unassigned && f.assignee.length === 0) return 'unassigned';
    const me = this.userId();
    if (!f.unassigned && f.assignee.length === 1 && me !== null && f.assignee[0] === me) {
      return 'me';
    }
    return f.assignee.length > 0 || f.unassigned ? 'other' : 'any';
  });

  constructor() {
    void this.lookups.ensureLoaded();
  }

  protected update(patch: Partial<QueueFilters>): void {
    const next = { ...this.filters(), ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.filters())) return;
    this.filtersChange.emit(next);
  }

  protected toggleStatus(code: string): void {
    const f = this.filters();
    this.update({
      status: f.status.includes(code) ? f.status.filter((s) => s !== code) : [...f.status, code],
    });
  }

  protected togglePriority(id: number): void {
    const f = this.filters();
    this.update({
      priority: f.priority.includes(id) ? f.priority.filter((p) => p !== id) : [...f.priority, id],
    });
  }

  protected setPod(value: string): void {
    if (value === 'none') this.update({ pod: [], noPod: true });
    else this.update({ pod: value ? [Number(value)] : [], noPod: false });
  }

  protected setAssignee(value: string): void {
    const me = this.userId();
    if (value === 'unassigned') this.update({ assignee: [], unassigned: true });
    else if (value === 'me' && me !== null) this.update({ assignee: [me], unassigned: false });
    else if (value === 'any') this.update({ assignee: [], unassigned: false });
  }

  protected triState(value: boolean | null): string {
    return value === null ? 'any' : value ? 'yes' : 'no';
  }

  protected fromTriState(value: string): boolean | null {
    return value === 'yes' ? true : value === 'no' ? false : null;
  }

  protected removeChip(chip: FilterChip): void {
    this.filtersChange.emit(chip.remove(this.filters()));
  }
}
