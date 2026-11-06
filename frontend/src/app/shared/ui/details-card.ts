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
 */
@Component({
  selector: 'mf-details-card',
  imports: [CountChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dc' },
  styles: `
    :host {
      display: block;
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
      <dl class="dc__fields"><ng-content select="[mfDetailField]" /></dl>
      <ng-content />
    </section>
  `,
})
export class DetailsCard {
  /** The card title, Title Case ("Details", "Relativity Workspace Fields"). */
  readonly title = input.required<string>();
  /** A number shown in a count chip beside the title (the number of fields of a group); none by default. */
  readonly count = input<number | null>(null);
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
