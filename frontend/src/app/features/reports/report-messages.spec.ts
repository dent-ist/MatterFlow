import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import { fieldErrorsOf, outcomeOf } from './report-messages';

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): ApiError =>
  ApiError.from(
    new HttpErrorResponse({ status, error: { status, code, detail: 'Server text', ...extra } }),
  );

describe('the words of a failed run (spec 3.5)', () => {
  const limits = { timeoutSeconds: 45 };
  const bannerOf = (error: unknown) => {
    const outcome = outcomeOf(error, limits);
    if (outcome.kind !== 'banner') throw new Error(`Expected a banner, got ${outcome.kind}`);
    return outcome.banner;
  };

  it('409 says another report is running and offers to cancel it', () => {
    const b = bannerOf(problem(409, 'REPORT_ALREADY_RUNNING'));
    expect(b.text).toBe(
      'Another report is already running for you. Wait for it to finish or cancel it.',
    );
    expect(b.action).toBe('cancelRunning');
    expect(b.tone).toBe('warning');
  });

  it('429 has two sentences, one for the hourly limit and one for a busy server', () => {
    expect(bannerOf(problem(429, 'REPORT_RATE_LIMITED')).text).toBe(
      "You've reached the hourly limit for report runs. Try again later.",
    );
    expect(bannerOf(problem(429, 'REPORT_BUSY')).text).toBe(
      'The server is busy with other reports. Try again in a minute.',
    );
  });

  it('503 memory and 408 timeout use the limit of the report, not a built-in number', () => {
    expect(bannerOf(problem(503, 'REPORT_MEMORY')).text).toBe(
      'This report needs more memory than is available. Narrow the parameters and try again.',
    );
    expect(bannerOf(problem(408, 'REPORT_TIMEOUT')).text).toBe(
      'The report took longer than 45 seconds and was stopped. Narrow the parameters and try again.',
    );
  });

  it('500 says the report could not be run and carries the support reference', () => {
    const b = bannerOf(problem(500, 'REPORT_FAILED', { reference: '3F9A12BC' }));
    expect(b.text).toBe("The report couldn't be run.");
    expect(b.reference).toBe('3F9A12BC');
    expect(b.tone).toBe('danger');
  });

  it('never shows the text of the server for a failure, and an unknown failure is the generic sentence', () => {
    expect(bannerOf(problem(500, 'SOMETHING_NEW')).text).toBe("The report couldn't be run.");
    expect(bannerOf(new Error('boom')).text).toBe("The report couldn't be run.");
  });

  it('499 is a cancel and says nothing, 404 is the no-access page, 422 goes to the fields', () => {
    expect(outcomeOf(problem(499, 'REPORT_CANCELLED'), limits).kind).toBe('cancelled');
    expect(outcomeOf(problem(404, 'NOT_FOUND'), limits).kind).toBe('notAvailable');
    const fields = outcomeOf(
      problem(422, 'REPORT_PARAMETERS_INVALID', {
        errors: { 'parameters.FROM': [{ code: 'INVALID_TYPE', message: 'Not a date.' }] },
      }),
      limits,
    );
    expect(fields).toEqual({ kind: 'fields', errors: { FROM: 'Not a date.' } });
  });

  it('reads parameters.NAME keys without the prefix and keeps the first message of each', () => {
    const e = problem(422, 'REPORT_PARAMETERS_INVALID', {
      errors: {
        'parameters.A': [
          { code: 'X', message: 'First' },
          { code: 'Y', message: 'Second' },
        ],
        B: [{ code: 'X', message: 'Other' }],
      },
    });
    expect(fieldErrorsOf(e)).toEqual({ A: 'First', B: 'Other' });
  });
});
