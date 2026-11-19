import {
  IMAGE_MIN_WIDTH,
  activePreset,
  clampWidth,
  fitLongSide,
  heightFor,
  maxWidth,
  parseWidth,
  pastedSize,
  presetWidth,
  readoutText,
} from './note-image-size';

const NAT = { width: 960, height: 600 };

describe('note image sums', () => {
  it('keeps the aspect ratio and stores whole pixels', () => {
    expect(heightFor(480, NAT)).toBe(300);
    expect(heightFor(333, NAT)).toBe(208);
    expect(heightFor(1, { width: 1000, height: 10 })).toBe(1);
  });

  it('holds a width between 48 px, the natural width and the room in the text', () => {
    expect(clampWidth(10, NAT.width, 800)).toBe(IMAGE_MIN_WIDTH);
    expect(clampWidth(5000, NAT.width, 800)).toBe(800);
    expect(clampWidth(5000, NAT.width, 0)).toBe(960); // not measured: no room limit
    expect(clampWidth(300.4, NAT.width, 800)).toBe(300);
    expect(maxWidth(30, 800)).toBe(IMAGE_MIN_WIDTH);
  });

  it('inserts a pasted image at the smaller of its natural width, 720 px and the room', () => {
    expect(pastedSize({ width: 1600, height: 900 }, 1000)).toEqual({ width: 720, height: 405 });
    expect(pastedSize({ width: 400, height: 200 }, 1000)).toEqual({ width: 400, height: 200 });
    expect(pastedSize({ width: 1600, height: 900 }, 500)).toEqual({ width: 500, height: 281 });
  });

  it('gives the presets, clamped (Large on a small image is its natural width)', () => {
    expect(presetWidth('small', NAT, 800)).toBe(240);
    expect(presetWidth('medium', NAT, 800)).toBe(480);
    expect(presetWidth('large', NAT, 800)).toBe(720);
    expect(presetWidth('large', { width: 500, height: 300 }, 800)).toBe(500);
    expect(presetWidth('original', NAT, 800)).toBe(800);
    expect(presetWidth('original', NAT, 0)).toBe(960);
    expect(presetWidth('fit', NAT, 640)).toBe(640);
    expect(presetWidth('fit', { width: 400, height: 300 }, 640)).toBe(400);
  });

  it('knows which preset is on', () => {
    expect(activePreset(480, NAT, 800)).toBe('medium');
    expect(activePreset(333, NAT, 800)).toBeNull();
  });

  it('writes the readout as size and percent of the original', () => {
    expect(readoutText({ width: 480, height: 300 }, NAT)).toBe('480 x 300 px · 50% of original');
  });

  it('reads the exact width: digits only', () => {
    expect(parseWidth(' 480 ')).toBe(480);
    expect(parseWidth('48.5')).toBeNull();
    expect(parseWidth('')).toBeNull();
    expect(parseWidth('0')).toBeNull();
    expect(parseWidth('abc')).toBeNull();
    expect(parseWidth('123456')).toBeNull();
  });

  it('shrinks to 1,600 px on the long side and never enlarges', () => {
    expect(fitLongSide(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitLongSide(900, 2400)).toEqual({ width: 600, height: 1600 });
    expect(fitLongSide(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
