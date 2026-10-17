import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_ENV } from '../config/app-env';
import { MeProfile } from './me.models';

/** Source of the signed-in user's profile and effective permissions. */
export abstract class MeApi {
  abstract getMe(): Observable<MeProfile>;
}

/** Real provider: `GET {apiBaseUrl}/me`. */
@Injectable()
export class HttpMeApi extends MeApi {
  private readonly http = inject(HttpClient);
  private readonly env = inject(APP_ENV);

  getMe(): Observable<MeProfile> {
    return this.http.get<Partial<MeProfile>>(`${this.env.apiBaseUrl}/me`).pipe(
      map((dto) => ({
        userId: dto.userId ?? 0,
        displayName: dto.displayName ?? '',
        status: dto.status ?? 'ACTIVE',
        windowsAccount: dto.windowsAccount,
        email: dto.email,
        registeredAtUtc: dto.registeredAtUtc,
        roles: dto.roles ?? [],
        permissions: dto.permissions ?? [],
        isSystemAdmin: dto.isSystemAdmin ?? false,
        hasWork: dto.hasWork ?? false,
      })),
    );
  }
}
