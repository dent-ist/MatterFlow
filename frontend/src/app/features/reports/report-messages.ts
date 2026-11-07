import { ApiError } from '../../core/http/api-error';

/**
 * The words of everything that can go wrong with a run (spec 3.5 and 1.4 of `ui-spec-user-pages.md`; fixed sentences, D-51). They are shown inline in
 * a banner above the result, never as a toast, and never contain SQL: the server's own text is used only for the few cases the spec has no sentence for.
 */
export interface RunBanner {
  /** warning (amber, a limit), danger (red, a failure) or info (blue). */
  readonly tone: 'warning' | 'danger' | 'info';
  readonly text: string;
  /** The support reference of a failure ("Reference: 3F9A12BC" with Copy Reference). */
  readonly reference?: string;
  /** A text button in the banner. */
  readonly action?: 'cancelRunning';
}

/**
 * The runs-per-hour limit of the sentence in spec 3.5. The server counts it from `Reports:RunsPerUserPerHour` (default 30) and does not send it,
 * so this is the documented default; if an administrator changes the setting, the sentence keeps the default number.
 */
export const RUNS_PER_HOUR = 30;

export type RunOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'notAvailable' }
  | { readonly kind: 'fields'; readonly errors: Readonly<Record<string, string>> }
  | { readonly kind: 'banner'; readonly banner: RunBanner };

/** What the person is told about a failed run: nothing (it was cancelled), the field messages of a 422, the "no access" page, or a banner. */
export function outcomeOf(error: unknown, limits: { timeoutSeconds: number }): RunOutcome {
  if (!(error instanceof ApiError)) return failed();
  const reference = referenceOf(error);
  switch (error.code) {
    case 'REPORT_CANCELLED':
      return { kind: 'cancelled' };
    case 'REPORT_PARAMETERS_INVALID':
      return { kind: 'fields', errors: fieldErrorsOf(error) };
    case 'REPORT_ALREADY_RUNNING':
      return banner({
        tone: 'warning',
        text: 'Another report is already running for you. Wait for it to finish or cancel it.',
        action: 'cancelRunning',
      });
    case 'REPORT_RATE_LIMITED':
      return banner({
        tone: 'warning',
        text: `You've reached the limit of ${RUNS_PER_HOUR} runs per hour. Try again later.`,
      });
    case 'REPORT_BUSY':
      return banner({
        tone: 'warning',
        text: 'The server is busy with other reports. Try again in a minute.',
      });
    case 'REPORT_MEMORY':
      return banner({
        tone: 'warning',
        text: 'This report needs more memory than is available. Narrow the parameters and try again.',
      });
    case 'REPORT_TIMEOUT':
      return banner({
        tone: 'warning',
        text: `The report took longer than ${limits.timeoutSeconds} seconds and was stopped. Narrow the parameters and try again.`,
      });
    case 'REPORT_INVALID':
      return banner({
        tone: 'danger',
        text: 'This report cannot be run. Tell an administrator.',
        reference,
      });
    case 'REPORT_CHOICES_FAILED':
      return banner({
        tone: 'danger',
        text: "A list of choices couldn't be loaded. Try again or tell an administrator.",
        reference,
      });
    case 'REPORTS_UNAVAILABLE':
      return banner({
        tone: 'warning',
        text: 'Reports are not available right now. Ask an administrator.',
      });
    default:
      if (error.status === 404) return { kind: 'notAvailable' };
      return failed(reference);
  }
}

function banner(b: RunBanner): RunOutcome {
  return { kind: 'banner', banner: b };
}

function failed(reference?: string): RunOutcome {
  return banner({ tone: 'danger', text: "The report couldn't be run.", reference });
}

/** The support reference the server put in the problem (`reference`), if any. */
function referenceOf(error: ApiError): string | undefined {
  const ref = (error.problem as Record<string, unknown> | undefined)?.['reference'];
  return typeof ref === 'string' && ref !== '' ? ref : undefined;
}

/** `parameters.NAME` entries of a 422 as one message per parameter name (the first one of each). */
export function fieldErrorsOf(error: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, list] of Object.entries(error.problem?.errors ?? {})) {
    const name = key.replace(/^parameters\./i, '');
    const first = list[0]?.message;
    if (first) out[name] = first;
  }
  return out;
}
