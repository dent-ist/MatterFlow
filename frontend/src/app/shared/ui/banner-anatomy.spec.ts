import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** #1196, #1254: one banner pattern (36 px, radius 4, 1 px line, icon 18, text 14, 32 px action); the shell banners, the sensitive bars and the dialog banners use it, and every one has its icon (D-53a). */
describe('the one banner', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const css = read('src/styles/_banners.scss');
  const block = (selector: string): string => {
    const from = css.indexOf(selector);
    return css.slice(from, css.indexOf('}', from));
  };

  it('is 36 px high, radius 4, 1 px line, 14 px text, icon 18 and a 32 px action, all from tokens', () => {
    const base = block('.pg-banner,\n.rh__note,\n.mh__note {');
    expect(base).toContain('min-height: var(--mf-ctl-h)');
    expect(base).toContain('border-radius: var(--mf-radius)');
    expect(base).toContain('border: 1px solid var(--mf-sem-risk-line)');
    expect(base).toContain('font-size: var(--mf-fs-md)');
    expect(block('.pg-banner > .pi')).toContain('font-size: var(--mf-icon-md)');
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

  it('has no private banner class: the Out of Office dialog uses .pg-banner and its danger variant (#1255)', () => {
    const dialog = read('src/app/shared/availability/absences/absence-dialog.ts');
    expect(dialog).not.toContain('ad__banner');
    expect(dialog).toContain('pg-banner pg-banner--danger');
  });

  it('every banner in a template has its icon (D-53a)', () => {
    const app = join(process.cwd(), 'src', 'app');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name)) files.push(path);
      }
    };
    walk(app);
    const without: string[] = [];
    let seen = 0;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(
        /<(div|p|section|aside)\b[^>]*class="[^"]*\bpg-banner\b[^"]*"[^>]*>/g,
      )) {
        seen++;
        // The icon is the first element inside the banner: a PrimeIcons <i class="pi ..."> (or an svg).
        const inside = text.slice(m.index! + m[0].length, m.index! + m[0].length + 160);
        if (!/^\s*(<i\b[^>]*class="[^"]*\bpi\b|<svg\b)/.test(inside))
          without.push(`${relative(app, file)}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(seen).toBeGreaterThan(10);
    expect(without, 'a banner without its icon (information, warning, danger or success)').toEqual(
      [],
    );
  });
});
