import { contrastRatio } from '../../../shared/ui/color-contrast';
import { AGE_RAMP } from './stacked-bar';

/**
 * The dashboard's chart colours come from the design tokens (docs/ux/tokens.css, copied here; keep in step). They must stay readable
 * (WCAG 1.4.3 text 4.5:1, 1.4.11 graphics 3:1).
 */
const t: Record<string, string> = {
  'mf-surface': '#FFFFFF',
  'mf-surface-alt': '#EEF0F4',
  'mf-text-muted': '#4B5563',
  'mf-primary': '#1F4E9C',
  'mf-danger': '#B42318',
  'mf-danger-bg': '#FDECEA',
  'mf-warning': '#8A4B00',
  'mf-warning-bg': '#FFF4DB',
  'mf-success': '#146C2E',
  'mf-info': '#1F4E9C',
  'mf-info-bg': '#E3ECFA',
  'mf-st-progress-fg': '#0B5E55',
  'mf-pr-critical-fg': '#FFFFFF',
  'mf-pr-critical-bg': '#B42318',
  'mf-pr-high-fg': '#5C2E00',
  'mf-pr-high-bg': '#FFD9A8',
  'mf-pr-normal-fg': '#1B1F27',
  'mf-pr-normal-bg': '#E3E7EE',
  'mf-pr-low-fg': '#3B4350',
  'mf-pr-low-bg': '#F1F3F6',
};

describe('dashboard chart colours', () => {
  it('age bands are one blue hue from light to dark, each text readable on its fill and each fill or its edge visible on the card', () => {
    const lightness = (hex: string) => contrastRatio(hex, '#FFFFFF');
    // Darker with age: contrast with white rises from band to band.
    for (let i = 1; i < AGE_RAMP.length; i++) {
      expect(lightness(AGE_RAMP[i].bg), `band ${i}`).toBeGreaterThan(lightness(AGE_RAMP[i - 1].bg));
    }
    for (const [i, band] of AGE_RAMP.entries()) {
      expect(contrastRatio(band.fg, band.bg), `text ${i}`).toBeGreaterThanOrEqual(4.5);
      // The segment edge is the brand blue (1px), the fill is what is left when it is dark enough on its own.
      const stands = Math.max(
        contrastRatio(band.bg, t['mf-surface']),
        contrastRatio(t['mf-primary'], t['mf-surface']),
      );
      expect(stands, `edge ${i}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('trend lines and markers are visible on the card', () => {
    for (const name of ['mf-primary', 'mf-st-progress-fg']) {
      expect(contrastRatio(t[name], t['mf-surface']), name).toBeGreaterThanOrEqual(3);
    }
  });

  it('priority bars use the badge pair: the outline is readable against the fill', () => {
    for (const p of ['critical', 'high', 'normal', 'low']) {
      expect(contrastRatio(t[`mf-pr-${p}-fg`], t[`mf-pr-${p}-bg`]), p).toBeGreaterThanOrEqual(4.5);
      // The bar stands out from the white card by its fill (critical) or by its outline (pale fills).
      const edge = Math.max(
        contrastRatio(t[`mf-pr-${p}-fg`], t['mf-surface']),
        contrastRatio(t[`mf-pr-${p}-bg`], t['mf-surface']),
      );
      expect(edge, p).toBeGreaterThanOrEqual(3);
    }
  });

  it('axis labels and notes in muted text meet 4.5:1', () => {
    expect(contrastRatio(t['mf-text-muted'], t['mf-surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t['mf-text-muted'], t['mf-surface-alt'])).toBeGreaterThanOrEqual(4.5);
  });

  it('attention tiles keep their coloured numbers readable on the tinted background', () => {
    const pairs: [string, string][] = [
      ['mf-danger', 'mf-danger-bg'],
      ['mf-warning', 'mf-warning-bg'],
      ['mf-info', 'mf-info-bg'],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrastRatio(t[fg], t[bg]), fg).toBeGreaterThanOrEqual(4.5);
    }
  });
});
