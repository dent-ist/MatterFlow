import { ADMIN_NAV_ITEMS } from '../../../shared/layout/nav-items';
import {
  ADMIN_LISTS,
  ADMIN_LIST_GROUPS,
  ADMIN_LIST_PERMISSIONS,
  ADMIN_LIST_TABS,
  adminListByKey,
  movedNotice,
} from './admin-lists';

/** The registry is the one source of the catalogue, the routes, the redirects, the page title and the guard (UI spec 3.1 and 4.3). */
describe('Administration > Lists registry (UI spec 3.1)', () => {
  it('has the eight lists in catalogue order and four groups, with the permission of each', () => {
    expect(ADMIN_LISTS.map((l) => [l.group, l.key, l.label, l.permission])).toEqual([
      ['Matter', 'matter-types', 'Matter Types', 'MatterList.Manage'],
      ['Matter', 'current-states', 'Current States', 'MatterList.Manage'],
      ['Matter', 'team-titles', 'Team Titles', 'MatterList.Manage'],
      ['Task', 'priorities', 'Priorities', 'Priority.Manage'],
      ['Task', 'status-labels', 'Status Labels', 'StatusLabel.Manage'],
      ['Task', 'on-hold-reasons', 'On-Hold Reasons', 'OnHoldReason.Manage'],
      // Owner decision 4: Note Tags stay gated by StatusLabel.Manage.
      ['Notes', 'note-tags', 'Note Tags', 'StatusLabel.Manage'],
      ['Assets', 'link-roles', 'Link Roles', 'AssetType.Manage'],
    ]);
    expect(ADMIN_LIST_GROUPS.map((g) => g.name)).toEqual(['Matter', 'Task', 'Notes', 'Assets']);
    expect(ADMIN_LIST_GROUPS.map((g) => g.icon)).toEqual([
      'pi-briefcase',
      'pi-check-square',
      'pi-file-edit',
      'pi-database',
    ]);
  });

  it('keeps the hints to one short line and the sentences exact', () => {
    for (const l of ADMIN_LISTS) {
      // The spec says at most 40 characters of 12 px text (the card shows about 38; a longer hint ellipsizes with the full text as tooltip).
      expect(l.hint.length, l.key).toBeLessThanOrEqual(40);
      expect(l.shownOn.startsWith('Shown on: '), l.key).toBe(true);
      expect(l.shownOn.endsWith('.'), l.key).toBe(true);
      expect(l.rule.endsWith('.'), l.key).toBe(true);
    }
    expect(adminListByKey('priorities')).toMatchObject({
      hint: 'Urgency of every task',
      shownOn: 'Shown on: New Task form, task lists (column and filter), Task page.',
      rule: 'Order priorities from most to least urgent. Exactly one is the default.',
    });
    expect(adminListByKey('status-labels')!.rule).toBe(
      "Rename how the five statuses read. You can't add or remove statuses.",
    );
    expect(adminListByKey('unknown')).toBeUndefined();
  });

  it('describes how the lists differ (backend notes, UI spec 4.3)', () => {
    const t = (key: string) => adminListByKey(key)!;
    expect([t('priorities').idField, t('priorities').nameField, t('priorities').colour]).toEqual([
      'id',
      'label',
      'color',
    ]);
    expect([t('status-labels').idField, t('status-labels').nameField]).toEqual([
      'code',
      'displayLabel',
    ]);
    expect([t('note-tags').idField, t('note-tags').colour, t('note-tags').reorder]).toEqual([
      'noteTagId',
      'colourKey',
      false,
    ]);
    // Delete exists for six lists; On-Hold Reasons and Status Labels have none, and Status Labels cannot be created or deactivated.
    expect(ADMIN_LISTS.filter((l) => !l.delete).map((l) => l.key)).toEqual([
      'status-labels',
      'on-hold-reasons',
    ]);
    expect(t('status-labels')).toMatchObject({ create: false, hasActive: false, newLabel: null });
    expect(ADMIN_LISTS.filter((l) => l.defaultAction).map((l) => l.key)).toEqual(['priorities']);
    expect(ADMIN_LISTS.filter((l) => !l.reorder).map((l) => l.key)).toEqual([
      'status-labels',
      'note-tags',
    ]);
    // A New button exists exactly where a list can be created.
    for (const l of ADMIN_LISTS) expect(l.newLabel !== null, l.key).toBe(l.create);
  });

  it('feeds the navigation item: it shows for any of the five permissions', () => {
    const item = ADMIN_NAV_ITEMS.find((i) => i.label === 'Lists')!;
    expect(item.path).toBe('/admin/lists');
    expect([...item.permissions!].sort()).toEqual([...ADMIN_LIST_PERMISSIONS].sort());
    expect(ADMIN_LIST_PERMISSIONS).toHaveLength(5);
    expect(ADMIN_NAV_ITEMS.map((i) => i.label)).not.toContain('Labels');
    expect(ADMIN_NAV_ITEMS.map((i) => i.label)).not.toContain('Matter Lists');
  });

  it('makes one tab per list for the permission helpers, addressed under /admin/lists', () => {
    expect(ADMIN_LIST_TABS.map((t) => t.route)).toEqual(
      ADMIN_LISTS.map((l) => `/admin/lists/${l.key}`),
    );
  });

  it('words the notice of an old link', () => {
    expect(movedNotice(adminListByKey('priorities')!)).toBe(
      'Priorities has moved here, under Lists > Task. Update your bookmark.',
    );
    expect(movedNotice(adminListByKey('link-roles')!)).toBe(
      'Link Roles has moved here, under Lists > Assets. Update your bookmark.',
    );
  });
});
