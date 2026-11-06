import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for D-04 / D-04a (owner rule, #1158): no diagonal stripes or hatching anywhere on the Dashboard. An overdue part is a solid
 * `--mf-sem-overdue-solid` fill next to the "N overdue" words; gauge segments are solid tints. The pie component under `shared/charts` keeps
 * its optional report patterns (Administration > Reports), which are not part of the Dashboard.
 */
const ROOT = join(process.cwd(), 'src', 'app', 'features', 'dashboard');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|scss|html)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('Dashboard has no stripes (D-04)', () => {
  it('no source uses a repeating gradient, an SVG stripe pattern or the chart hatch token', () => {
    const hits = sources(ROOT).filter((file) =>
      /repeating-linear-gradient|repeating-conic-gradient|--mf-chart-hatch|<pattern|hatch/i.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(hits).toEqual([]);
  });
});
