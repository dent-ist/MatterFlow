import { CLOSED_STATUSES } from './queue-filters';

/**
 * Quiet badges (My Matters grids, epic #893): a coloured pill says "look here", so it is kept for what needs a look. Priority is a pill only for High and
 * Critical, Status only for On hold and At risk; everything else is plain text. The words are always printed (never colour alone).
 */
export function loudPriority(p: { label: string; color: string }): boolean {
  const k = `${p.color} ${p.label}`.toLowerCase();
  return /\b(critical|high)\b/.test(k);
}

export function loudStatus(row: { status: string; atRisk: boolean }): 'hold' | 'risk' | null {
  if (row.status === 'ON_HOLD') return 'hold';
  return row.atRisk && !CLOSED_STATUSES.includes(row.status) ? 'risk' : null;
}
