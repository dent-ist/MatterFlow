import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';
import { FormDesignerApi } from './task-types/form-designer-api';
import { InMemoryFormDesignerApi } from './task-types/in-memory-form-designer-api';

const page = (path: string, title: string, ...codes: Parameters<typeof permissionGuard>) => ({
  path,
  canActivate: [permissionGuard(...codes)],
  component: PlaceholderPage,
  data: { title },
});

/**
 * Task Types & Forms (UX S14). The form designer talks to `FormDesignerApi`; until the backend
 * endpoints exist it is backed by an in-memory stub. Swap the provider to go live.
 */
const taskTypeForms = (path: string) => ({
  path,
  canActivate: [permissionGuard('TaskType.Manage')],
  canDeactivate: [unsavedChangesGuard],
  providers: [{ provide: FormDesignerApi, useClass: InMemoryFormDesignerApi }],
  loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
});

/** Administration (UX 2.1). Each screen needs its own *.Manage / View permission. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  page('users', 'Users & Roles', 'User.View', 'User.Manage', 'Role.Manage'),
  page('roles', 'Roles & Permissions', 'Role.Manage'),
  page('pods', 'Pods', 'Pod.Manage', 'Pod.ManageMembers'),
  taskTypeForms('task-types'),
  taskTypeForms('task-types/:ownerId/form'),
  page('steps', 'Step Library', 'Workflow.Manage'),
  page('workflows', 'Workflows', 'Workflow.Manage'),
  page('asset-types', 'Asset Types', 'AssetType.Manage'),
  page('custom-fields', 'Custom Fields', 'CustomField.Manage'),
  page('priorities', 'Priorities', 'Priority.Manage'),
  page('status-labels', 'Status Labels', 'StatusLabel.Manage'),
  page('audit', 'Audit Log', 'Audit.View'),
];
