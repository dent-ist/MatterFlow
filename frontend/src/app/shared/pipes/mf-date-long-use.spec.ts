import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for D-60 (#1146, #1147): the long date form (`mfDateLong`, "Oct 12, 2026, 10:23 PM EDT") is for tooltips and accessible names only. A template that prints it
 * in a cell, a field, a chip or a feed fails here; what those show is `mfNum` (`MM/DD hh:mm AM/PM`).
 */
const APP = join(process.cwd(), 'src', 'app');

/** Files that still print the long form and are converted by the next issue (#1147). Empty when part 2 is done. */
const PENDING: string[] = [
  'features/access-pending/pages/access-pending-page.html',
  'features/admin/asset-types/asset-type-record-page.html',
  'features/admin/custom-fields/custom-fields-page.ts',
  'features/admin/reports/report-runs-tab.ts',
  'features/admin/reports/reports-health-tab.ts',
  'features/admin/reports/reports-list-tab.ts',
  'features/admin/reports/versions-panel.ts',
  'features/admin/settings/dashboard-capacity-settings.ts',
  'features/admin/settings/dashboard-settings.ts',
  'features/admin/settings/settings-page.ts',
  'features/admin/task-types/task-type-edit-page.html',
  'features/admin/task-types/task-type-form-page.html',
  'features/admin/users/user-drawer.html',
  'features/admin/users/users-page.html',
  'features/admin/workflows/workflow-versions-tab.ts',
  'features/admin/workflows/workflows-list-page.ts',
  'features/dashboard/swimlane/swimlane-card.ts',
  'features/dashboard/swimlane/swimlane-drawer.ts',
  'features/productions/productions-tab.ts',
  'features/tasks/create/create-task-page.html',
  'features/tasks/panels/task-activity.ts',
  'features/tasks/panels/task-comments.ts',
  'shared/ui/email-intake.ts',
  'shared/ui/entity-activity.ts',
  'shared/work-queue/task-table.ts',
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return (name.endsWith('.ts') && !name.endsWith('.spec.ts')) || name.endsWith('.html')
      ? [path]
      : [];
  });
}

describe('the long date pipe', () => {
  it('is used only inside title and aria-label bindings', () => {
    const offenders: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\[(?:attr\.)?(?:title|aria-label)\]="[^"]*"/g, '');
      if (/\|\s*mfDateLong\b/.test(text)) offenders.push(relative(APP, file).replace(/\\/g, '/'));
    }
    expect(offenders.filter((f) => !PENDING.includes(f))).toEqual([]);
  });

  it('the pending list only shrinks: part 2 (#1147) empties it', () => {
    expect(PENDING.length).toBeLessThanOrEqual(25);
  });
});
