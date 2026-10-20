/**
 * The one denial rule of the Task Types area (BUG-8, #416):
 *
 * - **A tab address** (`?tab=...`, or `/admin/workflows` and `/admin/steps` for the three tabs of the Task Types page) falls back to the
 *   first tab the person may use: `firstAllowedTab`. A tab is a view of a page the person may open, so the page still opens.
 * - **A create, edit, version or form address** (`/admin/task-types/new`, `/admin/workflows/5/versions/9`, `/admin/steps/3/form`, the Asset
 *   Type and Custom Field designers) shows the 403 page when the person lacks the permission that page needs: `permissionGuard`, which every such
 *   route in `admin.routes.ts` carries (the task type routes through their parent route).
 *
 * Every admin permission is enough to read what it manages (TY-P), so the permission of a route is its `*.Manage` code alone.
 */
export function firstAllowedTab<T extends string>(
  requested: string | null | undefined,
  allowed: readonly T[],
  fallback?: T,
): T {
  const first = allowed[0] ?? fallback;
  if (first === undefined) throw new Error('A page needs at least one tab.');
  return (allowed as readonly string[]).includes(requested ?? '') ? (requested as T) : first;
}
