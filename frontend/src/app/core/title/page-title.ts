import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const APP_NAME = 'MatterFlow';

/** `<page> - MatterFlow`; the bare app name when there is no page name. */
export function documentTitle(page: string | null | undefined): string {
  const name = page?.trim();
  return name ? `${name} - ${APP_NAME}` : APP_NAME;
}

/** Sets the browser tab title from the route's `title` on every navigation (UXR-01). */
@Injectable({ providedIn: 'root' })
export class MfTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(documentTitle(this.buildTitle(snapshot)));
  }
}

/**
 * Lets a detail page replace the route's generic title with the loaded record (`TSK-12 Load Jones mailbox - MatterFlow`).
 * The next navigation resets it through `MfTitleStrategy`.
 */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  private readonly title = inject(Title);

  set(page: string | null | undefined): void {
    if (page?.trim()) this.title.setTitle(documentTitle(page));
  }
}
