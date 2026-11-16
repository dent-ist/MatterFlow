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
  PersonListItemView,
  UpdateUserPersonDetailsRequest,
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
  PersonListItemView,
  UpdateUserPersonDetailsRequest,
} from '../../api/generated/api-client';

/** An active pod that can be assigned to a person (the choices of the Pods editor in the Users grid). */
export interface PodChoice {
  podId: number;
  name: string;
}

export type UserStatusFilter = 'all' | 'pending' | 'active' | 'inactive';

/** The sort keys of the users list (#436). */
export type UserSortKey =
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'firstSeen'
  | 'lastSeen'
  | 'title'
  | 'office'
  | 'employmentStatus';

export interface UserListQuery {
  status?: UserStatusFilter;
  search?: string;
  /** Column filters (fragments of that column only). */
  name?: string;
  /** Fragment of the first or last name of the linked person record. */
  firstName?: string;
  lastName?: string;
  /** Fragment of the title of the person record. */
  title?: string;
  /** Only people of this office / with this employment status (the HR status of the person record, not the account state). */
  officeId?: number;
  employmentStatusId?: number;
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
  /** `firstName`, `lastName`, `firstSeen` or `lastSeen` (`name` sorts by display name) (people who never signed in are last); omitted keeps the queue order (waiting people first). */
  sort?: UserSortKey;
  /** Direction of `sort`; ascending by default. */
  dir?: 'asc' | 'desc';
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

  /** Saves Title, Notes, Office, Employment Status and Industry Join Date (`yyyy-MM`) of the person record; every field is replaced. */
  abstract updateUserPersonDetails(
    userId: number,
    request: UpdateUserPersonDetailsRequest,
  ): Observable<UserDetailDto>;
  /** The Office and Employment Status lists (Administration > Lists), inactive items too; the dialog offers the active ones. */
  abstract listOffices(): Observable<PersonListItemView[]>;
  abstract listEmploymentStatuses(): Observable<PersonListItemView[]>;

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
