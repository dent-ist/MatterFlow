import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ADMIN_LIST, AdminListLeave, ListReturn } from './list-return';

function openedWith(state: unknown): void {
  history.replaceState(state, '');
}

describe('ListReturn (#354)', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
  });

  afterEach(() => openedWith(null));

  it('is the exact list view the page was opened from, with the state that carries it on', () => {
    openedWith({ returnTo: '/admin/steps?page=2&size=50&title=ocr' });
    const back = new ListReturn(ADMIN_LIST.steps, router);
    expect(back.url).toBe('/admin/steps?page=2&size=50&title=ocr');
    expect(router.serializeUrl(back.tree)).toBe('/admin/steps?page=2&size=50&title=ocr');
    expect(back.carry).toEqual({ returnTo: '/admin/steps?page=2&size=50&title=ocr' });
    expect(back.extras).toEqual({ state: back.carry });
    // The crumb asks the list to put focus back on the row.
    const crumb = back.crumb('Workflow Steps');
    expect(crumb.label).toBe('Workflow Steps');
    expect(crumb.state).toEqual({ restoreFocus: true });
  });

  it('is the plain list when the page was opened with no state, and carries nothing on', () => {
    openedWith(null);
    const back = new ListReturn(ADMIN_LIST.taskTypes, router);
    expect(back.url).toBe('/admin/task-types');
    expect(back.carry).toBeUndefined();
    expect(back.extras).toEqual({});
  });

  it('ignores a return address of another section or another admin list, or a malformed one', () => {
    for (const returnTo of [
      '/clients?page=2',
      '/admin/workflows?page=2',
      '//evil.example/admin/steps',
      'https://evil.example/admin/steps',
      42,
      { path: '/admin/steps' },
    ]) {
      openedWith({ returnTo });
      const back = new ListReturn(ADMIN_LIST.steps, router);
      expect(back.url, JSON.stringify(returnTo)).toBe('/admin/steps');
      expect(back.carry).toBeUndefined();
    }
  });
});

describe('AdminListLeave (#354)', () => {
  it('carries the address of the page it is on, as it is after each navigation', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    const router = TestBed.inject(Router);
    const leave = TestBed.inject(AdminListLeave);
    await router.navigateByUrl('/admin/workflows?taskType=4&page=2');
    expect(leave.state()).toEqual({ returnTo: '/admin/workflows?taskType=4&page=2' });
    await router.navigateByUrl('/admin/workflows');
    expect(leave.state()).toEqual({ returnTo: '/admin/workflows' });
  });
});
