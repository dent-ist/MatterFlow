import { ApiError } from '../../core/http/api-error';
import { IMAGE_MAX_PER_NOTE } from './note-image-size';

/** Why an image could not be added; one key per row of the design note's table (4.5). */
export type ImageFailureReason =
  'size' | 'type' | 'count' | 'offline' | 'access' | 'inactive' | 'pending';

export interface ImageFailure {
  readonly reason: ImageFailureReason;
  /** True when sending the same bytes again can work (a lost connection); false when the person has to change something. */
  readonly retry: boolean;
}

/** The words of the image states (rule D-46d): one table, sentence case; the failure block is inline, never a toast (D-51). */
export const IMAGE_COPY = {
  failTitle: "Couldn't add the image.",
  uploading: 'Adding image...',
  pastedName: 'pasted image',
  retry: 'Retry',
  remove: 'Remove',
  saveOff: 'Save is off until the image is added or removed.',
  reasons: {
    size: 'It is larger than 2 MB even after shrinking. Crop it or take a smaller screenshot.',
    type: "This image type isn't supported. Paste a PNG or JPEG, or take a screenshot.",
    count: `A note can hold up to ${IMAGE_MAX_PER_NOTE} images. Remove one first.`,
    offline: "The upload didn't finish. Check your connection and try again.",
    access: "You don't have permission to add images to this matter's notes.",
    inactive: "This matter is inactive; notes can't get new images.",
    pending: 'Too many images are waiting to be saved. Save or cancel this note first.',
  } satisfies Record<ImageFailureReason, string>,
  missingTitle: 'This image is no longer available.',
  missingHelp: 'It was removed from the matter. The text around it is still here.',
  loadFailed: "Couldn't load the image.",
  openFull: 'Open full size',
  barLabel: 'Image tools',
  altText: 'Alt Text',
  removeImage: 'Remove Image',
  detailsTitle: 'Image Details',
  detailsSave: 'Save Changes',
  altHelp: 'Read aloud by screen readers and found by search.',
  sizeLabel: 'Size',
  widthLabel: 'Width (px)',
  widthError: (max: number): string => `Enter a width from 48 to ${max} px.`,
  widthHelp: (h: number, nw: number, nh: number): string =>
    `Height follows: ${h} px. Original is ${nw} x ${nh} px.`,
  liveAdded: 'Image added.',
  liveFailed: "Couldn't add the image.",
  liveRemoved: 'Image removed.',
  copyFailed: (n: number): string =>
    `Couldn't copy ${n === 1 ? 'a pasted image' : `${n} pasted images`} into this note. ${n === 1 ? 'It was' : 'They were'} left out.`,
  leftOut: (n: number): string =>
    `${n} ${n === 1 ? 'image was' : 'images were'} left out of the template.`,
  goneSummary: (n: number): string =>
    `${n} ${n === 1 ? 'image was' : 'images were'} no longer available`,
  goneDetail: 'They were taken out of the note when it was saved.',
  otherMatterSummary: (n: number): string =>
    `${n} ${n === 1 ? 'image belongs' : 'images belong'} to another matter`,
  otherMatterDetail:
    'They were left out of the note. Paste them again to copy them into this matter.',
  saveTooMany: `A note can hold up to ${IMAGE_MAX_PER_NOTE} images. Remove some and save again.`,
  willLeaveOut: (n: number): string =>
    `${n} ${n === 1 ? 'image' : 'images'} will be left out of the template.`,
} as const;

/** Maps what the upload (or the copy) answered to the row of the table. */
export function failureOf(e: unknown): ImageFailure {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'IMAGE_TOO_LARGE':
        return { reason: 'size', retry: false };
      case 'IMAGE_TYPE_UNSUPPORTED':
      case 'IMAGE_CORRUPT':
      case 'IMAGE_REQUIRED':
        return { reason: 'type', retry: false };
      case 'MATTER_INACTIVE':
        return { reason: 'inactive', retry: false };
      case 'TOO_MANY_PENDING_IMAGES':
        return { reason: 'pending', retry: false };
      default:
    }
    if (e.status === 413) return { reason: 'size', retry: false };
    if (e.status === 415) return { reason: 'type', retry: false };
    if (e.status === 401 || e.status === 403 || e.status === 404)
      return { reason: 'access', retry: false };
    return { reason: 'offline', retry: true };
  }
  return { reason: 'offline', retry: true };
}
