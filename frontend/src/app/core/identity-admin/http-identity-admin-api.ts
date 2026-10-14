import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RolesClient, UsersClient } from '../../api/generated/api-client';
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

/** Real provider over the generated API client. */
@Injectable()
export class HttpIdentityAdminApi extends IdentityAdminApi {
  private readonly users = inject(UsersClient);
  private readonly roles = inject(RolesClient);

  listUsers(q: UserListQuery): Observable<PagedResultOfUserSummaryDto> {
    return this.users.listUsers(
      q.status && q.status !== 'all' ? q.status : undefined,
      q.search?.trim() || undefined,
      q.page,
      q.pageSize,
    );
  }

  userCounts(): Observable<UserCountsDto> {
    return this.users.getUserCounts();
  }

  getUser(userId: number): Observable<UserDetailDto> {
    return this.users.getUser(userId);
  }

  setUserRoles(userId: number, roleIds: number[], rowVersion?: string): Observable<UserDetailDto> {
    return this.users.setUserRoles(userId, { roleIds, rowVersion });
  }

  setUserActive(userId: number, isActive: boolean, rowVersion?: string): Observable<UserDetailDto> {
    return this.users.setUserActive(userId, { isActive, rowVersion });
  }

  updateUserProfile(
    userId: number,
    displayName: string,
    email: string | undefined,
    rowVersion?: string,
  ): Observable<UserDetailDto> {
    return this.users.updateUserProfile(userId, { displayName, email, rowVersion });
  }

  listRoles(): Observable<RoleSummaryDto[]> {
    return this.roles.listRoles();
  }

  getRole(roleId: number): Observable<RoleDetailDto> {
    return this.roles.getRole(roleId);
  }

  createRole(request: SaveRoleRequest): Observable<RoleDetailDto> {
    return this.roles.createRole(request);
  }

  updateRole(roleId: number, request: SaveRoleRequest): Observable<RoleDetailDto> {
    return this.roles.updateRole(roleId, request);
  }

  deleteRole(roleId: number): Observable<void> {
    return this.roles.deleteRole(roleId);
  }

  listPermissions(): Observable<PermissionGroupDto[]> {
    return this.roles.listPermissions();
  }
}
