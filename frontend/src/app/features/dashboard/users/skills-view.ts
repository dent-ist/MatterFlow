import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DashboardBoardClient,
  SkillsMatrix,
  SkillsPerson,
} from '../../../api/generated/api-client';
import { Clock } from '../../../core/time/clock';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { SearchBox } from '../../../shared/ui/search-box';
import { Segmented } from '../../../shared/ui/segmented';
import { Tip } from '../../../shared/ui/tip';
import { DashScope } from '../dash-scope';
import { DashSkeleton } from '../ui/dash-skeleton';
import { DashState } from '../ui/dash-state';
import {
  SkillsWindow,
  cellIndex,
  countOf,
  growthCandidates,
  stepOf,
  thinText,
} from './skills-model';

type SkillsState = 'loading' | 'ready' | 'error';

/**
 * The Skills and training view of Dashboard > Users (US-04, #1094), read from `GET /dashboard/users/skills` for the page scope (permission Dashboard.ViewUsers only). A matrix of people
 * (rows, the first column sticks) by task types (columns, the header sticks): the completed tasks of the last 3 or 12 months, always as a number, with a tint by count. A column header marks task
 * types with thin coverage (0 to 2 people with 5 or more completed in 12 months) with an icon, the word and a tooltip. Filters: name and one task type (a dropdown of its own). "Growth candidates" lists, for the
 * chosen task type, people with little experience in it who can take work now, lightest load first; a click opens the person's drawer. The same 3-month counts drive the assignee suggestions (#1088).
 * No ranking of people: this is for planning cover and training.
 */
