/**
 * The sums of a note image (design note `docs/ux/notes-round-2/README.md` 4.5 and 4.6, rule D-46d): the limits, the presets, the size an image gets when it is
 * pasted, and how a new width is clamped. Pure functions, no DOM: the image node, the Image Details dialog and the specs use the same ones, so the stored `width` and
 * `height` always follow one rule (aspect ratio kept, at least 48 px, at most the natural width and the room the text leaves).
 */

/** The longest side the browser keeps when it re-draws a pasted image. */
export const IMAGE_MAX_SIDE = 1_600;
/** The server's limit per image, in bytes (checked after the re-draw). */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Images per note (the server answers `TOO_MANY_IMAGES` above this). */
export const IMAGE_MAX_PER_NOTE = 20;
/** The narrowest an image can be made. */
export const IMAGE_MIN_WIDTH = 48;
/** The width a pasted image gets at most (and never more than its natural width or the room in the text). */
export const IMAGE_PASTE_WIDTH = 720;
/** The alt text of a pasted image: never empty, so a screen reader announces something. */
export const IMAGE_DEFAULT_ALT = 'Pasted image';
export const IMAGE_ALT_MAX = 200;

export type SizePreset = 'small' | 'medium' | 'large' | 'original' | 'fit';

/** The buttons of the image bar and of Image Details, in order. */
export const SIZE_PRESETS: readonly { key: SizePreset; label: string; width: number | null }[] = [
  { key: 'small', label: 'Small', width: 240 },
  { key: 'medium', label: 'Medium', width: 480 },
  { key: 'large', label: 'Large', width: 720 },
  { key: 'original', label: 'Original', width: null },
  { key: 'fit', label: 'Fit to Width', width: null },
];

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** `room` is the width the text leaves for the image; 0 or a missing value means "not measured" and puts no limit. */
function limit(room: number | null | undefined): number {
  return room && Number.isFinite(room) && room > 0 ? room : Number.POSITIVE_INFINITY;
}

/** The widest an image may be: its natural width, and the room in the text. Never below the minimum. */
export function maxWidth(natural: number, room?: number | null): number {
  return Math.max(IMAGE_MIN_WIDTH, Math.floor(Math.min(natural, limit(room))));
}

/** A width the person asked for, rounded and held between 48 px and `maxWidth`. */
export function clampWidth(width: number, natural: number, room?: number | null): number {
  const w = Number.isFinite(width) ? Math.round(width) : IMAGE_MIN_WIDTH;
  return Math.min(maxWidth(natural, room), Math.max(IMAGE_MIN_WIDTH, w));
}

/** The height that goes with a width: the aspect ratio of the natural size, at least 1 px. */
export function heightFor(width: number, natural: ImageSize): number {
  if (natural.width <= 0) return Math.max(1, Math.round(width));
  return Math.max(1, Math.round((width * natural.height) / natural.width));
}

/** The size a pasted image is inserted at: the smaller of its natural width, 720 px and the room. */
export function pastedSize(natural: ImageSize, room?: number | null): ImageSize {
  const width = clampWidth(Math.min(natural.width, IMAGE_PASTE_WIDTH), natural.width, room);
  return { width, height: heightFor(width, natural) };
}

/** The width a preset button gives (clamped: Large on a small image is its natural width). */
export function presetWidth(key: SizePreset, natural: ImageSize, room?: number | null): number {
  const base = SIZE_PRESETS.find((p) => p.key === key)?.width;
  const wanted =
    key === 'original' ? natural.width : key === 'fit' ? limit(room) : (base ?? natural.width);
  return clampWidth(Number.isFinite(wanted) ? wanted : natural.width, natural.width, room);
}

/** Which preset the width equals right now (for `aria-pressed`), or null. */
export function activePreset(
  width: number,
  natural: ImageSize,
  room?: number | null,
): SizePreset | null {
  for (const p of SIZE_PRESETS) if (presetWidth(p.key, natural, room) === width) return p.key;
  return null;
}

/** "480 x 300 px · 50% of original", the readout near a selected image. */
export function readoutText(size: ImageSize, natural: ImageSize): string {
  const pct = natural.width > 0 ? Math.round((size.width / natural.width) * 100) : 100;
  return `${size.width} x ${size.height} px · ${pct}% of original`;
}

/** The text of the exact Width field: digits only; null when it is not a whole number of at least 1. */
export function parseWidth(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,5}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** The size after the shrink to 1,600 px on the long side (never an enlargement). */
export function fitLongSide(
  width: number,
  height: number,
  side: number = IMAGE_MAX_SIDE,
): ImageSize {
  const long = Math.max(width, height);
  if (long <= side) return { width, height };
  const k = side / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
