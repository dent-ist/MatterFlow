import { contrastRatio } from '../../../shared/ui/color-contrast';
import { LOW_STROKE, NORMAL_STROKE, overdueShare, strokeFor } from './breakdown-overdue';
import { tokenHex } from '../../../testing/token-colours.spec-util';
import { AGE_RAMP } from './stacked-bar';

/**
 * The dashboard's chart colours come from the design tokens (docs/ux/tokens.css, read here through tokenHex). They must stay readable
 * (WCAG 1.4.3 text 4.5:1, 1.4.11 graphics 3:1).
 */
const t: Record<string, string> = new Proxy(
  {},
  { get: (_target, name) => tokenHex(`var(--${String(name)})`) },
);

describe('dashboard chart colours', () => {
  it('age bands are one blue hue from light to dark, each text readable on its fill and each fill or its edge visible on the card', () => {
    const lightness = (hex: string) => contrastRatio(tokenHex(hex), '#FFFFFF');
    // Darker with age: contrast with white rises from band to band.
    for (let i = 1; i < AGE_RAMP.length; i++) {
      expect(lightness(AGE_RAMP[i].bg), `band ${i}`).toBeGreaterThan(lightness(AGE_RAMP[i - 1].bg));
    }
    for (const [i, band] of AGE_RAMP.entries()) {
      expect(
        contrastRatio(tokenHex(band.fg), tokenHex(band.bg)),
        `text ${i}`,
      ).toBeGreaterThanOrEqual(4.5);
      // The segment edge is the brand blue (1px), the fill is what is left when it is dark enough on its own.
      const stands = Math.max(
        contrastRatio(tokenHex(band.bg), t['mf-surface']),
        contrastRatio(t['mf-primary'], t['mf-surface']),
      );
      expect(stands, `edge ${i}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('trend lines and markers are visible on the card', () => {
    for (const name of ['mf-primary', 'mf-sem-healthy-fg']) {
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

  describe('Low and Normal priority bars (Breakdowns B4)', () => {
    it('differ by stroke style, width and fill weight, with no new colour', () => {
      expect(strokeFor('normal')).toBe(NORMAL_STROKE);
      expect(strokeFor('low')).toBe(LOW_STROKE);
      expect(strokeFor(null)).toBe(NORMAL_STROKE);
      expect(NORMAL_STROKE.style).toBe('solid');
      expect(LOW_STROKE.style).toBe('dashed');
      expect(LOW_STROKE.width).toBeGreaterThan(NORMAL_STROKE.width);
      expect(LOW_STROKE.fillWeight).toBeLessThan(NORMAL_STROKE.fillWeight);
    });

    it('both outlines reach 3:1 against the card, and the Low fill (mixed with the card) is lighter than the Normal fill', () => {
      for (const p of ['normal', 'low']) {
        expect(contrastRatio(t[`mf-pr-${p}-fg`], t['mf-surface']), p).toBeGreaterThanOrEqual(3);
      }
      const mix = (hex: string, weight: number): string => {
        const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const out = rgb.map((c) => Math.round((c * weight) / 100 + (255 * (100 - weight)) / 100));
        return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      };
      const lowFill = mix(t['mf-pr-low-bg'], LOW_STROKE.fillWeight);
      expect(contrastRatio(lowFill, '#FFFFFF')).toBeLessThan(
        contrastRatio(t['mf-pr-normal-bg'], '#FFFFFF'),
      );
    });

    it('the overdue hatch (danger on its tint) and its solid edge are visible on the card', () => {
      expect(contrastRatio(t['mf-danger'], t['mf-surface'])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t['mf-danger'], t['mf-danger-bg'])).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('the overdue segment is proportional to the row total, 0 for none, never above the bar', () => {
    expect(overdueShare(11, 53)).toBeCloseTo((11 / 53) * 100, 6);
    expect(overdueShare(0, 53)).toBe(0);
    expect(overdueShare(5, 0)).toBe(0);
    expect(overdueShare(60, 53)).toBe(100);
  });

  describe('one colour language (M9)', () => {
    it('the New and On Hold chips read at 4.5:1', () => {
      expect(contrastRatio(t['mf-status-new-fg'], t['mf-status-new-bg'])).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(t['mf-status-hold-fg'], t['mf-status-hold-bg'])).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it('the status colours of the charts (New, In Progress, On Hold) are 3:1 on the card and apart from each other', () => {
      const colors = ['mf-sem-neutral-solid', 'mf-status-progress-fg', 'mf-border-strong'];
      for (const name of colors) {
        expect(contrastRatio(t[name], t['mf-surface']), name).toBeGreaterThanOrEqual(3);
      }
      expect(
        contrastRatio(t['mf-sem-neutral-solid'], t['mf-border-strong']),
      ).toBeGreaterThanOrEqual(1.5);
    });

    it('the white level glyph on the red overdue bar is readable', () => {
      expect(contrastRatio('#FFFFFF', t['mf-danger'])).toBeGreaterThanOrEqual(4.5);
    });
  });
});
