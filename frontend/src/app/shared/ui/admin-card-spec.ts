import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { ActionMenu } from './action-menu';
import { ActiveBadge, Badge, BadgeTone } from './badge';
import { CopyPart } from './copy-parts';
import { LoadState } from './data-table';
import { RowStop } from './row-nav';
import type { RowActionsMenu } from './row-actions';
import type { ListFilters } from '../filters/list-filters';
import { RecordCard, RecordCardDef, RecordCardList } from './record-card-list';

/** A badge of a card, top right: the same family as the table's badges (text and icon, never colour alone). */
export interface AdminCardBadge {
  text: string;
  tone?: BadgeTone;
  /** PrimeIcons class, for example `pi-check-circle`. */
  icon?: string;
  /** The Active / Inactive badge of a record: drawn by `mf-active-badge`, exactly as in the table row (see `activeCardBadge`). */
  active?: boolean;
}

/** A muted line of a card; one line with an ellipsis. `link` makes the line an anchor (a count that opens a filtered list). */
export interface AdminCardLine {
  text: string;
  link?: { commands: readonly unknown[]; queryParams?: Params; label?: string };
  /** A line that says something is wrong (red text; the words still say it). */
  warn?: boolean;
  /** `data-*` attributes for the element that carries the text (the anchor when there is a `link`, else the line): hooks for tests, nothing else. */
  attrs?: Readonly<Record<string, string>>;
}

/** Sets the `data-*` attributes of a card line (`AdminCardLine.attrs`). */
@Directive({ selector: '[mfCardAttrs]' })
export class CardAttrs {
  readonly attrs = input<Readonly<Record<string, string>> | undefined>(undefined, {
    alias: 'mfCardAttrs',
  });
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  constructor() {
    effect(() => {
      for (const [name, value] of Object.entries(this.attrs() ?? {}))
        this.el.nativeElement.setAttribute(name, value);
    });
  }
}

/**
 * The card of one record of an admin list below 640 px (#579):
 *
 *   title      the record's name; the one link of the card, the whole card is its target (two lines at most, the full text as tooltip)
 *   subtitle   a muted line under the name (a description)
 *   badges     state badges, top right
 *   meta       more muted lines; `subtitle` and `meta` together show 3 lines at most (`ADMIN_CARD_LINES`), so a card is 2 to 4 lines tall
 *   actions    the row overflow of the table (`rowActions()`): the same entries, the same order, the same reasons
 */
export interface AdminCardSpec {
  title: string;
  /** Router commands to the record. */
  link: string | unknown[];
  /** The record's key: Back to the list focuses this card's link (the list-return rule). */
  rowKey: string | number;
  /** Router state for the link (the list address). */
  state?: Record<string, unknown>;
  subtitle?: string | null;
  badges?: readonly AdminCardBadge[];
  meta?: readonly (string | AdminCardLine)[];
  actions?: RowActionsMenu | null;
}

/** The most muted lines a card shows (subtitle included). */
export const ADMIN_CARD_LINES = 3;

/** The lines of a card (subtitle first, then meta), at most `ADMIN_CARD_LINES`. */
export function adminCardLines(spec: AdminCardSpec): AdminCardLine[] {
  const all: AdminCardLine[] = [];
  if (spec.subtitle) all.push({ text: spec.subtitle });
  for (const m of spec.meta ?? []) all.push(typeof m === 'string' ? { text: m } : m);
  return all.filter((l) => l.text !== '' || l.link).slice(0, ADMIN_CARD_LINES);
}

/** The Active / Inactive badge of a record, as card data (the words and icons of `mf-active-badge`). */
export function activeCardBadge(active: boolean | null | undefined): AdminCardBadge {
  return active
    ? { text: 'Active', tone: 'success', icon: 'pi-check-circle', active: true }
    : { text: 'Inactive', tone: 'neutral', icon: 'pi-minus-circle', active: false };
}

/** The window widths at which an optional column can leave (the `data-drop` values of the grid stylesheet), widest first. */
export const COLUMN_DROP_WIDTHS = [1280, 1100, 900, 768, 640] as const;

/**
 * The fixed order in which the optional columns of a page leave as the window narrows (#579): the FIRST id leaves first (at the widest
 * threshold), the last one leaves last. The name, the status and the actions are never in the list: they stay down to the phone cards at 640 px.
 *
 *   readonly drop = columnDropOrder(['note', 'updated', 'assets']);      // { note: 1280, updated: 1100, assets: 900 }
 *   <th class="mf-cell-num" [attr.data-drop]="drop.assets">Assets</th>   // the th, every td and the skeleton cell
 *
 * At most five optional columns (one per threshold); a sixth is a design error, not something to hide quietly.
 */
