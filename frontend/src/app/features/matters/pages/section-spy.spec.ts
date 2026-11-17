import { pickSection } from './section-spy';

// Six sections like the Matter page: Summary, Tasks, Projects, Assets, Productions (empty, short), Notes (short).
const tops = [0, 600, 1500, 1900, 2500, 2700];
const base = { docTops: tops, line: 100 };

describe('pickSection', () => {
  it('is the first section at the top and when there are no sections', () => {
    expect(pickSection({ ...base, scrollY: 0, maxScroll: 3000 })).toBe(0);
    expect(pickSection({ docTops: [], line: 0, scrollY: 50, maxScroll: 100 })).toBe(-1);
  });

  it('is the last section whose top is above the line while every section can reach the line', () => {
    const max = 5000;
    expect(pickSection({ ...base, scrollY: 400, maxScroll: max })).toBe(0);
    expect(pickSection({ ...base, scrollY: 500, maxScroll: max })).toBe(1);
    expect(pickSection({ ...base, scrollY: 2400, maxScroll: max })).toBe(4);
    expect(pickSection({ ...base, scrollY: 2600, maxScroll: max })).toBe(5);
  });

  it('gives short sections at the end of the page their turn, in order, and the last one at the bottom', () => {
    // Page ends at 2450: Productions (2500) and Notes (2700) never reach the line.
    const max = 2450;
    const seen: number[] = [];
    for (let y = 1; y <= max; y += 10) {
      const k = pickSection({ ...base, scrollY: y, maxScroll: max });
      if (seen[seen.length - 1] !== k) seen.push(k);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pickSection({ ...base, scrollY: max, maxScroll: max })).toBe(5);
  });

  it('never goes backwards while scrolling down, whatever the page length', () => {
    for (const max of [700, 1500, 2100, 2450, 2650, 3000]) {
      let last = 0;
      for (let y = 0; y <= max; y += 7) {
        const k = pickSection({ ...base, scrollY: y, maxScroll: max });
        expect(k).toBeGreaterThanOrEqual(last);
        last = k;
      }
      expect(last).toBe(5);
    }
  });

  it('works for a page with one section and for a page that cannot scroll far', () => {
    expect(pickSection({ docTops: [0], line: 100, scrollY: 40, maxScroll: 40 })).toBe(0);
    expect(pickSection({ docTops: [0, 300], line: 100, scrollY: 30, maxScroll: 30 })).toBe(1);
    expect(pickSection({ docTops: [0, 300], line: 100, scrollY: 10, maxScroll: 30 })).toBe(0);
  });
});
