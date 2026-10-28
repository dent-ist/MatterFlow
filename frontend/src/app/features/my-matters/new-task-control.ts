import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { ManagedMatters } from './managed-matters';
import { ActionMenu, MenuAction } from '../../shared/ui/action-menu';
import {
  flagFocusReturn,
  lastMatterId,
  rememberMatter,
  takeFocusReturn,
} from '../../shared/tasks/recent-choices';

/** How many matters the menu lists; "Another matter" opens Create task with its own matter search for the rest. */
const MENU_MAX = 25;

/**
 * "New task" in the header of My Matters (issue #814): adding work starts on the first screen, not 2,000 px down in Matter health. With a matter
 * the person used last (and still manages) the main button is "New task for <that matter>" and one click opens Create task with the matter
 * fixed; "Other matter" lists the matters they manage (their last one first) and "Another matter" opens Create task to search all of them.
 * Create task returns to this page (`returnTo`, only an address on /my-matters is accepted there) and the focus comes back to this control.
 * Nothing is drawn without Task.Create or when the person manages no active matter, and (issue #904) not for exactly one matter either: the shell's
 * "Create task" is then the one create button and opens Create task with that matter filled in (the page tells the shell, see `CreateTaskContext`).
 * With several matters the menu is one small "+ Task on a matter".
 */
@Component({
  selector: 'mf-mm-new-task',
  imports: [ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
    }
    .nt {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .nt__go {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      max-width: 100%;
      min-width: 0;
    }
    .nt__text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 639.98px) {
      :host,
      .nt {
        width: 100%;
      }
      .nt__go {
        flex: 1 1 12rem;
        min-height: 44px;
        justify-content: center;
      }
    }
  `,
  template: `
    @if (shown()) {
      <div class="nt" data-header-new-task>
        @if (last(); as l) {
          <button
            type="button"
            class="mf-btn mf-btn--primary nt__go"
            data-new-task-last
            [attr.aria-label]="'New task for ' + l.matterRef + ' ' + l.name"
            [attr.title]="'New task for ' + l.matterRef + ' ' + l.name"
            (click)="open(l.matterId)"
          >
            <i class="pi pi-plus" aria-hidden="true"></i>
            <span class="nt__text">New task for {{ l.matterRef }}</span>
          </button>
          <mf-action-menu
            label="Choose the matter for a new task"
            triggerText="Other matter"
            align="start"
            [floating]="true"
            [items]="items()"
          />
        } @else {
          <mf-action-menu
            label="Choose the matter for a new task"
            triggerText="+ Task on a matter"
            align="start"
            [floating]="true"
            [items]="items()"
          />
        }
      </div>
    }
  `,
})
export class NewTaskControl {
  private readonly managed = inject(ManagedMatters);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private readonly matters = computed(() => this.managed.items().slice(0, MENU_MAX));
  protected readonly shown = computed(
    () => this.auth.has('Task.Create') && this.matters().length > 0 && this.managed.only() === null,
  );

  /** The matter used last, when the person still manages it and it is active. */
  protected readonly last = computed(() => {
    const id = lastMatterId(this.auth.profile()?.userId ?? 0);
    return id === null ? null : (this.matters().find((m) => m.matterId === id) ?? null);
  });

  protected readonly items = computed<MenuAction[]>(() => {
    const lastId = this.last()?.matterId;
    const ordered = [...this.matters()].sort(
      (a, b) => Number(b.matterId === lastId) - Number(a.matterId === lastId),
    );
    const rows = ordered.map<MenuAction>((m) => ({
      id: `matter-${m.matterId}`,
      label: `${m.matterRef} ${m.name}`,
      icon: 'pi-plus',
      run: () => this.open(m.matterId),
    }));
    rows.push({
      id: 'another',
      label: 'Another matter...',
      icon: 'pi-search',
      separated: true,
      run: () => this.open(null),
    });
    return rows;
  });

  constructor() {
    // Back from Create task: the focus returns to this control (once), when it is on the page.
    effect(() => {
      if (this.managed.state() === 'loading') return;
      const shown = this.shown();
      untracked(() => {
        if (takeFocusReturn() && shown) {
          afterNextRender(
            () =>
              document
                .querySelector<HTMLElement>(
                  '[data-header-new-task] [data-new-task-last], [data-header-new-task] [data-overflow]',
                )
                ?.focus(),
            { injector: this.injector },
          );
        }
      });
    });
  }

  /** Create task with the matter fixed (or its own search without one); Create and Cancel come back here with the filters. */
  protected open(matterId: number | null): void {
    const userId = this.auth.profile()?.userId ?? 0;
    flagFocusReturn();
    if (matterId !== null) rememberMatter(userId, matterId);
    void this.router.navigate(['/tasks/new'], {
      queryParams:
        matterId === null ? { returnTo: this.router.url } : { matterId, returnTo: this.router.url },
    });
  }
}
