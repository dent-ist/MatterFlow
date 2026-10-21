import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  afterRenderEffect,
  inject,
  input,
  output,
} from '@angular/core';
import type { ListFilters } from '../filters/list-filters';
import { ListFiltersButton } from '../filters/list-filters-button';
import { SkipTarget } from '../layout/skip-target';
import { FixedPage } from './fixed-page';
import { Crumb, PageHeader } from './page-header';
import { MfTab, Tabs } from './tabs';

/**
 * The count of each tab by key, as the shell shows it (#544, #545): a number is the ACTIVE records, `null` or `undefined` is "not known yet"
 * (the tab reads `--`). A key that is not in the map keeps the count the tab itself has (or none). `AdminTabCounts.snapshot` is such a map.
 */
export type ShellCounts = Readonly<Record<string, number | null | undefined>>;

/**
 * The shell of an admin list (#544, the admin list kit; Task Types, Labels, Asset Types, Users, Assets and Search build on it):
 *
 *   Administration > Asset Types                       crumb (default `Administration > <heading>`)
 *   [icon] Asset Types        [Filters (2)]  [New asset type]    H1; Filters with its count (and the one Clear filters) then the primary action last
 *   One line, 90 characters at most.                    description (the page header: one line, full text as tooltip)
 *   Asset Types (12) | Link Roles (4)                   counted route tabs, only when there are two or more
 *   [strip]                                             `mfStrip`: the health strip of the list
 *   [body]                                              the list (filter row, grid, pager)
 *
 *   <mf-admin-list-shell heading="Asset Types" description="..." [tabs]="tabs" [tab]="current()" [counts]="counts.snapshot()"
 *     [filters]="filters" controls="asset-filter-row" tableId="asset-types-table" (tabChange)="select($event)">
 *     <p-button mfPrimary label="New asset type" icon="pi pi-plus" />
 *     <mf-work-strip mfStrip ... />
 *     <div class="mf-table-wrap"><table id="asset-types-table" class="mf-grid">...</table></div>
 *   </mf-admin-list-shell>
 *
 * It is a fixed-header page (`mf-fixed-page`): the header, tabs and strip stay and the body scrolls (below 768 px wide it all scrolls
 * normally). With `tableId` the first Tab stop of the page is "Skip to table"; it is visible on focus (the app shell draws it, #354), moves
 * focus to the element with that id (made focusable, named by the heading when it has no name) and falls back to the body when the table
 * is not there (loading, error). The filter row itself, its open state and the sheet below 640 px belong to `ListFilters`; the shell only
 * draws the button. No keyboard shortcut is involved.
 */
