import { TestBed } from '@angular/core/testing';
import { ViewStateService } from '../../core/views/view-state.service';
import { focusLabel } from './focus-control';
import { MyMattersFocus, focusFromState } from './focus';

describe('Focus (PV-07)', () => {
  it('reads a remembered Focus defensively', () => {
    expect(focusFromState(null)).toEqual([]);
    expect(focusFromState({ types: 'x' })).toEqual([]);
    expect(focusFromState({ types: [3, 'a', -1, 3, 2.5, 5] })).toEqual([3, 5]);
  });

  it('names the chosen types in the chip, a type nobody knows by its number', () => {
    const options = [
      { id: 1, name: 'Intake', iconKey: 'x', colourKey: undefined, active: true },
      { id: 2, name: 'Production', iconKey: 'x', colourKey: undefined, active: true },
    ];
    expect(focusLabel([1, 2], options)).toBe('Focus: Intake, Production');
    expect(focusLabel([9], options)).toBe('Focus: Task type 9');
  });

  describe('the store', () => {
    const views = {
      cached: vi.fn(),
      load: vi.fn(),
      save: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    function make() {
      TestBed.configureTestingModule({
        providers: [{ provide: ViewStateService, useValue: views }],
      });
      return TestBed.inject(MyMattersFocus);
    }
    beforeEach(() => {
      views.cached.mockReset().mockReturnValue({ types: [4] });
      views.load.mockReset().mockResolvedValue({ types: [4, 6] });
      views.save.mockReset();
    });

    it('starts from the cache, then the server, and stays until changed', async () => {
      const focus = make();
      expect(focus.types()).toEqual([4]);
      focus.ensure();
      focus.ensure();
      await Promise.resolve();
      await Promise.resolve();
      expect(views.load).toHaveBeenCalledTimes(1);
      expect(focus.types()).toEqual([4, 6]);
    });

    it('saves a change once per person (surface my-matters.focus) and a change beats a late server answer', async () => {
      const focus = make();
      focus.ensure();
      focus.set([2, 2, 3]);
      await Promise.resolve();
      await Promise.resolve();
      expect(focus.types()).toEqual([2, 3]);
      expect(views.save).toHaveBeenCalledWith('my-matters.focus', { types: [2, 3] });
      focus.clear();
      expect(focus.types()).toEqual([]);
      expect(views.save).toHaveBeenLastCalledWith('my-matters.focus', { types: [] });
    });
  });
});
