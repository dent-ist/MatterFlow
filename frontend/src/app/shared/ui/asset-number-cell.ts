import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AssetTypeResponse } from '../../api/generated/api-client';

/** The width of the Asset Number column (#1297): the default tail gives 17 characters of mono 13 px and fits; a longer one is clipped with the full number as tooltip. */
export const ASSET_NUMBER_COLUMN_WIDTH = '168px';

/** True when at least one active asset type numbers its assets (the Asset Number column is then a default column and External Reference goes off by default). */
export function hasNumberedType(types: readonly AssetTypeResponse[]): boolean {
  return types.some((t) => t.isActive && t.numbering?.enabled === true);
}

/** The ids of the asset types that number their assets (an asset of one of them without a number reads "Not assigned"). */
export function numberedTypeIds(types: readonly AssetTypeResponse[]): ReadonlySet<number> {
  return new Set(types.filter((t) => t.numbering?.enabled === true).map((t) => t.assetTypeId));
}

/**
 * The Asset Number of a list row (#1297): the number in mono type on one line with an ellipsis and the whole number as tooltip (D-45); muted "Not assigned"
 * for an asset of a numbered type that has none; empty for a type without numbering. No Copy button in a list (the record page has it).
 */
@Component({
  selector: 'mf-asset-number-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .anc__text {
      display: block;
      overflow: hidden;
      font-family: var(--mf-font-mono);
      font-size: var(--mf-fs-sm);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .anc__none {
      color: var(--mf-text-muted);
    }
  `,
  template: `
    @if (number()) {
      <span class="anc__text" [attr.title]="number()" data-asset-number-text>{{ number() }}</span>
    } @else if (numbered()) {
      <span class="anc__none" data-asset-number-none>Not assigned</span>
    }
  `,
})
export class AssetNumberCell {
  readonly number = input<string | null | undefined>(null);
  /** The asset's type numbers its assets. */
  readonly numbered = input(false);
}
