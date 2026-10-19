import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import {
  DrillReturn,
  RECORD_ORIGINS,
  isRecordOrigin,
  listUrl,
  originNav,
  originUrl,
  parseFrom,
  parseOrigin,
  parseRowRef,
} from './drill';

describe('drill-in context (M7)', () => {
  it('whitelists the from values', () => {
    expect(parseFrom('my-work')).toBe('my-work');
    expect(parseFrom('task-queue')).toBe('task-queue');
    expect(parseFrom('pod-work')).toBe('pod-work');
    for (const bad of ['dashboard', '', null, undefined, 'constructor', '__proto__']) {
      expect(parseFrom(bad)).toBeNull();
    }
  });

  it('returns to the exact view only for an address on the list path', () => {
    expect(listUrl('my-work', '/my-work?view=closed&x=1')).toBe('/my-work?view=closed&x=1');
    expect(listUrl('my-work', undefined)).toBe('/my-work');
    expect(listUrl('my-work', '/admin/users')).toBe('/my-work');
    expect(listUrl('my-work', '//evil.example/my-work')).toBe('/my-work');
    expect(listUrl('pod-work', '/pods/work?podId=2')).toBe('/pods/work?podId=2');
  });

  describe('origins of the Task page (T9, #324)', () => {
    it('whitelists the three lists and the four record pages, nothing else', () => {
      for (const ok of [
        'my-work',
        'task-queue',
        'pod-work',
        'matter',
        'project',
        'dashboard',
        'search',
      ]) {
        expect(parseOrigin(ok)).toBe(ok);
      }
      for (const bad of [
        '',
        null,
        undefined,
        'constructor',
        '__proto__',
        'toString',
        'MATTER',
        '//x',
      ]) {
        expect(parseOrigin(bad)).toBeNull();
      }
      // The work lists' own parser is unchanged.
      expect(parseFrom('matter')).toBeNull();
      expect(isRecordOrigin('matter')).toBe(true);
      expect(isRecordOrigin('my-work')).toBe(false);
    });

    it('keeps the origin page current in the navigation (Search is not in it)', () => {
      expect(originNav('my-work')).toBe('/my-work');
      expect(originNav('task-queue')).toBe('/tasks');
      expect(originNav('matter')).toBe('/matters');
      expect(originNav('project')).toBe('/projects');
      expect(originNav('dashboard')).toBe('/dashboard');
      expect(originNav('search')).toBeNull();
      expect(RECORD_ORIGINS.search.paths).toEqual(['/search', '/search/advanced']);
    });

    it('returns to the exact address only when it is on one of the origin paths', () => {
      const paths = ['/matters/7'];
      expect(originUrl(paths, '/matters/7?tab=tasks', '/matters/7?tab=tasks&status=NEW')).toBe(
        '/matters/7?tab=tasks&status=NEW',
      );
      expect(originUrl(paths, '/matters/7?tab=tasks', '/matters/8?tab=tasks')).toBe(
        '/matters/7?tab=tasks',
      );
      expect(originUrl(paths, '/m', '/matters/7/evil')).toBe('/m');
      expect(originUrl(paths, '/m', '//evil.example/matters/7')).toBe('/m');
      expect(originUrl(paths, '/m', 'https://evil.example/matters/7')).toBe('/m');
      expect(originUrl(paths, '/m', undefined)).toBe('/m');
      expect(originUrl(paths, '/m', 42)).toBe('/m');
      expect(originUrl(RECORD_ORIGINS.search.paths, '/search', '/search/advanced?type=task')).toBe(
        '/search/advanced?type=task',
      );
    });
  });

  describe('DrillReturn', () => {
    function setup(): { drill: DrillReturn; router: Router } {
      TestBed.configureTestingModule({
        providers: [provideRouter([{ path: 'a', children: [] }])],
      });
      return { drill: TestBed.inject(DrillReturn), router: TestBed.inject(Router) };
    }

    it('gives the row back once after a return, and not after any other visit', async () => {
      const { drill, router } = setup();
      drill.leave('my-work', 42);
      await router.navigateByUrl('/a');
      expect(drill.take('my-work')).toBeNull();

      await router.navigateByUrl('/a?x=1', { state: { restoreFocus: true } });
      expect(drill.take('task-queue')).toBeNull();
      expect(drill.take('my-work')).toBe(42);
      expect(drill.take('my-work')).toBeNull();
    });
  });
});

