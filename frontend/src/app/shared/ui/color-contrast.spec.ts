import { contrastRatio, hasReadableText, isHexColor, readableTextOn } from './color-contrast';

describe('color contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('picks white on dark backgrounds and the dark token on light ones', () => {
    expect(readableTextOn('#B42318').color).toBe('#FFFFFF');
    expect(readableTextOn('#FFD9A8').color).toBe('#1B1F27');
  });

  it('flags mid-tone backgrounds where neither text color reaches 4.5:1', () => {
    expect(hasReadableText('#B42318')).toBe(true);
    expect(hasReadableText('#E3E7EE')).toBe(true);
    expect(hasReadableText('#808080')).toBe(false);
  });

  it('recognises #RRGGBB values only', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('critical')).toBe(false);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });
});
