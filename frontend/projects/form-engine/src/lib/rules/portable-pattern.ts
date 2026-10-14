/**
 * The portable regular-expression subset of contracts/form-rules.md section 3.1. A pattern in this subset
 * means the same in JavaScript (no flags) and in .NET (`RegexOptions.ECMAScript`, after the server's `.`/`$`
 * translation), so it can be passed to `new RegExp(pattern)` unchanged. The subset also excludes the shapes that
 * backtrack exponentially or with a high polynomial degree (nested quantifiers, quantified alternation, adjacent
 * unbounded quantifiers), because JavaScript regular expressions have no timeout (security review SEC-05).
 */

const MAX_PATTERN_LENGTH = 200;
const SYNTAX_CHARS = '^$\\.*+?()[]{}|/-';
const CLASS_ESCAPES = 'dDwW';
const SINGLE_ESCAPES: Record<string, number> = { t: 9, n: 10, r: 13, f: 12, v: 11 };

/** What a piece of the pattern contains that matters for backtracking. */
interface Info {
  /** A quantifier with min != max (`* + ? {n,} {n,m}`). */
  variable: boolean;
  /** An alternation (`|`). */
  alt: boolean;
}

interface Atom extends Partial<Info> {
  quantifiable: boolean;
  group?: boolean;
}

/** A quantifier's bounds; unbounded is `max === Infinity`. */
interface Quantifier {
  min: number;
  max: number;
}

const isQuantifierStart = (c: string | undefined): boolean => c !== undefined && '*+?{'.includes(c);

/** True when `pattern` uses only the portable subset. */
export function isPortablePattern(pattern: unknown): pattern is string {
  if (typeof pattern !== 'string' || pattern.length < 1 || pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  const p = pattern;
  const n = p.length;
  let i = 0;

  /** One escaped or literal character usable as a class range end: its code, or null. */
  const single = (): number | null => {
    const c = p[i];
    if (c === undefined || c === ']' || c === '[' || c === '-') return null;
    if (c !== '\\') {
      i++;
      return c.charCodeAt(0);
    }
    const e = p[i + 1];
    if (e === undefined) return null;
    if (e in SINGLE_ESCAPES) {
      i += 2;
      return SINGLE_ESCAPES[e];
    }
    if (SYNTAX_CHARS.includes(e)) {
      i += 2;
      return e.charCodeAt(0);
    }
    return null;
  };

  const parseClass = (): Atom | null => {
    i++;
    if (p[i] === '^') i++;
    let items = 0;
    let previous: number | null = null;
    for (;;) {
      if (i >= n) return null;
      const c = p[i];
      if (c === ']') {
        if (items === 0) return null;
        i++;
        return { quantifiable: true };
      }
      if (c === '[') return null;
      if (c === '-') {
        if (items === 0 || p[i + 1] === ']') {
          i++;
          items++;
          previous = null;
          continue;
        }
        if (previous === null) return null;
        i++;
        const high = single();
        if (high === null || high < previous) return null;
        previous = null;
        continue;
      }
      if (c === '\\' && i + 1 < n && CLASS_ESCAPES.includes(p[i + 1])) {
        i += 2;
        items++;
        previous = null;
        continue;
      }
      const code = single();
      if (code === null) return null;
      items++;
      previous = code;
    }
  };

  /** Parses a quantifier (and optional lazy marker); returns its bounds, or null when malformed. */
  const parseQuantifier = (): Quantifier | null => {
    let min: number;
    let max: number;
    const c = p[i];
    if (c === '*' || c === '+' || c === '?') {
      i++;
      min = c === '+' ? 1 : 0;
      max = c === '?' ? 1 : Infinity;
    } else {
      const m = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(p.slice(i));
      if (!m) return null;
      min = +m[1];
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : +m[3];
      if (max < min) return null;
      i += m[0].length;
    }
    if (p[i] === '?') i++;
    if (i < n && isQuantifierStart(p[i])) return null;
    return { min, max };
  };

  const parseAtom = (): Atom | null => {
    const c = p[i];
    if (c === '(') {
      i++;
      if (p[i] === '?') {
        if (p[i + 1] !== ':') return null;
        i += 2;
      }
      const inner = parseAlt();
      if (!inner || p[i] !== ')') return null;
      i++;
      return { quantifiable: true, group: true, variable: inner.variable, alt: inner.alt };
    }
    if (c === '[') return parseClass();
    if (c === '\\') {
      const e = p[i + 1];
      if (e === undefined) return null;
      i += 2;
      if (e === 'b' || e === 'B') return { quantifiable: false };
      return 'dDwWtnrfv'.includes(e) || SYNTAX_CHARS.includes(e) ? { quantifiable: true } : null;
    }
    if (c === '^' || c === '$') {
      i++;
      return { quantifiable: false };
    }
    if ('*+?{}]'.includes(c)) return null;
    i++;
    return { quantifiable: true };
  };

  const parseSeq = (): Info | null => {
    let variable = false;
    let alt = false;
    let previousUnbounded = false;
    while (i < n && p[i] !== '|' && p[i] !== ')') {
      const atom = parseAtom();
      if (!atom) return null;
      variable ||= !!atom.variable;
      alt ||= !!atom.alt;
      let unbounded = false;
      if (i < n && isQuantifierStart(p[i])) {
        if (!atom.quantifiable) return null;
        const q = parseQuantifier();
        if (!q) return null;
        // Backtracking hazards (security review SEC-05): a repeated group may not contain a variable-count quantifier
        // or an alternation, and two unbounded quantifiers may not be directly adjacent.
        if (atom.group && q.max > 1 && (atom.variable || atom.alt)) return null;
        unbounded = q.max === Infinity;
        if (unbounded && previousUnbounded) return null;
        variable ||= q.min !== q.max;
      }
      previousUnbounded = unbounded;
    }
    return { variable, alt };
  };

  const parseAlt = (): Info | null => {
    let variable = false;
    let alt = false;
    for (;;) {
      const seq = parseSeq();
      if (!seq) return null;
      variable ||= seq.variable;
      alt ||= seq.alt;
      if (p[i] === '|') {
        i++;
        alt = true;
        continue;
      }
      return { variable, alt };
    }
  };

  return parseAlt() !== null && i === n;
}
