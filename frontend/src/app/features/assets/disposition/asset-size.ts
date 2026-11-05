import { formatDecimal } from '../../../shared/ui/number-format';

/** "412 GB", "26,400 Items", "1.2 TB"; an empty string when there is no size. Whole numbers show without decimals, others with one (D-61). */
export function formatSize(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  return unit ? `${formatDecimal(value)} ${unit}` : formatDecimal(value);
}
