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
