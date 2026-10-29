import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  computed,
  effect,
  input,
  inject,
  Injector,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { ManagedMatters } from './managed-matters';
import {
  flagFocusReturn,
  rememberMatter,
  takeFocusReturn,
} from '../../shared/tasks/recent-choices';

/**
 * "New task" in the header of My Matters (issues #814, #900, #941): adding work starts on the first screen. The one button says "New task" and nothing else. It opens Create task with
 * the matter fixed when exactly ONE matter is chosen in the page's Matter filter (the button's name then says which: "New task for 90001-80001 Merger"); with no matter chosen it opens
 * Create task with its own matter search, so the person is asked (as before). There is no matter chooser of its own any more: the Matter dropdown of the filter bar is the one place
 * where a matter is chosen, and it limits the whole page. Create task returns to this page (`returnTo`, only an address on /my-matters is accepted there) and the focus comes back to
 * this control. Nothing is drawn without Task.Create or when the person manages no active matter, and (issue #904) not for exactly one matter either: the shell's "Create task" is then the
 * one create button and opens Create task with that matter filled in (the page tells the shell, see `CreateTaskContext`). On a phone the button sits inside the title row's Options menu
 * (`inline`).
 */
@Component({
  selector: 'mf-mm-new-task',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-flex;
    }
    :host(:empty) {
      display: none;
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
      :host {
        width: 100%;
      }
      .nt__go {
        flex: 1 1 12rem;
        width: 100%;
        min-height: 44px;
        justify-content: center;
      }
    }
  `,
  template: `
    @if (shown()) {
      <div class="nt" data-header-new-task [attr.data-new-task-inline]="inline() ? '' : null">
        <button
          type="button"
          class="mf-btn nt__go"
          [class.mf-btn--primary]="!inline()"
          data-new-task-go
          [attr.aria-label]="label()"
          [attr.title]="matterId() !== null ? label() : null"
          (click)="open(matterId())"
        >
          <i class="pi pi-plus" aria-hidden="true"></i>
          <span class="nt__text">New task</span>
        </button>
      </div>
    }
  `,
})
export class NewTaskControl {
  /** Drawn inside another menu (the phone's header menu). */
  readonly inline = input(false);
  /** The page's Matter filter: the matter New task uses when one is chosen. */
  readonly matterId = input<number | null>(null);
  private readonly managed = inject(ManagedMatters);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly shown = computed(
    () =>
      this.auth.has('Task.Create') &&
      this.managed.items().length > 0 &&
      this.managed.only() === null,
  );

  /** The chosen matter, when it is one the person manages (its name is then in the button's name). */
  protected readonly chosen = computed(() => {
    const id = this.matterId();
    return id === null ? null : (this.managed.items().find((m) => m.matterId === id) ?? null);
  });

  protected readonly label = computed(() => {
    const m = this.chosen();
    if (m) return `New task for ${m.matterRef} ${m.name}`;
    return this.matterId() === null ? 'New task' : 'New task for the chosen matter';
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
