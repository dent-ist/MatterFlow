import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

export const APP_NAME = 'MatterFlow';

/** `<page> - MatterFlow`; the bare app name when there is no page name. */
export function documentTitle(page: string | null | undefined): string {
  const name = page?.trim();
  return name ? `${name} - ${APP_NAME}` : APP_NAME;
}

/** Longest record text in a detail page's document title; longer text is cut with an ellipsis (the page itself shows it whole). */
export const RECORD_TITLE_MAX = 60;

/**
 * Document title of a record's detail page: `<Record text>: <Tab label>` (`00107 Hartwell & Bryce LLP: Matters`; the app name is added by
 * `documentTitle`). The tab label is the visible label without its count; the record text is cut at 60 characters in the title only.
 */
export function recordTitle(record: string, tabLabel: string): string {
  const text = record.replace(/\s+/g, ' ').trim();
  const short =
    text.length > RECORD_TITLE_MAX ? text.slice(0, RECORD_TITLE_MAX).trimEnd() + '…' : text;
  return `${short}: ${tabLabel}`;
}

/** Sets the browser tab title from the route's `title` on every navigation (UXR-01). */
@Injectable({ providedIn: 'root' })
export class MfTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  private readonly page = inject(PageTitle);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(documentTitle(this.page.pinned() ?? this.buildTitle(snapshot)));
  }
}

/**
 * Lets a detail page replace the route's generic title with the loaded record (`TSK-12 Load Jones mailbox - MatterFlow`).
 * The next navigation resets it through `MfTitleStrategy`.
 */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  private readonly title = inject(Title);

  private pinnedName: string | null = null;

  set(page: string | null | undefined): void {
    if (page?.trim()) this.title.setTitle(documentTitle(page));
  }

  /** The page name a list page keeps through query-parameter navigations ("My Work: Closed"); `unpin` when the page goes. */
  pinned(): string | null {
    return this.pinnedName;
  }

  pin(page: string): void {
    this.pinnedName = page.trim() || null;
    this.set(page);
  }

  unpin(): void {
    this.pinnedName = null;
  }
}
