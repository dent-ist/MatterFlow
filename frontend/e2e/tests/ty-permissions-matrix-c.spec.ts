import {
  registerListsAuditMatrix,
  registerTaskTypesMatrix,
} from '../support/ty-permissions-matrix';

/**
 * #1357: part c of the permission matrix of the Task Types area (#417) and the AD-D matrix of the Lists and Audit pages. The body is in
 * support/ty-permissions-matrix.ts; the roles are spread over three files so that no single file dominates a CI shard (docs/qa/e2e.md).
 */
registerTaskTypesMatrix(['wf-tv', 'tt-tv', 'tv', 'none']);
registerListsAuditMatrix();
