/**
 * Pure helpers of the remembered screen state (PM v2, #856). No Angular, no api-client: safe to import from any chunk.
 */

/** The screen sections that remember state; the server accepts exactly these ids (`UserViewService.Surfaces`). */
export const VIEW_SURFACES = [
  'my-matters.attention',
  'my-matters.deadlines',
  'my-matters.since-last-visit',
  'my-matters.activity',
  'my-matters.breakdown',
  'my-matters.data',
  'my-matters.focus',
  'task-queue',
  'assets',
] as const;

export type ViewSurface = (typeof VIEW_SURFACES)[number];

/** A remembered state is a plain JSON object. */
export type ViewState = Record<string, unknown>;

/** Server limit of one state, in UTF-8 bytes. */
export const VIEW_STATE_MAX_BYTES = 4096;

export function isViewState(value: unknown): value is ViewState {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the state would be accepted by the server (a small JSON object). */
export function fitsViewState(state: ViewState): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(state)).length <= VIEW_STATE_MAX_BYTES;
  } catch {
    return false;
  }
}

/**
 * The state a screen opens with: the defaults, then the remembered state, then whatever the address says explicitly. The address wins, so a
 * link such as `?type=5` always shows what it says, whatever was remembered. Keys with `undefined` in a layer do not override the one below.
 */
export function mergeViewState<T extends ViewState>(
  defaults: T,
  remembered: Partial<T> | null | undefined,
  explicit: Partial<T> | null | undefined,
): T {
  const out: ViewState = { ...defaults };
  for (const layer of [remembered, explicit]) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out as T;
}
