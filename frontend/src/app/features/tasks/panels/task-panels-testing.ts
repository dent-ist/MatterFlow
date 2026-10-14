import {
  TaskActivityItem,
  TaskAssetLinkResponse,
  TaskCommentResponse,
} from '../../../api/generated/api-client';

/** Builders shared by the Task panel component tests. */
export function aComment(overrides: Partial<TaskCommentResponse> = {}): TaskCommentResponse {
  return {
    commentId: 1,
    taskId: 42,
    purpose: 'NORMAL',
    purposeLabel: undefined,
    bodyHtml: '<p>Called the client; <strong>approved</strong>.</p>',
    author: { userId: 5, displayName: 'Dana P.', isActive: true },
    createdAtUtc: '2026-10-13T14:25:00Z',
    editedAtUtc: undefined,
    isEdited: false,
    canEdit: true,
    canDelete: true,
    rowVersion: 'AAAA',
    ...overrides,
  };
}

export function aLink(overrides: Partial<TaskAssetLinkResponse> = {}): TaskAssetLinkResponse {
  return {
    assetId: 9,
    displayName: 'Contract bundle',
    assetTypeName: 'Document Set',
    externalReference: 'https://dms.example/folders/42',
    isActive: true,
    assetLinkRoleId: 1,
    assetLinkRoleName: 'Source',
    linkedAtUtc: '2026-10-13T14:25:00Z',
    linkedBy: { userId: 5, displayName: 'Dana P.', isActive: true },
    rowVersion: 'LLLL',
    ...overrides,
  };
}

export function anActivity(overrides: Partial<TaskActivityItem> = {}): TaskActivityItem {
  return {
    eventId: 10,
    occurredAtUtc: '2026-10-13T14:25:00Z',
    eventType: 'TASK_STATUS_CHANGED',
    category: 'STATUS',
    actor: { userId: 5, displayName: 'Dana P.', isActive: true },
    summary: 'Status changed from In Progress to On Hold',
    fieldKey: 'status',
    oldValue: 'In Progress',
    newValue: 'On Hold',
    ...overrides,
  };
}
