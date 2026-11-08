/**
 * The Asset Number tail (#1297): the text the administrator adds after the matter's CM Number. One pure function pair, the browser twin of the
 * backend rules; both are tested against `contracts/asset-numbering/pattern-vectors.json`, which is the single source of truth.
 */

/** The stable codes of the tail rules (the backend answers the same codes on `numbering.pattern`). */
export type TailCode =
  | 'PATTERN_NO_COUNTER'
  | 'PATTERN_TWO_COUNTERS'
  | 'PATTERN_UNKNOWN_TOKEN'
  | 'PATTERN_COUNTER_WIDTH'
  | 'PATTERN_FORBIDDEN_CHAR'
  | 'PATTERN_EDGE_SPACE'
  | 'PATTERN_TRAILING_DOT'
  | 'PATTERN_TOO_LONG';

export interface TailError {
  code: TailCode;
  /** The offending token text, only for PATTERN_UNKNOWN_TOKEN. */
  token?: string;
}

export const TAIL_MAX_LENGTH = 50;
export const TAIL_DEFAULT = '_{###}';
export const TAIL_COUNTER = '{###}';
/** The longest Asset Number the server stores. */
export const NUMBER_MAX_LENGTH = 100;
export const COUNTER_MAX_WIDTH = 9;

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

/** The sentences of the rules, keyed by code (the spec's wording wins over the backend's text). */
export function tailMessage(error: TailError, tooLongName = false): string {
  switch (error.code) {
    case 'PATTERN_FORBIDDEN_CHAR':
      return 'The tail can’t contain \\ / : * ? " < > | or control characters.';
    case 'PATTERN_UNKNOWN_TOKEN': {
      const text = error.token ?? '';
      const shown = text.length > 30 ? `${text.slice(0, 30)}…` : text;
      return `"${shown}" isn’t a token. The only token is the counter {###}.`;
    }
    case 'PATTERN_EDGE_SPACE':
      return 'The tail can’t start or end with a space.';
    case 'PATTERN_TRAILING_DOT':
      return 'The name can’t end with a dot.';
    case 'PATTERN_TOO_LONG':
      return tooLongName
        ? 'The whole name would be longer than 100 characters. Shorten the tail.'
        : `The tail must be ${TAIL_MAX_LENGTH} characters or fewer.`;
    case 'PATTERN_NO_COUNTER':
      return 'Add a counter, for example {###}.';
    case 'PATTERN_TWO_COUNTERS':
      return 'Use only one counter.';
    case 'PATTERN_COUNTER_WIDTH':
      return `The counter must have 1 to ${COUNTER_MAX_WIDTH} # characters.`;
  }
}

/** Is this a code the browser knows (a server refusal with any other code falls back to a generic message)? */
export function isTailCode(code: string | undefined): code is TailCode {
  return (
    code === 'PATTERN_NO_COUNTER' ||
    code === 'PATTERN_TWO_COUNTERS' ||
    code === 'PATTERN_UNKNOWN_TOKEN' ||
    code === 'PATTERN_COUNTER_WIDTH' ||
    code === 'PATTERN_FORBIDDEN_CHAR' ||
    code === 'PATTERN_EDGE_SPACE' ||
    code === 'PATTERN_TRAILING_DOT' ||
    code === 'PATTERN_TOO_LONG'
  );
}

/** The first rule the tail breaks, or null when it is valid. Order: length, edge space, trailing dot, then left to right, then "has a counter". */
export function validateTail(tail: string): TailError | null {
  if (tail.length > TAIL_MAX_LENGTH) return { code: 'PATTERN_TOO_LONG' };
  if (tail.startsWith(' ') || tail.endsWith(' ')) return { code: 'PATTERN_EDGE_SPACE' };
  if (tail.endsWith('.')) return { code: 'PATTERN_TRAILING_DOT' };
  let counters = 0;
  let i = 0;
  while (i < tail.length) {
    const ch = tail[i];
    if (ch === '{') {
      const close = tail.indexOf('}', i + 1);
      const inner = close < 0 ? '' : tail.slice(i + 1, close);
      // A group must close, hold no other brace and be only # characters.
      if (close < 0 || inner.includes('{') || !/^#+$/.test(inner)) {
        // An unclosed or nested group is reported with the text up to the next brace or the end.
        const stop = close < 0 ? tail.length : close + 1;
        const nested = tail.indexOf('{', i + 1);
        const end = nested >= 0 && nested < stop ? nested : stop;
        return { code: 'PATTERN_UNKNOWN_TOKEN', token: tail.slice(i, end) };
      }
      if (inner.length > COUNTER_MAX_WIDTH) return { code: 'PATTERN_COUNTER_WIDTH' };
      counters++;
      if (counters > 1) return { code: 'PATTERN_TWO_COUNTERS' };
      i = close + 1;
      continue;
    }
    if (ch === '}') return { code: 'PATTERN_UNKNOWN_TOKEN', token: '}' };
    if (FORBIDDEN.test(ch)) return { code: 'PATTERN_FORBIDDEN_CHAR' };
    i++;
  }
  if (counters === 0) return { code: 'PATTERN_NO_COUNTER' };
  return null;
}

/** True while the whole name would pass the server's 100-character limit (the counter counted at its minimum width). */
export function nameTooLong(cmNumber: string, tail: string, longestCmNumber?: number): boolean {
  const width = /\{(#+)\}/.exec(tail)?.[1].length ?? 0;
  const length = tail.replace(/\{#+\}/, '').length + width;
  return Math.max(cmNumber.length, longestCmNumber ?? 0) + length > NUMBER_MAX_LENGTH;
}

/** True when the tail already holds a counter token (the Counter button is then disabled). */
export function hasCounter(tail: string): boolean {
  return /\{#+\}/.test(tail);
}

/** The whole Asset Number: the CM Number, the tail with its counter zero padded to the minimum width (never cut). Null when the tail is invalid. */
export function renderTail(cmNumber: string, tail: string, counter: number): string | null {
  if (validateTail(tail)) return null;
  return cmNumber + renderTailPart(tail, counter);
}

/** The tail alone with the counter filled in (the Example shows the CM Number in a muted colour and this part in the text colour). */
export function renderTailPart(tail: string, counter: number): string {
  return tail.replace(/\{(#+)\}/, (_m, hashes: string) =>
    String(counter).padStart(hashes.length, '0'),
  );
}

/** The tail with the counter shown as its # characters (the minimum width), e.g. `-M-###`. */
export function tailHashes(tail: string): string {
  return tail.replace(/\{(#+)\}/, '$1');
}

/** The format hint of the New Asset form: the CM Number and the tail with the counter as its # characters, e.g. `90003-80008_###`. */
export function formatHint(cmNumber: string, tail: string): string {
  return `${cmNumber}${tailHashes(tail)}`;
}
