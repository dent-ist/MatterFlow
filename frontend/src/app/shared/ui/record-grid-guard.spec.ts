import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guard for the shared record grid (#1241, docs/ux/design-guidelines.md section 2.2, D-42): a list of records is drawn by `mf-record-grid` (resize, reorder, Columns,
 * stored widths, one anatomy), not by a hand-built `<table class="pg-table">` or `<table class="mf-grid">`. A new page that draws one fails here.
 *
 * ALLOWED lists the tables that are still hand-built, each with the reason; remove the entry when the page is migrated (the Administration lists and the Assets and
 * Projects grids are follow-up issues of #1241). A new entry needs the UI designer.
 */
const APP = join(process.cwd(), 'src', 'app');

const ALLOWED: Readonly<Record<string, string>> = {
  'features/admin/asset-types/asset-types-page.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/custom-fields/custom-fields-page.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/note-tags/note-tags-page.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/reports/preview-panel.ts': 'a report preview, not a record list',
  'features/admin/reports/report-categories-tab.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/reports/report-matrix-tab.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/reports/report-runs-tab.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/reports/reports-list-tab.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/steps/steps-list-page.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/workflows/workflow-versions-tab.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/admin/workflows/workflows-list-page.ts':
    'Administration list, adopts the shared grid in its Administration issue',
  'features/clients/pages/client-matters.ts':
    'Client > Matters tab, adopts the shared grid with the Clients record issues',
  'features/matters/pages/matter-projects.ts':
    'Matter > Projects tab, adopts the shared grid with the Matter tab issues',
  'features/matters/ui/matter-activities.ts':
    'Matter > Activities feed, adopts the shared grid with the Matter tab issues',
  'features/productions/productions-tab.ts':
    'Matter > Productions tab, adopts the shared grid with the Matter tab issues',
  'features/search/search-grid.ts': 'Search results, adopts the shared grid in the Search issue',
  'shared/ui/admin-list-shell.ts': 'the shell of the Administration lists',
  'shared/ui/matter-assets.ts':
    'Matter > Assets tab, adopts the shared grid with the Matter tab issues',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.ts$/.test(name) && !/\.spec\.ts$/.test(name) && !name.includes('generated'))
      out.push(path);
  }
  return out;
}

/** The grid itself and the resize directive: their doc comments show the markup, they draw none. */
const DOC_ONLY = new Set(['shared/ui/record-grid.ts', 'shared/ui/resizable-columns.ts']);

/** A record grid drawn by hand: a `<table>` with the shared grid class. */
const HAND_BUILT = /<table[^>]*class="[^"]*\b(pg-table|mf-grid)\b/;
const rel = (path: string): string => relative(APP, path).replace(/\\/g, '/');

describe('record grid guard (#1241)', () => {
  const files = sources(APP).map((path) => ({ file: rel(path), text: readFileSync(path, 'utf8') }));

  it('no new hand-built record grid: a list of records uses mf-record-grid', () => {
    const offenders = files
      .filter((f) => !DOC_ONLY.has(f.file) && HAND_BUILT.test(f.text) && !(f.file in ALLOWED))
      .map((f) => f.file);
    expect(
      offenders,
      `use <mf-record-grid> (shared/ui/record-grid.ts), or ask the designer to list the file`,
    ).toEqual([]);
  });

  it('the allowed list holds only files that still draw a table by hand', () => {
    const stale = Object.keys(ALLOWED).filter((file) => {
      const f = files.find((x) => x.file === file);
      return !f || !HAND_BUILT.test(f.text);
    });
    expect(stale, 'remove the migrated pages from ALLOWED').toEqual([]);
  });

  it('the Matters, Clients, Projects and Assets lists are drawn by the shared grid', () => {
    for (const file of [
      'features/matters/pages/matters-list-page.ts',
      'features/clients/pages/clients-list-page.ts',
      'features/projects/pages/projects-list-page.ts',
      'features/assets/pages/assets-list-page.ts',
    ]) {
      const text = files.find((f) => f.file === file)!.text;
      expect(text, file).toContain('<mf-record-grid');
      expect(text, file).toContain('<mf-record-columns');
      expect(HAND_BUILT.test(text), file).toBe(false);
    }
  });
});