export function columnDropOrder<const K extends string>(ids: readonly K[]): Record<K, number> {
  if (ids.length > COLUMN_DROP_WIDTHS.length) {
    throw new Error(
      `columnDropOrder: ${ids.length} optional columns, at most ${COLUMN_DROP_WIDTHS.length}.`,
    );
  }
  const out = {} as Record<K, number>;
  ids.forEach((id, i) => {
    if (id in out) throw new Error(`columnDropOrder: "${id}" twice.`);
    out[id] = COLUMN_DROP_WIDTHS[i];
  });
  return out;
}

/**
 * The phone cards of an admin list (#579): `mf-record-card-list` and `mf-record-card` driven by data. The page maps each record to an
 * `AdminCardSpec`; the states (loading, 403, error with reference and Retry, first-run, no-match with Clear filters, "n inactive hidden - Show
 * all") are the table's (`AdminListState`). Render it only while `phoneCards()` is true (below 640 px), instead of the table.
 *
 *   @if (phone()) {
 *     <mf-admin-card-list noun="asset types" label="Asset types" [items]="rows()" [spec]="cardOf" [state]="ls.state()" [empty]="ls.empty()"
 *       [filtered]="ls.filtered()" [hidden]="ls.hidden()" (retry)="load()" (clear)="clear()" (showAll)="showAll()" />
 *   }
 *
 * The first Tab stop of a card is its link, the second its overflow button; focus, the stretched link and the 44 px targets are those of
 * `mf-record-card`.
 */
@Component({
  selector: 'mf-admin-card-list',
  imports: [
    RecordCardList,
    RecordCardDef,
    RecordCard,
    Badge,
    ActiveBadge,
    ActionMenu,
    RouterLink,
    RowStop,
    CardAttrs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-record-card-list
      [noun]="noun()"
      [label]="label()"
      [state]="state()"
      [empty]="empty()"
      [filtered]="filtered()"
      [hidden]="hidden()"
      [hiddenLabel]="hiddenLabel()"
      [emptyText]="emptyText()"
      [emptyParts]="emptyParts()"
      [errorRef]="errorRef()"
      [filters]="filters()"
      (retry)="retry.emit()"
      (clear)="clear.emit()"
      (showAll)="showAll.emit()"
    >
      <ng-content select="[mfEmptyAction]" ngProjectAs="[mfEmptyAction]" />
      <ng-template [mfRecordCard]="cards()" let-c>
        <mf-record-card
          [name]="c.spec.title"
          [link]="c.spec.link"
          [state]="c.spec.state"
          [list]="listId()"
          [rowKey]="c.spec.rowKey"
        >
          @for (b of c.spec.badges ?? []; track $index) {
            <span mfCardBadges class="rc-badge">
              @if (b.active !== undefined) {
                <mf-active-badge [active]="b.active" />
              } @else {
                <mf-badge [tone]="b.tone ?? 'neutral'" [icon]="b.icon ?? null">{{
                  b.text
                }}</mf-badge>
              }
            </span>
          }
          @for (l of c.lines; track $index) {
            <p
              mfCardMeta
              class="rc-line"
              data-card-meta
              [class.rc-line--warn]="l.warn"
              [mfCardAttrs]="l.link ? undefined : l.attrs"
            >
              @if (l.link) {
                <a
                  mfRowStop
                  [mfCardAttrs]="l.attrs"
                  [routerLink]="l.link.commands"
                  [queryParams]="l.link.queryParams"
                  >{{ l.link.label ?? l.text }}</a
                >
              } @else {
                <span class="rc-text">{{ l.text }}</span>
              }
            </p>
          }
          @if (c.menu; as menu) {
            <mf-action-menu
              mfCardAside
              [items]="menu.items"
              [label]="menu.label"
              [floating]="true"
            />
          }
        </mf-record-card>
      </ng-template>
    </mf-record-card-list>
  `,
})
export class AdminCardList<T> {
  readonly items = input.required<readonly T[]>();
  /** Maps a record to its card. A plain function of the record (keep it free of side effects). */
  readonly spec = input.required<(row: T) => AdminCardSpec>();
  readonly state = input.required<LoadState>();
  readonly empty = input(false);
  readonly filtered = input(false);
  readonly noun = input.required<string>();
  /** The accessible name of the list ("Asset types"). */
  readonly label = input('');
  readonly emptyText = input('');
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  readonly hidden = input(0);
  readonly hiddenLabel = input('inactive');
  readonly errorRef = input<string | null>(null);
  /** The page's filters: the bar shows no second Clear filters while the cards offer one. */
  readonly filters = input<ListFilters | null>(null);
  /** The list's id for Back-to-list focus (`ADMIN_LIST.<x>.id`); empty to opt out. */
  readonly listId = input('');

  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly showAll = output<void>();

  protected readonly cards = computed(() =>
    this.items().map((row) => {
      const spec = this.spec()(row);
      const menu = spec.actions && spec.actions.items.length > 0 ? spec.actions : null;
      return { spec, lines: adminCardLines(spec), menu };
    }),
  );
}
