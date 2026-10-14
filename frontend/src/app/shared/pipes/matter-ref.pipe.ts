import { Pipe, PipeTransform } from '@angular/core';

/** `normalizeNumber('343') -> '00343'`; null when not 1-5 digits (BusinessNumber rules). */
export function normalizeNumber(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^\d{1,5}$/.test(text) ? text.padStart(5, '0') : null;
}

export interface MatterRefParts {
  clientNumber?: string | number | null;
  matterNumber?: string | number | null;
  matterRef?: string | null;
}

/** Formats a matter reference as `00343-00012` (always both parts, zero padded). */
export function formatMatterRef(
  value: MatterRefParts | string | number | null | undefined,
  matterNumber?: string | number | null,
): string {
  if (value === null || value === undefined || value === '') return '';
  let client: string | number | null | undefined;
  let matter: string | number | null | undefined = matterNumber;

  if (typeof value === 'object') {
    if (value.clientNumber !== undefined || value.matterNumber !== undefined) {
      client = value.clientNumber;
      matter = value.matterNumber;
    } else if (value.matterRef) {
      return formatMatterRef(value.matterRef);
    }
  } else if (matterNumber === undefined && typeof value === 'string' && value.includes('-')) {
    [client, matter] = value.split('-', 2).map((s) => s.trim());
  } else {
    client = value;
  }

  const c = normalizeNumber(client);
  const m = normalizeNumber(matter);
  if (c && m) return `${c}-${m}`;
  return typeof value === 'object' ? '' : String(value);
}

/**
 * `{{ matter | matterRef }}`, `{{ '343-12' | matterRef }}` or `{{ 343 | matterRef: 12 }}`
 * all render `00343-00012`. Unparseable input is echoed back unchanged (never throws).
 */
@Pipe({ name: 'matterRef' })
export class MatterRefPipe implements PipeTransform {
  transform(
    value: MatterRefParts | string | number | null | undefined,
    matterNumber?: string | number | null,
  ): string {
    return formatMatterRef(value, matterNumber);
  }
}
