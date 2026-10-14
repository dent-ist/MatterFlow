import { Provider } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { MeApi } from './me-api';
import { MeProfile } from './me.models';
import { Permission } from './permissions';

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

export function withPermissions(...permissions: Permission[]): MeProfile {
  return profileOf({ permissions, roles: ['Test'] });
}

/** Test double for the /me source; `current` can be swapped between calls. */
export class FakeMeApi extends MeApi {
  calls = 0;
  constructor(public current: MeProfile | Error) {
    super();
  }

  getMe(): Observable<MeProfile> {
    this.calls++;
    return this.current instanceof Error ? throwError(() => this.current) : of(this.current);
  }
}

export function provideFakeMe(api: FakeMeApi): Provider {
  return { provide: MeApi, useValue: api };
}
