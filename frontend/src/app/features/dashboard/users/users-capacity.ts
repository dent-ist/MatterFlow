import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  WorkloadSummary,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { DashScope } from '../dash-scope';
import {
  LOAD_ICONS,
  LOAD_LABELS,
  LoadFilter,
  LoadLevel,
  UsersFilters,
  capacitySegments,
  loadHelp,
  plural,
  unassignedQueueParams,
} from './users-model';

let nextId = 0;

/**
 * The capacity strip above the tiles (U1, #127): one bar stacked by load level (Idle, Light, Normal, Heavy; the width of a segment is its share of
 * the people on the board), every segment a toggle button that sets the same filter as the chip of that level, and on the right the unassigned
 * count (a link to the Task Queue within the Scope) and the Assign work menu. The menu has two entries and nothing else: "Show people who can take
 * work now" (not out of office, Idle or Light, fewest open tasks first) and "Open the unassigned queue". No automatic assignment and no ranking.
 *
 * The strip reads the board the tab already holds, so its counts equal the chips' and follow the "can take work" population and the Scope. The
 * default sort is not changed: the strip makes the heavy end visible. Meaning is never colour alone: each segment has an icon and its number
 * (when the segment is wide enough; the group's name carries all five counts).
 */
@Component({
  selector: 'mf-users-capacity',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
  template: `
    <div class="strip" role="group" [attr.aria-label]="summaryText()" data-capacity>
      <div class="bar" data-capacity-bar>
        @for (s of segments(); track s.level) {
          @if (s.count > 0) {
            <button
              type="button"
              class="seg"
              [class]="'seg seg--' + s.level.toLowerCase()"
              [attr.data-segment]="s.level.toLowerCase()"
              [style.flex-grow]="s.count"
              [attr.aria-pressed]="isOn(s.level)"
              [attr.aria-label]="'Filter: ' + s.count + ' ' + word(s.level)"
              [attr.title]="s.count + ' ' + word(s.level) + '. ' + help(s.level)"
              (click)="loadToggle.emit(key(s.level))"
            >
              <i class="pi" [class]="icons[s.level]" aria-hidden="true"></i>
              <span class="n" aria-hidden="true">{{ s.count }}</span>
            </button>
          }
        }
        @if (users().length === 0) {
          <span class="none" data-capacity-none>No people to show.</span>
        }
      </div>
      <a
        class="unassigned"
        data-summary-unassigned
        routerLink="/tasks"
        [queryParams]="queue()"
        title="Open tasks nobody has: open them in the Task Queue"
        [attr.aria-label]="plural(count(), 'unassigned task') + '. Open in the Task Queue'"
      >
        <i class="pi pi-inbox" aria-hidden="true"></i>
        <strong data-n>{{ unassignedText() }}</strong
        >&ngsp;<span>unassigned {{ count() === 1 ? 'task' : 'tasks' }}</span>
        <i class="pi pi-external-link go" aria-hidden="true"></i>
      </a>
      @if (canAssign()) {
        <div class="assign">
          <button
            type="button"
            class="mf-btn menu-btn"
            data-assign-work-menu
            aria-haspopup="menu"
            [attr.aria-expanded]="open()"
            [attr.aria-controls]="open() ? uid : null"
            (click)="toggle()"
            (keydown)="onTriggerKey($event)"
          >
            <i class="pi pi-user-plus" aria-hidden="true"></i>
            <span>Assign work</span>
            <i class="pi pi-chevron-down chev" aria-hidden="true"></i>
          </button>
          @if (open()) {
            <div
              class="menu"
              role="menu"
              aria-label="Assign work"
              data-assign-menu
              tabindex="-1"
              [id]="uid"
              (keydown)="onMenuKey($event)"
            >
              <button
                type="button"
                role="menuitem"
                class="item"
                data-menu-can-take
                (click)="pickCanTake()"
              >
                <i class="pi pi-users" aria-hidden="true"></i>
                Show people who can take work now
              </button>
              <a
                role="menuitem"
                class="item"
                data-menu-queue
                routerLink="/tasks"
                [queryParams]="queue()"
                (click)="close()"
              >
                <i class="pi pi-inbox" aria-hidden="true"></i>
                Open the unassigned queue
              </a>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    .strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .bar {
      display: flex;
      flex: 1 1 18rem;
      gap: 2px;
      min-width: 0;
      height: 22px;
    }
    .seg {
      container-type: inline-size;
      display: flex;
      flex-basis: 0;
      flex-shrink: 1;
      align-items: center;
      justify-content: center;
      gap: 4px;
      box-sizing: border-box;
      min-width: 18px;
      height: 100%;
      padding: 0;
      overflow: hidden;
      color: var(--mf-text);
      border: 1px solid var(--mf-border-strong);
      border-radius: 4px;
      font: inherit;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
      cursor: pointer;
    }
    .seg .pi {
      font-size: 0.7rem;
    }
    .seg .n {
      display: none;
      font-variant-numeric: tabular-nums;
    }
    @container (min-width: 44px) {
      .seg .n {
        display: inline;
      }
    }
    @container (max-width: 25px) {
      .seg .pi {
        display: none;
      }
    }
    /* The same tints as the tiles and chips (U7): Idle the lightest, saturated colour only for Heavy. */
    .seg--idle {
      background: color-mix(in srgb, var(--mf-success-bg) 45%, var(--mf-surface));
      border-color: var(--mf-success);
    }
    .seg--light {
      background: var(--mf-info-bg);
    }
    .seg--normal {
      background: color-mix(in srgb, var(--mf-info-bg) 55%, var(--mf-surface-alt));
    }
    .seg--heavy {
      background: var(--mf-danger-bg);
      border-color: var(--mf-danger);
      box-shadow: inset 0 0 0 1px var(--mf-danger);
    }
    .seg--heavy .pi {
      color: var(--mf-danger);
    }
    .seg:hover {
      filter: brightness(0.96);
    }
    .seg[aria-pressed='true'] {
      outline: 2px solid var(--mf-primary);
      outline-offset: 1px;
    }
    .seg[aria-pressed='true'] .n {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .seg:focus-visible,
    .unassigned:focus-visible,
    .menu-btn:focus-visible,
    .item:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .none {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .unassigned {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .unassigned .pi:first-child {
      color: var(--mf-warning);
    }
    .unassigned span {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .go {
      color: var(--mf-text-muted);
      font-size: 0.7rem;
    }
    .assign {
      position: relative;
    }
    .menu-btn {
      gap: 6px;
    }
    .chev {
      font-size: 0.7rem;
    }
    .menu {
      position: absolute;
      top: calc(100% + 2px);
      right: 0;
      z-index: 20;
      display: grid;
      min-width: 17rem;
      padding: var(--mf-s1);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      box-shadow: var(--mf-shadow-1);
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      box-sizing: border-box;
      min-height: 2rem;
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: transparent;
      border: 0;
      font: inherit;
      text-align: left;
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }
    .item:hover {
      background: var(--mf-surface-alt);
    }
    @media (max-width: 560px) {
      .bar {
        flex-basis: 100%;
      }
    }
  `,
})
export class UsersCapacity {
  private readonly scope = inject(DashScope);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly uid = `wl-assign-menu-${nextId++}`;

