import {
  LABEL_MIN_GAP,
  addDays,
  bucketRange,
  containsDay,
  endLabelText,
  granularityOf,
  markerIndexes,
  nudgeLabels,
  pointHeading,
  rangeQuery,
  shortDate,
  weekLabel,
  weekdayOf,
  xTicks,
} from './trend-model';

/** `count` consecutive days from `from`. */
function days(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}
/** `count` consecutive Mondays from `from`. */
function weeks(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, 7 * i));
}
/** x of point i in a plot of the given width spanning n points. */
const xOf = (n: number, left: number, width: number) => (i: number) =>
  n <= 1 ? left + width / 2 : left + (width * i) / (n - 1);

describe('trend dates', () => {
  it('knows weekdays, adds days across months, years and daylight saving changes (dates only)', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-18')).toBe(0);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    // New York 2026: clocks go back on Sunday 1 Nov and forward on Sunday 8 Mar. A calendar day is never lost or doubled.
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(weekdayOf(addDays('2026-11-01', 1))).toBe(1);
    expect(shortDate('2026-10-06')).toBe('Oct 6');
    expect(weekLabel('2026-10-06')).toBe('Week of Oct 6');
    expect(pointHeading('2026-10-13', 'day')).toBe('Tue, Oct 13');
    expect(pointHeading('2026-10-12', 'week')).toBe('Week of Oct 12');
    expect(granularityOf('week')).toBe('week');
    expect(granularityOf('day')).toBe('day');
    expect(granularityOf(undefined)).toBe('day');
  });

  it('cuts a week to the period and finds the week that holds today', () => {
    expect(bucketRange('2026-10-13', 'day', '2026-09-14', '2026-10-13')).toEqual({
      from: '2026-10-13',
      to: '2026-10-13',
    });
    // First week partial (the period starts on a Thursday), last week partial (it ends on a Tuesday).
    expect(bucketRange('2026-09-07', 'week', '2026-09-10', '2026-10-13')).toEqual({
      from: '2026-09-10',
      to: '2026-09-13',
    });
    expect(bucketRange('2026-10-12', 'week', '2026-09-10', '2026-10-13')).toEqual({
      from: '2026-10-12',
      to: '2026-10-13',
    });
    expect(bucketRange('2026-09-21', 'week', '2026-09-10', '2026-10-13')).toEqual({
      from: '2026-09-21',
      to: '2026-09-27',
    });
    expect(containsDay('2026-10-12', 'week', '2026-10-13')).toBe(true);
    expect(containsDay('2026-10-05', 'week', '2026-10-13')).toBe(false);
    expect(containsDay('2026-10-13', 'day', '2026-10-13')).toBe(true);
  });

  it('week links list the flows over the cut week and the stocks at its end', () => {
    const range = { from: '2026-10-12', to: '2026-10-13' };
    expect(rangeQuery('created', range, null, true)).toBe(
      'createdFrom=2026-10-12&createdTo=2026-10-13',
    );
    expect(rangeQuery('completed', { from: '2026-09-21', to: '2026-09-27' }, 5, false)).toBe(
      'status=COMPLETED&completedFrom=2026-09-21&completedTo=2026-09-27&type=5',
    );
    expect(rangeQuery('open', { from: '2026-09-21', to: '2026-09-27' }, null, false)).toBe(
      'status=NEW&status=IN_PROGRESS&status=ON_HOLD&createdTo=2026-09-27',
    );
    expect(rangeQuery('overdue', range, null, true)).toContain('overdue=true');
    expect(rangeQuery('created', { from: '2026-10-13', to: '2026-10-13' }, null, true)).toBe(
      'createdFrom=2026-10-13&createdTo=2026-10-13',
    );
  });
});

