import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** One step of the breadcrumb trail; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  /** Router commands (or a URL string). Omit for the current page. */
  link?: string | readonly unknown[];
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
          <ng-content select="[mfTitle]">{{ heading() }}</ng-content>
        </h1>
        <div class="ph__actions" data-page-actions>
          <ng-content select="[mfActions]" />
        </div>
      </div>
      <p class="ph__desc" data-page-description>
        @if (description()) {
          {{ description() }}
        }
        <ng-content select="[mfDescription]" />
      </p>
      <ng-content />
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
  `,
})
export class PageHeader {
  /** Plain-text H1; use the `mfTitle` slot instead for rich content. */
  readonly heading = input('');
  readonly crumbs = input<readonly Crumb[]>([]);
  readonly description = input('');
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
