import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { ReportViewResponse, ReportViewsClient } from '../../api/generated/api-client';
import { apiError } from '../../shared/testing/org-testing';
import { aView } from './reports-testing';
import {
  ReportViewsStore,
  suggestedViewName,
  viewErrorText,
  viewNameError,
} from './report-views-store';

type Mock = ReturnType<typeof vi.fn>;

describe('view names (#722)', () => {
  it('asks for a name, refuses one over 80 characters and one that another view has in any case', () => {
    expect(viewNameError('', [])).toBe('Enter a view name.');
    expect(viewNameError('   ', [])).toBe('Enter a view name.');
    expect(viewNameError('x'.repeat(80), [])).toBeNull();
    expect(viewNameError('x'.repeat(81), [])).toBe('View name must be 80 characters or fewer.');
    expect(viewNameError('  my VIEW ', ['My view'])).toBe(
      'You already have a view with this name.',
    );
    expect(viewNameError('Another', ['My view'])).toBeNull();
  });

  it('suggests "<Report name> view", numbered while that is taken and cut to 80 characters', () => {
    expect(suggestedViewName('Overdue tasks', [])).toBe('Overdue tasks view');
    expect(suggestedViewName('Overdue tasks', ['overdue tasks view'])).toBe('Overdue tasks view 2');
    expect(suggestedViewName('Overdue tasks', ['Overdue tasks view', 'Overdue tasks view 2'])).toBe(
      'Overdue tasks view 3',
    );
    const long = suggestedViewName('R'.repeat(120), []);
    expect(long).toHaveLength(80);
    expect(long.endsWith(' view')).toBe(true);
    expect(viewNameError(long, [])).toBeNull();
  });

  it('says what the server refused in the words of the spec, and nothing for any other failure', () => {
    const refused = async (code: string): Promise<unknown> => {
      try {
        await new Promise((_, reject) => apiError(409, { code }).subscribe({ error: reject }));
      } catch (e) {
        return e;
      }
      return null;
    };
    return Promise.all([
      refused('VIEW_NAME_EXISTS').then((e) =>
        expect(viewErrorText(e)).toBe('You already have a view with this name.'),
      ),
      refused('VIEW_LIMIT_REACHED').then((e) =>
        expect(viewErrorText(e, 25)).toBe('You can save up to 25 views for this report.'),
      ),
      refused('OTHER').then((e) => expect(viewErrorText(e)).toBeNull()),
    ]).then(() => expect(viewErrorText(new Error('x'))).toBeNull());
  });
});

describe('ReportViewsStore (#722)', () => {
  let api: Record<string, Mock>;
  let store: ReportViewsStore;

  function setup(list: ReportViewResponse[] = []): void {
    api = {
      listReportViews: vi.fn().mockReturnValue(of({ views: list, limit: 25 })),
      createReportView: vi.fn(),
      updateReportView: vi.fn(),
      deleteReportView: vi.fn().mockReturnValue(of(undefined)),
      setDefaultReportView: vi.fn(),
      clearDefaultReportView: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [ReportViewsStore, { provide: ReportViewsClient, useValue: api }],
    });
    store = TestBed.inject(ReportViewsStore);
  }

  it('reads the list of a report, the default first and then by name, and the limit', async () => {
    setup([
      aView({ viewId: 3, name: 'zeta' }),
      aView({ viewId: 2, name: 'Alpha' }),
      aView({ viewId: 1, name: 'Mid', isDefault: true }),
    ]);
    expect(store.state()).toBe('idle');
    await store.load(5);
    expect(api['listReportViews']).toHaveBeenCalledWith(5);
    expect(store.state()).toBe('ready');
    expect(store.views().map((v) => v.name)).toEqual(['Mid', 'Alpha', 'zeta']);
    expect(store.limit()).toBe(25);
    expect(store.defaultView()!.viewId).toBe(1);
    expect(store.find(2)!.name).toBe('Alpha');
    expect(store.find(null)).toBeUndefined();
  });

  it('keeps an empty list and says error when the read fails, and never throws', async () => {
    setup();
    api['listReportViews'].mockReturnValue(throwError(() => new Error('down')));
    await expect(store.load(5)).resolves.toBeUndefined();
    expect(store.state()).toBe('error');
    expect(store.views()).toEqual([]);
  });

  it('creates a view, sorts it into the list and moves the default when it is the new default', async () => {
    setup([aView({ viewId: 1, name: 'Old default', isDefault: true })]);
    await store.load(5);
    const layout = { columns: [], sort: [], filters: [], pageSize: 100 };
    api['createReportView'].mockReturnValue(
      of(aView({ viewId: 2, name: 'Fresh', isDefault: true, layout })),
    );
    const made = await store.create(5, 'Fresh', layout, true);
    expect(api['createReportView']).toHaveBeenCalledWith(5, {
      name: 'Fresh',
      layout,
      isDefault: true,
    });
    expect(made.viewId).toBe(2);
    expect(store.views().map((v) => [v.name, v.isDefault])).toEqual([
      ['Fresh', true],
      ['Old default', false],
    ]);
  });

  it('renames or re-saves a view in place', async () => {
    setup([aView({ viewId: 1, name: 'B' }), aView({ viewId: 2, name: 'C' })]);
    await store.load(5);
    api['updateReportView'].mockReturnValue(of(aView({ viewId: 2, name: 'A' })));
    await store.update(5, 2, { name: 'A' });
    expect(api['updateReportView']).toHaveBeenCalledWith(5, 2, { name: 'A', layout: undefined });
    expect(store.views().map((v) => v.name)).toEqual(['A', 'B']);
  });

  it('deletes, sets and clears the default view and keeps one default only', async () => {
    setup([aView({ viewId: 1, name: 'A', isDefault: true }), aView({ viewId: 2, name: 'B' })]);
    await store.load(5);
    api['setDefaultReportView'].mockReturnValue(
      of(aView({ viewId: 2, name: 'B', isDefault: true })),
    );
    await store.setDefault(5, 2);
    expect(
      store
        .views()
        .filter((v) => v.isDefault)
        .map((v) => v.viewId),
    ).toEqual([2]);
    api['clearDefaultReportView'].mockReturnValue(
      of(aView({ viewId: 2, name: 'B', isDefault: false })),
    );
    await store.clearDefault(5, 2);
    expect(store.defaultView()).toBeUndefined();
    await store.remove(5, 1);
    expect(api['deleteReportView']).toHaveBeenCalledWith(5, 1);
    expect(store.views().map((v) => v.viewId)).toEqual([2]);
  });

  it('lets a refused call through to the caller and leaves the list as it was', async () => {
    setup([aView({ viewId: 1, name: 'A' })]);
    await store.load(5);
    api['createReportView'].mockReturnValue(
      throwError(() => new Error('refused')) as Observable<ReportViewResponse>,
    );
    await expect(
      store.create(5, 'B', { columns: [], sort: [], filters: [], pageSize: 50 }, false),
    ).rejects.toThrow('refused');
    expect(store.views()).toHaveLength(1);
  });
});