@Component({
  selector: 'mf-skills-view',
  imports: [TaskTypeIcon, SearchBox, Segmented, Tip, Dropdown, DashSkeleton, DashState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="toolbar" aria-label="Skills controls" data-skills-toolbar>
      <ng-content />
      <mf-search-box
        class="search"
        role="search"
        inputId="sk-q"
        label="Search by name"
        placeholder="Search by name"
        [hideLabel]="true"
        [hintOnFocus]="true"
        [leadingIcon]="true"
        [compact]="true"
        [value]="q()"
        (searchChange)="q.set($event)"
      />
      <mf-dropdown
        class="typedd"
        buttonId="sk-type"
        label="Task type"
        prefix="Task type:"
        data-skills-type
        [items]="typeItems()"
        [value]="typeId() === null ? '' : '' + typeId()"
        [neutralValue]="''"
        [panelWidth]="260"
        (valueChange)="setType($event)"
      />
      <span class="grow"></span>
      <div mfSegmented role="group" aria-label="Window" data-skills-window>
        @for (w of windows; track w) {
          <button
            type="button"
            class="mf-btn"
            [attr.data-window]="w"
            [attr.aria-pressed]="window() === w"
            (click)="window.set(w)"
          >
            {{ w }} months
          </button>
        }
      </div>
      <button
        type="button"
        class="mf-btn mf-btn--icon info"
        data-skills-help
        aria-label="How to read this view"
        [mfTip]="help"
      >
        <i class="pi pi-info-circle" aria-hidden="true"></i>
      </button>
    </div>

    @switch (state()) {
      @case ('loading') {
        <mf-dash-skeleton kind="users" label="Loading skills" data-skills-loading />
      }
      @case ('error') {
        <mf-dash-state
          variant="error"
          message="The skills matrix could not be loaded."
          (retry)="load()"
        />
      }
      @default {
        @if (matrix(); as m) {
          @if (refreshFailed()) {
            <mf-dash-state variant="stale" [updated]="null" (retry)="load()" />
          }
          @if (typeId() !== null) {
            <section class="growth" aria-labelledby="sk-growth" data-growth>
              <h3 id="sk-growth" class="gh">
                <i class="pi pi-user-plus" aria-hidden="true"></i> Growth candidates for
                {{ typeName() }}
              </h3>
              @if (candidates().length === 0) {
                <p class="muted" data-growth-empty>
                  Nobody who can take work now is still building experience in this task type.
                </p>
              } @else {
                <ul class="cands">
                  @for (p of candidates(); track p.userId) {
                    <li>
                      <button
                        type="button"
                        class="cand"
                        data-growth-person
                        [attr.aria-label]="
                          p.displayName + ', ' + p.load + ' open tasks. Open details'
                        "
                        (click)="open.emit(p)"
                      >
                        <span class="avatar" aria-hidden="true">{{ p.initials }}</span>
                        {{ p.displayName }}
                        <span class="muted">{{ p.load }} open</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </section>
          }
          <div
            class="frame"
            role="region"
            tabindex="0"
            aria-label="Skills matrix, scrollable"
            data-skills-scroll
          >
            @if (shownPeople().length === 0) {
              <p class="muted empty" data-skills-empty>No people match these filters.</p>
            } @else {
              <table class="mx" data-skills-table>
                <caption class="sr-only">
                  Completed tasks by person and task type, last
                  {{
                    window()
                  }}
                  months
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="pcol">Person</th>
                    @for (t of shownTypes(); track t.taskTypeId) {
                      <th scope="col" class="tcol" [attr.data-type]="t.taskTypeId">
                        <span class="th">
                          <mf-task-type-icon [iconKey]="t.iconKey" size="sm" />
                          <span class="tn" [attr.title]="t.name">{{ t.name }}</span>
                          @if (t.isThin) {
                            <span
                              class="thin"
                              data-thin
                              role="img"
                              aria-label="Thin cover"
                              [mfTip]="thin(t.experiencedPeople)"
                              tabindex="0"
                            >
                              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                              <span class="sr-only"
                                >Thin cover. {{ thin(t.experiencedPeople) }}</span
                              >
                            </span>
                          }
                        </span>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (p of shownPeople(); track p.userId) {
                    <tr [attr.data-person]="p.userId">
                      <th scope="row" class="pcol">
                        <button
                          type="button"
                          class="link"
                          data-skills-open
                          [attr.aria-label]="p.displayName + '. Open details'"
                          (click)="open.emit(p)"
                        >
                          {{ p.displayName }}
                        </button>
                      </th>
                      @for (t of shownTypes(); track t.taskTypeId) {
                        @let n = count(p.userId, t.taskTypeId);
                        <td class="cell" [attr.data-step]="step(n)" [attr.data-count]="n">
                          @if (n === 0) {
                            <span class="num" aria-hidden="true">&ndash;</span>
                            <span class="sr-only">0</span>
                          } @else {
                            <span class="num">{{ n }}</span>
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        }
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1 1 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .bar {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s2);
    }
    /* One control height on all three views (the shared token): the search box, the switches, the dropdowns and the icon buttons are the same height. */
    .bar .mf-btn {
      min-height: var(--mf-ctl-h);
    }
    .search ::ng-deep .sb__input {
      height: var(--mf-ctl-h);
      min-height: var(--mf-ctl-h);
      padding-block: 0;
    }
    .search {
      min-width: 10rem;
      flex: 0 1 11rem;
    }
    .grow {
      flex: 1;
    }
    .fl {
      display: grid;
      gap: var(--mf-s1);
    }
    .muted {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .empty {
      padding: var(--mf-s4);
    }
    .growth {
      flex: none;
      margin-bottom: var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-lg);
    }
    .gh {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
    }
    .cands {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .cand {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 28px;
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      font: inherit;
      font-size: var(--mf-fs-sm);
      cursor: pointer;
    }
    .cand:hover {
      background: var(--mf-surface-alt);
    }
    .cand:focus-visible,
    .link:focus-visible,
    .frame:focus-visible,
    .thin:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      border: 1px solid var(--mf-primary);
      border-radius: 50%;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    /* The matrix scrolls inside its frame: the person column and the header stick. */
    .frame {
      position: relative; /* the spoken zeros are absolutely placed: this keeps them inside the scrolling frame */
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl);
      box-shadow: var(--mf-shadow-card);
    }
    .mx {
      border-collapse: separate;
      border-spacing: 0;
      font-size: var(--mf-fs-sm);
    }
    .mx th,
    .mx td {
      padding: var(--mf-s1) var(--mf-s2);
      border-bottom: 1px solid var(--mf-border-soft);
      border-right: 1px solid var(--mf-border-soft);
      background: var(--mf-surface);
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      vertical-align: bottom;
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      height: var(--mf-grid-head-h);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      letter-spacing: 0.03em;
      text-align: left;
      text-transform: uppercase;
    }
    .pcol {
      position: sticky;
      left: 0;
      z-index: 1;
      min-width: 11rem;
      max-width: 14rem;
      font-weight: 600;
      text-align: left;
      white-space: nowrap;
    }
    thead th.pcol {
      z-index: 3;
    }
    .tcol {
      min-width: 6.5rem;
      max-width: 9rem;
    }
    .th {
      display: flex;
      align-items: center;
      gap: var(--mf-s1);
      min-width: 0;
    }
    .tn {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mf-text);
    }
    .thin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
      border-radius: 50%;
    }
    .thin .pi {
      font-size: var(--mf-icon-sm);
    }
    .link {
      max-width: 13rem;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .mx td {
      box-sizing: border-box;
      height: var(--mf-grid-row-h);
    }
    .cell {
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .mx td.cell[data-step='0'] .num {
      color: var(--mf-text-muted);
    }
    .mx td.cell[data-step='1'] {
      background: var(--mf-ramp-1-bg);
      color: var(--mf-ramp-1-fg);
    }
    .mx td.cell[data-step='2'] {
      background: var(--mf-ramp-2-bg);
      color: var(--mf-ramp-2-fg);
    }
    .mx td.cell[data-step='3'],
    .mx td.cell[data-step='4'] {
      background: var(--mf-ramp-4-bg);
      color: var(--mf-ramp-4-fg);
      font-weight: 600;
    }
    .info:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    @media (max-width: 767.98px) {
      /* On a phone the page scrolls, so the frame needs its own height (a flex frame in an auto-height page collapses). */
      .frame {
        flex: none;
        max-height: 70vh;
        min-height: 16rem;
        max-width: 100%;
      }
      .pcol {
        min-width: 8rem;
      }
    }
  `,
})
export class SkillsView {
  private readonly api = inject(DashboardBoardClient);
  private readonly scope = inject(DashScope);
  private readonly clock = inject(Clock);
  private readonly destroyRef = inject(DestroyRef);

  /** A person was chosen (a name, or a growth candidate): the tab opens their drawer. */
  readonly open = output<SkillsPerson>();

  protected readonly windows = [3, 12] as const;
  protected readonly state = signal<SkillsState>('loading');
  protected readonly matrix = signal<SkillsMatrix | null>(null);
  readonly refreshFailed = signal(false);
  readonly lastOkAt = signal<number | null>(null);

  protected readonly q = signal('');
  protected readonly typeId = signal<number | null>(null);
  protected readonly window = signal<SkillsWindow>(3);

  protected readonly help =
    'Completed tasks per person and task type. A thin column has 0 to 2 people with 5 or more completed in 12 months. The same 3-month counts drive the assignee suggestions. For planning cover and training, not a ranking of people.';

  protected readonly types = computed(() => this.matrix()?.types ?? []);
  protected readonly typeItems = computed<DropdownItem[]>(() => [
    { value: '', label: 'All task types' },
    ...this.types().map((t) => ({ value: String(t.taskTypeId), label: t.name })),
  ]);
  private readonly cells = computed(() => {
    const m = this.matrix();
    return m ? cellIndex(m) : new Map();
  });
  protected readonly shownTypes = computed(() => {
    const id = this.typeId();
    return id === null ? this.types() : this.types().filter((t) => t.taskTypeId === id);
  });
  protected readonly typeName = computed(
    () => this.types().find((t) => t.taskTypeId === this.typeId())?.name ?? '',
  );
  protected readonly shownPeople = computed(() => {
    const m = this.matrix();
    if (!m) return [];
    const q = this.q().trim().toLowerCase();
    return m.people.filter((p) => q === '' || p.displayName.toLowerCase().includes(q));
  });
  protected readonly candidates = computed(() => {
    const m = this.matrix();
    const id = this.typeId();
    return m && id !== null ? growthCandidates(m, this.cells(), id) : [];
  });

  constructor() {
    effect(() => {
      this.scope.scope();
      untracked(() => this.load());
    });
  }

  protected step = stepOf;
  protected thin(n: number): string {
    return thinText(n, this.matrix()?.experiencedMin ?? 5);
  }
  protected count(userId: number, typeId: number): number {
    return countOf(this.cells(), userId, typeId, this.window());
  }
  protected setType(v: string): void {
    this.typeId.set(v === '' ? null : Number(v));
  }

  refresh(): void {
    this.load();
  }

  protected load(): void {
    const had = this.matrix() !== null;
    if (!had) this.state.set('loading');
    this.api
      .getDashboardSkills(this.scope.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => {
          this.matrix.set(m);
          this.state.set('ready');
          this.refreshFailed.set(false);
          this.lastOkAt.set(this.clock.now().getTime());
        },
        error: () => {
          if (had) this.refreshFailed.set(true);
          else this.state.set('error');
        },
      });
  }
}
