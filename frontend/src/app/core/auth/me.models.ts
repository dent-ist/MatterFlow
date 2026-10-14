import { Permission } from './permissions';

/** GET /api/v1/me status (architecture 6.5). */
export type MeStatus = 'ACTIVE' | 'ACCESS_PENDING' | 'DISABLED';

/**
 * The /me contract the shell codes against. The backend endpoint is not available yet; when it
 * is, align this with the generated client (only `HttpMeApi` should need to change).
 * A pending user receives only `userId`, `displayName` and `status`.
 */
export interface MeProfile {
  userId: number;
  displayName: string;
  status: MeStatus;
  /** Windows account, e.g. `KE\kekim`. */
  windowsAccount?: string;
  email?: string;
  /** ISO-8601 UTC instant the account was provisioned. */
  registeredAtUtc?: string;
  roles: string[];
  /** Effective permission codes (union of all roles). */
  permissions: Permission[];
  isSystemAdmin: boolean;
  /** True when the user has a pod membership or assignments (drives default landing page). */
  hasWork?: boolean;
}
