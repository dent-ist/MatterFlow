/**
 * The portable regular-expression subset of contracts/form-rules.md section 3.1. A pattern in this subset
 * means the same in JavaScript (no flags) and in .NET (`RegexOptions.ECMAScript`, after the server's `.`/`$`
 * translation), so it can be passed to `new RegExp(pattern)` unchanged.
 */

const MAX_PATTERN_LENGTH = 200;
const SYNTAX_CHARS = '^$\\.*+?()[]{}|/-';
const CLASS_ESCAPES = 'dDwW';
const SINGLE_ESCAPES: Record<string, number> = { t: 9, n: 10, r: 13, f: 12, v: 11 };

interface Atom {
  quantifiable: boolean;
  group?: boolean;
  unbounded?: boolean;
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

  /** Parses a quantifier; returns whether it is unbounded, or null when malformed. */
  const parseQuantifier = (): { unbounded: boolean } | null => {
    let unbounded: boolean;
    const c = p[i];
    if (c === '*' || c === '+' || c === '?') {
      i++;
      unbounded = c !== '?';
    } else {
      const m = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(p.slice(i));
      if (!m) return null;
      const low = +m[1];
      const high = m[2] === undefined ? low : m[3] === '' ? Infinity : +m[3];
      if (high < low) return null;
      i += m[0].length;
      unbounded = high === Infinity;
    }
    if (p[i] === '?') i++;
    if (i < n && isQuantifierStart(p[i])) return null;
    return { unbounded };
  };

  const parseAtom = (): Atom | null => {
    const c = p[i];
    if (c === '(') {
      i++;
      if (p[i] === '?') {
        if (p[i + 1] !== ':') return null;
        i += 2;
      }
      const alt = parseAlt();
      if (!alt || p[i] !== ')') return null;
      i++;
      return { quantifiable: true, group: true, unbounded: alt.unbounded };
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

  const parseSeq = (): { unbounded: boolean } | null => {
    let unbounded = false;
    while (i < n && p[i] !== '|' && p[i] !== ')') {
      const atom = parseAtom();
      if (!atom) return null;
      unbounded ||= !!atom.unbounded;
      if (i < n && isQuantifierStart(p[i])) {
        if (!atom.quantifiable) return null;
        const q = parseQuantifier();
        if (!q) return null;
        if (q.unbounded && atom.group && atom.unbounded) return null;
        unbounded ||= q.unbounded;
      }
    }
    return { unbounded };
  };

  const parseAlt = (): { unbounded: boolean } | null => {
    let unbounded = false;
    for (;;) {
      const seq = parseSeq();
      if (!seq) return null;
      unbounded ||= seq.unbounded;
      if (p[i] === '|') {
        i++;
        continue;
      }
      return { unbounded };
    }
  };

  return parseAlt() !== null && i === n;
}
