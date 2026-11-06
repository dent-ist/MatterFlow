import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** #1196: one banner pattern (36 px, radius 4, 1 px line, icon 16, text 14, 32 px action); the shell banners and the sensitive bars use it. */
describe('the one banner', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const css = read('src/styles/_banners.scss');
  const block = (selector: string): string => {
    const from = css.indexOf(selector);
    return css.slice(from, css.indexOf('}', from));
  };

  it('is 36 px high, radius 4, 1 px line, 14 px text, icon 16 and a 32 px action, all from tokens', () => {
    const base = block('.pg-banner,\n.rh__note,\n.mh__note {');
    expect(base).toContain('min-height: var(--mf-ctl-h)');
    expect(base).toContain('border-radius: var(--mf-radius)');
    expect(base).toContain('border: 1px solid var(--mf-sem-risk-line)');
    expect(base).toContain('font-size: var(--mf-fs-md)');
    expect(block('.pg-banner > .pi')).toContain('font-size: var(--mf-icon-sm)');
    expect(block('.pg-banner > .mf-btn')).toContain('height: var(--mf-ctl-h-sm)');
    expect(css).toContain('--mf-sem-info-line');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /border-left|border-inline-start|#[0-9a-f]{3,6}\b/i,
    );
  });

  it('is what the connection, sign-in, dev-auth and sensitive banners use (no private bar)', () => {
    const connection = read('src/app/shared/layout/connection-banner.ts');
    expect(connection).not.toContain('cb__bar');
    expect(connection.match(/pg-banner pg-banner--full/g)).toHaveLength(3);
    expect(read('src/app/shared/layout/dev-auth-banner.ts')).toContain('pg-banner--info');
    expect(read('src/app/features/matters/ui/matter-header.ts')).not.toContain('.mh__note {');
    expect(read('src/app/shared/ui/record-header.scss')).not.toContain('\n.rh__note {');
  });
});
