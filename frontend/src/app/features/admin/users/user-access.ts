import { PermissionGroupDto } from '../../../core/identity-admin/identity-admin-api';

/** One group of the permission summary: `Task (9)`, the codes in it (the tooltip) and its size. */
export interface PermissionSummaryGroup {
  group: string;
  count: number;
  codes: string[];
}

/**
 * The permissions of a person grouped the way the Roles tab groups them (#439): one entry per catalog group that has at least one of the
 * codes, in catalog order, with the number held. A code the catalog does not know (a newer server) goes to an "Other" group at the end,
 * so a count is never silently dropped.
 */
export function summarizePermissions(
  codes: Iterable<string>,
  catalog: readonly PermissionGroupDto[],
): PermissionSummaryGroup[] {
  const held = new Set(codes);
  const known = new Set<string>();
  const groups: PermissionSummaryGroup[] = [];
  for (const g of catalog) {
    const own = g.permissions.map((p) => p.code).filter((c) => held.has(c));
    g.permissions.forEach((p) => known.add(p.code));
    if (own.length > 0) groups.push({ group: g.group, count: own.length, codes: own });
  }
  const other = [...held].filter((c) => !known.has(c)).sort();
  if (other.length > 0) groups.push({ group: 'Other', count: other.length, codes: other });
  return groups;
}

/** Permission codes of the roles ticked in the draft: the union of their permissions (System Admin holds the whole catalog). */
export function permissionsOfRoles(
  roleIds: readonly number[],
  codesByRole: ReadonlyMap<number, readonly string[]>,
): Set<string> {
  const out = new Set<string>();
  for (const id of roleIds) for (const code of codesByRole.get(id) ?? []) out.add(code);
  return out;
}
