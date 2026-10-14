import { Injectable, Injector, inject } from '@angular/core';
import { Observable, defer, from, shareReplay, switchMap } from 'rxjs';
import type { RolesClient, UsersClient } from '../../api/generated/api-client';
import {
  IdentityAdminApi,
  PagedResultOfUserSummaryDto,
  PermissionGroupDto,
  RoleDetailDto,
  RoleSummaryDto,
  SaveRoleRequest,
  UserCountsDto,
  UserDetailDto,
  UserListQuery,
} from './identity-admin-api';

/**
 * Real provider over the generated API client. The client module (all ~24 API classes, ~100 kB) is
 * imported on first use so it stays out of the initial bundle; this class is eager because the
 * app shell needs it for the pending-users badge.
 */
@Injectable()
export class HttpIdentityAdminApi extends IdentityAdminApi {
  private readonly injector = inject(Injector);
  private readonly client$ = defer(() => from(import('../../api/generated/api-client'))).pipe(
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  private withUsers<T>(call: (c: UsersClient) => Observable<T>): Observable<T> {
    return this.client$.pipe(switchMap((m) => call(this.injector.get(m.UsersClient))));
  }

  private withRoles<T>(call: (c: RolesClient) => Observable<T>): Observable<T> {
    return this.client$.pipe(switchMap((m) => call(this.injector.get(m.RolesClient))));
  }

  listUsers(q: UserListQuery): Observable<PagedResultOfUserSummaryDto> {
    return this.withUsers((c) =>
      c.listUsers(
        q.status && q.status !== 'all' ? q.status : undefined,
        q.search?.trim() || undefined,
        q.page,
        q.pageSize,
      ),
    );
  }

  userCounts(): Observable<UserCountsDto> {
    return this.withUsers((c) => c.getUserCounts());
  }

  getUser(userId: number): Observable<UserDetailDto> {
    return this.withUsers((c) => c.getUser(userId));
  }

  setUserRoles(userId: number, roleIds: number[], rowVersion?: string): Observable<UserDetailDto> {
    return this.withUsers((c) => c.setUserRoles(userId, { roleIds, rowVersion }));
  }

  setUserActive(userId: number, isActive: boolean, rowVersion?: string): Observable<UserDetailDto> {
    return this.withUsers((c) => c.setUserActive(userId, { isActive, rowVersion }));
  }

  updateUserProfile(
    userId: number,
    displayName: string,
    email: string | undefined,
    rowVersion?: string,
  ): Observable<UserDetailDto> {
    return this.withUsers((c) => c.updateUserProfile(userId, { displayName, email, rowVersion }));
  }

  listRoles(): Observable<RoleSummaryDto[]> {
    return this.withRoles((c) => c.listRoles());
  }

  getRole(roleId: number): Observable<RoleDetailDto> {
    return this.withRoles((c) => c.getRole(roleId));
  }

  createRole(request: SaveRoleRequest): Observable<RoleDetailDto> {
    return this.withRoles((c) => c.createRole(request));
  }

  updateRole(roleId: number, request: SaveRoleRequest): Observable<RoleDetailDto> {
    return this.withRoles((c) => c.updateRole(roleId, request));
  }

  deleteRole(roleId: number): Observable<void> {
    return this.withRoles((c) => c.deleteRole(roleId));
  }

  listPermissions(): Observable<PermissionGroupDto[]> {
    return this.withRoles((c) => c.listPermissions());
  }
}
