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
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { MatterTree } from './mm-models';
import { MmEventDialog } from './event-dialog';
import { MmTab } from './mm-scope';

interface Item {
  key: 'task' | 'event' | 'asset' | 'project';
  label: string;
  icon: string;
  hint: string;
  /** Why the item cannot be used now (it stays in the menu, greyed, with this sentence). */
  reason: string | null;
}

/**
 * "+ New" (`mf-mm-new-menu`, epic #953 UI-14): a menu button with New task, New calendar item, New asset and New project. The choice (client, matter) is carried into what opens. An
 * item the person may not use is NOT hidden: it is greyed (`aria-disabled`, still focusable) and says why in words under its name and in its description. The item that fits the
 * current tab (Calendar: the calendar item; Assets: the asset) comes first and is marked "Suggested here". New task, New asset and New project open the app's full forms with the
 * matter prefilled (they carry task types, workflows and type-specific fields); a project cannot exist without a matter, and its form asks for one. New calendar item opens a dialog.
 */
@Component({
  selector: 'mf-mm-new-menu',
  imports: [MmEventDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:mousedown)': 'outside($event)', '(keydown)': 'onKey($event)' },
  template: `
    <div class="wrap">
      <button
        type="button"
        class="go"
        id="mm-new-btn"
        data-new-menu
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        aria-controls="mm-new-menu"
        (click)="toggle()"
        (keydown)="onButtonKey($event)"
      >
        <i class="pi pi-plus" aria-hidden="true"></i><span>New</span
        ><i class="pi pi-angle-down" aria-hidden="true"></i>
      </button>
      @if (open()) {
        <ul class="menu" role="menu" id="mm-new-menu" aria-labelledby="mm-new-btn">
          @for (it of items(); track it.key; let i = $index) {
            <li role="none">
              <button
                type="button"
                role="menuitem"
                class="mi"
                [attr.data-new]="it.key"
                [attr.aria-disabled]="it.reason ? true : null"
                [attr.aria-describedby]="'mm-new-d-' + it.key"
                [attr.tabindex]="i === 0 ? 0 : -1"
                (click)="choose(it)"
              >
                <i class="pi" [class]="it.icon" aria-hidden="true"></i>
                <span class="tx">
                  <span class="nm"
                    >{{ it.label }}
                    @if (i === 0 && suggested()) {
                      <span class="sug">Suggested here</span>
                    }
                  </span>
                  <span class="ds" [id]="'mm-new-d-' + it.key">{{ it.reason ?? it.hint }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
    @if (dialog()) {
      <mf-mm-event-dialog
        [(visible)]="dialog"
        [tree]="tree()"
        [matterId]="matterId()"
        [clientId]="clientId()"
        (saved)="created.emit()"
      />
    }
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .wrap {
      position: relative;
    }
    .go {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 36px;
      padding: 0 var(--mf-s4);
      border: 1px solid var(--mf-primary);
      border-radius: var(--mf-radius-lg, 8px);
      background: var(--mf-primary);
      color: var(--mf-primary-contrast, var(--mf-surface));
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .go:hover {
      background: var(--mf-primary-hover);
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 70;
      width: 320px;
      margin: 0;
      padding: var(--mf-s2);
      list-style: none;
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-xl, 12px);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2);
    }
    .mi {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s3);
      width: 100%;
      box-sizing: border-box;
      padding: var(--mf-s2) var(--mf-s3);
      border: 0;
      border-radius: var(--mf-radius-lg, 8px);
      background: none;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .mi:hover,
    .mi:focus-visible {
      background: var(--mf-surface-alt);
    }
    .mi[aria-disabled='true'] {
      color: var(--mf-text-muted);
      cursor: not-allowed;
    }
    .mi .pi {
      margin-top: 3px;
    }
    .tx {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .nm {
      font-weight: 600;
    }
    .ds {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .sug {
      margin-left: var(--mf-s2);
      padding: 0 var(--mf-s2);
      border-radius: 999px;
      background: var(--mf-selected-bg);
      color: var(--mf-primary);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    @media (max-width: 768px) {
      :host {
        display: block;
      }
      .go {
        width: 100%;
        justify-content: center;
        min-height: 44px;
      }
      .menu {
        left: 0;
        right: 0;
        width: auto;
      }
      .mi {
        min-height: 44px;
      }
    }
  `,
})
export class MmNewMenu {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly tab = input<MmTab>('overview');
  readonly matterId = input<number | null>(null);
  readonly clientId = input<number | null>(null);
  readonly tree = input<MatterTree | null>(null);
  /** An event was created: the page reloads what shows events. */
  readonly created = output<void>();

