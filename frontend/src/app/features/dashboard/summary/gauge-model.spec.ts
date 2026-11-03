import { DashboardUnassignedGauge } from '../../../api/generated/api-client';
import { GAUGE_CLEAR, LEVEL_WORDS, clampLevel, gaugeView, levelChange } from './gauge-model';

const gauge = (over: Partial<DashboardUnassignedGauge> = {}): DashboardUnassignedGauge => ({
  count: 7,
  oldestSinceUtc: '2026-11-03T12:00:00Z',
  oldestAgeMinutes: 168,
  ageBasis: 'WORKING',
  level: 3,
  asOfUtc: '2026-11-03T15:00:00Z',
  ...over,
});

describe('gaugeView', () => {
  it('renders level 0 to 5 with a word, a badge, a needle and a what-to-do line each', () => {
    const doLines = new Set<string>();
    for (let level = 0; level <= 5; level++) {
      const v = gaugeView(gauge({ level }));
      expect(v.level).toBe(level);
      expect(v.word).toBe(LEVEL_WORDS[level]);
      expect(v.badge).toBe(level === 0 ? 'Normal' : `Level ${level} · ${LEVEL_WORDS[level]}`);
      expect(v.needleDeg).toBe(level * 30 + 15);
      expect(v.ariaLabel).toContain(`level ${level} of 5`);
      doLines.add(v.doLine);
    }
    expect(doLines.size).toBe(6);
  });

  it('shows the count, the working-hours age and the basis', () => {
    const v = gaugeView(gauge());
    expect(v.count).toBe(7);
    expect(v.age).toBe('2 h 48 m');
    expect(v.ageLabel).toBe('oldest, working hours');
    expect(gaugeView(gauge({ ageBasis: 'CLOCK' })).ageLabel).toBe('oldest, clock hours');
  });

  it('is calmly All clear when nothing is unassigned', () => {
    const v = gaugeView(
      gauge({ count: 0, oldestSinceUtc: undefined, oldestAgeMinutes: 0, level: 0 }),
    );
    expect(v.clear).toBe(true);
    expect(v.badge).toBe('All clear');
    expect(v.doLine).toBe(GAUGE_CLEAR);
    expect(v.age).toBe('-');
    expect(v.pulses).toBe(false);
  });

  it('pulses only at levels 4 and 5', () => {
    expect(gaugeView(gauge({ level: 3 })).pulses).toBe(false);
    expect(gaugeView(gauge({ level: 4 })).pulses).toBe(true);
    expect(gaugeView(gauge({ level: 5 })).pulses).toBe(true);
  });

  it('keeps a wild level inside 0 to 5', () => {
    expect(clampLevel(9)).toBe(5);
    expect(clampLevel(-2)).toBe(0);
  });
});

describe('levelChange (aria-live only when the level changes)', () => {
  it('says nothing the first time and while the level stays', () => {
    const first = levelChange(null, gauge({ level: 2 }));
    expect(first.message).toBeNull();
    expect(levelChange(first.key, gauge({ level: 2, count: 9 })).message).toBeNull();
  });

  it('announces once per change, including to and from All clear', () => {
    const up = levelChange(2, gauge({ level: 3 }));
    expect(up.message).toBe('Unassigned wait level is now 3 of 5, High. 7 unassigned tasks.');
    const clear = levelChange(3, gauge({ count: 0, level: 0 }));
    expect(clear.message).toContain('all clear');
    expect(clear.key).toBe(-1);
    expect(levelChange(-1, gauge({ count: 1, level: 0 })).message).toContain('level is now 0 of 5');
  });
});
