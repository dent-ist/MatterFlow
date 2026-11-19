import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import { IMAGE_COPY, failureOf } from './note-image-copy';

const err = (status: number, code?: string) =>
  new ApiError(status, code, 'x', undefined, new HttpErrorResponse({ status }));

describe('failureOf', () => {
  it('maps every upload answer to a row of the design table', () => {
    expect(failureOf(err(413, 'IMAGE_TOO_LARGE')).reason).toBe('size');
    expect(failureOf(err(415, 'IMAGE_TYPE_UNSUPPORTED')).reason).toBe('type');
    expect(failureOf(err(400, 'IMAGE_CORRUPT')).reason).toBe('type');
    expect(failureOf(err(400, 'IMAGE_REQUIRED')).reason).toBe('type');
    expect(failureOf(err(409, 'MATTER_INACTIVE')).reason).toBe('inactive');
    expect(failureOf(err(409, 'TOO_MANY_PENDING_IMAGES')).reason).toBe('pending');
    expect(failureOf(err(403)).reason).toBe('access');
    expect(failureOf(err(404)).reason).toBe('access');
  });

  it('offers Retry only when the same bytes can work', () => {
    expect(failureOf(err(0)).retry).toBe(true);
    expect(failureOf(err(500)).retry).toBe(true);
    expect(failureOf(new Error('x')).retry).toBe(true);
    expect(failureOf(err(415, 'IMAGE_TYPE_UNSUPPORTED')).retry).toBe(false);
    expect(failureOf(err(413, 'IMAGE_TOO_LARGE')).retry).toBe(false);
    expect(failureOf(err(413)).retry).toBe(false);
    expect(failureOf(err(415)).retry).toBe(false);
    expect(failureOf(err(400, 'IMAGE_CORRUPT')).retry).toBe(false);
    expect(failureOf(err(409, 'MATTER_INACTIVE')).retry).toBe(false);
  });

  it('has the words of the design note', () => {
    expect(IMAGE_COPY.failTitle).toBe("Couldn't add the image.");
    expect(IMAGE_COPY.reasons.count).toBe('A note can hold up to 20 images. Remove one first.');
    expect(IMAGE_COPY.leftOut(2)).toBe('2 images were left out of the template.');
    expect(IMAGE_COPY.leftOut(1)).toBe('1 image was left out of the template.');
  });
});
