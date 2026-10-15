import { FilterDef, FilterOption } from './filter-def';

/** Active (the default), Inactive, All: the Status filter of the record lists (`status` in the URL, mapped with `isActiveParam`). */
export const ACTIVE_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

/** The same for Projects, where inactive means archived. */
export const ARCHIVE_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Archived' },
  { value: 'all', label: 'All' },
];

/** The Status column filter shared by the record lists: a select that shows Active and does not count it. */
export function statusDef(options: readonly FilterOption[] = ACTIVE_STATUS_OPTIONS): FilterDef {
  return {
    key: 'status',
    label: 'Status',
    column: 'status',
    type: 'select',
    options,
    default: 'active',
  };
}

/** The Matters filters that Matters and a Client's Matters share (the client column is added by the Matters list). */
export function matterColumnDefs(refLabel = 'Matter reference'): FilterDef[] {
  return [
    { key: 'matterRef', label: refLabel, column: 'matterRef', type: 'text' },
    { key: 'name', label: 'Name', column: 'name', type: 'text' },
    statusDef(),
    // No column: it lives in "More filters". isSensitive exists on the API; the flag is shown as a badge after the name.
    {
      key: 'isSensitive',
      label: 'Sensitive',
      type: 'triState',
      options: [
        { value: '', label: 'Any' },
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ],
    },
  ];
}
