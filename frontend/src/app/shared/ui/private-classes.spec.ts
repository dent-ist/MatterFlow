import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard for private chip and link classes (D-12, D-13; #1130, #1132; docs/ux/design-guidelines.md section 6). A component style sheet may lay a chip or a link out, but it may
 * not draw one: no class named like a chip (`chip`, `badge`, `pill`, `tag`) that paints a fill or a pill shape (`background`, `border-radius`), and no class named like a link
 * (`link`, `lnk`, `linkbtn`, `link-btn`, `lnk-btn`, `pg-link`) that underlines or takes the link colour. Use `mf-status-chip`, `mf-badge`, `mf-count-chip`, `mf-filter-chips`,
 * `mf-tag-chip` and `mf-priority-flag` for a chip, `<a class="mf-link">` (or a plain `a`) for a link and `mf-btn mf-btn--text` for an action.
 *
 * The same scan runs from the command line as `node docs/ux/ui-update/crawl/scan-private-classes.mjs --list`.
 *
 * A second guard (D-51, #1279) fails on a new `dashed` border or outline: an empty, no-match, loading or error message is `mf-state-block`, never a dashed box.
 */
const APP = join(process.cwd(), 'src', 'app');

/** The shared chip components themselves: their own inner class names are the shared look, not a private one. */
const SHARED_KINDS = new Set([
  'shared/ui/badge.ts',
  'shared/ui/status-chip.ts',
  'shared/ui/filter-chips.ts',
  'shared/ui/priority-badge.ts',
  'shared/ui/priority-pill.ts',
  'shared/ui/task-type-chip.ts',
]);

/**
 * Private chip classes that remain, each with the reason and the follow-up (#1130). Keys are `file:class`. Remove an entry when its page is converted; a new entry needs the designer.
 */
const ALLOWED_CHIPS: Readonly<Record<string, string>> = {
  'shared/work-queue/task-card-list.scss:tc-sk--chips':
    'a skeleton placeholder in the shape of a chip while loading, not a chip',
};

/**
 * The dashed borders that stay (#1279): a drop target and status markers, not containers of a message. Keys are `file:selector` (selector as written, one rule per entry).
 * A new entry needs the designer; a message box is `mf-state-block`.
 */
const ALLOWED_DASHED: Readonly<Record<string, string>> = {
  'shared/ui/email-intake.scss:.ei__drop': 'the e-mail drop zone: a drop target',
  'features/admin/roles/roles-page.scss:.mf-change--removed':
    'the roles diff marker for a removed permission',
  'features/admin/reports/parameters-editor.ts:.pe__card--unused':
    'the card of a parameter the query does not use',
  "features/tasks/detail/task-step.ts:.step[data-step-status='SKIPPED']":
    'the skipped step of a task',
  'features/dashboard/summary/dash-battery.ts:.sw--off': 'the "off" swatch of the battery legend',
  'features/notes/notes-tab-panel.scss:.nt__add': 'the add-note placeholder',
  'features/admin/workflows/workflow-step-row.scss:.wsr__preview': 'the step preview',
  'shared/charts/pie-chart.ts:.swatch.dashed': 'the legend swatch of the dashed pie slice',
  '../styles/_tables.scss:.wt-resize-guide': 'the drop line of a column resize',
};

/** The selectors (innermost, as written) of the rules in a style sheet that draw a dashed border or outline; follows SCSS nesting. Comments are removed first. */
function dashedSelectors(css: string): string[] {
  const found: string[] = [];
  const stack: { selector: string; body: string }[] = [];
  let pending = '';
  for (const ch of css) {
    if (ch === '{') {
      stack.push({ selector: pending.trim().replace(/\s+/g, ' '), body: '' });
      pending = '';
    } else if (ch === ';') {
      if (stack.length > 0) stack[stack.length - 1].body += `${pending};`;
      pending = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) {
        top.body += pending;
        if (/(?:border|outline)[\w-]*\s*:[^;]*\bdashed\b/.test(top.body))
          found.push(...top.selector.split(',').map((x) => x.trim()));
      }
      pending = '';
    } else pending += ch;
  }
  return found;
}

/** Every dashed border or outline in a component or global style sheet, as `file:selector`. */
function dashedRules(): string[] {
  const out: string[] = [];
  for (const root of [APP, join(process.cwd(), 'src', 'styles')]) {
    for (const path of sources(root)) {
      const file = relative(APP, path).replace(/\\/g, '/');
      const css = cssOf(path, readFileSync(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      out.push(...dashedSelectors(css).map((sel) => `${file}:${sel}`));
    }
  }
  return out;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (
      /\.(ts|scss|html)$/.test(name) &&
      !/\.spec\.ts$/.test(name) &&
      !name.includes('generated')
    )
      out.push(path);
  }
  return out;
}

/** The CSS of a source file: the whole file for `.scss`, the `styles:` template literals of a component. */
function cssOf(path: string, text: string): string {
  if (path.endsWith('.scss')) return text;
  if (path.endsWith('.html')) return '';
  return [...text.matchAll(/styles:\s*(?:\[\s*)?`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
}

const CHIP_WORD = /chip|badge|pill|(^|[-_])(tag|tags|hchip|achip)($|[-_])/;
const LINK_WORD =
  /^(lnk|link|linkbtn|link-btn|lnk-btn|pg-link)$|(^|[-_])(lnk|link|linkbtn)($|[-_])|^(pg-link|ov-link)$/;

interface Hit {
  file: string;
  cls: string;
}

function scan(): { chips: Hit[]; links: Hit[]; templateLinks: Hit[] } {
  const chips: Hit[] = [];
  const links: Hit[] = [];
  const templateLinks: Hit[] = [];
  for (const path of sources(APP)) {
    const file = relative(APP, path).replace(/\\/g, '/');
    const text = readFileSync(path, 'utf8');
    const css = cssOf(path, text).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      for (const cls of new Set([...m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]))) {
        if (cls.startsWith('mf-')) continue;
        if (CHIP_WORD.test(cls) && /border-radius|background/.test(body)) chips.push({ file, cls });
        if (LINK_WORD.test(cls) && /text-decoration|--mf-link/.test(body))
          links.push({ file, cls });
      }
    }
    if (!path.endsWith('.scss')) {
      // A template element that still carries a private link class.
      for (const m of text.matchAll(/<(?:a|button)\b[^<>]*?\bclass="([^"]*)"/g)) {
        for (const cls of m[1].split(/\s+/)) {
          if (/^(lnk|link|linkbtn|link-btn|lnk-btn|pg-link)$/.test(cls))
            templateLinks.push({ file, cls });
        }
      }
    }
  }
  return { chips, links, templateLinks };
}

describe('no private chip or link class (D-12, D-13, #1130, #1132)', () => {
  const found = scan();

  it('no component style draws its own chip, badge, pill or tag (use the four shared kinds)', () => {
    const offenders = found.chips
      .filter((h) => !SHARED_KINDS.has(h.file) && !(`${h.file}:${h.cls}` in ALLOWED_CHIPS))
      .map((h) => `${h.file}: .${h.cls}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('every allowed private chip still exists (delete the entry when its page is converted)', () => {
    const seen = new Set(found.chips.map((h) => `${h.file}:${h.cls}`));
    expect(Object.keys(ALLOWED_CHIPS).filter((k) => !seen.has(k))).toEqual([]);
  });

  it('no component style draws its own link (use a.mf-link for a link, mf-btn mf-btn--text for an action)', () => {
    expect([...new Set(found.links.map((h) => `${h.file}: .${h.cls}`))]).toEqual([]);
  });

  it('no template uses the retired link classes lnk, link, linkbtn, link-btn, lnk-btn, pg-link', () => {
    expect([...new Set(found.templateLinks.map((h) => `${h.file}: ${h.cls}`))]).toEqual([]);
  });
});

describe('no dashed message box (D-51, #1279)', () => {
  const found = dashedRules();

  it('a dashed border or outline exists only on the drop zone and the status markers; an empty, error or no-match message is mf-state-block', () => {
    expect(found.filter((k) => !(k in ALLOWED_DASHED))).toEqual([]);
  });

  it('every allowed dashed rule still exists (delete the entry when its style is removed)', () => {
    expect(Object.keys(ALLOWED_DASHED).filter((k) => !found.includes(k))).toEqual([]);
  });
});
