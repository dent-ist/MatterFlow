import { Pipe, PipeTransform } from '@angular/core';

/**
 * THE number forms of the app (UI update 2, issue #1148, rule D-61). Change a form here and every grid, card, chip and tab follows.
 *  - integers with a thousands comma: `1,234` (counts never have decimals)
 *  - percent without a space: `37%`
 *  - durations: `45 m`, `2 h 48 m`, `3 d 4 h`
 *  - sizes: `1.2 MB` (KB, MB, GB, base 1024, one decimal)
 *  - ranges: `1-50 of 143`
 *  - relative past: `3 m ago`, `3 h ago`, `3 d ago`
 */
const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** `1,234`; empty for no value. A count is rounded to a whole number. */
export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : INT.format(value);
}

/** `37%` from a whole-number percentage (rounded, no space). */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? ''
    : `${INT.format(value)}%`;
}

/** A number with a thousands comma and at most one decimal (`412`, `1.2`, `26,400`): the size of an asset in its own unit. */
export function formatDecimal(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? ''
    : ONE_DECIMAL.format(value);
}

/** `45 m`, `2 h 48 m`, `3 d 4 h`: a length of time given in minutes. Empty for no value. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')} m`;
  return `${INT.format(Math.floor(h / 24))} d ${h % 24} h`;
}

/** `812 B`, `2 KB`, `1.2 MB`, `3.4 GB` (base 1024, one decimal). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${INT.format(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${ONE_DECIMAL.format(Math.round(value * 10) / 10)} ${units[unit]}`;
}

/** `1-50 of 143`; `0 of 0` for an empty list. */
export function formatRange(from: number, to: number, total: number): string {
  return total === 0 ? '0 of 0' : `${INT.format(from)}-${INT.format(to)} of ${INT.format(total)}`;
}

/** `3 m ago`, `3 h ago`, `3 d ago` from an age in minutes. */
export function formatAgo(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} m ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${INT.format(Math.floor(m / 1440))} d ago`;
}

/** `{{ count | mfInt }}`: an integer with a thousands comma (`1,234`); the value itself when it is not a number (a text count such as `99+`). */
@Pipe({ name: 'mfInt' })
export class IntPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    if (typeof value === 'string') return value;
    return formatInt(value);
  }
}
