import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { APP_ENV } from '../config/app-env';
import { MeApi } from './me-api';
import { MeProfile } from './me.models';
import { PERMISSIONS, Permission } from './permissions';

const STORAGE_KEY = 'mf.stubScenario';

const view = (...groups: string[]): Permission[] =>
  PERMISSIONS.filter((p) => groups.some((g) => p.startsWith(g + '.') && p.endsWith('.View')));

const TASK_WORK: Permission[] = [
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
];

const DASHBOARD_ALL: Permission[] = PERMISSIONS.filter((p) => p.startsWith('Dashboard.'));

const base = { userId: 1, registeredAtUtc: '2026-10-14T13:05:00Z' };

/** Stub users, mirroring the starter roles (architecture 6.3). Key = scenario id. */
export const STUB_SCENARIOS: Record<string, MeProfile & { label: string }> = {
  admin: {
    ...base,
    label: 'System Admin',
    displayName: 'Kim Admin',
    windowsAccount: 'KE\\kekim',
    status: 'ACTIVE',
    roles: ['System Admin'],
    permissions: [...PERMISSIONS],
    isSystemAdmin: true,
    hasWork: true,
  },
  director: {
    ...base,
    userId: 2,
    label: 'Director',
    displayName: 'Dana Director',
    windowsAccount: 'KE\\ddirector',
    status: 'ACTIVE',
    roles: ['Director'],
    permissions: [
      ...view('Client', 'Matter', 'Project', 'Asset', 'Pod', 'User'),
      ...TASK_WORK,
      'Client.Create',
      'Client.Edit',
      'Client.EditNumber',
      'Matter.Create',
      'Matter.Edit',
      'Matter.EditNumber',
      'Matter.SetActive',
      'Project.Create',
      'Project.Edit',
      'Project.Archive',
      'Asset.Create',
      'Asset.Edit',
      'Asset.Link',
      'Pod.Manage',
      'Pod.ManageMembers',
      ...DASHBOARD_ALL,
      'Audit.View',
    ],
    isSystemAdmin: false,
    hasWork: true,
  },
  technician: {
    ...base,
    userId: 3,
    label: 'Data Technician',
    displayName: 'Tariq Technician',
    windowsAccount: 'KE\\ttech',
    status: 'ACTIVE',
    roles: ['Data Technician'],
    permissions: [
      ...view('Client', 'Matter', 'Project', 'Asset', 'Pod'),
      ...TASK_WORK,
      'Project.Create',
      'Project.Edit',
      'Project.Archive',
      'Asset.Create',
      'Asset.Edit',
      'Asset.Link',
      'Dashboard.View',
      'Dashboard.ViewUnassigned',
    ],
    isSystemAdmin: false,
    hasWork: true,
  },
  pending: {
    ...base,
    userId: 4,
    label: 'Pending user (no roles)',
    displayName: 'Tariq Mahmood',
    windowsAccount: 'KE\\tmahmood',
    status: 'ACCESS_PENDING',
    roles: [],
    permissions: [],
    isSystemAdmin: false,
  },
  disabled: {
    ...base,
    userId: 5,
    label: 'Disabled account',
    displayName: 'Dee Disabled',
    windowsAccount: 'KE\\ddisabled',
    status: 'DISABLED',
    roles: [],
    permissions: [],
    isSystemAdmin: false,
  },
};

/**
 * Typed in-memory /me provider so the app runs without a backend. The scenario is selectable by
 * `environment.stubScenario`, persisted in localStorage and switchable from the dev-auth banner.
 * `grant()` lets the "Check again" flow be exercised.
 */
@Injectable()
export class StubMeApi extends MeApi {
  private readonly env = inject(APP_ENV);
  readonly scenarios: Record<string, MeProfile & { label: string }> = { ...STUB_SCENARIOS };
  readonly scenario = signal<string>(this.initialScenario());
  private readonly overrides = new Map<string, Partial<MeProfile>>();

  getMe(): Observable<MeProfile> {
    const s = this.scenarios[this.scenario()] ?? this.scenarios['director'];
    const { label, ...profile } = s;
    void label;
    return of({ ...profile, ...this.overrides.get(this.scenario()) });
  }

  setScenario(id: string): void {
    if (!this.scenarios[id]) return;
    this.scenario.set(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable: scenario is session-only */
    }
  }

  /** Simulate an admin granting the Data Technician role to the current user. */
  grant(): void {
    const t = this.scenarios['technician'];
    this.overrides.set(this.scenario(), {
      status: 'ACTIVE',
      roles: t.roles,
      permissions: t.permissions,
      hasWork: true,
    });
  }

  private initialScenario(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && STUB_SCENARIOS[stored]) return stored;
    } catch {
      /* ignore */
    }
    return STUB_SCENARIOS[this.env.stubScenario] ? this.env.stubScenario : 'director';
  }
}
