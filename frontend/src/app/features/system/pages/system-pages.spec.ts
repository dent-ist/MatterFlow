import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ForbiddenPage } from './forbidden-page';
import { NotFoundPage } from './not-found-page';

/** BUG-4 (#291): the generic 403 and 404 pages link to a page the person can open, or to nothing. */
describe('the generic 403 and 404 pages', () => {
  async function render(page: Type<unknown>, permissions: string[]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...(permissions as never[])))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(page);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('sends a person without Task.View to the first page the landing rule finds, never "my work"', async () => {
    const el = await render(ForbiddenPage, ['Client.View', 'Matter.View']);
    const link = el.querySelector('[data-back-link]')!;
    expect(link.textContent).toContain('Go to Clients');
    expect(link.getAttribute('href')).toBe('/clients');
    expect(el.textContent).not.toMatch(/my work/i);
  });

  it('follows the rule for other permission sets', async () => {
    const matters = await render(ForbiddenPage, ['Matter.View']);
    expect(matters.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/matters');
    TestBed.resetTestingModule();
    const queue = await render(NotFoundPage, ['Task.View']);
    expect(queue.querySelector('[data-back-link]')?.getAttribute('href')).toBe('/tasks');
  });

  it('shows no link when the person can open nothing', async () => {
    expect((await render(ForbiddenPage, [])).querySelector('[data-back-link]')).toBeNull();
    TestBed.resetTestingModule();
    expect((await render(NotFoundPage, [])).querySelector('[data-back-link]')).toBeNull();
  });
});
