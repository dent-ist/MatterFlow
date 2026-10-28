import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  effect,
  signal,
  input,
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

/** How many characters of the matter's name the chooser's button shows. */
const CHOOSER_NAME_MAX = 24;

/**
 * "New task" in the header of My Matters (issues #814, #900): adding work starts on the first screen, not 2,000 px down in Matter health. The main button
 * says "New task" and nothing else; with several matters a second control, "Matter: <name>", is the chooser of the matter the button uses (the one the
 * person used last, and still manages, to begin with). The chooser ONLY picks the matter for New task: it is not a page filter and changes nothing else
 * (owner decision Q6). "New task" opens Create task with that matter fixed (without a chosen matter Create task has its own matter search); "Another
 * matter..." at the end of the chooser opens Create task to search all of them. Create task returns to this page (`returnTo`, only an address on
 * /my-matters is accepted there) and the focus comes back to this control. Nothing is drawn without Task.Create or when the person manages no active
 * matter, and (issue #904) not for exactly one matter either: the shell's "Create task" is then the one create button and opens Create task with that matter
 * filled in (the page tells the shell, see `CreateTaskContext`), so a one-matter person has no chooser. On a phone the matters are listed inside the
 * title row's Options menu (`inline`); each opens Create task at once.
 */
@Component({
  selector: 'mf-mm-new-task',
  imports: [ActionMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
    }
    :host(:empty) {
      display: none;
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
    .nti__title {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .nti__list {
      display: grid;
      gap: var(--mf-s1);
      max-height: 9rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    .nti__item {
      justify-content: flex-start;
      width: 100%;
      min-height: 44px;
      font-weight: 400;
      text-align: left;
    }
    .nti__text {
      min-width: 0;
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
    @if (inline()) {
      <!-- Inside the phone's header menu: the matters as a list, no second popover. -->
      @if (shown()) {
        <div
          class="nti"
          role="group"
          aria-labelledby="nti-h"
          data-header-new-task
          data-new-task-inline
        >
          <p class="nti__title" id="nti-h">New task on a matter</p>
          <ul class="nti__list">
            @for (it of items(); track it.id) {
              <li>
                <button
                  type="button"
                  class="mf-btn nti__item"
                  data-options-pick
                  [attr.data-new-task-item]="it.id"
                  (click)="it.run()"
                >
                  <i class="pi" [class]="it.icon" aria-hidden="true"></i>
                  <span class="nti__text">{{ it.label }}</span>
                </button>
              </li>
            }
          </ul>
        </div>
      }
    } @else if (shown()) {
      <div class="nt" data-header-new-task>
        <button
          type="button"
          class="mf-btn mf-btn--primary nt__go"
          data-new-task-go
          [attr.aria-label]="
            chosen() ? 'New task for ' + chosen()!.matterRef + ' ' + chosen()!.name : 'New task'
          "
          [attr.title]="
            chosen() ? 'New task for ' + chosen()!.matterRef + ' ' + chosen()!.name : null
          "
          (click)="open(chosen()?.matterId ?? null)"
        >
          <i class="pi pi-plus" aria-hidden="true"></i>
          <span class="nt__text">New task</span>
        </button>
        <mf-action-menu
          label="Matter for New task"
          [triggerText]="chooserText()"
          align="start"
          [floating]="true"
          [items]="chooserItems()"
        />
      </div>
    }
  `,
})
export class NewTaskControl {
  /** Drawn inside another menu (the phone's header menu): the matters as a list. */
  readonly inline = input(false);
  private readonly managed = inject(ManagedMatters);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private readonly matters = computed(() => this.managed.items().slice(0, MENU_MAX));
  protected readonly shown = computed(
    () => this.auth.has('Task.Create') && this.matters().length > 0 && this.managed.only() === null,
  );

  /** The matter the person picked in the chooser this visit (`undefined`: not yet, the one used last counts). */
  private readonly picked = signal<number | null | undefined>(undefined);

  /** The matter New task uses: the one picked in the chooser, else the one used last, when the person still manages it and it is active. */
  protected readonly chosen = computed(() => {
    const picked = this.picked();
    const id = picked !== undefined ? picked : lastMatterId(this.auth.profile()?.userId ?? 0);
    return id === null ? null : (this.matters().find((m) => m.matterId === id) ?? null);
  });

  /** "Matter: <name>" (cut when long; the full name is in the list), or "Matter: choose" before one is picked. */
  protected readonly chooserText = computed(() => {
    const m = this.chosen();
    if (!m) return 'Matter: choose';
    return `Matter: ${m.name.length > CHOOSER_NAME_MAX ? `${m.name.slice(0, CHOOSER_NAME_MAX - 1)}\u2026` : m.name}`;
  });

  /** The chooser: each matter only becomes the one New task uses (nothing opens), then Another matter opens Create task with its own search. */
  protected readonly chooserItems = computed<MenuAction[]>(() => {
    const rows = this.matters().map<MenuAction>((m) => ({
      id: `matter-${m.matterId}`,
      label: `${m.matterRef} ${m.name}`,
      icon: m.matterId === this.chosen()?.matterId ? 'pi-check' : 'pi-briefcase',
      current: m.matterId === this.chosen()?.matterId,
      run: () => {
        this.picked.set(m.matterId);
        rememberMatter(this.auth.profile()?.userId ?? 0, m.matterId);
      },
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

  /** The phone's list: each matter opens Create task at once (the person's last one first). */
  protected readonly items = computed<MenuAction[]>(() => {
    const lastId = this.chosen()?.matterId;
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
              // New task itself (wide screens); on a phone the title row's Options menu holds the matters.
              (
                document.querySelector<HTMLElement>('[data-header-new-task] [data-new-task-go]') ??
                document.querySelector<HTMLElement>('[data-header-options] [data-options-trigger]')
              )?.focus(),
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
