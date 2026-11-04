/** The note in the tooltip of the Task type chip: the Show counts follow Status and Show only (the contract, #978), so they do not narrow by the task type. */
export const SHOW_COUNTS_NOTE = 'The Show counts follow Status and Show only, not this filter.';

export interface TaskTypeChipText {
  label: string;
  title: string;
}

/**
 * The text of the Overview's "Task type" chip when the address carries task types (a drill from Metrics, #978): the NAME for one or two types, "N types" with every name in the tooltip
 * for more. Until the names are read (or when one is unknown) it falls back to the count ("one chosen", "N chosen"). The tooltip always carries the note about the Show counts.
 */
export function taskTypeChipText(
  ids: readonly (number | string)[],
  names: ReadonlyMap<number, string>,
): TaskTypeChipText {
  const found = ids.map((id) => names.get(Number(id)));
  if (found.some((n) => n === undefined)) {
    return {
      label: ids.length === 1 ? 'one chosen' : `${ids.length} chosen`,
      title: SHOW_COUNTS_NOTE,
    };
  }
  const all = (found as string[]).join(', ');
  return ids.length <= 2
    ? { label: all, title: SHOW_COUNTS_NOTE }
    : { label: `${ids.length} types`, title: `${all}. ${SHOW_COUNTS_NOTE}` };
}
