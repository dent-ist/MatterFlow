/** The due buckets of "Group by: Due" (M12.1) in the order the server sorts them. */
type BucketKey = 'asap' | 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'closed';

/** The bucket sizes of the whole filtered set: My Work's six, and the Task Queue's seventh (`closed`, Completed and Cancelled). */
export type BucketCounts = Partial<Record<BucketKey, number>>;

export const DUE_BUCKETS: readonly { key: BucketKey; label: string }[] = [
  { key: 'asap', label: 'ASAP' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'closed', label: 'Closed' },
];

/**
 * The order of the headers for a direction. Descending mirrors the open buckets (Later first, ASAP last); Closed comes last either way,
 * like the server (`OrderByDueGroups`).
 */
export function bucketOrder(
  dir: 'asc' | 'desc' = 'asc',
): readonly { key: BucketKey; label: string }[] {
  if (dir === 'asc') return DUE_BUCKETS;
  const closed = DUE_BUCKETS.filter((b) => b.key === 'closed');
  return [...DUE_BUCKETS.filter((b) => b.key !== 'closed').reverse(), ...closed];
}

/** One group header on the page: where it goes, the size of the whole bucket, and whether the bucket began on an earlier page. */
export interface RowGroup {
  key: string;
  label: string;
  /** The size of the whole bucket (all pages), as the server counted it. */
  count: number;
  /** Index of the bucket's first row on this page. */
  start: number;
  /** How many of the bucket's rows are on this page. */
  length: number;
  /** True when the bucket began on an earlier page: "Overdue (9), continued". */
  continued: boolean;
}

/**
 * The headers of one page of a list the server ordered by due bucket. The server returns the size of every bucket for the whole filtered
 * set, so the bucket of each row follows from its position (`offset` + index) without any date logic on the client: the two can never
 * disagree around midnight. Buckets with no row on this page get no header.
 */
export function groupRows(
  rowCount: number,
  offset: number,
  counts: BucketCounts | null | undefined,
  dir: 'asc' | 'desc' = 'asc',
): RowGroup[] {
  if (!counts || rowCount <= 0) return [];
  const groups: RowGroup[] = [];
  let first = 0; // global index of the bucket's first row
  for (const { key, label } of bucketOrder(dir)) {
    const count = counts[key] ?? 0;
    const last = first + count; // exclusive
    const from = Math.max(first, offset);
    const to = Math.min(last, offset + rowCount);
    if (count > 0 && from < to) {
      groups.push({
        key,
        label,
        count,
        start: from - offset,
        length: to - from,
        continued: first < offset,
      });
    }
    first = last;
  }
  return groups;
}
