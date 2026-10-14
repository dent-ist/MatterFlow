import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import {
  ClientResponse,
  MatterResponse,
  PagedResultOfClientResponse,
  PagedResultOfMatterResponse,
  PagedResultOfProjectResponse,
  ProjectResponse,
} from '../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { ApiError, ProblemDetails } from '../../core/http/api-error';

/** Builders and fakes shared by the Organization (Clients, Matters, Projects) component tests. */
export function aClient(overrides: Partial<ClientResponse> = {}): ClientResponse {
  return {
    clientId: 1,
    clientNumber: '00343',
    name: 'Acme Corp',
    isActive: true,
    matterCount: 2,
    formVersionId: undefined,
    publishedFormVersionId: undefined,
    formValues: undefined,
    droppedFields: [],
    rowVersion: 'AAAA',
    createdAtUtc: '2026-10-01T12:00:00Z',
    modifiedAtUtc: undefined,
    ...overrides,
  };
}

export function aMatter(overrides: Partial<MatterResponse> = {}): MatterResponse {
  return {
    matterId: 7,
    clientId: 1,
    clientNumber: '00343',
    clientName: 'Acme Corp',
    clientIsActive: true,
    matterNumber: '00012',
    matterRef: '00343-00012',
    name: 'Merger Review',
    isActive: true,
    isSensitive: false,
    projectCount: 1,
    openTaskCount: 0,
    formVersionId: undefined,
    publishedFormVersionId: undefined,
    formValues: undefined,
    droppedFields: [],
    rowVersion: 'BBBB',
    createdAtUtc: '2026-10-01T12:00:00Z',
    modifiedAtUtc: undefined,
    ...overrides,
  };
}

export function aProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    projectId: 3,
    matterId: 7,
    matterRef: '00343-00012',
    matterName: 'Merger Review',
    matterIsActive: true,
    name: 'Custodian Processing',
    description: 'Intake of custodian data',
    isActive: true,
    formVersionId: undefined,
    publishedFormVersionId: undefined,
    formValues: undefined,
    droppedFields: [],
    rowVersion: 'CCCC',
    createdAtUtc: '2026-10-01T12:00:00Z',
    modifiedAtUtc: undefined,
    ...overrides,
  };
}

export const pageOfClients = (...items: ClientResponse[]): PagedResultOfClientResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});
export const pageOfMatters = (...items: MatterResponse[]): PagedResultOfMatterResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});
export const pageOfProjects = (...items: ProjectResponse[]): PagedResultOfProjectResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});

/** An `ApiError` as the HTTP layer would throw it for a ProblemDetails response. */
export function apiError(status: number, problem: ProblemDetails): Observable<never> {
  const response = new HttpErrorResponse({ status, error: problem });
  return throwError(() => ApiError.from(response));
}

export const ok = <T>(value: T): Observable<T> => of(value);

export { FakeMeApi, provideFakeMe, withPermissions };

/** Lets promises, timers and change detection settle (the pages load through promises). */
export async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
}

export function text(fixture: ComponentFixture<unknown>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

/** Finds a PrimeNG button or plain button by its visible label. */
export function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === label,
  );
}
