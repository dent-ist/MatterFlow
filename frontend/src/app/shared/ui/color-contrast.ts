/** WCAG 2.1 contrast helpers for admin-chosen priority colors (UX 4.5: text must reach 4.5:1). */

export const MIN_TEXT_CONTRAST = 4.5;
export const LIGHT_TEXT = '#FFFFFF';
export const DARK_TEXT = '#1B1F27';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX.test(value);
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** Contrast ratio (1 to 21) between two `#RRGGBB` colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The text color (white or the dark text token) that reads best on `background`, with its ratio. */
export function readableTextOn(background: string): { color: string; ratio: number } {
  const light = contrastRatio(background, LIGHT_TEXT);
  const dark = contrastRatio(background, DARK_TEXT);
  return light >= dark ? { color: LIGHT_TEXT, ratio: light } : { color: DARK_TEXT, ratio: dark };
}

/** True when some allowed text color reaches 4.5:1 on `background`. */
export function hasReadableText(background: string): boolean {
  return readableTextOn(background).ratio >= MIN_TEXT_CONTRAST;
}