@Component({
  selector: 'mf-admin-list-shell',
  imports: [NgTemplateOutlet, FixedPage, PageHeader, Tabs, ListFiltersButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The shell adds no box of its own: the fixed page inside it is a flex child of the routed page, as without the shell.
  host: { style: 'display: contents' },
  template: `
    <mf-fixed-page>
      @if (!bare()) {
        <mf-page-header
          [heading]="heading()"
          [icon]="icon()"
          [crumbs]="trail()"
          [description]="description().trim()"
        >
          @if (filters(); as f) {
            <mf-list-filters-button
              mfActions
              [filters]="f"
              [controls]="controls()"
              [clearAlso]="clearAlso()"
            />
          }
          <span mfActions class="als__primary" data-shell-primary
            ><ng-content select="[mfPrimary]"
          /></span>
        </mf-page-header>
      }
      @if (showTabs()) {
        <mf-tabs
          [label]="tabsLabel() || heading() + ' sections'"
          [idPrefix]="idPrefix()"
          [tabs]="tabItems()"
          [selected]="tab()"
          (tabChange)="tabChange.emit($event)"
        />
        <div
          class="mf-fill"
          role="tabpanel"
          [id]="idPrefix() + '-panel'"
          [attr.aria-labelledby]="idPrefix() + '-tab-' + tab()"
          data-shell-body
        >
          <ng-container [ngTemplateOutlet]="inner" />
        </div>
      } @else {
        <div class="mf-fill" data-shell-body>
          <ng-container [ngTemplateOutlet]="inner" />
        </div>
      }
      <ng-template #inner>
        <ng-content select="[mfStrip]" />
        <ng-content />
      </ng-template>
    </mf-fixed-page>
  `,
  styles: `
    /* The primary action slot adds no box: its buttons are the header's own actions, in order (Filters, then the primary action). */
    .als__primary {
      display: contents;
    }
  `,
})
export class AdminListShell {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly skip = inject(SkipTarget);

  /** The H1. */
  readonly heading = input.required<string>();
  /** PrimeIcons classes before the H1; left out it is the icon of the section (see `mf-page-header`). */
  readonly icon = input<string | null>(null);
  /** The breadcrumb; default `Administration > <heading>`. Pass `[]` for none. */
  readonly crumbs = input<readonly Crumb[] | null>(null);
  /** One line, 90 characters at most (the rule of the kit): the page header shows it on one line with an ellipsis in a fixed page and the full text as its tooltip. */
  readonly description = input('');
  /** Route tabs (`mf-tabs`); fewer than two render no strip at all. Build them with `adminTabItems()` so permissions and counts are applied. */
  readonly tabs = input<readonly MfTab[]>([]);
  /** The key of the open tab. */
  readonly tab = input('');
  /** The counts of the tabs by key (see `ShellCounts`). */
  readonly counts = input<ShellCounts | null>(null);
  /** The accessible name of the tab list; default "<heading> sections". */
  readonly tabsLabel = input('');
  /** Prefix of the tab element ids; the tab panel is `<prefix>-panel`. */
  readonly idPrefix = input('admin-list');
  /** The list's filters: the header shows the Filters button (with its count) and the one Clear filters. Omit for a list without filters. */
  readonly filters = input<ListFilters | null>(null);
  /** The id of the filter row (the button's `aria-controls`). */
  readonly controls = input('');
  /** Legacy parameters that Clear filters drops too (`['q']`). */
  readonly clearAlso = input<readonly string[]>([]);
  /**
   * Without the page header and the tabs: the body is a record page of its own (the Users shell shows a pod's editor this way, whose record
   * header has the crumb and the name). The body, and what is projected into it, stays alive when this switches.
   */
  readonly bare = input(false);
  /** The id of the table (or list) that "Skip to table" moves focus to. Omit for no skip link. */
  readonly tableId = input('');
  /** The text of the skip link. */
  readonly skipLabel = input('Skip to table');
  /** The person chose a tab (click or keyboard); the page navigates (`?tab=` replaced, not added). */
  readonly tabChange = output<string>();

  protected readonly trail = computed<readonly Crumb[]>(
    () => this.crumbs() ?? [{ label: 'Administration' }, { label: this.heading() }],
  );
  protected readonly showTabs = computed(() => !this.bare() && this.tabs().length > 1);
  protected readonly tabItems = computed(() => applyCounts(this.tabs(), this.counts()));

  constructor() {
    // The skip link of the page (the contract of #586: the link names an element that exists, here the body region of the shell). A list
    // that registers its own skip target (the Task Types lists do) simply replaces this one; leave `tableId` out there.
    afterRenderEffect((onCleanup) => {
      if (!this.tableId()) return;
      const label = this.skipLabel();
      const element = this.host.nativeElement.querySelector<HTMLElement>('[data-shell-body]');
      if (!element) return;
      // With tabs the body is the tab panel, which already has its id (`aria-controls` and `aria-labelledby` name it): the link names that.
      const id = this.showTabs() ? this.idPrefix() + '-panel' : undefined;
      onCleanup(this.skip.register({ label, element, id, focus: () => this.focusTable() }));
    });
  }

  /** Moves focus to the table (or the body when the table is not on screen), the target of "Skip to table". */
  focusTable(): void {
    const root = this.host.nativeElement;
    const id = this.tableId();
    const table = id ? document.getElementById(id) : null;
    const target =
      table ??
      // A phone shows cards, not a table: the first card's link.
      root.querySelector<HTMLElement>('li.rc a[href]') ??
      root.querySelector<HTMLElement>(
        '[data-empty], [data-error], [data-forbidden], [data-no-access]',
      ) ??
      root.querySelector<HTMLElement>('[data-shell-body]');
    if (!target) return;
    if (!target.matches('a, button, input, select, textarea, [tabindex]')) {
      target.setAttribute('tabindex', '-1');
    }
    // A table (or the body) is announced by its name: give it one when the page did not (a caption or aria-label counts). A link or a
    // button already has its own name and keeps it.
    if (
      !target.matches('a, button, input, select, textarea') &&
      !target.hasAttribute('aria-label') &&
      !target.hasAttribute('aria-labelledby') &&
      !target.querySelector(':scope > caption')
    ) {
      target.setAttribute('aria-label', this.heading());
    }
    target.focus();
  }
}

/** The tabs with the counts applied: `--` while unknown, `n` (spoken as "Label, n active") when known; tabs without an entry are unchanged. */
export function applyCounts(tabs: readonly MfTab[], counts: ShellCounts | null): readonly MfTab[] {
  if (!counts) return tabs;
  return tabs.map((t) => {
    if (!(t.key in counts)) return t;
    const n = counts[t.key];
    return typeof n === 'number'
      ? { ...t, count: n, name: `${t.label}, ${n} active` }
      : { ...t, count: '--', name: undefined };
  });
}
