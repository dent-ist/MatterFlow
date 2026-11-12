import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { CountChip } from './count-chip';

let nextId = 0;

/**
 * The Details card of a record page (D-44f, #1250, #1249; the Matter Summary is the model): ONE white `mf-card` (12 px radius, 1 px border) with the title (16 / 700, an
 * `h2`), an optional count chip beside it, and the fields in two columns with the label ABOVE the value (13 px muted label, 14 px value, 16 px row gap, 24 px column gap).
 * Project, Asset and the other record pages put their fields in it; a second group (the custom fields) is a second card with its own title and the number of fields as the chip.
 *
 *   <mf-details-card title="Details">
 *     <div mfDetailField label="Status"><mf-active-badge [active]="true" /></div>
 *     <div mfDetailField label="Description" wide>Long text spanning both columns</div>
 *   </mf-details-card>
 *   <mf-details-card title="Relativity Workspace Fields" [count]="12"><mf-dynamic-form ... /></mf-details-card>
 *
 * Fields go in the `mfDetailField` slot; anything else projected (a read-only form) goes below them. Labels are Title Case (D-20).
 *
 * Groups (Matter Summary, #1376): `section[mfDetailsGroup]` with a `heading` is a group of fields under a quiet sub-heading (D-11a: 14/700, 16 px above, 4 px below, no count chip), the fields
 * in the group's own two-column grid (a short field takes half of the group's width, a `wide` one the whole row). Put the groups in the card's default slot. A line that belongs to the card as a whole and
 * must not scroll away (the Created and Last Updated line) goes in the `mfDetailsFoot` slot, below the scrolling body.
 *
 * Two options for the one card that needs them (Matter Summary, #1253): `threeColumns` puts the fields in three columns when the card is 1100 px wide or more (two below that), and
 * `scrollLabel` makes the card fit its content and scroll the fields inside itself when the page has no more room (a focusable region with that accessible name).
 */
@Component({
  selector: 'mf-details-card',
  imports: [CountChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'dc',
    '[class.dc--cols3]': 'threeColumns()',
    '[class.dc--scroll]': 'scrollLabel() !== null',
  },
  styles: `
    :host {
      display: block;
    }
    :host(.dc--cols3) {
      container-type: inline-size;
    }
    :host(.dc--scroll),
    :host(.dc--scroll) .mf-card {
      display: flex;
      flex-direction: column;
      flex: 0 1 auto;
      min-height: 0;
    }
    .dc__body {
      min-height: 0;
    }
    :host(.dc--scroll) .dc__body {
      overflow-y: auto;
    }
    @media (max-width: 767.98px), (max-height: 560.98px) {
      :host(.dc--scroll) .dc__body {
        overflow: visible;
      }
    }
    @container (min-width: 1100px) {
      :host(.dc--cols3) .dc__fields {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .dc__head {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
    }
    .dc__head .mf-card__title {
      margin: 0;
    }
    .dc__fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--mf-s3) var(--mf-s5);
      margin: 0;
    }
    .dc__fields:empty {
      display: none;
    }
    .dc__fields + * {
      margin-top: var(--mf-s3);
    }
  `,
  template: `
    <section class="mf-card" [attr.aria-labelledby]="headId">
      <div class="dc__head">
        <h2 class="mf-card__title" [id]="headId" data-details-title>{{ title() }}</h2>
        @if (count() !== null) {
          <mf-count-chip data-details-count>{{ count() }}</mf-count-chip>
        }
      </div>
      <div
        class="dc__body"
        [attr.tabindex]="scrollLabel() !== null ? 0 : null"
        [attr.role]="scrollLabel() !== null ? 'region' : null"
        [attr.aria-label]="scrollLabel()"
      >
        <dl class="dc__fields"><ng-content select="[mfDetailField]" /></dl>
        <ng-content />
      </div>
      <ng-content select="[mfDetailsFoot]" />
    </section>
  `,
})
export class DetailsCard {
  /** The card title, Title Case ("Details", "Relativity Workspace Fields"). */
  readonly title = input.required<string>();
  /** A number shown in a count chip beside the title (the number of fields of a group); none by default. */
  readonly count = input<number | null>(null);
  /** Three columns from a card width of 1100 px (two below), for a card with many short fields (the Matter Summary). */
  readonly threeColumns = input(false, { transform: booleanAttribute });
  /** The card fits its content and scrolls the fields inside itself; the text is the accessible name of that scroll region ("Matter details, scrollable"). */
  readonly scrollLabel = input<string | null>(null);
  protected readonly headId = `dc-h-${nextId++}`;
}

let nextGroup = 0;

/**
 * A group of fields inside a `mf-details-card` under a quiet sub-heading (D-11a, #1376): `<section mfDetailsGroup heading="Matter">` with `div[mfDetailField]` children. The heading is an `h3`
 * (the card's title is the `h2`); the fields are a `dl` of two equal columns: two short fields (CM Number and Matter Number, Status and AI Allowed) share a row, a `wide` field (a name, a link, a person with a button,
 * a path) spans the whole row. The row gap is `--dg-row-gap` (D-44f: 16 px, `--mf-s4`).
 */
@Component({
  // An attribute selector on a section, so the heading and its `dl` stay inside one landmark-free group.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'section[mfDetailsGroup]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-labelledby]': 'headId' },
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .dg__h {
      margin: var(--mf-s4) 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
      font-weight: var(--mf-fw-bold);
      line-height: 1.4;
    }
    :host(:first-child) .dg__h {
      margin-top: 0;
    }
    .dg__fields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--dg-row-gap, var(--mf-s4)) var(--mf-s5);
      margin: 0;
    }
  `,
  template: `<h3 class="dg__h" [id]="headId" data-details-group>{{ heading() }}</h3>
    <dl class="dg__fields"><ng-content select="[mfDetailField]" /></dl>`,
})
export class DetailsGroup {
  /** The group's name, Title Case ("Matter", "Management"). */
  readonly heading = input.required<string>();
  protected readonly headId = `dg-h-${nextGroup++}`;
}

/** One field of a `mf-details-card`: the label above the value (the projected content). `wide` spans both columns (long text, a history). */
@Component({
  // An attribute selector on a div, so the card's `dl` keeps valid markup (dl > div > dt + dd).
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'div[mfDetailField]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.df--wide]': 'wide()' },
  styles: `
    :host {
      min-width: 0;
      min-height: 2.75rem;
    }
    :host(.df--wide) {
      grid-column: 1 / -1;
    }
    dt {
      margin: 0 0 2px;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      /* 13 px label on the 15 px line the 12 px label had, so the rows keep their rhythm when a page moves onto this card (#1253). */
      line-height: 1.15;
    }
    dd {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      min-height: var(--mf-chip-h);
      margin: 0;
      font-size: var(--mf-fs-md);
      overflow-wrap: anywhere;
    }
    :host(.df--wide) dd {
      display: block;
    }
  `,
  template: `<dt>{{ label() }}</dt>
    <dd><ng-content /></dd>`,
})
export class DetailField {
  readonly label = input.required<string>();
  readonly wide = input(false, { transform: booleanAttribute });
}
