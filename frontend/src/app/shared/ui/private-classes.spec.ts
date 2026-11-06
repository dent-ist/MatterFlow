import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard for private chip and link classes (D-12, D-13; #1130, #1132; docs/ux/design-guidelines.md section 6). A component style sheet may lay a chip or a link out, but it may
 * not draw one: no class named like a chip (`chip`, `badge`, `pill`, `tag`) that paints a fill or a pill shape (`background`, `border-radius`), and no class named like a link
 * (`link`, `lnk`, `linkbtn`, `link-btn`, `lnk-btn`, `pg-link`) that underlines or takes the link colour. Use `mf-status-chip`, `mf-badge`, `mf-count-chip`, `mf-filter-chips`,
 * `mf-tag-chip` and `mf-priority-flag` for a chip, `<a class="mf-link">` (or a plain `a`) for a link and `mf-btn mf-btn--text` for an action.
 *
 * The same scan runs from the command line as `node docs/ux/ui-update/crawl/scan-private-classes.mjs --list`.
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
  'shared/ui/side-panel.ts',
]);

/**
 * Private chip classes that remain, each with the reason and the follow-up (#1130). Keys are `file:class`. Remove an entry when its page is converted; a new entry needs the designer.
 */
const ALLOWED_CHIPS: Readonly<Record<string, string>> = {
  'features/admin/note-tags/note-tags-page.ts:nt-chip':
    'a note tag in the colour an administrator chose (any hex): no shared chip takes a free colour; ask the designer for a coloured tag chip',
  'features/dashboard/calendar/calendar-coverage.scss:hchip':
    'a holiday label in the colour an administrator chose (colour key); same need as the coloured tag chip',
  'features/notes/notes-tab-misc.scss:nt__badge':
    'a count that sits on the corner of an icon button (History, Referenced Items): the shared count chip is a 22 px grey chip beside a title, not an overlay',
  'features/search/search-filters.ts:sf-chip':
    'a removable filter whose whole chip is the button; the shared tag chip removes only with its x, so the behaviour would change (Search page group)',
  'shared/availability/set-out-of-office-dialog.ts:ooo__chip':
    'preset buttons that mix toggles and one action ("Pick a Date") in one group; mf-filter-chips has only toggles',
  'shared/layout/notification-bell.ts:nb__badge':
    'the red unread count on the bell: an overlay alert count, no shared kind (count chip is grey and beside a title)',
  'shared/task-type/task-type-badge.ts:tt-chip':
    'a second task type tile (tinted palette, 24 or 28 px) beside mf-task-type-chip (solid --mf-tt colours); merging changes the colours of Search, task cards, Task Types and My Matters rows, a designer decision',
  'shared/work-queue/task-card-list.scss:tc-sk--chips':
    'a skeleton placeholder in the shape of a chip while loading, not a chip',
};

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
