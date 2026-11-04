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
import { LoadFilter, UsersFilters, plural, unassignedQueueParams } from './users-model';

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
    <div class="strip" role="group" aria-label="Unassigned work" data-capacity>
      @if (summary()) {
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
      }
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
    }
    .strip {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .unassigned:focus-visible,
    .menu-btn:focus-visible,
    .item:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
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
      min-height: 2.5rem;
      padding: 0 var(--mf-s3) 0 var(--mf-s2);
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
    .item .pi {
      font-size: var(--mf-icon-md);
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

  protected readonly plural = plural;
  protected readonly open = signal(false);

  protected readonly queue = computed(() => unassignedQueueParams(this.scope.queueParam()));
  protected readonly count = computed(() => this.summary()?.unassignedTasks ?? 0);
  protected readonly unassignedText = computed(() => (this.summary() ? String(this.count()) : '-'));
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
