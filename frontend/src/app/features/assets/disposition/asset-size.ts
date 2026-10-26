const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** "412 GB", "26,400 Items"; an empty string when there is no size. Whole numbers show without decimals, others with at most two. */
export function formatSize(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  return unit ? `${NUMBER.format(value)} ${unit}` : NUMBER.format(value);
}
