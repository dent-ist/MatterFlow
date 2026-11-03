import { join } from 'node:path';
import { compile } from 'sass';
import { NOTE_COLOURS } from './note-editor';

/**
 * Guard for the text colour rules (MD-30, #1034): the style sheet draws exactly one `[data-color='key']` rule per colour of the palette, pointing at
 * its theme token, and compiling it gives no Sass warning (bare names such as blue are Sass colour values and used to warn when interpolated).
 */
describe('note text colour styles', () => {
  const warnings: string[] = [];
  const css = compile(
    join(process.cwd(), 'src', 'app', 'features', 'notes', 'note-editor-colours.scss'),
    {
      logger: { warn: (m: string) => warnings.push(m), debug: () => undefined },
    },
  ).css;

  it('compiles without warnings', () => {
    expect(warnings).toEqual([]);
  });

  it('has exactly one rule per palette colour, using its token', () => {
    const rules = [
      ...css.matchAll(
        /\[data-color=["']?([a-z]+)["']?\]\s*\{\s*color:\s*var\(--mf-note-([a-z]+)\)/g,
      ),
    ];
    expect(rules.map((m) => m[1])).toEqual(NOTE_COLOURS.map((c) => c.key));
    for (const m of rules) expect(m[2]).toBe(m[1]);
  });
});
