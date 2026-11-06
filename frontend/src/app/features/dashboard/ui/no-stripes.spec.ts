import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for D-04 / D-04a (owner rule, #1158, #1211): no diagonal stripes or hatching on the Dashboard or in the shared charts (the report pie lost its optional
 * patterns in #1211). An overdue part is a solid `--mf-sem-overdue-solid` fill next to the "N overdue" words; gauge segments are solid tints.
 */
const ROOTS = [
  join(process.cwd(), 'src', 'app', 'features', 'dashboard'),
  join(process.cwd(), 'src', 'app', 'shared', 'charts'),
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|scss|html)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('Dashboard and the shared charts have no stripes (D-04)', () => {
  it('no source uses a repeating gradient, an SVG stripe pattern or the chart hatch token', () => {
    const hits = ROOTS.flatMap((root) => sources(root)).filter((file) =>
      /repeating-linear-gradient|repeating-conic-gradient|--mf-chart-hatch|<pattern|hatch/i.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(hits).toEqual([]);
  });
});
