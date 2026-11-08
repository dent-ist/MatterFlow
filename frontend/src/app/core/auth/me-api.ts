import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { APP_ENV } from '../config/app-env';
import { SKIP_ERROR_TOAST } from '../http/interceptors';
import { MeProfile } from './me.models';
import type { MyLandingPageDto } from '../../api/generated/api-client';

/** Source of the signed-in user's profile and effective permissions. */
export abstract class MeApi {
  abstract getMe(): Observable<MeProfile>;
  /**
   * The landing page the server resolved for the signed-in person (`GET /me/landing-page`, epic #1330). Optional: a source without it (the
   * stub provider, a spec) means "no resolved page", and the landing rule applies exactly as it did before the epic.
   */
  getLanding?(): Observable<MyLandingPageDto>;
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
        pods: dto.pods ?? [],
        permissions: dto.permissions ?? [],
        isSystemAdmin: dto.isSystemAdmin ?? false,
        hasWork: dto.hasWork ?? false,
      })),
    );
  }

  override getLanding(): Observable<MyLandingPageDto> {
    // A failed read is not an error for the person: the landing rule applies as before, so no toast.
    return this.http.get<MyLandingPageDto>(`${this.env.apiBaseUrl}/me/landing-page`, {
      context: new HttpContext().set(SKIP_ERROR_TOAST, true),
    });
  }
}