describe('record list rows (#281)', () => {
  function setup(): { drill: DrillReturn; router: Router } {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'clients', children: [] },
          { path: 'clients/:id', children: [] },
          { path: 'other', children: [] },
        ]),
      ],
    });
    return { drill: TestBed.inject(DrillReturn), router: TestBed.inject(Router) };
  }

  it('parses only a well-formed focusRow from a history state', () => {
    expect(parseRowRef({ list: 'clients', key: '37' })).toEqual({ list: 'clients', key: '37' });
    for (const bad of [
      null,
      undefined,
      'x',
      3,
      {},
      { list: 'clients' },
      { list: '', key: '1' },
      { list: 'a', key: 1 },
    ]) {
      expect(parseRowRef(bad)).toBeNull();
    }
  });

  it('writes the row to history.state.focusRow without touching the URL or the router state', async () => {
    const { drill, router } = setup();
    await router.navigateByUrl('/clients?name=a&size=100');
    history.replaceState({ ...history.state, kept: 1 }, '');
    const url = location.href;
    drill.leaveRow('clients', 37);
    expect(history.state.focusRow).toEqual({ list: 'clients', key: '37' });
    expect(history.state.kept).toBe(1); // the router's own state stays
    expect(location.href).toBe(url);
  });

  it('hands the row back once after a "Back to ..." link and not after a forward visit', async () => {
    const { drill, router } = setup();
    await router.navigateByUrl('/clients?name=a');
    drill.leaveRow('clients', 5);
    await router.navigateByUrl('/clients/5');
    // A link that asks for the return: the list takes its row, once, and only the list it was left from.
    await router.navigateByUrl('/clients?name=a', { state: { restoreFocus: true } });
    expect(drill.takeRow('matters')).toBeNull();
    expect(drill.takeRow('clients')).toBe('5');
    expect(drill.takeRow('clients')).toBeNull();

    drill.leaveRow('clients', 6);
    await router.navigateByUrl('/clients/6');
    await router.navigateByUrl('/clients?name=a'); // a plain forward visit is not a return
    expect(drill.takeRow('clients')).toBeNull();
  });

  it('forgets the row when the person goes on to another page, but not when only the query changes', async () => {
    const { drill, router } = setup();
    await router.navigateByUrl('/clients?name=a');
    drill.leaveRow('clients', 5);
    await router.navigateByUrl('/clients/5');
    await router.navigateByUrl('/clients/5?tab=matters');
    expect(drill.returnUrl('/clients')).toBe('/clients?name=a');
    await router.navigateByUrl('/other');
    expect(drill.returnUrl('/clients')).toBe('/clients');
  });

  it('returns the exact list view only for an address of that list', async () => {
    const { drill, router } = setup();
    expect(drill.returnUrl('/clients')).toBe('/clients');
    await router.navigateByUrl('/clients?name=a&size=100&sort=-name');
    drill.leaveRow('clients', 1);
    expect(drill.returnUrl('/clients')).toBe('/clients?name=a&size=100&sort=-name');
    expect(drill.returnUrl('/matters')).toBe('/matters');
  });

  it('gives a record page its tab once after a return, unless the row left is in a list inside the page', async () => {
    const { drill, router } = setup();
    expect(drill.takeTab()).toBe(false);
    await router.navigateByUrl('/clients/5');
    await router.navigateByUrl('/clients', { state: { restoreFocus: true } });
    expect(drill.takeTab()).toBe(true);
    expect(drill.takeTab()).toBe(false);

    await router.navigateByUrl('/clients/5?tab=matters');
    drill.leaveRow('client-matters', 9);
    await router.navigateByUrl('/clients/9');
    await router.navigateByUrl('/clients/5?tab=matters', { state: { restoreFocus: true } });
    expect(drill.takeTab(['client-matters'])).toBe(false);
    expect(drill.takeRow('client-matters')).toBe('9');
  });

  it('reads the row from the history entry on browser Back (a popstate), clears it once taken', async () => {
    const { drill, router } = setup();
    await router.navigateByUrl('/clients?name=a');
    drill.leaveRow('clients', 7);
    await router.navigateByUrl('/clients/7');
    const entry = { navigationId: 2, focusRow: { list: 'clients', key: '7' } };
    // What the router announces when the person presses Back to the list entry that carries the row.
    (router.events as unknown as Subject<unknown>).next(
      new NavigationStart(3, '/clients?name=a', 'popstate', entry),
    );
    expect(drill.takeRow('clients')).toBe('7');
    expect(drill.takeRow('clients')).toBeNull();

    // A popstate to an entry without a row (the list was reached some other way) hands out nothing; a reload is not a popstate.
    (router.events as unknown as Subject<unknown>).next(
      new NavigationStart(4, '/clients', 'popstate', { navigationId: 1 }),
    );
    expect(drill.takeRow('clients')).toBeNull();
    (router.events as unknown as Subject<unknown>).next(
      new NavigationStart(5, '/clients', 'imperative', undefined),
    );
    expect(drill.takeRow('clients')).toBeNull();
    expect(drill.takeTab()).toBe(false);
  });
});
