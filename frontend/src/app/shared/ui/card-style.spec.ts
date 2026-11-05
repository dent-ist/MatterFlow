import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8');

/** The body of the first rule in `css` that starts with `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('one card anatomy (D-10, D-11, #1134)', () => {
  const cards = source('styles/_cards.scss');

  it('a card is the surface with a soft 1 px edge, the 12 px radius, the card shadow and 16 px padding', () => {
    const body = rule(cards, '.mf-card {');
    expect(body).toContain('background: var(--mf-surface)');
    expect(body).toContain('border: 1px solid var(--mf-border-soft)');
    expect(body).toContain('border-radius: var(--mf-radius-xl)');
    expect(body).toContain('box-shadow: var(--mf-shadow-card)');
    expect(body).toContain('padding: var(--mf-s4)');
  });

  it('a card title is 16 / 600 with 12 px below; a section heading is 16 / 600 with 24 above and 8 below', () => {
    const title = rule(cards, '.mf-card__title {');
    expect(title).toContain('margin: 0 0 var(--mf-s3)');
    expect(title).toContain('font-size: var(--mf-fs-lg)');
    expect(title).toContain('font-weight: var(--mf-fw-semibold)');
    const section = rule(cards, '.mf-section-title {');
    expect(section).toContain('margin: var(--mf-s5) 0 var(--mf-s2)');
    expect(section).toContain('font-size: var(--mf-fs-lg)');
  });

  it('a clickable card hovers to the row colour; the selected one has a 2 px inset primary ring and no coloured edge', () => {
    expect(rule(cards, '.mf-card--clickable:hover {')).toContain('background: var(--mf-row-hover)');
    const selected = rule(cards, '.mf-card--selected,');
    expect(selected).toContain('inset 0 0 0 2px var(--mf-primary)');
    expect(selected).not.toContain('border-left');
  });

  it('the cards of the issue use the shared class and no longer set radius or shadow themselves', () => {
    for (const file of [
      'app/features/profile/account-card.ts',
      'app/features/profile/notification-preferences.ts',
      'app/shared/availability/absences/absence-list.ts',
      'app/shared/availability/absences/holiday-card.ts',
      'app/shared/availability/availability-form.ts',
      'app/shared/ui/stat-tile.ts',
      'app/shared/ui/detail-layout.ts',
      'app/features/matters/ui/matter-summary.ts',
    ]) {
      expect(source(file), file).toContain('mf-card');
    }
    expect(source('app/features/profile/account-card.scss')).not.toContain('.ac {');
    expect(source('app/shared/ui/stat-tile.ts')).not.toContain('--mf-radius-lg');
  });
});
