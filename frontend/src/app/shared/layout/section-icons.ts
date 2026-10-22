import { ADMIN_NAV_ITEMS, NAV_ITEMS, NavItem } from './nav-items';

/**
 * One source of truth for "which icon belongs to which screen": the icon of a section is the icon it has in the left navigation
 * (`nav-items.ts`), and every page header shows it before the title. Detail, edit and create pages inherit the icon of their section
 * through the path prefix (`/clients/12/edit` is a Clients page). Screens without a navigation item are listed in `EXTRA_SECTIONS`.
 */
export interface SectionIcon {
  /** Path prefix, matched on whole segments (`/tasks` matches `/tasks/7`, not `/tasks-old`). */
  prefix: string;
  /** PrimeIcons classes, for example `pi pi-home`. */
  icon: string;
}

/** Screens that are not a left-navigation item. A longer prefix wins, so `/tasks/new` beats the Task Queue's `/tasks`. */
export const EXTRA_SECTIONS: readonly SectionIcon[] = [
  { prefix: '/tasks/new', icon: 'pi pi-plus' },
  { prefix: '/profile', icon: 'pi pi-user-edit' },
  { prefix: '/notifications', icon: 'pi pi-bell' },
  { prefix: '/search', icon: 'pi pi-search' },
  { prefix: '/access-pending', icon: 'pi pi-lock' },
  { prefix: '/403', icon: 'pi pi-ban' },
  { prefix: '/404', icon: 'pi pi-compass' },
  { prefix: '/error', icon: 'pi pi-exclamation-triangle' },
];

function fromNav(items: readonly NavItem[]): SectionIcon[] {
  return items.flatMap((i) =>
    [i.path, ...(i.alsoActive ?? [])].map((p) => ({ prefix: p, icon: i.icon })),
  );
}

/** Longest prefix first. */
export const SECTION_ICONS: readonly SectionIcon[] = [
  ...fromNav(NAV_ITEMS),
  ...fromNav(ADMIN_NAV_ITEMS),
  ...EXTRA_SECTIONS,
].sort((a, b) => b.prefix.length - a.prefix.length);

/** The icon classes of the section a path (or URL) belongs to, or null when no section claims it. Query and fragment are ignored. */
export function iconForPath(path: string): string | null {
  const clean = '/' + path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
  const hit = SECTION_ICONS.find((s) => clean === s.prefix || clean.startsWith(s.prefix + '/'));
  return hit?.icon ?? null;
}
