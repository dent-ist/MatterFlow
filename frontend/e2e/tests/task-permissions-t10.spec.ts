import { registerTaskPermissionsMatrix } from '../support/task-permissions-t10';

/**
 * #1359: part a of the permission matrix of the Task page (#329). The body is in support/task-permissions-t10.ts; the roles are spread over three files so
 * that no single file dominates a CI shard (docs/qa/e2e.md).
 */
registerTaskPermissionsMatrix([
  'admin',
  'assignee',
  'tech',
  'view-only',
  'view-all',
  'comment-only',
  'no-asset',
]);
