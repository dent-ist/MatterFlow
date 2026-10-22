import { NgTemplateOutlet } from '@angular/common';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { NotificationService, ToastSeverity } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';

/** The most toasts on screen at once; older ones stay in the list and show again when newer ones close. */
export const MAX_VISIBLE_TOASTS = 3;

interface Item {
  readonly id: number;
  readonly severity: ToastSeverity;
  readonly summary: string;
  readonly detail?: string;
  /** The long explanation of an Undo offer: the Undo button's tooltip. */
  readonly hint?: string;
  readonly count: number;
  readonly undo: boolean;
  readonly order: number;
}

const ICONS: Record<ToastSeverity, string> = {
  success: 'pi-check-circle',
  info: 'pi-info-circle',
  warn: 'pi-exclamation-triangle',
  error: 'pi-times-circle',
};

/**
 * The one toast host of the app: bottom right, tinted by severity, with an icon and a close button (UX S16, #616). Success, info and
 * the Undo offer are announced politely (the always-present `role=status` region they are added to), warnings and errors
 * assertively (each is its own `role=alert`). The Undo offer is an action button inside the same stack.
 * Focus is never moved to a toast; the close and Undo buttons are normal buttons in the tab order.
 */
@Component({
  selector: 'mf-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #stack
      class="th"
      (mouseenter)="hold()"
      (mouseleave)="release()"
      (focusin)="hold()"
      (focusout)="release()"
    >
      <div class="th__region" role="status" aria-live="polite" data-toast-polite>
        @for (item of polite(); track item.id) {
          <ng-container *ngTemplateOutlet="row; context: { $implicit: item }" />
        }
      </div>
      @for (item of assertive(); track item.id) {
        <ng-container *ngTemplateOutlet="row; context: { $implicit: item }" />
      }
    </div>

    <ng-template #row let-item>
      <div
        class="th__toast"
        data-toast
        [attr.role]="item.severity === 'warn' || item.severity === 'error' ? 'alert' : null"
        [attr.data-severity]="item.severity"
        [attr.data-undo-toast]="item.undo ? '' : null"
        [style.order]="item.order"
      >
        <i class="th__icon" [class]="'pi ' + icon(item.severity)" aria-hidden="true"></i>
        <div class="th__body">
          <span
            class="th__summary"
            data-toast-summary
            [attr.data-undo-message]="item.undo ? '' : null"
            >{{ item.summary }}</span
          >
          @if (item.count > 1) {
            <span class="th__count" data-toast-count>x{{ item.count }}</span>
          }
          @if (item.detail) {
            <span class="th__detail" data-toast-detail>{{ item.detail }}</span>
          }
        </div>
        @if (item.undo) {
          <button
            type="button"
            class="mf-btn mf-btn--text th__action"
            data-undo
            aria-keyshortcuts="Alt+Z"
            [attr.title]="item.hint ? 'Undo (Alt+Z): ' + item.hint : 'Undo (Alt+Z)'"
            [disabled]="undo.working()"
            (click)="undo.run()"
          >
            Undo
          </button>
        }
        <button
          type="button"
          class="mf-btn mf-btn--icon th__close"
          data-toast-close
          [attr.data-undo-dismiss]="item.undo ? '' : null"
          aria-label="Dismiss"
          (click)="close(item)"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      display: contents;
    }
    .th {
      position: fixed;
      /* 16px from the right edge: clear of the grid scroll bar. It rises above a work page's pager bar (the page publishes its height). */
      right: var(--mf-s4);
      bottom: calc(var(--mf-page-footer-h, 0px) + var(--mf-s4) + env(safe-area-inset-bottom, 0px));
      z-index: 1200;
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
      width: min(26rem, calc(100vw - 2 * var(--mf-s4)));
      pointer-events: none;
    }
    /* The polite live region takes no box: all toasts are laid out as one column, in the order they came. */
    .th__region {
      display: contents;
    }
    @media (max-width: 639px) {
      .th {
        left: var(--mf-s4);
        width: auto;
      }
    }
    .th__toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--tone, var(--mf-border-strong));
      border-radius: var(--mf-radius);
      background: var(--tone-bg, var(--mf-surface));
      color: var(--mf-text);
      box-shadow: var(--mf-shadow-1);
    }
    @media (prefers-reduced-motion: no-preference) {
      .th__toast {
        animation: th-in 160ms ease-out;
      }
    }
    @keyframes th-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    [data-severity='success'] {
      --tone: var(--mf-success);
      --tone-bg: var(--mf-success-bg);
    }
    [data-severity='info'] {
      --tone: var(--mf-info);
      --tone-bg: var(--mf-info-bg);
    }
    [data-severity='warn'] {
      --tone: var(--mf-warning);
      --tone-bg: var(--mf-warning-bg);
    }
    [data-severity='error'] {
      --tone: var(--mf-danger);
      --tone-bg: var(--mf-danger-bg);
    }
    .th__icon {
      flex: none;
      margin-top: 0.2rem;
      color: var(--tone);
    }
    .th__body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      column-gap: var(--mf-s2);
      overflow-wrap: anywhere;
    }
    .th__summary {
      font-weight: 600;
    }
    .th__count {
      font-weight: 600;
      color: var(--tone);
    }
    .th__detail {
      flex-basis: 100%;
    }
    .th__action,
    .th__close {
      flex: none;
    }
  `,
})
export class ToastHost {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly stack = viewChild<ElementRef<HTMLElement>>('stack');

  constructor() {
    const destroyRef = inject(DestroyRef);
    // On a phone a page without a pager has no room under its last row for the full-width toast: publish how far the toast reaches up
    // from the bottom of the window (plus a gap) as `--mf-toast-h`; the shell pads the page by it (#754). Removed when no toast is shown.
    afterNextRender(() => {
      const el = this.stack()?.nativeElement;
      if (!el) return;
      const publish = () => {
        const reach =
          el.offsetHeight > 0 ? this.root.clientHeight - el.getBoundingClientRect().top : 0;
        if (reach > 0) this.root.style.setProperty('--mf-toast-h', `${Math.ceil(reach) + 16}px`);
        else this.root.style.removeProperty('--mf-toast-h');
      };
      const win = this.root.ownerDocument.defaultView;
      win?.addEventListener('resize', publish);
      const observer =
        typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(publish);
      observer?.observe(el);
      destroyRef.onDestroy(() => {
        observer?.disconnect();
        win?.removeEventListener('resize', publish);
        this.root.style.removeProperty('--mf-toast-h');
      });
    });
  }

  protected readonly notify = inject(NotificationService);
  protected readonly undo = inject(UndoService);

  /** Newest last; the Undo offer always shows, and takes one of the places. */
  private readonly visible = computed<Item[]>(() => {
    const offer = this.undo.current();
    const room = MAX_VISIBLE_TOASTS - (offer ? 1 : 0);
    const items: Item[] = this.notify
      .toasts()
      .slice(-room)
      .map((t) => ({ ...t, undo: false, order: t.id }));
    if (offer) {
      items.push({
        id: -offer.id,
        severity: 'success',
        summary: offer.message,
        detail: offer.detail,
        hint: offer.hint,
        count: 1,
        undo: true,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
    return items;
  });
  protected readonly polite = computed(() =>
    this.visible().filter((i) => i.severity === 'success' || i.severity === 'info'),
  );
  protected readonly assertive = computed(() =>
    this.visible().filter((i) => i.severity === 'warn' || i.severity === 'error'),
  );

  protected icon(severity: ToastSeverity): string {
    return ICONS[severity];
  }

  protected close(item: Item): void {
    if (item.undo) this.undo.dismiss();
    else this.notify.dismiss(item.id);
  }

  protected hold(): void {
    this.notify.hold();
    this.undo.hold();
  }

  protected release(): void {
    this.notify.release();
    this.undo.release();
  }

  /** Alt+Z undoes the change in the toast, so a keyboard user does not have to tab to the end of the page to reach the button. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyZ') {
      if (!this.undo.current() || this.undo.working()) return;
      event.preventDefault();
      void this.undo.run();
    }
  }
}
