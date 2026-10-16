import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { PERMISSIONS } from '../auth/permissions';
import { ApiError } from '../http/api-error';
import {
  IdentityAdminApi,
  PagedResultOfUserSummaryDto,
  PermissionGroupDto,
  RoleDetailDto,
  RoleSummaryDto,
  CreateRoleRequest,
  UpdateRoleRequest,
  UserCountsDto,
  UserDetailDto,
  UserListQuery,
  UserSummaryDto,
  PodChoice,
  SetUserPodsRequest,
  UserPodDto,
} from './identity-admin-api';

interface MemRole {
  roleId: number;
  name: string;
  description?: string;
  isSystemAdmin: boolean;
  permissionCodes: string[];
}

interface MemUser {
  userId: number;
  displayName: string;
  email?: string;
  windowsAccount: string;
  isActive: boolean;
  isSeededAdmin: boolean;
  roleIds: number[];
  registeredAtUtc: string;
  lastLoginAtUtc?: string;
  version: number;
  /** Pod memberships (ids; `primaryPodId` is the primary one). */
  podIds: number[];
  primaryPodId?: number;
  /** Set by tests to show a person as out of office or off hours; unset = available. */
  availability?: { state: string; outUntil: string | undefined; note: string | undefined };
}

const fail = (status: number, code: string, message: string): Observable<never> =>
  throwError(
    () =>
      new ApiError(
        status,
        code,
        message,
        { code, detail: message, status },
        new HttpErrorResponse({ status }),
      ),
  );

const noUser = () => fail(404, 'NOT_FOUND', 'The user does not exist.');
const noRole = () => fail(404, 'NOT_FOUND', 'The role does not exist.');
const group = (code: string): string => code.split('.')[0];
const view = (...groups: string[]): string[] =>
  PERMISSIONS.filter((p) => groups.some((g) => p.startsWith(g + '.') && p.endsWith('.View')));

/**
 * In-memory users and roles for the stub auth provider and tests. Mirrors the server rules that matter to the UI: pending
 * users have no role, System Admin is locked, a role in use cannot be deleted, the last active admin is protected.
 */
@Injectable()
export class InMemoryIdentityAdminApi extends IdentityAdminApi {
  private nextRoleId = 7;
  /** Id of the signed-in stub user; deactivating that user is refused like the server does. */
  currentUserId = 1;

  readonly roles: MemRole[] = [
    { roleId: 1, name: 'System Admin', isSystemAdmin: true, permissionCodes: [...PERMISSIONS] },
    {
      roleId: 2,
      name: 'Director',
      description: 'Department head',
      isSystemAdmin: false,
      permissionCodes: [
        ...view('Client', 'Matter', 'Project', 'Asset', 'Pod', 'User'),
        'Task.View',
      ],
    },
    {
      roleId: 3,
      name: 'Project Manager',
      isSystemAdmin: false,
      permissionCodes: [...view('Client', 'Matter', 'Project'), 'Task.View', 'Project.Create'],
    },
    {
      roleId: 4,
      name: 'Pod Lead',
      isSystemAdmin: false,
      permissionCodes: [...view('Client', 'Matter', 'Pod'), 'Task.View', 'Pod.ManageMembers'],
    },
    {
      roleId: 5,
      name: 'Data Technician',
      isSystemAdmin: false,
      permissionCodes: [...view('Client', 'Matter', 'Project'), 'Task.View', 'Task.Complete'],
    },
    {
      roleId: 6,
      name: 'Data Scientist',
      isSystemAdmin: false,
      permissionCodes: [...view('Client', 'Matter', 'Project'), 'Task.View'],
    },
  ];

  readonly users: MemUser[] = [
    this.user(1, 'Kim Admin', 'KE\\kekim', 'kim@firm.test', [1], true, true),
    this.user(2, 'Dana Director', 'KE\\ddirector', 'dana@firm.test', [2]),
    this.user(3, 'Tariq Mahmood', 'KE\\tmahmood', 'tariq@firm.test', [], true),
    this.user(4, 'Priya Patel', 'KE\\ppatel', undefined, [], true),
    this.user(5, 'Dee Disabled', 'KE\\ddisabled', undefined, [5], false),
  ];

  private user(
    userId: number,
    displayName: string,
    windowsAccount: string,
    email: string | undefined,
    roleIds: number[],
    isActive = true,
    isSeededAdmin = false,
  ): MemUser {
    return {
      userId,
      displayName,
      email,
      windowsAccount,
      isActive,
      isSeededAdmin,
      roleIds,
      registeredAtUtc: '2026-10-14T13:05:00Z',
      lastLoginAtUtc: roleIds.length ? '2026-10-14T15:00:00Z' : undefined,
      version: 1,
      podIds: [],
    };
  }

  /** Pods of the stub (tests add to it). */
  readonly pods: { podId: number; name: string; isActive: boolean }[] = [];

  // ---- users

