import {
  formatAgo,
  formatBytes,
  formatDecimal,
  formatDuration,
  formatInt,
  formatPercent,
  formatRange,
  IntPipe,
} from './number-format';

describe('number forms (D-61, #1148)', () => {
  it('integers have a thousands comma and no decimals', () => {
    expect(formatInt(1234)).toBe('1,234');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(0)).toBe('0');
    expect(formatInt(null)).toBe('');
  });

  it('the pipe formats numbers and leaves a text count alone', () => {
    const pipe = new IntPipe();
    expect(pipe.transform(12345)).toBe('12,345');
    expect(pipe.transform('99+')).toBe('99+');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('percent has no space', () => {
    expect(formatPercent(37)).toBe('37%');
    expect(formatPercent(1200)).toBe('1,200%');
  });

  it('durations read 45 m, 2 h 48 m and 3 d 4 h', () => {
    expect(formatDuration(45)).toBe('45 m');
    expect(formatDuration(168)).toBe('2 h 48 m');
    expect(formatDuration(60)).toBe('1 h 00 m');
    expect(formatDuration(3 * 1440 + 4 * 60)).toBe('3 d 4 h');
    expect(formatDuration(null)).toBe('');
  });

  it('sizes use base 1024 and one decimal', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.2 * 1024 * 1024)).toBe('1.2 MB');
    expect(formatBytes(3.45 * 1024 ** 3)).toBe('3.5 GB');
    expect(formatDecimal(26400)).toBe('26,400');
    expect(formatDecimal(412.46)).toBe('412.5');
  });

  it('ranges and relative times', () => {
    expect(formatRange(1, 50, 143)).toBe('1-50 of 143');
    expect(formatRange(1, 50, 1430)).toBe('1-50 of 1,430');
    expect(formatRange(1, 0, 0)).toBe('0 of 0');
    expect(formatAgo(3)).toBe('3 m ago');
    expect(formatAgo(180)).toBe('3 h ago');
    expect(formatAgo(3 * 1440)).toBe('3 d ago');
  });
});
