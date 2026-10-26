/**
 * The character limits of the text fields of the Administration pages, as the API holds them (#583). A limited field shows its counter
 * (`mf-char-counter`, or `[counter]="true"` on `mf-text-field`) with the same number, so the field never stops silently.
 *
 *   <mf-text-field inputId="at-name" label="Name" [maxLength]="ADMIN_FIELD_LIMITS.assetTypeName" [counter]="true" [(value)]="name" />
 */
export const ADMIN_FIELD_LIMITS = {
  /** `AssetType.Name` (the issue text says 100). */
  assetTypeName: 100,
  /** `AssetType.Description`: the API column is 500. */
  assetTypeDescription: 500,
  /** `AssetLinkRole.Name`. */
  linkRoleName: 50,
  onHoldReasonName: 100,
  /** `Priority.Label`. */
  priorityLabel: 50,
  /** `StatusLabel.DisplayLabel` (the code is not editable). */
  statusLabel: 50,
} as const;
