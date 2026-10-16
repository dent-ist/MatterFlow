import { Observable } from 'rxjs';
import {
  PagedResultOfUserSummaryDto,
  PermissionGroupDto,
  RoleDetailDto,
  RoleSummaryDto,
  CreateRoleRequest,
  UpdateRoleRequest,
  UserCountsDto,
  UserDetailDto,
  UserPodDto,
  SetUserPodsRequest,
} from '../../api/generated/api-client';

export type {
  PagedResultOfUserSummaryDto,
  PermissionGroupDto,
  RoleDetailDto,
  RoleSummaryDto,
  CreateRoleRequest,
  UpdateRoleRequest,
  UserCountsDto,
  UserDetailDto,
  UserSummaryDto,
  UserPodDto,
  SetUserPodsRequest,
} from '../../api/generated/api-client';

/** An active pod that can be assigned to a person (the choices of the Pods editor in the Users grid). */
export interface PodChoice {
  podId: number;
  name: string;
}

export type UserStatusFilter = 'all' | 'pending' | 'active' | 'inactive';

export interface UserListQuery {
  status?: UserStatusFilter;
  search?: string;
  /** Column filters (fragments of that column only). */
  name?: string;
  account?: string;
  email?: string;
  /** People holding any of these roles. */
  roleIds?: number[];
  /** `AVAILABLE`, `OUT_OF_OFFICE` or `OFF_HOURS`, as of now (worked out by the server). */
  availability?: string;
  /** First-seen days (`yyyy-MM-dd`, the viewer's zone, To inclusive). */
  registeredFrom?: string;
  registeredTo?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Users, roles and the permission catalog (S12). The real provider wraps the generated NSwag clients; an in-memory provider
 * keeps the app usable with the stub auth provider (no backend).
 */
export abstract class IdentityAdminApi {
  abstract listUsers(query: UserListQuery): Observable<PagedResultOfUserSummaryDto>;
  abstract userCounts(): Observable<UserCountsDto>;
  abstract getUser(userId: number): Observable<UserDetailDto>;
  abstract setUserRoles(
    userId: number,
    roleIds: number[],
    rowVersion: string,
  ): Observable<UserDetailDto>;
  abstract setUserActive(
    userId: number,
    isActive: boolean,
    rowVersion: string,
  ): Observable<UserDetailDto>;
  abstract updateUserProfile(
    userId: number,
    displayName: string,
    email: string | undefined,
    rowVersion: string,
  ): Observable<UserDetailDto>;

  abstract listRoles(): Observable<RoleSummaryDto[]>;
  abstract getRole(roleId: number): Observable<RoleDetailDto>;
  abstract createRole(request: CreateRoleRequest): Observable<RoleDetailDto>;
  abstract updateRole(roleId: number, request: UpdateRoleRequest): Observable<RoleDetailDto>;
  abstract deleteRole(roleId: number): Observable<void>;
  abstract listPermissions(): Observable<PermissionGroupDto[]>;

  /** Every active pod, by name. */
  abstract listActivePods(): Observable<PodChoice[]>;
  /** Replaces the pods and the primary pod of one person in one call (all of the person's pods come back, inactive ones too). */
  abstract setUserPods(userId: number, request: SetUserPodsRequest): Observable<UserPodDto[]>;
}
