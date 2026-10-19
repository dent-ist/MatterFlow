import { TestBed } from '@angular/core/testing';
import { OPEN_STATUSES, ViewContext, builtInFilters, emptyFilters } from './queue-filters';
import { QuickViews, VIEW_ORDER, overlayColumns, viewCount } from './quick-views';
import { VIEW_TIPS } from './work-vocabulary';
import { LIST_ORDER } from '../../features/dashboard/dashboard-links';

describe('QuickViews', () => {
  const ctx: ViewContext = {
    userId: 9,
    primaryPodId: 5,
    recentFrom: '2026-09-18',
    dueSoonTo: '2026-10-19',
    canCreate: true,
  };

  function create(filters = emptyFilters(), context = ctx) {
    const fixture = TestBed.createComponent(QuickViews);
    fixture.componentRef.setInput('filters', filters);
    fixture.componentRef.setInput('context', context);
    fixture.detectChanges();
    return fixture;
  }
  const button = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLButtonElement>(`[data-view="${key}"]`)!;

  it('offers the views of the row as one labelled toolbar of toggle buttons, then More', () => {
    const el = create().nativeElement as HTMLElement;
    expect(el.querySelector('[role="toolbar"]')!.getAttribute('aria-label')).toBe('Quick views');
    expect(
      Array.from(el.querySelectorAll('.qv > button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'All open',
      'Unassigned',
      'Overdue',
      'Due soon',
      'ASAP',
      'On hold',
      'My pod',
      'Created by me',
      'More views',
    ]);
  });

  it('watches its room with a ResizeObserver and lets go of it when destroyed (no NG0203 from afterNextRender)', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    try {
      const fixture = create();
      await fixture.whenStable();
      TestBed.tick();
      expect(observe).toHaveBeenCalled();
      fixture.destroy();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives every view a one-sentence tooltip', () => {
    const el = create().nativeElement as HTMLElement;
    expect(button(el, 'dueSoon').getAttribute('title')).toBe(
      'Open tasks due today, tomorrow or in 2 days; not overdue, not ASAP',
    );
    expect(button(el, 'createdByMe').getAttribute('title')).toBe('Open tasks you created');
    expect(VIEW_TIPS.recentlyCompleted).toBe(
      'Completed in the last 30 days (cancelled tasks are not included)',
    );
    expect(VIEW_TIPS.recentlyCompleted).toContain('30 days');
  });

  it('presses the view whose filters are set, and none after a manual change', () => {
    const fixture = create({ ...emptyFilters(), status: [...OPEN_STATUSES], overdue: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(button(el, 'overdue').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'allOpen').getAttribute('aria-pressed')).toBe('false');

    fixture.componentRef.setInput('filters', {
      ...builtInFilters('overdue', ctx),
      matterText: '343',
    });
    fixture.detectChanges();
    // The view with an extra filter on top is still the pressed view (#221).
    expect(button(el, 'overdue').getAttribute('aria-pressed')).toBe('true');

    fixture.componentRef.setInput('filters', { ...emptyFilters(), priority: [1] });
    fixture.detectChanges();
    expect(el.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
  });

  it('emits the chosen view', () => {
    const fixture = create();
    const el = fixture.nativeElement as HTMLElement;
    const chosen: string[] = [];
    fixture.componentInstance.viewSelect.subscribe((k) => chosen.push(k));
    button(el, 'unassigned').click();
    button(el, 'dueSoon').click();
    expect(chosen).toEqual(['unassigned', 'dueSoon']);
  });

  it('hides My pod without a primary Pod and Created by me without Task.Create instead of disabling them (#223)', () => {
    const el = create(emptyFilters(), { ...ctx, primaryPodId: null, canCreate: false })
      .nativeElement as HTMLElement;
    expect(el.querySelector('[data-view="myPod"]')).toBeNull();
    expect(el.querySelector('[data-view="createdByMe"]')).toBeNull();
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.disabled)).toBe(false);
    expect(button(el, 'overdue')).not.toBeNull();
  });

  describe('More menu', () => {
    const more = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-more-views]')!;
    const overlay = () => document.querySelector('mf-filter-popover');

    afterEach(() => {
      TestBed.resetTestingModule();
    });

    it('holds Recently completed and opens a labelled panel; choosing a view emits it and closes', () => {
      const fixture = create();
      const el = fixture.nativeElement as HTMLElement;
      const chosen: string[] = [];
      fixture.componentInstance.viewSelect.subscribe((k) => chosen.push(k));
      expect(el.querySelector('.qv > [data-view="recentlyCompleted"]')).toBeNull();
      expect(more(el).getAttribute('aria-expanded')).toBe('false');
      more(el).click();
      fixture.detectChanges();
      expect(more(el).getAttribute('aria-expanded')).toBe('true');
      expect(el.querySelector('mf-filter-popover')!.getAttribute('aria-label')).toBe('More views');
      const item = el.querySelector<HTMLButtonElement>(
        'mf-filter-popover [data-view="recentlyCompleted"]',
      )!;
      expect(item.textContent).toContain('Recently completed');
      item.click();
      fixture.detectChanges();
      expect(chosen).toEqual(['recentlyCompleted']);
      expect(el.querySelector('mf-filter-popover')).toBeNull();
      expect(overlay()).toBeNull();
    });

    it('shows the name and count of a pressed view that sits in More, and counts as pressed', () => {
      const fixture = create(builtInFilters('recentlyCompleted', ctx));
      fixture.componentRef.setInput('counts', {
        open: 1,
        unassigned: 1,
        overdue: 1,
        dueSoon: 1,
        asap: 1,
        onHold: 1,
        myPod: 1,
        recentlyCompleted: 153,
        createdByMe: 1,
      });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(more(el).getAttribute('aria-pressed')).toBe('true');
      expect(more(el).textContent!.replace(/\s+/g, ' ').trim()).toBe('Recently completed 153');
      expect(more(el).getAttribute('aria-label')).toBe('Recently completed, 153 tasks');
      expect(more(el).getAttribute('data-view-in-more')).toBe('recentlyCompleted');
      expect(el.querySelector('.qv > [aria-pressed="true"]')).toBe(more(el));
    });

    it('is not pressed when the pressed view is in the strip', () => {
      const el = create(builtInFilters('overdue', ctx)).nativeElement as HTMLElement;
      expect(more(el).hasAttribute('aria-pressed')).toBe(false);
      expect(more(el).textContent!.replace(/\s+/g, ' ').trim()).toBe('More');
    });
  });

  describe('counts', () => {
    const counts = {
      open: 442,
      unassigned: 157,
      overdue: 101,
      dueSoon: 96,
      asap: 51,
      onHold: 64,
      myPod: 12,
      recentlyCompleted: 7,
      createdByMe: 3,
    };

    it('maps each view to its count, and to null while loading or without a primary Pod', () => {
      expect(viewCount('allOpen', counts)).toBe(442);
      expect(viewCount('unassigned', counts)).toBe(157);
      expect(viewCount('myPod', counts)).toBe(12);
      expect(viewCount('createdByMe', counts)).toBe(3);
      expect(viewCount('overdue', counts)).toBe(101);
      expect(viewCount('recentlyCompleted', counts)).toBe(7);
      expect(viewCount('overdue', null)).toBeNull();
      expect(viewCount('myPod', { ...counts, myPod: undefined })).toBeNull();
    });

    it('shows the count in each button: tabular, muted zero, (--) while loading, count in the accessible name', () => {
      const fixture = create();
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'overdue').querySelector('[data-count-pending]')!.textContent).toBe('--');
      expect(button(el, 'overdue').getAttribute('aria-label')).toBe('Overdue');

      fixture.componentRef.setInput('counts', { ...counts, recentlyCompleted: 0, createdByMe: 1 });
      fixture.detectChanges();
      expect(button(el, 'overdue').getAttribute('aria-label')).toBe('Overdue, 101 tasks');
      expect(button(el, 'overdue').textContent!.replace(/\s+/g, ' ').trim()).toBe('Overdue 101');
      expect(button(el, 'allOpen').getAttribute('data-count')).toBe('442');
      expect(button(el, 'createdByMe').getAttribute('aria-label')).toBe('Created by me, 1 task');
      expect(button(el, 'onHold').getAttribute('aria-label')).toBe('On hold, 64 tasks');
      expect(button(el, 'dueSoon').getAttribute('data-count')).toBe('96');
      fixture.componentRef.setInput('counts', { ...counts, open: 1442 });
      fixture.detectChanges();
      expect(button(el, 'allOpen').getAttribute('aria-label')).toBe('All open, 1,442 tasks');
    });

    it('maps the new views to their counts', () => {
      expect(viewCount('dueSoon', counts)).toBe(96);
      expect(viewCount('asap', counts)).toBe(51);
      expect(viewCount('onHold', counts)).toBe(64);
    });
  });

  describe('order and column overlay (#219)', () => {
    it('reads Unassigned and Overdue from the Dashboard rule and keeps the default order elsewhere', () => {
      expect(VIEW_ORDER.overdue).toEqual({
        sort: LIST_ORDER.overdue.sort,
        dir: LIST_ORDER.overdue.dir,
      });
      expect(VIEW_ORDER.unassigned).toEqual({ sort: 'priorityAge', dir: 'asc' });
      expect(VIEW_ORDER.recentlyCompleted).toEqual({ sort: 'closed', dir: 'desc' });
      expect(VIEW_ORDER.allOpen).toBeNull();
      expect(VIEW_ORDER.myPod).toBeNull();
      expect(VIEW_ORDER.createdByMe).toBeNull();
      // Due soon reads the Dashboard's rule too (soonest first); ASAP and On hold keep the default order.
      expect(VIEW_ORDER.dueSoon).toEqual({ sort: LIST_ORDER.dueSoon.sort, dir: 'asc' });
      expect(VIEW_ORDER.asap).toBeNull();
      expect(VIEW_ORDER.onHold).toBeNull();
    });

    it('replaces Due with Closed for Recently completed only, without touching the given set', () => {
      const own = ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status'];
      const copy = [...own];
      expect(overlayColumns(own, 'recentlyCompleted')).toEqual([
        'ref',
        'title',
        'matter',
        'priority',
        'assignee',
        'status',
        'closed',
      ]);
      expect(own).toEqual(copy);
      expect(overlayColumns(own, 'overdue')).toEqual(own);
      expect(overlayColumns(own, null)).toEqual(own);
    });
  });

  describe('roving tabindex (#236)', () => {
    const stops = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLElement>('.qv > button'))
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.getAttribute('data-view') ?? 'more');
    const press = (target: Element, key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    it('has one Tab stop: the pressed view, else the first', () => {
      const el = create({ ...emptyFilters(), status: [...OPEN_STATUSES], overdue: true })
        .nativeElement as HTMLElement;
      expect(stops(el)).toEqual(['overdue']);
      const none = create({ ...emptyFilters(), priority: [1] }).nativeElement as HTMLElement;
      expect(stops(none)).toEqual(['allOpen']);
    });

    it('moves with the arrow keys, wraps, and Home and End go to the ends', () => {
      const fixture = create();
      const el = fixture.nativeElement as HTMLElement;
      document.body.appendChild(el);
      button(el, 'allOpen').focus();
      press(button(el, 'allOpen'), 'ArrowRight');
      fixture.detectChanges();
      expect(document.activeElement).toBe(button(el, 'unassigned'));
      expect(stops(el)).toEqual(['unassigned']);
      press(document.activeElement!, 'ArrowLeft');
      press(document.activeElement!, 'ArrowLeft');
      expect(document.activeElement).toBe(el.querySelector('[data-more-views]'));
      press(document.activeElement!, 'Home');
      expect(document.activeElement).toBe(button(el, 'allOpen'));
      press(document.activeElement!, 'End');
      expect(document.activeElement).toBe(el.querySelector('[data-more-views]'));
      expect(press(document.activeElement!, 'a').defaultPrevented).toBe(false);
      el.remove();
    });

    it('presses a view with Enter or Space (a button click) and keeps aria-pressed', () => {
      const fixture = create();
      const picked: string[] = [];
      fixture.componentInstance.viewSelect.subscribe((k) => picked.push(k));
      button(fixture.nativeElement, 'asap').click();
      expect(picked).toEqual(['asap']);
    });
  });
});
