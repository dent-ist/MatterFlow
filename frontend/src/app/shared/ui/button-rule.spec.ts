import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard for the button rule (epic #1001, MD-26, #1030; docs/ux/theme-guide.md section 9): the Matter detail tabs draw their buttons from the
 * shared theme only. A page style sheet may lay a button out (margin, flex, width) but never paints it, and a `p-button` is never
 * `size="small"` (a 44 px touch `min-height` in a media query is allowed) (in this theme it is the same size as the default, so it only invites a different look).
 */
const APP = join(process.cwd(), 'src', 'app');
const FILES = [
  'features/matters/pages/matter-detail-page.ts',
  'features/matters/pages/matter-projects.ts',
  'features/matters/ui/matter-summary.ts',
  'features/matters/ui/matter-form-dialog.ts',
  'features/matters/ui/matter-event-panel.ts',
  'features/matters/ui/matter-activities.ts',
  'features/matters/ui/matter-header.ts',
  'features/projects/ui/project-panel.ts',
  'features/projects/ui/project-tasks-panel.ts',
  'features/productions/productions-tab.ts',
  'features/notes/notes-tab.ts',
  'shared/ui/matter-assets.ts',
  'shared/ui/form-dialog.ts',
  'shared/ui/grid-columns.ts',
  'shared/ui/slide-panel.ts',
  'shared/work-queue/scoped-tasks.ts',
];
/** My Matters (MD-26 round 2): its buttons are theme buttons too. */
const MY_MATTERS = ['ui', 'tabs', 'panels'].flatMap((dir) =>
  readdirSync(join(APP, 'features', 'my-matters', dir))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.includes('generated'))
    .map((f) => `features/my-matters/${dir}/${f}`),
);
FILES.push(...MY_MATTERS);

/** Files whose `size="small"` buttons are still to be cleaned by their owner (none: Notes is clean since MD-27, #1031). */
const SIZE_PENDING: string[] = [];

/** Properties that paint a button. */
const PAINT =
  /(^|[;{\s])(background|background-color|border|border-color|border-radius|color|padding|padding-inline|padding-block|font|font-size|font-weight|height)\s*:/;
/** A `height` or `min-height` written as a number (UI update 2, #1123: button heights come from `--mf-ctl-h` / `--mf-ctl-h-sm` only; the 44 px touch rule in a media query is allowed). */
const LITERAL_HEIGHT = /(^|[;{\s])(min-)?height\s*:\s*(?!44px)[\d.]/;
/** Selectors that target a button. */
const BUTTON_SELECTOR = /(^|[\s,>:])(button\b|\.p-button|\.mf-btn)|__(link|btn|button)\b/;

export function paintedButtonRules(css: string): string[] {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (BUTTON_SELECTOR.test(selector) && (PAINT.test(rule[2]) || LITERAL_HEIGHT.test(rule[2])))
      out.push(selector);
  }
  return out;
}

/** Selectors that target a segmented control or a dropdown (LC-08): these are the shared `mfSegmented` and `mf-dropdown`, never painted locally. */
const CONTROL_SELECTOR =
  /(^|[\s,>:])(\.p-select\w*|\.p-selectbutton|\.mf-seg\w*|\[mfSegmented\]|mf-dropdown|select\b|\.dd\b)/;

export function paintedControlRules(css: string): string[] {
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (CONTROL_SELECTOR.test(selector) && PAINT.test(rule[2])) out.push(selector);
  }
  return out;
}

describe('segmented control and dropdown rule (LC-08)', () => {
  it('finds a painted dropdown or segmented control and leaves layout alone', () => {
    expect(paintedControlRules('.a mf-dropdown { border: 1px solid red; }')).toEqual([
      '.a mf-dropdown',
    ]);
    expect(paintedControlRules('.a .p-select { background: red; }')).toEqual(['.a .p-select']);
    expect(paintedControlRules('.a mf-dropdown { flex: 1 1 auto; }')).toEqual([]);
  });

  for (const file of FILES.filter((f) => !f.startsWith('features/my-matters'))) {
    it(`${file} paints no segmented control or dropdown with local CSS`, () => {
      const source = readFileSync(join(APP, file), 'utf8');
      const css = source.match(/styles:\s*`([^`]*)`/s)?.[1] ?? '';
      expect(paintedControlRules(css)).toEqual([]);
    });
  }
});

describe('button rule (theme guide section 9)', () => {
  it('finds a painted button rule and leaves layout alone', () => {
    expect(paintedButtonRules('.a button { background: red; }')).toEqual(['.a button']);
    expect(paintedButtonRules('.x__link { color: blue; }')).toEqual(['.x__link']);
    expect(paintedButtonRules('.a .mf-btn { margin-inline-start: 8px; }')).toEqual([]);
    expect(paintedButtonRules('.a { color: red; }')).toEqual([]);
  });

  it('fails on a min-height or height literal on a button and accepts a token (#1123)', () => {
    expect(paintedButtonRules('.a .mf-btn { min-height: 32px; }')).toEqual(['.a .mf-btn']);
    expect(paintedButtonRules('.a .p-button { height: 2rem; }')).toEqual(['.a .p-button']);
    expect(paintedButtonRules('.a .mf-btn { min-height: var(--mf-ctl-h); }')).toEqual([]);
  });

  it('the shared button sheet takes every height from a token (#1123)', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', '_buttons.scss'), 'utf8').replace(
      /\/\*.*?\*\//gs,
      '',
    );
    const touch = css.indexOf('@media');
    const heights =
      (touch < 0 ? css : css.slice(0, touch)).match(/(?<![-\w])(min-)?height:\s*[^;]+;/g) ?? [];
    for (const h of heights) expect(h, h).toMatch(/var\(--mf-/);
    expect(css).not.toMatch(/opacity:\s*0?\.\d/);
  });

  for (const file of FILES) {
    describe(file, () => {
      const source = readFileSync(join(APP, file), 'utf8');

      it('paints no button with local CSS', () => {
        const css = source.match(/styles:\s*`([^`]*)`/s)?.[1] ?? '';
        expect(paintedButtonRules(css)).toEqual([]);
      });

      it('has no p-button with size="small"', () => {
        if (SIZE_PENDING.includes(file)) return;
        expect(source.match(/<p-button[^>]*\ssize="small"/gs) ?? []).toEqual([]);
      });
    });
  }
});
