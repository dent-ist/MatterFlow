import { SortDirection } from './queue-filters';

/**
 * Plain words for the direction of a sort (epic #893, issue #898): a sort says what comes first instead of "ascending" or an arrow, so the label carries the
 * direction. One table for every place that names a sort (the note under a list, the phone's Sort sheet, the print line).
 */
export type SortKind = 'urgency' | 'due' | 'date' | 'age' | 'text' | 'number' | 'count';

/** What kind of values a sort field orders, which decides the words of its two directions. */
const KINDS: Readonly<Record<string, SortKind>> = {
  priority: 'urgency',
  priorityAge: 'urgency',
  due: 'due',
  created: 'date',
  updated: 'date',
  completed: 'date',
  closed: 'date',
  age: 'age',
  title: 'text',
  status: 'text',
  matterName: 'text',
  client: 'text',
  assignee: 'text',
  type: 'text',
  name: 'text',
  number: 'number',
  matter: 'number',
};

const WORDS: Readonly<Record<SortKind, { asc: string; desc: string }>> = {
  urgency: { asc: 'most urgent first', desc: 'least urgent first' },
  due: { asc: 'soonest first', desc: 'latest first' },
  date: { asc: 'oldest first', desc: 'newest first' },
  // The Task Queue's Age sort is the creation date reversed: ascending age is the youngest task first.
  age: { asc: 'newest first', desc: 'oldest first' },
  text: { asc: 'A to Z', desc: 'Z to A' },
  number: { asc: 'lowest first', desc: 'highest first' },
  count: { asc: 'fewest first', desc: 'most first' },
};

/** The kind of a sort field; a field the table does not know is read as text. */
export function sortKind(field: string): SortKind {
  return KINDS[field] ?? 'text';
}

/** "most urgent first", "soonest first", "A to Z": the direction of a sort as the person reads it. */
export function directionWords(field: string, dir: SortDirection, kind?: SortKind): string {
  return WORDS[kind ?? sortKind(field)][dir];
}
