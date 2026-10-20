import { Location } from '@angular/common';
import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { ForbiddenRequest } from '../../../core/auth/guards';
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

/** #598: the 403 page keeps the address the person asked for. */
describe('the 403 page keeps the address', () => {
  async function render(asked: string | null) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions('Task.View')))],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    TestBed.inject(ForbiddenRequest).url.set(asked);
    const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
    const fixture = TestBed.createComponent(ForbiddenPage);
    await settle(fixture);
    return { el: fixture.nativeElement as HTMLElement, replace };
  }

  it('says what was asked for, offers Copy link and puts the address back in the address bar', async () => {
    const { el, replace } = await render('/admin/users?status=all');
    expect(el.querySelector('[data-asked-path]')!.textContent).toBe('/admin/users?status=all');
    expect(el.querySelector('[data-state-secondary] button')!.getAttribute('aria-label')).toBe(
      'Copy link',
    );
    expect(el.querySelector('[data-state-secondary] button')!.textContent).toContain('Copy link');
    expect(replace).toHaveBeenCalledWith('/admin/users?status=all', '', null);
    expect(el.querySelector('h1')!.textContent).toContain("You don't have permission");
  });

  it('shows nothing about an address when /403 was opened directly', async () => {
    const { el, replace } = await render(null);
    expect(el.querySelector('[data-asked]')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});

/** #607: 403, 404 and the error page are one family: the shared state-page card. */
describe('the state pages are one family', () => {
  it('the 403, the 404 and the error page each render one card with one H1, a reason and the brand line', async () => {
    const { ErrorPage } = await import('./error-page');
    for (const page of [ForbiddenPage, NotFoundPage, ErrorPage] as Type<unknown>[]) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions('Task.View')))],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      const fixture = TestBed.createComponent(page);
      await settle(fixture);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('h1')).toHaveLength(1);
      expect(el.querySelector('[data-state-page] [data-page-title]')).not.toBeNull();
      expect(el.querySelector('[data-state-reason]')!.textContent!.trim().length).toBeGreaterThan(
        0,
      );
      expect(el.querySelector('[data-state-brand]')!.textContent).toContain('MatterFlow');
    }
  });

  it('only the 404 offers search, with a placeholder short enough not to be cut', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideFakeMe(new FakeMeApi(withPermissions('Task.View')))],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const nf = TestBed.createComponent(NotFoundPage);
    await settle(nf);
    const input = (nf.nativeElement as HTMLElement).querySelector('input[type=search]')!;
    expect(input.getAttribute('placeholder')!.length).toBeLessThanOrEqual(20);
    const fb = TestBed.createComponent(ForbiddenPage);
    await settle(fb);
    expect((fb.nativeElement as HTMLElement).querySelector('input')).toBeNull();
  });
});
