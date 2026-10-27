import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  Branding,
  applyBranding,
  currentBranding,
  onBrandingChange,
  rememberBranding,
} from './branding';

/** Where the built-in header mark lives (the same file the static `index.html` uses as the tab icon). */
export const BUILT_IN_MARK = 'favicon.svg';

/**
 * Signal facade over the branding holder (`branding.ts`) for components: the application name for the header, the state pages, the search
 * labels and the error texts, and the address of the header mark. The name is only ever bound as text, never as HTML.
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private readonly state = signal<Branding>(currentBranding());
  private readonly iconBroken = signal(false);

  /** The whole branding in force. */
  readonly branding = this.state.asReadonly();

  /** The application name (the built-in `MatterFlow` until an administrator changes it). */
  readonly appName = computed(() => this.state().appName);

  /** The header mark: the custom icon, or the built-in one when there is none or the custom one could not be loaded. */
  readonly markSrc = computed(() => {
    const url = this.state().iconUrl;
    return url && !this.iconBroken() ? url : BUILT_IN_MARK;
  });

  constructor() {
    const stop = onBrandingChange((b) => {
      this.iconBroken.set(false);
      this.state.set(b);
    });
    inject(DestroyRef).onDestroy(stop);
    this.state.set(currentBranding());
  }

  /** The custom icon could not be loaded: show the built-in mark instead of a broken image. */
  markFailed(): void {
    if (this.state().iconUrl) this.iconBroken.set(true);
  }

  /** The administrator just saved: use the new branding in this tab at once and remember it for the next visit. */
  apply(branding: Branding): void {
    applyBranding(branding);
    rememberBranding(branding);
  }
}
