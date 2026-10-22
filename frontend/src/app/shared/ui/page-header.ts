import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, RouterLink, UrlTree } from '@angular/router';
import { iconForPath } from '../layout/section-icons';
import { FixedPage } from './fixed-page';

/** One step of the breadcrumb trail; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  /** Router commands (or a URL string). Omit for the current page. */
  link?: string | readonly unknown[] | UrlTree;
  /** Router state sent with the link (the Task page's list crumb asks the list to put focus back on the row, `restoreFocus`). */
  state?: Record<string, unknown>;
  /** The step is shown as plain text: the person may not open its target (a link exists only when it is reachable, #285). */
  plain?: boolean;
  /** A grey bar instead of the label (`mf-record-skeleton`: the record is still loading); `label` is ignored. */
  skeleton?: boolean;
}

/** Longest last breadcrumb step (the current page) before it is cut with an ellipsis; the full text is its tooltip and accessible name. */
export const CRUMB_MAX = 40;

/** `label` cut to `max` characters with an ellipsis as the last one; shorter text is returned as it is. */
export function truncateCrumb(label: string, max = CRUMB_MAX): string {
  const text = label.trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

/**
 * The page header of every screen (UXR-02, UXR-03; UX spec `mf-page-header`) and the one page-header contract (S20, #600). Four shapes use
 * it (mock `docs/ux/shell-review/mocks/mock-page-header.png`): A list page, B workspace page (Dashboard, My Work, Pod Work: a context
 * line, chips and tabs under the title, a scope control in the actions), C record page (`mf-record-header`, same title size) and
 * D administration page (A or B with the breadcrumb "Administration > Page").
 *
 *   Clients > Acme Corp > New matter           breadcrumb row (only on non-top-level pages, real links, `nav aria-label="Breadcrumb"`)
 *   [icon] H1 (22px / 700, 18px below 640px)   [secondary action] [Filters] [Primary action]   title row; actions right-aligned
 *   One-line context line                      optional, 13px, muted, ONE line under the title (a sentence beside a title is not allowed)
 *
 * The numbers every page shares (nothing is set per page; no new token):
 *   - H1 22px / 700 from 640px, 18px below 640px, on every page (phones included); the title box is one 36px row tall, so it does not
 *     move when the actions are taller or shorter;
 *   - the first row of the header sits 12px below the top of the main area on every page (the shell's padding is 12px on a fixed page, 24px on
 *     a page that scrolls and 16px on a phone; the header levels it), so clicking through the rail does not move the title;
 *   - actions on the right in the order `[secondary] [Filters] [primary]` (project them in that order, primary last); Filters is a header
 *     action for every list that has a Filters button, except Task Queue, My Work and Pod Work, which keep it in the toolbar because it also
 *     hosts Columns and Other filters;
 *   - a selector in the actions slot (Pod, Scope) is capped at 22rem and truncates; it never wraps the title (mark a custom control
 *     `data-ph-selector` to get the cap);
 *   - the context line is the single place for a description: `description` or the `mfDescription` slot.
 *
 * Slots: `mfTitle` (rich H1 content such as reference + name + badge; replaces `heading`), `mfActions` (put the attribute on each
 * action, secondary first and the primary action last so it sits top-right), `mfDescription` (rich context line) and the default
 * slot for anything that belongs to the header under the context line (chips, tabs).
 */
@Component({
  selector: 'mf-page-header',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ph--compact]': 'compact' },
  template: `
    <header class="ph">
      @if (crumbs().length > 0) {
        <nav class="ph__crumbs" aria-label="Breadcrumb">
          <ol>
            @for (c of crumbs(); track $index; let last = $last) {
              <li>
                @if (c.skeleton) {
                  <span class="ph__sk" aria-hidden="true" data-crumb-skeleton></span>
                } @else if (c.link && !last) {
                  <a [routerLink]="c.link" [state]="c.state">{{ c.label }}</a>
                } @else if (last && c.label.length > crumbMax) {
                  <span aria-current="page" [attr.title]="c.label" data-crumb-clamped>
                    <span aria-hidden="true">{{ cut(c.label) }}</span>
                    <span class="ph__sr">{{ c.label }}</span>
                  </span>
                } @else {
                  <span [attr.aria-current]="last ? 'page' : null">{{ c.label }}</span>
                }
              </li>
            }
          </ol>
        </nav>
      }
      <div class="ph__row">
        <h1 class="ph__title" data-page-title>
          @if (iconClass(); as ic) {
            <i class="ph__icon" [class]="ic" aria-hidden="true" data-page-icon></i>
          }
          <ng-content select="[mfTitle]">{{ heading() }}</ng-content>
        </h1>
        <div class="ph__actions" data-page-actions>
          <ng-content select="[mfActions]" />
        </div>
      </div>
      <p class="ph__desc" data-page-description [attr.title]="description() || null">
        @if (description()) {
          {{ description() }}
        }
        <ng-content select="[mfDescription]" />
      </p>
      <div class="ph__extra"><ng-content /></div>
    </header>
  `,
  styles: `
    /* The contract's numbers (see the class comment). --ph-row is the height of the title row; the main area's padding is 24px (12px on a
       fixed page: the compact rule below) and 16px on a phone, so a header that starts the page is pulled up to 12px. */
    :host {
      --ph-row: 36px;
      display: block;
      margin-bottom: var(--mf-s4);
    }
    :host(:first-child) {
      margin-top: calc(-1 * var(--mf-s3));
    }
    @media (max-width: 639.98px) {
      :host(:first-child) {
        margin-top: calc(-1 * var(--mf-s1));
      }
    }
    .ph__crumbs {
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ph__crumbs ol {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    /* Every step (link, plain text, current page) and every separator is a 24px-tall row centred on one line, so a link with its 24px
       target does not sit lower than the text beside it. */
    .ph__crumbs li {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      line-height: 1.4;
    }
    .ph__crumbs li + li::before {
      content: '>';
      margin-right: var(--mf-s2);
    }
    .ph__crumbs a {
      color: var(--mf-link);
      /* A crumb link keeps a 24 px target (WCAG 2.5.8, axe target-size, BUG-5); wrapped rows must not overlap, so the row is 24 px tall. */
      display: inline-flex;
      align-items: center;
      min-height: 24px;
    }
    .ph__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .ph__sk {
      display: inline-block;
      width: 9rem;
      max-width: 100%;
      height: 0.8em;
      border-radius: 3px;
      background: var(--mf-border);
      opacity: 0.55;
      vertical-align: baseline;
    }
    .ph__row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mf-s3);
    }
    /* H1: 22px / 700, 18px below 640px. The padding makes a one-line title exactly --ph-row tall, so its top edge is the row's top edge
       whatever the actions are. */
    .ph__title {
      margin: 0;
      min-width: 0;
      padding-block: max(0px, calc((var(--ph-row) - 1.3em) / 2));
      font-size: var(--mf-fs-h2);
      font-weight: 700;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    @media (max-width: 639.98px) {
      .ph__title {
        font-size: var(--mf-fs-h3);
      }
    }
    /* The section icon: the same one the left navigation shows, neutral, a little smaller than the text, on the baseline. */
    .ph__icon {
      margin-right: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: 0.75em;
      vertical-align: 0.04em;
      /* One em wide before the icon font has loaded as well as after, so the title does not widen when it arrives (layout shift, #756). */
      display: inline-block;
      width: 1em;
      text-align: center;
    }
    .ph__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      min-height: var(--ph-row);
      max-width: 100%;
      margin-left: auto;
    }
    /* A selector in the actions slot (Pod, Scope): 22rem at most, its text is cut, and it never takes the title's room. */
    :host ::ng-deep .ph__actions :is(select, .p-select, [data-ph-selector]),
    :host ::ng-deep .ph__actions > :has(select, .p-select, [data-ph-selector]) {
      min-width: 0;
      max-width: min(22rem, 100%);
      text-overflow: ellipsis;
    }
    /* An icon in the actions is one em wide before the icon font has loaded as well as after, so the actions do not grow by a few pixels
       (and wrap under the title on a small phone) when the font arrives (layout shift, #756). */
    :host ::ng-deep .ph__actions .pi {
      width: 1em;
      text-align: center;
    }
    /* The context line: one line under the title, 13px, muted (its whole text is the tooltip). */
    .ph__desc {
      margin: var(--mf-s1) 0 0;
      overflow: hidden;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ph__desc:empty {
      display: none;
    }
    .ph__extra:empty {
      display: none;
    }
    /*
     * Inside a fixed-header page the header is compact: the breadcrumb row, then the title and the actions on ONE row, then the context
     * line under the title, then tabs and other content. The main area's padding is 12px here, so the header needs no pull-up.
     * Only while the fixed layout is on; on phones and short windows the normal header shows.
     */
    @media (min-width: 768px) and (min-height: 561px) {
      :host(.ph--compact) {
        /* Above the toolbar and the grid under it, so the popovers of the header (Columns, the sort rule) are not painted under them. */
        position: relative;
        z-index: 8;
        margin-top: 0;
        margin-bottom: var(--mf-s2);
      }
      :host(.ph--compact) .ph {
        display: grid;
        grid-template-columns: minmax(min(100%, 12rem), 1fr) auto;
        align-items: start;
        column-gap: var(--mf-s4);
      }
      /* Row 1 belongs to the breadcrumb (empty without one) so tabs and other content always land under the title row. */
      :host(.ph--compact) .ph::before {
        content: '';
        grid-column: 1 / -1;
        grid-row: 1;
      }
      :host(.ph--compact) .ph__crumbs {
        grid-column: 1 / -1;
        grid-row: 1;
      }
      :host(.ph--compact) .ph__row {
        display: contents;
      }
      :host(.ph--compact) .ph__title {
        grid-column: 1;
        grid-row: 2;
      }
      :host(.ph--compact) .ph__desc {
        grid-column: 1 / -1;
        grid-row: 3;
      }
      :host(.ph--compact) .ph__actions {
        grid-column: 2;
        grid-row: 2;
      }
      :host(.ph--compact) .ph__extra {
        grid-column: 1 / -1;
        grid-row: 4;
      }
    }
  `,
})
export class PageHeader {
  /** Plain-text H1; use the `mfTitle` slot instead for rich content. */
  readonly heading = input('');
  readonly crumbs = input<readonly Crumb[]>([]);
  readonly description = input('');
  /**
   * PrimeIcons classes shown before the title (decorative, `aria-hidden`). Left out, it is the icon of the section the page belongs to
   * (the one in the left navigation, see `section-icons.ts`); an empty string shows none.
   */
  readonly icon = input<string | null>(null);

