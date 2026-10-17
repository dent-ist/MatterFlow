import { FilterChip } from './filter-def';

/** The notice line is kept to about this many characters; the rest of the parts become "and N more". */
export const RESTORE_SUMMARY_MAX = 120;

/**
 * "Restored your last view: Due soon and overdue, Priority Critical or High." Names the tab (when the screen has tabs) and then the
 * filters in words, one part per filter ("Priority Critical or High"); parts that do not fit become "and 2 more".
 */
export function restoreSummary(tab: string | null, chips: readonly FilterChip[]): string {
  const groups = new Map<string, string[]>();
  for (const chip of chips) {
    const at = chip.label.indexOf(': ');
    const name = at < 0 ? chip.label : chip.label.slice(0, at);
    const value = at < 0 ? '' : chip.label.slice(at + 2);
    const values = groups.get(name) ?? [];
    if (value) values.push(value);
    groups.set(name, values);
  }
  const parts = [...groups].map(([name, values]) =>
    values.length === 0 ? name : `${name} ${values.join(' or ')}`,
  );
  const lead = 'Restored your last view';
  if (tab) parts.unshift(tab);
  if (parts.length === 0) return `${lead}.`;
  const kept: string[] = [];
  let length = lead.length + 2;
  for (const part of parts) {
    const rest = parts.length - kept.length - 1;
    // Leave room for " and N more" when parts remain after this one.
    const room = rest > 0 ? 16 : 1;
    if (kept.length > 0 && length + part.length + 2 + room > RESTORE_SUMMARY_MAX) break;
    kept.push(part);
    length += part.length + 2;
  }
  const more = parts.length - kept.length;
  return `${lead}: ${kept.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`;
}