  readonly users = input<readonly WorkloadUser[]>([]);
  readonly summary = input<WorkloadSummary | null>(null);
  readonly filters = input.required<UsersFilters>();
  readonly thresholds = input<WorkloadThresholds | null>(null);
  readonly canAssign = input(false);

  readonly loadToggle = output<LoadFilter>();
  /** "Show people who can take work now" was chosen. */
  readonly showCanTake = output<void>();

  protected readonly icons = LOAD_ICONS;
  protected readonly plural = plural;
  protected readonly open = signal(false);

  protected readonly segments = computed(() => capacitySegments(this.users()));
  protected readonly queue = computed(() => unassignedQueueParams(this.scope.queueParam()));
  protected readonly count = computed(() => this.summary()?.unassignedTasks ?? 0);
  protected readonly unassignedText = computed(() => (this.summary() ? String(this.count()) : '-'));
  /** The group's name: every count in words (the segments' numbers are drawn only when they fit). */
  protected readonly summaryText = computed(() => {
    const segs = this.segments();
    const out = this.users().filter((u) => u.availability?.state === 'OUT_OF_OFFICE').length;
    const parts = segs.map((s) => `${s.count} ${this.word(s.level)}`);
    return `Capacity: ${parts.join(', ')}, ${out} out of office`;
  });

  protected word(level: LoadLevel): string {
    return LOAD_LABELS[level].toLowerCase();
  }

  protected key(level: LoadLevel): LoadFilter {
    return level.toLowerCase() as LoadFilter;
  }

  protected isOn(level: LoadLevel): boolean {
    return this.filters().load.includes(this.key(level));
  }

  protected help(level: LoadLevel): string {
    return loadHelp(level, this.thresholds());
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) setTimeout(() => this.items()[0]?.focus());
  }

  protected close(): void {
    this.open.set(false);
  }

  protected pickCanTake(): void {
    this.close();
    this.showCanTake.emit();
  }

  private items(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' && !this.open()) {
      event.preventDefault();
      this.toggle();
    }
  }

  protected onMenuKey(event: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.host.nativeElement.querySelector<HTMLElement>('[data-assign-work-menu]')?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') {
      this.close();
    }
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}
