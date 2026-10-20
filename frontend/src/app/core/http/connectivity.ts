import {
  DestroyRef,
  EffectRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

/** Consecutive requests that must fail at the network level (the server is not reachable) before the banner says so, while the browser still reports "online". */
export const OFFLINE_AFTER_FAILURES = 2;
/** While the banner is up the server is asked this often whether it is back (the "Retry" button asks at once). */
export const PROBE_EVERY_MS = 15000;
/** How long "Back online." stays. */
export const BACK_ONLINE_MS = 4000;

/**
 * Whether the server can be reached (S13, #611). The browser's `online` / `offline` events, and the HTTP layer's count of consecutive
 * requests that failed at the network level, decide `offline`. When the connection returns, `recoveries` goes up once: a list or a record
 * that is showing its inline "couldn't load" state reads itself again, once (`retryWhenBackOnline`), and the banner says "Back online.".
 * Nothing is queued and nothing is retried in a loop: one automatic retry per recovery, plus the Retry button.
 */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  private readonly browserOnline = signal(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  private readonly failures = signal(0);
  private wasOffline = false;
  private backTimer: ReturnType<typeof setTimeout> | undefined;
  private probeTimer: ReturnType<typeof setInterval> | undefined;

  /** The server cannot be reached: the browser says offline, or two requests in a row failed at the network level. */
  readonly offline = computed(
    () => !this.browserOnline() || this.failures() >= OFFLINE_AFTER_FAILURES,
  );
  /** The server answered 401: the sign-in could not be verified (S14, #612). One banner with "Reload page", no toasts; it stays until the page is reloaded. */
  readonly signInFailed = signal(false);
  /** Counts reconnections; a screen showing a failed load retries once when it changes. */
  readonly recoveries = signal(0);
  /** True for a few seconds after the connection returned ("Back online."). */
  readonly backOnline = signal(false);
  /** A check (the Retry button or the timer) is running. */
  readonly checking = signal(false);

  constructor() {
    if (typeof window !== 'undefined') {
      const online = () => {
        this.failures.set(0);
        this.browserOnline.set(true);
      };
      const offline = () => this.browserOnline.set(false);
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
        this.stopProbe();
        clearTimeout(this.backTimer);
      });
    }
    effect(() => {
      const off = this.offline();
      if (this.wasOffline && !off) this.recovered();
      if (off) this.startProbe();
      else this.stopProbe();
      this.wasOffline = off;
    });
  }

  /** A request failed at the network level (no response at all). */
  unreachable(): void {
    this.failures.update((n) => n + 1);
  }

  /** A request got an answer from the server (any status): it is reachable. */
  reachable(): void {
    if (this.failures() > 0) this.failures.set(0);
  }

  /** A request was answered with 401: the server is reachable but does not accept the sign-in. */
  signInRejected(): void {
    if (this.failures() > 0) this.failures.set(0);
    this.signInFailed.set(true);
  }

  /** Asks the server whether it is back (the Retry button). Returns whether it answered. */
  async check(): Promise<boolean> {
    if (this.checking()) return !this.offline();
    this.checking.set(true);
    try {
      // Relative to the page's base, so a site hosted in a virtual directory asks its own server.
      const response = await fetch(new URL('health/live', document.baseURI).toString(), {
        cache: 'no-store',
      });
      if (response.status > 0) {
        this.failures.set(0);
        this.browserOnline.set(true);
      }
      return true;
    } catch {
      return false;
    } finally {
      this.checking.set(false);
    }
  }

  private recovered(): void {
    this.recoveries.update((n) => n + 1);
    this.backOnline.set(true);
    clearTimeout(this.backTimer);
    this.backTimer = setTimeout(() => this.backOnline.set(false), BACK_ONLINE_MS);
  }

  private startProbe(): void {
    if (this.probeTimer !== undefined) return;
    this.probeTimer = setInterval(() => void this.check(), PROBE_EVERY_MS);
  }

  private stopProbe(): void {
    if (this.probeTimer === undefined) return;
    clearInterval(this.probeTimer);
    this.probeTimer = undefined;
  }
}

/**
 * For a component that can show an inline "couldn't load" state with a Retry button: when the connection comes back, `retry` runs once if
 * `failed()` is true at that moment (a screen that loaded fine is left alone). Call it in a constructor or a field initialiser.
 */
export function retryWhenBackOnline(failed: () => boolean, retry: () => void): EffectRef {
  const connectivity = inject(Connectivity);
  let seen = connectivity.recoveries();
  return effect(() => {
    const now = connectivity.recoveries();
    if (now === seen) return;
    seen = now;
    if (untracked(failed)) untracked(retry);
  });
}
