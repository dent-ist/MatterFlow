import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  ElementRef,
  Injector,
  ViewContainerRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { NotificationPanel } from '../../features/notifications/notification-panel';
import type { NotificationStore } from '../../features/notifications/notification-store';

/** The badge text: 1 to 99, then "99+" (the server counts at most the newest 100). */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** The tooltip of the bell: what its number counts. */
export const COUNT_NOTE = 'Unread notifications. The overdue notices of one day count once.';

/** The bell's accessible name: "Notifications, 3 unread", "Notifications, more than 99 unread" (README section 10). */
export function bellName(count: number): string {
  return `Notifications, ${count > 99 ? 'more than 99' : count} unread`;
}

/**
 * The bell in the header next to the user menu (NT-D1 to NT-D3, #745 to #747). This file is eager and deliberately tiny: an icon button,
 * the badge, the always-present polite live region and the lazy loader. It has no HTTP and no overlay of its own. In idle time after the
 * first render (and on the first click) it loads the store with `import()`; the store owns the 30-second poll and brings the generated API
 * client with it, which must not reach the initial bundle (`initial-bundle.spec.ts`). The panel is loaded the same way on the first click.
 */
@Component({
  selector: 'mf-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nb' },
  template: `
    <button
      #trigger
      type="button"
      class="mf-btn mf-btn--icon nb__button"
      data-testid="notification-bell"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="name()"
      [attr.title]="count() > 0 ? countNote : null"
      (click)="toggle()"
    >
      <i class="pi pi-bell" aria-hidden="true"></i>
      @if (count() > 0) {
        <span class="nb__badge" data-notification-badge aria-hidden="true">{{ badge() }}</span>
      }
    </button>
    <div
      class="mf-sr-only"
      role="status"
      aria-live="polite"
      data-notification-live
      [textContent]="announcement()"
    ></div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      flex: none;
    }
    .nb__button {
      position: relative;
      min-width: var(--mf-row-h);
      min-height: var(--mf-row-h);
      color: var(--mf-text);
      border-color: transparent;
      background: transparent;
    }
    .nb__button:hover,
    .nb__button[aria-expanded='true'] {
      background: var(--mf-surface-alt);
    }
    .nb__badge {
      position: absolute;
      top: 2px;
      right: 0;
      min-width: 1.25rem;
      box-sizing: border-box;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--mf-danger);
      color: #fff;
      font-size: var(--mf-fs-xs);
      font-weight: 700;
      line-height: 1.25rem;
      text-align: center;
    }
  `,
})
export class NotificationBell {
  private readonly injector = inject(Injector);
  private readonly container = inject(ViewContainerRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly store = signal<NotificationStore | null>(null);
  private loading: Promise<NotificationStore | null> | null = null;
  private panel: ComponentRef<NotificationPanel> | null = null;
  private idleHandle: number | undefined;
  private idleIsCallback = false;
  private destroyed = false;

  protected readonly open = signal(false);
  protected readonly count = computed(() => this.store()?.unreadCount() ?? 0);
  protected readonly badge = computed(() => badgeText(this.count()));
  protected readonly name = computed(() => bellName(this.count()));
  /** What the number counts (PM v2, #884): the overdue notices of one day are one entry, as the panel and the page list them. */
  protected readonly countNote = COUNT_NOTE;
  protected readonly announcement = computed(() => this.store()?.announcement() ?? '');

  constructor() {
    afterNextRender(() => this.whenIdle(() => void this.load()));
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancelIdle();
      this.closePanel(false);
      this.store()?.stop();
    });
  }

  private whenIdle(run: () => void): void {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      this.idleIsCallback = true;
      this.idleHandle = w.requestIdleCallback(run, { timeout: 3000 });
    } else {
      this.idleIsCallback = false;
      this.idleHandle = window.setTimeout(run, 200);
    }
  }

  private cancelIdle(): void {
    if (this.idleHandle === undefined) return;
    const w = window as Window & { cancelIdleCallback?: (h: number) => void };
    if (this.idleIsCallback) w.cancelIdleCallback?.(this.idleHandle);
    else window.clearTimeout(this.idleHandle);
    this.idleHandle = undefined;
  }

  /** Loads the store once (idle time or first click) and starts its poll. A failure leaves a quiet bell; the next click tries again. */
  private load(): Promise<NotificationStore | null> {
    this.loading ??= import('../../features/notifications/notification-store')
      .then((m) => {
        if (this.destroyed) return null;
        const store = this.injector.get(m.NotificationStore);
        this.store.set(store);
        store.start();
        return store;
      })
      .catch(() => {
        this.loading = null;
        return null;
      });
    return this.loading;
  }

  protected async toggle(): Promise<void> {
    if (this.open()) {
      this.closePanel(true);
      return;
    }
    this.cancelIdle();
    this.open.set(true);
    const store = await this.load();
    if (!store || !this.open() || this.panel) {
      if (!store) this.open.set(false);
      return;
    }
    try {
      const m = await import('../../features/notifications/notification-panel');
      if (!this.open() || this.panel) return;
      const ref = this.container.createComponent(m.NotificationPanel, { injector: this.injector });
      ref.instance.closed.subscribe((restoreFocus: boolean) => this.closePanel(restoreFocus));
      ref.setInput('anchor', this.host.nativeElement);
      this.panel = ref;
    } catch {
      this.open.set(false);
    }
  }

  private closePanel(restoreFocus: boolean): void {
    this.panel?.destroy();
    this.panel = null;
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('.nb__button')?.focus();
  }
}
