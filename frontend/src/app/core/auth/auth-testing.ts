import { Provider } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { MeApi } from './me-api';
import { MeProfile } from './me.models';
import { Permission } from './permissions';
import type { MyLandingPageDto } from '../../api/generated/api-client';

export function profileOf(overrides: Partial<MeProfile> = {}): MeProfile {
  return {
    userId: 1,
    displayName: 'Test User',
    windowsAccount: 'KE\\tuser',
    status: 'ACTIVE',
    roles: [],
    permissions: [],
    isSystemAdmin: false,
    ...overrides,
  };
}

/** The `GET /me/landing-page` answer of a person with nothing set (`resolved` null: the landing rule applies). */
export function landingOf(overrides: Partial<MyLandingPageDto> = {}): MyLandingPageDto {
  return {
    choice: undefined,
    choiceAllowed: true,
    roleName: undefined,
    roleDefault: undefined,
    roleDefaultAllowed: true,
    resolved: undefined,
    resolvedPath: undefined,
    source: undefined,
    ...overrides,
  };
}

export function withPermissions(...permissions: Permission[]): MeProfile {
  return profileOf({ permissions, roles: ['Test'] });
}

/** Test double for the /me source; `current` can be swapped between calls. */
export class FakeMeApi extends MeApi {
  calls = 0;
  landingCalls = 0;
  /** The landing page answer; an Error makes the call fail. Left undefined, the source has no landing endpoint (the rule applies). */
  landing: MyLandingPageDto | Error | undefined;
  constructor(public current: MeProfile | Error) {
    super();
  }

  override getLanding(): Observable<MyLandingPageDto> {
    this.landingCalls++;
    const landing = this.landing;
    if (landing === undefined) return of(landingOf());
    return landing instanceof Error ? throwError(() => landing) : of(landing);
  }

  getMe(): Observable<MeProfile> {
    this.calls++;
    return this.current instanceof Error ? throwError(() => this.current) : of(this.current);
  }
}

export function provideFakeMe(api: FakeMeApi): Provider {
  return { provide: MeApi, useValue: api };
}
