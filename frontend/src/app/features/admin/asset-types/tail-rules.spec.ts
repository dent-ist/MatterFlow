import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatHint,
  hasCounter,
  nameTooLong,
  renderTail,
  tailMessage,
  validateTail,
} from './tail-rules';

interface Vector {
  name: string;
  tail: string;
  cmNumber: string;
  counter: number;
  expected?: string;
  expectedError?: string;
}

function vectors(): Vector[] {
  const candidates = [
    resolve(process.cwd(), '../contracts/asset-numbering/pattern-vectors.json'),
    resolve(process.cwd(), 'contracts/asset-numbering/pattern-vectors.json'),
  ];
  for (const path of candidates) {
    try {
      return (JSON.parse(readFileSync(path, 'utf8')) as { vectors: Vector[] }).vectors;
    } catch {
      // try the next place
    }
  }
  throw new Error('pattern-vectors.json not found');
}

describe('tail rules against the shared vectors', () => {
  const all = vectors();

  it('reads the vectors file', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  for (const v of all) {
    it(v.name, () => {
      const error = validateTail(v.tail);
      if (v.expectedError) {
        expect(error?.code).toBe(v.expectedError);
        expect(renderTail(v.cmNumber, v.tail, v.counter)).toBeNull();
      } else {
        expect(error).toBeNull();
        expect(renderTail(v.cmNumber, v.tail, v.counter)).toBe(v.expected);
      }
    });
  }
});

describe('tail helpers', () => {
  it('names the offending token and cuts it at 30 characters', () => {
    const error = validateTail('_{client number}_{###}');
    expect(tailMessage(error!)).toBe(
      '"{client number}" isn’t a token. The only token is the counter {###}.',
    );
    const long = validateTail('_{' + 'a'.repeat(40) + '}{###}');
    expect(tailMessage(long!)).toContain('…');
  });

  it('has the spec sentence for a trailing dot', () => {
    expect(tailMessage({ code: 'PATTERN_TRAILING_DOT' })).toBe('The name can’t end with a dot.');
  });

  it('detects a counter and the 100 character name', () => {
    expect(hasCounter('_{###}')).toBe(true);
    expect(hasCounter('_x')).toBe(false);
    expect(nameTooLong('90003-80008', '_{###}')).toBe(false);
    expect(nameTooLong('90003-80008', 'x'.repeat(45) + '{###}', 60)).toBe(true);
  });

  it('builds the form hint', () => {
    expect(formatHint('90003-80008', '-M-{###}')).toBe('90003-80008-M-###');
  });
});
