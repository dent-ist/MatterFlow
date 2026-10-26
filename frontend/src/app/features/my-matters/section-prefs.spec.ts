import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ViewStateService } from '../../core/views/view-state.service';
import { prefFromState, sectionPref, typesFromAddress } from './section-prefs';

describe('section prefs (#857)', () => {
  it('reads a remembered state defensively', () => {
    expect(prefFromState(null)).toEqual({});
    expect(prefFromState({ types: [3, 'x', -1, 2.5, 5], sort: 'bogus', dir: 'up' })).toEqual({
      types: [3, 5],
    });
    expect(prefFromState({ types: [], sort: 'type', dir: 'desc' })).toEqual({
      types: [],
      sort: 'type',
      dir: 'desc',
    });
  });

  it('reads type ids from the address, repeated or comma separated, ignoring junk', () => {
    expect(typesFromAddress([])).toBeNull();
    expect(typesFromAddress(['abc', '0'])).toBeNull();
    expect(typesFromAddress(['3', '5,3', 'x'])).toEqual([3, 5]);
  });

  describe('sectionPref', () => {
    const views = {
      cached: vi.fn(),
      load: vi.fn(),
      save: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    function make(query: Record<string, string[]>, sort = true) {
      TestBed.configureTestingModule({
        providers: [
          { provide: ViewStateService, useValue: views },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: { queryParamMap: convertToParamMap(query) },
              queryParamMap: { subscribe: () => ({ unsubscribe: () => undefined }) },
            },
          },
        ],
      });
      return runInInjectionContext(TestBed.inject(Injector), () =>
        sectionPref('my-matters.attention', { sort }),
      );
    }

    beforeEach(() => {
      views.cached.mockReset().mockReturnValue({ types: [4], sort: 'due', dir: 'desc' });
      views.load.mockReset().mockResolvedValue(null);
      views.save.mockReset();
    });

    it('starts from the cached state and ignores the sort for a filter-only section', () => {
      expect(make({}).value()).toEqual({ types: [4], sort: 'due', dir: 'desc' });
    });

    it('drops the sort when the section has none', () => {
      TestBed.resetTestingModule();
      expect(make({}, false).value().sort).toBe('');
    });

    it('lets the address win until the person changes the filter, then remembers it', () => {
      const pref = make({ type: ['7'] });
      expect(pref.value().types).toEqual([7]);
      expect(pref.fromAddress()).toBe(true);
      pref.setTypes([2, 3]);
      expect(pref.value().types).toEqual([2, 3]);
      expect(pref.fromAddress()).toBe(false);
      expect(views.save).toHaveBeenCalledWith('my-matters.attention', {
        types: [2, 3],
        sort: 'due',
        dir: 'desc',
      });
    });

    it('shows all types and sorts, each change being saved', () => {
      const pref = make({});
      pref.showAll();
      expect(pref.value().types).toEqual([]);
      pref.setSort('type');
      pref.setDir('asc');
      expect(pref.value()).toEqual({ types: [], sort: 'type', dir: 'asc' });
      expect(views.save).toHaveBeenCalledTimes(3);
    });
  });
});
