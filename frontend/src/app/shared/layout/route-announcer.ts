import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/** How long the tab title must stay unchanged before it is announced (a record page pins its name once it has loaded). */
export const ANNOUNCE_QUIET_MS = 350;
/** The longest wait: a slow record still gets its title announced, whatever it says by then. */
export const ANNOUNCE_MAX_MS = 2000;

/**
 * Route announcement (S9a, #624): after a navigation to another page a visually hidden polite live region says the document title
 * ("Clients - MatterFlow"), so a screen-reader user hears that the page changed. Focus is never moved (focus handling, including the
 * Back rules of decision V, is the pages' and the router's own).
 *
 * Rules: the first navigation of the session (the browser announces the loaded page itself), Back/Forward (`popstate`) and navigations
 * that only change the query or fragment (tabs, filters, the activity drawer: the grids announce their own counts) say nothing. The text
 * is read from `document.title` once the title has settled, so a record page announces the record's name, not the generic route title;
 * the same title twice in a row is still announced (the region is cleared first). The text equals `document.title`.
 */
@Component({
  selector: 'mf-route-announcer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The text is bound as `textContent`, so the region holds exactly the title (no padding spaces).
  template: `<div
    class="mf-sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-route-announcer
    [textContent]="text()"
  ></div>`,
})
export class RouteAnnouncer {
  private readonly router = inject(Router);
  protected readonly text = signal('');

  private trigger: string | undefined;
  private lastPath: string | null = null;
  private quiet: ReturnType<typeof setTimeout> | undefined;
  private max: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | undefined;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationStart) this.trigger = e.navigationTrigger;
      else if (e instanceof NavigationEnd) this.ended(e.urlAfterRedirects);
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private ended(url: string): void {
    const path = url.split(/[?#]/)[0];
    const first = this.lastPath === null;
    const samePath = path === this.lastPath;
    this.lastPath = path;
    this.stop();
    if (first || samePath || this.trigger === 'popstate') return;
    this.text.set('');
    this.watchTitle();
  }

  /** Announces `document.title` when it has not changed for `ANNOUNCE_QUIET_MS`, or after `ANNOUNCE_MAX_MS` at the latest. */
  private watchTitle(): void {
    const settle = (): void => {
      this.stop();
      this.text.set(document.title);
    };
    const rearm = (): void => {
      clearTimeout(this.quiet);
      this.quiet = setTimeout(settle, ANNOUNCE_QUIET_MS);
    };
    rearm();
    this.max = setTimeout(settle, ANNOUNCE_MAX_MS);
    const titleEl = document.querySelector('title');
    if (titleEl && typeof MutationObserver === 'function') {
      this.observer = new MutationObserver(rearm);
      this.observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }

  private stop(): void {
    clearTimeout(this.quiet);
    clearTimeout(this.max);
    this.observer?.disconnect();
    this.observer = undefined;
  }
}
