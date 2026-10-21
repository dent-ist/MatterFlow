import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';

/** How long a skeleton may stand alone before it says "Still loading..." (S17, #615). One constant for every skeleton. */
export const STILL_LOADING_MS = 8000;

/**
 * The line under a skeleton that has been on screen for about 8 seconds: "Still loading... Retry" (S17, #615). Put it inside the loading
 * branch, so it starts counting when the skeleton appears and is gone when the state changes. The polite live region exists from the start
 * and gets its text once; Retry asks the page to issue the request again, hides the line and counts another 8 seconds.
 *
 *   @if (state() === 'loading') { ... skeleton ... <mf-still-loading (retry)="load()" /> }
 */
@Component({
  selector: 'mf-still-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sl" aria-live="polite" data-still-loading-region>
      @if (shown()) {
        <span class="sl__text" data-still-loading>Still loading...</span>
        <button type="button" class="mf-btn" data-still-loading-retry (click)="onRetry()">
          Retry
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .sl {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--mf-s3);
    }
    .sl:has(*) {
      padding: var(--mf-s4) var(--mf-s3);
    }
    .sl__text {
      color: var(--mf-text-muted);
    }
  `,
})
export class StillLoading {
  readonly retry = output<void>();
  protected readonly shown = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.start();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected onRetry(): void {
    this.shown.set(false);
    this.start();
    this.retry.emit();
  }

  private start(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.shown.set(true), STILL_LOADING_MS);
  }
}
