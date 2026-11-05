import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string => readFileSync(join(process.cwd(), 'src', file), 'utf8');

/** One page header on every list and workspace page (D-21, #1135). */
describe('one page header (D-21, #1135)', () => {
  const header = source('app/shared/ui/page-header.ts');

  it('the tile is 32 x 32 with the 8 px radius, the primary fill and a white 20 px icon', () => {
    const at = header.indexOf('.ph__icon {');
    const body = header.slice(at, header.indexOf('}', at));
    expect(body).toContain('width: var(--mf-tile-size)');
    expect(body).toContain('height: var(--mf-tile-size)');
    expect(body).toContain('border-radius: var(--mf-radius-lg)');
    expect(body).toContain('background: var(--mf-primary)');
    expect(body).toContain('color: var(--mf-primary-contrast)');
    expect(body).toContain('font-size: var(--mf-icon-lg)');
  });

  it('the title is 22 / 700 and the count is the shared count chip, not a private pill', () => {
    const at = header.indexOf('.ph__title {');
    const body = header.slice(at, header.indexOf('}', at));
    expect(body).toContain('font-size: var(--mf-fs-h2)');
    expect(body).toContain('font-weight: 700');
    expect(header).toContain('<mf-count-chip');
    expect(header).not.toContain('.ph__count');
  });

  it('Dashboard, My Matters, Profile and Create Task use the component and draw no <h1> of their own', () => {
    for (const file of [
      'app/features/dashboard/ui/dash-tabs.ts',
      'app/features/my-matters/ui/shell.ts',
      'app/features/profile/profile-page.ts',
      'app/features/tasks/create/create-task-page.html',
    ]) {
      const text = source(file);
      expect(text, file).toContain('<mf-page-header');
      expect(text, file).not.toMatch(/<h1[\s>]/);
    }
  });

  it('the page heading, focused from script, draws no outline', () => {
    const css = source('styles.scss');
    const at = css.indexOf('h1[data-page-title]:focus,');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = css.slice(css.indexOf('{', at), css.indexOf('}', at));
    expect(body).toContain('outline: none');
  });
});