  protected readonly crumbMax = CRUMB_MAX;
  protected cut(label: string): string {
    return truncateCrumb(label);
  }

  /** Inside a fixed-header page (`mf-fixed-page`) the header is compact. */
  protected readonly compact = inject(FixedPage, { optional: true }) !== null;

  private readonly route = inject(ActivatedRoute);
  private readonly routePath =
    '/' + this.route.pathFromRoot.flatMap((r) => r.snapshot.url.map((s) => s.path)).join('/');
  protected readonly iconClass = computed(() => {
    const explicit = this.icon();
    return explicit === null ? iconForPath(this.routePath) : explicit;
  });
}

/**
 * Title of a record in a page header (UXR-36): the reference in monospace, then the name in regular weight, then badges, wrapping
 * cleanly with a visible gap between the parts. Put it inside the `mfTitle` slot. Pass a plain `ref`, or project an element with the
 * `mfRef` attribute (a linked, copyable `mf-matter-ref`).
 *
 *   <mf-page-header><mf-record-title mfTitle ref="00343" name="Acme Corp"><mf-active-badge .../></mf-record-title></mf-page-header>
 */
@Component({
  selector: 'mf-record-title',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[mfRef]">
      @if (ref()) {
        <span class="rt__ref" data-ref>{{ ref() }}</span>
      }
    </ng-content>
    <span class="rt__name" data-name [attr.title]="clamp() ? name() : null">{{ name() }}</span>
    <span class="rt__extra"><ng-content /></span>
  `,
  host: { '[class.rt--clamp]': 'clamp()', '[class.rt--stack]': 'stack()' },
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mf-s1) var(--mf-s3);
    }
    .rt__ref {
      font-family: var(--mf-font-mono);
      font-weight: 600;
    }
    .rt__name {
      font-weight: 400;
    }
    .rt__extra {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    /* One-line header (H1, #253): the reference and the badges keep their size, the name takes what is left and stops at two lines. */
    :host(.rt--clamp) {
      display: flex;
      flex-wrap: nowrap;
      min-width: 0;
      max-width: 100%;
    }
    :host(.rt--clamp) .rt__name {
      display: -webkit-box;
      flex: 0 1 auto;
      min-width: 4rem;
      overflow: hidden;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }
    :host(.rt--clamp) > :not(.rt__name) {
      flex: none;
    }
    /* Phones: the reference and the badges come first; the name follows on the same line when it fits, else it takes the line under them. */
    @media (max-width: 639.98px) {
      :host(.rt--clamp.rt--stack) {
        flex-wrap: wrap;
        column-gap: var(--mf-s2);
      }
      :host(.rt--clamp.rt--stack) .rt__ref {
        font-size: var(--mf-fs-lg);
      }
      :host(.rt--clamp.rt--stack) .rt__name {
        max-width: 100%;
        order: 3;
      }
      :host(.rt--clamp.rt--stack) .rt__extra {
        display: contents;
      }
      :host(.rt--clamp.rt--stack) .rt__extra > * {
        order: 2;
      }
    }
  `,
})
export class RecordTitle {
  readonly ref = input('');
  readonly name = input('');
  /** The name stops at two lines (its full text is the tooltip and stays in the document); the reference and badges keep their size. */
  readonly clamp = input(false);
  /** With `clamp`, on phones the name goes under the reference and the badges (a record that has a reference). */
  readonly stack = input(false);
}

/** The same decorative section icon for the few screens that have their own H1 instead of `mf-page-header` (403, 404, error, access pending). */
@Component({
  selector: 'mf-title-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<i [class]="icon()" aria-hidden="true" data-page-icon></i>`,
  styles: `
    :host {
      margin-right: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: 0.75em;
      vertical-align: 0.04em;
    }
  `,
})
export class TitleIcon {
  /** PrimeIcons classes, for example `pi pi-ban`. */
  readonly icon = input.required<string>();
}
