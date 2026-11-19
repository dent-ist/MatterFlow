import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, fitLongSide } from './note-image-size';

/** Why the browser could not make an uploadable image of a pasted file. */
export type PrepareProblem = 'type' | 'size';

export class ImagePrepareError extends Error {
  constructor(readonly problem: PrepareProblem) {
    super(problem === 'size' ? 'The image is larger than 2 MB.' : 'The image cannot be read.');
    this.name = 'ImagePrepareError';
  }
}

/** The bytes that go to the server: re-drawn (so EXIF, GPS and every other metadata chunk is gone), at most 1,600 px on the long side, PNG or JPEG, at most 2 MB. */
export interface PreparedImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly contentType: 'image/png' | 'image/jpeg';
  readonly fileName: string;
}

/** The two browser services the re-draw needs; the specs replace them (jsdom has no canvas). */
export interface PrepareDeps {
  /** Decodes the file; throws when the browser cannot read it. */
  decode(file: Blob): Promise<{ width: number; height: number; source: unknown }>;
  /** Draws the decoded image at the size on a canvas (a white background for JPEG) and exports it. `null` when the export failed. */
  encode(
    decoded: { source: unknown },
    size: { width: number; height: number },
    type: 'image/png' | 'image/jpeg',
    quality: number,
  ): Promise<Blob | null>;
}

export const browserDeps: PrepareDeps = {
  async decode(file) {
    // `imageOrientation: 'from-image'` applies the camera's rotation before the metadata is dropped.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encode(decoded, size, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (type === 'image/jpeg') {
      // theme-colour-ok: the pixels of a picture, not the theme: a JPEG has no transparency, so it is drawn on white
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
    }
    ctx.drawImage(decoded.source as CanvasImageSource, 0, 0, size.width, size.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  },
};

/** The file name for the upload: the pasted name with the extension of what is sent (the server ignores the name and reads the bytes). */
function nameFor(original: string, type: 'image/png' | 'image/jpeg'): string {
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const base = (original || 'pasted-image').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 80);
  return `${base || 'pasted-image'}.${ext}`;
}

/**
 * Re-draws a pasted image (design note 4.3 and 4.5): long side at most 1,600 px, PNG; when that is over 2 MB, JPEG at 0.85 on a white background; when that is still
 * over, `size` fails. A file the browser cannot decode (not an image, an SVG, a damaged file) fails with `type`. The re-draw drops all metadata.
 */
export async function prepareImage(
  file: Blob,
  name: string,
  deps: PrepareDeps = browserDeps,
): Promise<PreparedImage> {
  let decoded: { width: number; height: number; source: unknown };
  try {
    decoded = await deps.decode(file);
  } catch {
    throw new ImagePrepareError('type');
  }
  if (!(decoded.width > 0 && decoded.height > 0)) throw new ImagePrepareError('type');
  const size = fitLongSide(decoded.width, decoded.height, IMAGE_MAX_SIDE);
  const png = await deps.encode(decoded, size, 'image/png', 1);
  if (png && png.size <= IMAGE_MAX_BYTES) {
    return { blob: png, ...size, contentType: 'image/png', fileName: nameFor(name, 'image/png') };
  }
  const jpeg = await deps.encode(decoded, size, 'image/jpeg', 0.85);
  if (jpeg && jpeg.size <= IMAGE_MAX_BYTES) {
    return {
      blob: jpeg,
      ...size,
      contentType: 'image/jpeg',
      fileName: nameFor(name, 'image/jpeg'),
    };
  }
  if (!png && !jpeg) throw new ImagePrepareError('type');
  throw new ImagePrepareError('size');
}