  listUsers(q: UserListQuery): Observable<PagedResultOfUserSummaryDto> {
    const needle = q.search?.trim().toLowerCase();
    const status = q.status ?? 'all';
    const rows = this.users
      .filter((u) => {
        if (status === 'pending' && !this.isPending(u)) return false;
        if (status === 'active' && !u.isActive) return false;
        if (status === 'inactive' && u.isActive) return false;
        const has = (v: string | undefined, t?: string) =>
          !t || (v ?? '').toLowerCase().includes(t.trim().toLowerCase());
        return (
          has(u.displayName, q.name) &&
          has(u.windowsAccount, q.account) &&
          has(u.email, q.email) &&
          (!q.availability || this.summary(u).availability?.state === q.availability) &&
          (!q.roleIds?.length || u.roleIds.some((id) => q.roleIds?.includes(id))) &&
          (!needle ||
            [u.displayName, u.email ?? '', u.windowsAccount].some((v) =>
              v.toLowerCase().includes(needle),
            ))
        );
      })
      .sort(
        (a, b) =>
          Number(this.isPending(b)) - Number(this.isPending(a)) ||
          a.displayName.localeCompare(b.displayName),
      );
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    return of({
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((u) => this.summary(u)),
      total: rows.length,
      page,
      pageSize,
    });
  }

  userCounts(): Observable<UserCountsDto> {
    return of({
      pending: this.users.filter((u) => this.isPending(u)).length,
      active: this.users.filter((u) => u.isActive).length,
      inactive: this.users.filter((u) => !u.isActive).length,
    });
  }

  getUser(userId: number): Observable<UserDetailDto> {
    const u = this.find(userId);
    return u ? of(this.detail(u)) : noUser();
  }

  setUserRoles(userId: number, roleIds: number[]): Observable<UserDetailDto> {
    const u = this.find(userId);
    if (!u) return noUser();
    const dropsAdmin = this.hasAdminRole(u) && !roleIds.some((id) => this.role(id)?.isSystemAdmin);
    if (dropsAdmin && u.isActive && this.activeAdmins().every((a) => a.userId === u.userId)) {
      return fail(409, 'LAST_ADMIN', 'At least one active System Admin is required.');
    }

    u.roleIds = [...new Set(roleIds)];
    u.version++;
    return of(this.detail(u));
  }

  setUserActive(userId: number, isActive: boolean): Observable<UserDetailDto> {
    const u = this.find(userId);
    if (!u) return noUser();
    if (!isActive && userId === this.currentUserId) {
      return fail(400, 'VALIDATION_FAILED', 'You cannot deactivate your own account.');
    }
    if (
      !isActive &&
      this.hasAdminRole(u) &&
      this.activeAdmins().every((a) => a.userId === u.userId)
    ) {
      return fail(409, 'LAST_ADMIN', 'At least one active System Admin is required.');
    }

    u.isActive = isActive;
    u.version++;
    return of(this.detail(u));
  }

  updateUserProfile(
    userId: number,
    displayName: string,
    email: string | undefined,
  ): Observable<UserDetailDto> {
    const u = this.find(userId);
    if (!u) return noUser();
    u.displayName = displayName.trim();
    u.email = email?.trim() || undefined;
    u.version++;
    return of(this.detail(u));
  }

  // ---- roles

  listRoles(): Observable<RoleSummaryDto[]> {
    return of(
      [...this.roles]
        .sort(
          (a, b) =>
            Number(b.isSystemAdmin) - Number(a.isSystemAdmin) || a.name.localeCompare(b.name),
        )
        .map((r) => ({
          roleId: r.roleId,
          name: r.name,
          description: r.description,
          isSystemAdmin: r.isSystemAdmin,
          memberCount: this.members(r),
          permissionCount: r.permissionCodes.length,
        })),
    );
  }

  getRole(roleId: number): Observable<RoleDetailDto> {
    const r = this.role(roleId);
    return r ? of(this.roleDetail(r)) : noRole();
  }

  createRole(request: CreateRoleRequest): Observable<RoleDetailDto> {
    if (this.nameTaken(request.name)) {
      return fail(409, 'DUPLICATE_NAME', 'A role with this name already exists.');
    }

    const role: MemRole = {
      roleId: this.nextRoleId++,
      name: request.name.trim(),
      description: request.description?.trim() || undefined,
      isSystemAdmin: false,
      permissionCodes: [...request.permissionCodes],
    };
    this.roles.push(role);
    return of(this.roleDetail(role));
  }

  updateRole(roleId: number, request: UpdateRoleRequest): Observable<RoleDetailDto> {
    const r = this.role(roleId);
    if (!r) return noRole();
    if (r.isSystemAdmin) {
      return fail(
        409,
        'IMMUTABLE_FIELD',
        'The System Admin role is built in and cannot be edited.',
      );
    }
    if (this.nameTaken(request.name, roleId)) {
      return fail(409, 'DUPLICATE_NAME', 'A role with this name already exists.');
    }

    r.name = request.name.trim();
    r.description = request.description?.trim() || undefined;
    r.permissionCodes = [...request.permissionCodes];
    return of(this.roleDetail(r));
  }