describe('markers (T4)', () => {
  it('every point keeps its marker up to 14 points; beyond it only the ends do (the hovered day is drawn by the chart)', () => {
    expect(markerIndexes(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(markerIndexes(14)).toHaveLength(14);
    expect(markerIndexes(15)).toEqual([0, 14]);
    expect(markerIndexes(30)).toEqual([0, 29]);
    expect(markerIndexes(1)).toEqual([0]);
    expect(markerIndexes(0)).toEqual([]);
  });
});

describe('end labels (T4)', () => {
  const noOverlap = (ys: number[], gap = LABEL_MIN_GAP) => {
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(gap);
  };

  it('leaves labels that already have room where their lines end', () => {
    expect(nudgeLabels([20, 60, 120], 12, 10, 200)).toEqual([20, 60, 120]);
    expect(nudgeLabels([], 12, 10, 200)).toEqual([]);
  });

  it('three lines ending at nearly equal values are spread at least 12 px apart, in the order of their lines, inside the plot', () => {
    const out = nudgeLabels([100, 101, 100.5], 12, 10, 200);
    noOverlap(out);
    // The order of the lines is kept: the line that ended highest keeps the highest label.
    expect(out[0]).toBeLessThanOrEqual(out[2]);
    expect(out[2]).toBeLessThanOrEqual(out[1]);
    for (const y of out) {
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(200);
    }
  });

  it('four labels all at the bottom of the plot are pulled back up, none leaves the plot', () => {
    const out = nudgeLabels([200, 200, 200, 200], 12, 10, 200);
    noOverlap(out);
    expect(Math.max(...out)).toBeLessThanOrEqual(200);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(10);
  });

  it('four labels at the top are pushed down from the lower bound', () => {
    const out = nudgeLabels([0, 0, 0, 0], 12, 16, 200);
    noOverlap(out);
    expect(Math.min(...out)).toBe(16);
  });

  it('keeps the value and cuts a long name with an ellipsis', () => {
    expect(endLabelText('Created', 15, 14)).toBe('Created 15');
    expect(endLabelText('Completed', 2, 14)).toBe('Completed 2');
    const long = endLabelText('Document review and filing', 1234, 14);
    expect(long.endsWith(' 1,234') || long.endsWith(' 1234')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(15);
    expect(long).toContain('…');
  });
});

describe('x axis ticks (T5)', () => {
  it('30 days at 1366 px: the first day, every Monday and the last day, with the month on each label', () => {
    const pts = days('2026-09-14', 30); // Mon 14 Sep to Tue 13 Oct
    const ticks = xTicks(pts, 'day', xOf(30, 40, 640), 8);
    // Monday 12 Oct is a day before the last day and would touch it: dropped.
    expect(ticks.map((t) => t.text)).toEqual(['Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 13']);
    // The first starts at the axis, the last ends at its point, the rest are centred.
    expect(ticks[0].anchor).toBe('start');
    expect(ticks[ticks.length - 1].anchor).toBe('end');
    expect(ticks[ticks.length - 1].text).toBe('Oct 13');
    expect(ticks.slice(1, -1).every((t) => t.anchor === 'middle')).toBe(true);
    // Mondays only in between.
    for (const t of ticks.slice(1, -1)) expect(weekdayOf(t.date)).toBe(1);
  });

  it('a Monday that would touch the last day is dropped, the last day is always labelled', () => {
    const pts = days('2026-09-15', 30); // ends Wed 14 Oct; Monday 12 Oct is two days before the end
    const ticks = xTicks(pts, 'day', xOf(30, 40, 640), 8);
    expect(ticks[ticks.length - 1].date).toBe('2026-10-14');
    expect(ticks.map((t) => t.date)).not.toContain('2026-10-12');
    expect(ticks.map((t) => t.date)).toContain('2026-10-05');
  });

  it('30 days at 375 px (a plot of about 213 px): at least 3 labels and none overlaps another', () => {
    const pts = days('2026-09-14', 30);
    const left = 34;
    const plot = 213;
    const ticks = xTicks(pts, 'day', xOf(30, left, plot), 4);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    const spans = ticks.map((t) => {
      const w = t.text.length * 6.8;
      return t.anchor === 'start'
        ? [t.x, t.x + w]
        : t.anchor === 'end'
          ? [t.x - w, t.x]
          : [t.x - w / 2, t.x + w / 2];
    });
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    expect(spans[0][0]).toBeGreaterThanOrEqual(left);
    expect(spans[spans.length - 1][1]).toBeLessThanOrEqual(left + plot + 0.001);
  });

  it('ranges across months, a year end and daylight saving changes keep their Mondays', () => {
    const cross = xTicks(days('2026-12-21', 21), 'day', xOf(21, 40, 800), 8).map((t) => t.text);
    expect(cross).toEqual(['Dec 21', 'Dec 28', 'Jan 4', 'Jan 10']);
    // 8 Mar 2026 (spring forward in New York) and 1 Nov 2026 (fall back): the weekday of every day is still the calendar's.
    const spring = xTicks(days('2026-03-02', 14), 'day', xOf(14, 40, 800), 8);
    expect(spring.map((t) => t.date)).toEqual(['2026-03-02', '2026-03-09', '2026-03-15']);
    const fall = xTicks(days('2026-10-26', 14), 'day', xOf(14, 40, 800), 8);
    expect(fall.map((t) => t.date)).toEqual(['2026-10-26', '2026-11-02', '2026-11-08']);
  });

  it('90 days of weekly points: at most 8 labels at 1366 px and 4 at 375 px, the last week always labelled', () => {
    const pts = weeks('2026-07-13', 14); // 14 weeks, the last is the week of 12 Oct
    const wide = xTicks(pts, 'week', xOf(14, 40, 900), 8);
    expect(wide.length).toBeLessThanOrEqual(8);
    expect(wide.length).toBeGreaterThanOrEqual(4);
    expect(wide[wide.length - 1].date).toBe('2026-10-12');
    expect(wide[0].date).toBe('2026-07-13');
    const narrow = xTicks(pts, 'week', xOf(14, 34, 213), 4);
    expect(narrow.length).toBeLessThanOrEqual(4);
    expect(narrow.length).toBeGreaterThanOrEqual(2);
    expect(narrow[narrow.length - 1].date).toBe('2026-10-12');
  });

  it('54 weekly points (a 366-day range) are thinned the same way', () => {
    const pts = weeks('2025-10-13', 54);
    const ticks = xTicks(pts, 'week', xOf(54, 40, 900), 8);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[ticks.length - 1].index).toBe(53);
  });

  it('copes with one point and none', () => {
    expect(xTicks([], 'day', () => 0, 8)).toEqual([]);
    expect(xTicks(['2026-10-13'], 'day', () => 100, 8)).toEqual([
      { index: 0, date: '2026-10-13', text: 'Oct 13', x: 100, anchor: 'middle' },
    ]);
  });
});
