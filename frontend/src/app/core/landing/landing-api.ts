import { Injectable, Injector, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  LandingPageListResponse,
  LandingPagesClient,
  MyLandingPageDto,
  RoleLandingPageDto,
} from '../../api/generated/api-client';

export type { MyLandingPageDto, RoleLandingPageDto, LandingPageListResponse };

/**
 * The landing-page endpoints (epic #1330) behind one injectable, so a screen can be tested with a fake. The generated client is read when a
 * call is made, not when the service is created: a page that never calls it needs no HTTP stack.
 */
@Injectable({ providedIn: 'root' })
export class LandingApi {
  private readonly injector = inject(Injector);

  private get client(): LandingPagesClient {
    return this.injector.get(LandingPagesClient);
  }

  /** GET /me/landing-pages: the pages the signed-in person can open now. */
  myPages(): Observable<LandingPageListResponse> {
    return this.client.listMyLandingPages();
  }

  /** GET /me/landing-page: the stored choice, the role default and what they resolve to (`resolved` null = apply today's rule). */
  mine(): Observable<MyLandingPageDto> {
    return this.client.getMyLandingPage();
  }

  /** PUT /me/landing-page: a page key, or null to use the role's default. */
  setMine(landingPage: string | null): Observable<MyLandingPageDto> {
    return this.client.setMyLandingPage({ landingPage: landingPage ?? undefined });
  }

  /** GET /roles/{id}/landing-page. */
  role(roleId: number): Observable<RoleLandingPageDto> {
    return this.client.getRoleLandingPage(roleId);
  }

  /** PUT /roles/{id}/landing-page: a page key, or null for Automatic. */
  setRole(
    roleId: number,
    landingPage: string | null,
    rowVersion: string,
  ): Observable<RoleLandingPageDto> {
    return this.client.setRoleLandingPage(roleId, {
      landingPage: landingPage ?? undefined,
      rowVersion,
    });
  }
}