  deleteRole(roleId: number): Observable<void> {
    const r = this.role(roleId);
    if (!r) return noRole();
    if (r.isSystemAdmin) {
      return fail(409, 'IMMUTABLE_FIELD', 'The System Admin role cannot be deleted.');
    }

    const members = this.members(r);
    if (members > 0) {
      return fail(409, 'ROLE_IN_USE', `${members} user(s) have this role. Remove them first.`);
    }

    this.roles.splice(this.roles.indexOf(r), 1);
    return of(undefined);
  }

  listPermissions(): Observable<PermissionGroupDto[]> {
    const groups = new Map<string, PermissionGroupDto>();
    for (const code of PERMISSIONS) {
      const g = groups.get(group(code)) ?? { group: group(code), permissions: [] };
      g.permissions.push({ code, description: code.replace('.', ': ') });
      groups.set(g.group, g);
    }

    return of([...groups.values()]);
  }

  // ---- helpers

  private find(userId: number): MemUser | undefined {
    return this.users.find((u) => u.userId === userId);
  }

  private role(roleId: number): MemRole | undefined {
    return this.roles.find((r) => r.roleId === roleId);
  }

  private members(r: MemRole): number {
    return this.users.filter((u) => u.roleIds.includes(r.roleId)).length;
  }

  private nameTaken(name: string, exceptId?: number): boolean {
    return this.roles.some(
      (r) => r.roleId !== exceptId && r.name.toLowerCase() === name.trim().toLowerCase(),
    );
  }

  private hasAdminRole(u: MemUser): boolean {
    return u.roleIds.some((id) => this.role(id)?.isSystemAdmin);
  }

  private activeAdmins(): MemUser[] {
    return this.users.filter((u) => u.isActive && this.hasAdminRole(u));
  }

  private isPending(u: MemUser): boolean {
    return u.isActive && u.roleIds.length === 0;
  }

  private effective(u: MemUser): string[] {
    const codes = new Set(u.roleIds.flatMap((id) => this.role(id)?.permissionCodes ?? []));
    return [...codes].sort();
  }

  private summary(u: MemUser): UserSummaryDto {
    return {
      userId: u.userId,
      displayName: u.displayName,
      email: u.email,
      windowsAccount: u.windowsAccount,
      isActive: u.isActive,
      isPending: this.isPending(u),
      isSystemAdmin: this.hasAdminRole(u),
      isSeededAdmin: u.isSeededAdmin,
      roles: u.roleIds.map((id) => this.role(id)?.name ?? '').sort(),
      registeredAtUtc: u.registeredAtUtc,
      lastLoginAtUtc: u.lastLoginAtUtc,
      pods: this.userPods(u),
      availability: u.availability ?? { state: 'AVAILABLE', outUntil: undefined, note: undefined },
    };
  }

  private userPods(u: MemUser): UserPodDto[] {
    return u.podIds
      .map((id) => this.pods.find((p) => p.podId === id))
      .filter((p): p is { podId: number; name: string; isActive: boolean } => !!p)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        podId: p.podId,
        name: p.name,
        isActive: p.isActive,
        isPrimary: u.primaryPodId === p.podId,
      }));
  }

  private detail(u: MemUser): UserDetailDto {
    return {
      ...this.summary(u),
      roleIds: [...u.roleIds],
      effectivePermissions: this.effective(u),
      rowVersion: String(u.version),
    };
  }

  private roleDetail(r: MemRole): RoleDetailDto {
    return {
      roleId: r.roleId,
      name: r.name,
      description: r.description,
      isSystemAdmin: r.isSystemAdmin,
      memberCount: this.members(r),
      permissionCodes: [...r.permissionCodes].sort(),
      rowVersion: '1',
    };
  }

  listActivePods(): Observable<PodChoice[]> {
    return of(this.pods.filter((p) => p.isActive).map((p) => ({ podId: p.podId, name: p.name })));
  }

  /** Stub of `PUT /users/{id}/pods` (the server rules are tested against the real API): one primary among the pods, no new inactive pod. */
  setUserPods(userId: number, request: SetUserPodsRequest): Observable<UserPodDto[]> {
    const u = this.find(userId);
    if (!u) return noUser();
    const ids = [...new Set(request.podIds)];
    const bad = (id: number) =>
      !u.podIds.includes(id) && !this.pods.find((p) => p.podId === id)?.isActive;
    if (request.primaryPodId !== undefined && !ids.includes(request.primaryPodId)) {
      return fail(400, 'VALIDATION_FAILED', 'The primary pod must be one of the pods.');
    }
    if (ids.some(bad))
      return fail(409, 'POD_INACTIVE', 'An inactive pod cannot be newly assigned.');
    u.podIds = ids;
    u.primaryPodId = request.primaryPodId;
    return of(this.userPods(u));
  }
}
