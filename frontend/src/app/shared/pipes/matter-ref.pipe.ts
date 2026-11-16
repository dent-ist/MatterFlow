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
 * A client number, a matter number or a CM Number as every screen shows it (#1392): each number has exactly 5 digits, so `343` is `00343` and `343-12` is `00343-00012`.
 * Text that is not a number (a name, an empty value) is returned as it is. This is the one function for a bare number; a matter with both parts goes through `formatMatterRef`.
 * The guard spec `business-number-guard.spec.ts` fails on a template or a text built from `clientNumber` or `matterNumber` that does not use it.
 */
export function formatBusinessNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (text === '') return '';
  if (text.includes('-')) return formatMatterRef(text);
  return normalizeNumber(text) ?? text;
}

/** `{{ client.clientNumber | businessNumber }}` renders `00343`; see `formatBusinessNumber`. */
@Pipe({ name: 'businessNumber' })
export class BusinessNumberPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    return formatBusinessNumber(value);
  }
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
