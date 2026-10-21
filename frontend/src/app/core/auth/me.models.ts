import { Permission } from './permissions';

/** GET /api/v1/me status (architecture 6.5). */
export type MeStatus = 'ACTIVE' | 'ACCESS_PENDING' | 'DISABLED';

/**
 * The /me contract the shell codes against. The backend endpoint is not available yet; when it
 * is, align this with the generated client (only `HttpMeApi` should need to change).
 * A pending user receives only `userId`, `displayName` and `status`.
 */
/** One Pod of the signed-in person (from `GET /me`, active Pods only, the primary one first). */
export interface MePod {
  podId: number;
  name: string;
  isActive: boolean;
  isPrimary: boolean;
}

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
  /** Pods the person is an active member of, primary first (the My profile Account card). */
  pods?: MePod[];
  /** Effective permission codes (union of all roles). */
  permissions: Permission[];
  isSystemAdmin: boolean;
  /** True for an active Pod member or a user with an open assigned task (GET /me; created-by-me alone does not count). Drives the default landing page. */
  hasWork?: boolean;
}