  protected readonly open = signal(false);
  protected readonly dialog = signal(false);

  private readonly noMatters = computed(() => (this.tree()?.matterCount ?? 0) === 0);
  private readonly where = computed(() => {
    const t = this.tree();
    const m = t?.clients.flatMap((c) => c.matters).find((x) => x.matterId === this.matterId());
    if (m) return ` for ${m.name}`;
    const c = t?.clients.find((x) => x.clientId === this.clientId());
    return c ? ` for ${c.name}` : '';
  });

  protected readonly suggested = computed(
    () => this.tab() === 'calendar' || this.tab() === 'assets',
  );

  protected readonly items = computed<Item[]>(() => {
    const none = this.noMatters() ? 'You have no matters yet.' : null;
    const where = this.where();
    const all: Item[] = [
      {
        key: 'task',
        label: 'New task',
        icon: 'pi-check-square',
        hint: `A task${where || ' on one of your matters'}`,
        reason: !this.auth.has('Task.Create')
          ? 'You do not have permission to create tasks.'
          : none,
      },
      {
        key: 'event',
        label: 'New calendar item',
        icon: 'pi-calendar-plus',
        hint: `A hearing, deposition or deadline${where}`,
        reason:
          !this.auth.has('Matter.Edit') && !this.auth.has('Matter.BeManager')
            ? "Only a matter's project managers can add calendar items."
            : none,
      },
      {
        key: 'asset',
        label: 'New asset',
        icon: 'pi-box',
        hint: `An asset${where || ' on one of your matters'}`,
        reason: !this.auth.has('Asset.Create')
          ? 'You do not have permission to create assets.'
          : none,
      },
      {
        key: 'project',
        label: 'New project',
        icon: 'pi-folder',
        hint: `A project needs a matter${where ? where.replace(' for', ': ') : ''}`,
        reason: !this.auth.has('Project.Create')
          ? 'You do not have permission to create projects.'
          : none,
      },
    ];
    const first = this.tab() === 'calendar' ? 'event' : this.tab() === 'assets' ? 'asset' : null;
    return first
      ? [...all.filter((i) => i.key === first), ...all.filter((i) => i.key !== first)]
      : all;
  });

  protected toggle(): void {
    this.open.update((o) => !o);
    if (this.open()) queueMicrotask(() => this.focusItem(0));
  }

  protected outside(e: MouseEvent): void {
    if (this.open() && !this.host.contains(e.target as Node)) this.open.set(false);
  }

  private focusItem(i: number): void {
    const els = Array.from(this.host.querySelectorAll<HTMLElement>('[role=menuitem]'));
    els.forEach((el, k) => (el.tabIndex = k === i ? 0 : -1));
    els[i]?.focus();
  }

  protected onButtonKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' && !this.open()) {
      e.preventDefault();
      this.toggle();
    }
  }

  protected onKey(e: KeyboardEvent): void {
    if (!this.open() || !(e.target as HTMLElement).closest('[role=menu]')) return;
    const els = Array.from(this.host.querySelectorAll<HTMLElement>('[role=menuitem]'));
    const i = els.indexOf(document.activeElement as HTMLElement);
    const move = (to: number): void => {
      e.preventDefault();
      this.focusItem((to + els.length) % els.length);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        return move(i - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(els.length - 1);
      case 'Escape':
        e.preventDefault();
        this.open.set(false);
        queueMicrotask(() => this.host.querySelector<HTMLElement>('#mm-new-btn')?.focus());
        return;
      case 'Tab':
        this.open.set(false);
        return;
    }
  }

  protected choose(it: Item): void {
    if (it.reason) return; // stays open: the reason is read in place
    this.open.set(false);
    const matterId = this.matterId();
    const returnTo = this.router.url;
    switch (it.key) {
      case 'event':
        this.dialog.set(true);
        return;
      case 'task':
        void this.router.navigate(['/tasks/new'], {
          queryParams: matterId ? { matterId, returnTo } : { returnTo },
        });
        return;
      case 'asset':
        void this.router.navigate(['/assets/new'], {
          queryParams: matterId ? { matterId, returnTo } : { returnTo },
        });
        return;
      case 'project':
        void this.router.navigate(['/projects/new'], {
          queryParams: matterId ? { matterId, returnTo } : { returnTo },
        });
        return;
    }
  }
}
