import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import { LocalListPage, PAGE_SIZES, ServerListPage, parsePageSize } from './list-query';

interface Row {
  name: string;
  size: number;
  active: boolean;
}

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class LocalHost extends LocalListPage<Row> {
  protected readonly defaultSort = 'name';
  constructor() {
    super();
    this.all.set([
      { name: 'beta', size: 2, active: true },
      { name: 'Alpha', size: 10, active: true },
      { name: 'gamma', size: 1, active: false },
      { name: 'delta', size: 5, active: true },
    ]);
  }
  protected override searchText = (r: Row) => r.name;
  protected override isActiveRow = (r: Row) => r.active;
  protected override sortValue = (r: Row, f: string) => (f === 'size' ? r.size : r.name);
  names = () => this.rows().map((r) => r.name);
  totalRows = () => this.total();
  shown = () => this.shownPage();
  filtering = () => this.hasFilter();
  doSearch = (t: string) => this.search(t);
  doSetPageSize = (n: number) => this.setPageSize(n);
  doClear = () => this.clear();
}

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class ServerHost extends ServerListPage<Row> {
  protected readonly defaultSort = 'name';
  fail: unknown = null;
  protected override fetch(): Promise<{ items: Row[]; total: number }> {
    return this.fail ? Promise.reject(this.fail) : Promise.resolve({ items: [], total: 0 });
  }
  current = () => this.state();
}

function apiError(status: number): ApiError {
  return ApiError.from(new HttpErrorResponse({ status, error: {} }));
}

describe('ServerListPage states', () => {
  it('maps a 403 to forbidden, any other failure to error, and a retry back through loading', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ServerHost);
    const page = fixture.componentInstance;
    page.fail = apiError(403);
    await page.load();
    expect(page.current()).toBe('forbidden');
    page.fail = apiError(500);
    await page.load();
    expect(page.current()).toBe('error');
    page.fail = null;
    const reload = page.load();
    expect(page.current()).toBe('loading');
    await reload;
    expect(page.current()).toBe('ready');
  });
});

describe('list URL state', () => {
  it('only accepts the offered page sizes', () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100]);
    expect(parsePageSize('50')).toBe(50);
    expect(parsePageSize('7')).toBe(25);
    expect(parsePageSize(undefined)).toBe(25);
  });

  describe('LocalListPage', () => {
    let fixture: ComponentFixture<LocalHost>;
    const set = (name: string, value: string) => {
      fixture.componentRef.setInput(name, value);
      fixture.detectChanges();
    };

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      fixture = TestBed.createComponent(LocalHost);
      fixture.detectChanges();
    });

    it('hides inactive rows by default and sorts by the default field, ignoring case', () => {
      expect(fixture.componentInstance.names()).toEqual(['Alpha', 'beta', 'delta']);
      expect(fixture.componentInstance.filtering()).toBe(false);
    });

    it('shows inactive or all rows on request, and counts that as filtered', () => {
      set('status', 'inactive');
      expect(fixture.componentInstance.names()).toEqual(['gamma']);
      expect(fixture.componentInstance.filtering()).toBe(true);
      set('status', 'all');
      expect(fixture.componentInstance.names()).toEqual(['Alpha', 'beta', 'delta', 'gamma']);
    });

    it('searches case-insensitively and reports the matching total', () => {
      set('q', 'ELT');
      expect(fixture.componentInstance.names()).toEqual(['delta']);
      expect(fixture.componentInstance.totalRows()).toBe(1);
    });

    it('sorts numbers numerically in both directions', () => {
      set('sort', 'size');
      expect(fixture.componentInstance.names()).toEqual(['beta', 'delta', 'Alpha']);
      set('sort', '-size');
      expect(fixture.componentInstance.names()).toEqual(['Alpha', 'delta', 'beta']);
    });

    it('pages the rows and pulls an out-of-range page back to the last one', () => {
      set('status', 'all');
      set('page', '9');
      expect(fixture.componentInstance.shown()).toBe(1);
      expect(fixture.componentInstance.names().length).toBe(4);
    });

    it('writes search, page size and Clear filters to the URL', () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      fixture.componentInstance.doSearch(' alp ');
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { q: 'alp', page: null },
        queryParamsHandling: 'merge',
      });
      fixture.componentInstance.doSetPageSize(100);
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { size: 100, page: null },
        queryParamsHandling: 'merge',
      });
      fixture.componentInstance.doClear();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { q: null, status: null, page: null },
        queryParamsHandling: 'merge',
      });
    });
  });
});
