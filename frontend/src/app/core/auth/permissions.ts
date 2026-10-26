/**
 * Permission catalog (architecture 6.3). Hand-maintained until the TypeScript union is generated
 * from contracts/permissions.json; keep codes identical to the server catalog.
 */
export const PERMISSIONS = [
  'Client.View',
  'Client.Create',
  'Client.Edit',
  'Client.EditNumber',
  'Matter.View',
  'Matter.Create',
  'Matter.Edit',
  'Matter.EditNumber',
  'Matter.SetActive',
  'Matter.BeManager',
  'Matter.AssignManagers',
  'Matter.ViewSensitive',
  'Project.View',
  'Project.Create',
  'Project.Edit',
  'Project.Archive',
  'Task.View',
  'Task.Create',
  'Task.Edit',
  'Task.Assign',
  'Task.SetPriority',
  'Task.ChangeStatus',
  'Task.Complete',
  'Task.Cancel',
  'Task.Reopen',
  'Task.Comment',
  'Workflow.Execute',
  'Workflow.StepReopen',
  'Asset.View',
  'Asset.Create',
  'Asset.Edit',
  'Asset.Link',
  'Pod.View',
  'Pod.Manage',
  'Pod.ManageMembers',
  'User.View',
  'User.Manage',
  'Role.Manage',
  'TaskType.Manage',
  'Workflow.Manage',
  'AssetType.Manage',
  'CustomField.Manage',
  'Priority.Manage',
  'OnHoldReason.Manage',
  'StatusLabel.Manage',
  'Dashboard.View',
  'Dashboard.ViewSummary',
  'Dashboard.ViewUnassigned',
  'Dashboard.ViewBreakdowns',
  'Dashboard.ViewTrends',
  'Dashboard.ViewSwimlane',
  'Dashboard.ViewUsers',
  'Dashboard.ViewCoverage',
  'Report.Manage',
  'Report.Assign',
  'Report.Run',
  'Audit.View',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The permissions that open a Dashboard tab (in addition to Dashboard.View). `Dashboard.ViewCoverage` is not here: it is a sub-view of the
 * Users tab and opens nothing by itself.
 */
export const DASHBOARD_TAB_PERMISSION_CODES = [
  'Dashboard.ViewSummary',
  'Dashboard.ViewUnassigned',
  'Dashboard.ViewBreakdowns',
  'Dashboard.ViewTrends',
  'Dashboard.ViewSwimlane',
  'Dashboard.ViewUsers',
] as const satisfies readonly Permission[];
