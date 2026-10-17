import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, RouterLink, UrlTree } from '@angular/router';
import { iconForPath } from '../layout/section-icons';
import { FixedPage } from './fixed-page';

/** One step of the breadcrumb trail; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  /** Router commands (or a URL string). Omit for the current page. */
  link?: string | readonly unknown[] | UrlTree;
}

/**
 * The page header of every screen (UXR-02, UXR-03; UX spec `mf-page-header`):
 *
 *   Clients > Acme Corp > New matter           breadcrumb row (only on non-top-level pages, real links, `nav aria-label="Breadcrumb"`)
 *   H1 (28px)                                  [secondary action]  [Primary action]   title row; actions right-aligned
 *   One-line description                       optional
 *
 * Slots: `mfTitle` (rich H1 content such as reference + name + badge; replaces `heading`), `mfActions` (put the attribute on each
 * action, secondary first and the primary action last so it sits top-right), `mfDescription` (rich description) and the default
 * slot for anything that belongs to the header under the description (a "Matter: ..." line, tabs, a pod picker).
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
                @if (c.link && !last) {
                  <a [routerLink]="c.link">{{ c.label }}</a>
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
    :host {
      display: block;
      margin-bottom: var(--mf-s4);
    }
    .ph__crumbs {
      margin: 0 0 var(--mf-s1);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .ph__crumbs ol {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ph__crumbs li + li::before {
      content: '>';
      margin-right: var(--mf-s2);
    }
    .ph__crumbs a {
      color: var(--mf-link);
    }
    .ph__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
    }
    .ph__title {
      margin: 0;
      font-size: var(--mf-fs-h1);
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    /* The section icon: the same one the left navigation shows, neutral, a little smaller than the text, on the baseline. */
    .ph__icon {
      margin-right: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: 0.75em;
      vertical-align: 0.04em;
    }
    .ph__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .ph__desc {
      margin: var(--mf-s1) 0 0;
      color: var(--mf-text-muted);
    }
    .ph__desc:empty {
      display: none;
    }
    .ph__extra:empty {
      display: none;
    }
    /*
     * Inside a fixed-header page the header is compact (title, one-line description and actions on ONE row, so the grid keeps its height):
     * the description sits beside the title and is cut off with an ellipsis (its full text is the tooltip), tabs and other content
     * go below. Only while the fixed layout is on; on phones and short windows the normal header shows.
     */
    @media (min-width: 768px) and (min-height: 561px) {
      :host(.ph--compact) {
        /* Above the toolbar and the grid under it, so the popovers of the header (Columns, the sort rule) are not painted under them. */
        position: relative;
        z-index: 8;
        margin-bottom: var(--mf-s2);
      }
      :host(.ph--compact) .ph {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
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
        font-size: var(--mf-fs-h2);
        line-height: 1.3;
      }
      :host(.ph--compact) .ph__desc {
        grid-column: 2;
        grid-row: 2;
        margin: 0;
        overflow: hidden;
        font-size: var(--mf-fs-sm);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host(.ph--compact) .ph__actions {
        grid-column: 3;
        grid-row: 2;
      }
      :host(.ph--compact) .ph__extra {
        grid-column: 1 / -1;
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
    <span class="rt__name" data-name>{{ name() }}</span>
    <span class="rt__extra"><ng-content /></span>
  `,
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
  `,
})
export class RecordTitle {
  readonly ref = input('');
  readonly name = input('');
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
