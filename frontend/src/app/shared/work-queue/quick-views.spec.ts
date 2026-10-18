import { TestBed } from '@angular/core/testing';
import { OPEN_STATUSES, ViewContext, builtInFilters, emptyFilters } from './queue-filters';
import { QuickViews, VIEW_ORDER, overlayColumns, viewCount } from './quick-views';
import { LIST_ORDER } from '../../features/dashboard/dashboard-links';

describe('QuickViews', () => {
  const ctx: ViewContext = { userId: 9, primaryPodId: 5, recentFrom: '2026-09-14' };

  function create(filters = emptyFilters(), context = ctx) {
    const fixture = TestBed.createComponent(QuickViews);
    fixture.componentRef.setInput('filters', filters);
    fixture.componentRef.setInput('context', context);
    fixture.detectChanges();
    return fixture;
  }
  const button = (el: HTMLElement, key: string) =>
    el.querySelector<HTMLButtonElement>(`[data-view="${key}"]`)!;

  it('offers the six views as a labelled group of toggle buttons', () => {
    const el = create().nativeElement as HTMLElement;
    expect(el.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Quick views');
    expect(
      Array.from(el.querySelectorAll('button')).map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'All open',
      'Unassigned',
      'My pod',
      'Created by me',
      'Overdue',
      'Recently completed',
    ]);
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
    expect(el.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
  });

  it('emits the chosen view and disables My pod without a primary Pod', () => {
    const fixture = create(emptyFilters(), { ...ctx, primaryPodId: null });
    const el = fixture.nativeElement as HTMLElement;
    const chosen: string[] = [];
    fixture.componentInstance.viewSelect.subscribe((k) => chosen.push(k));
    button(el, 'unassigned').click();
    expect(chosen).toEqual(['unassigned']);
    expect(button(el, 'myPod').disabled).toBe(true);
    expect(button(el, 'myPod').getAttribute('title')).toBe('You have no primary Pod');
    expect(button(el, 'allOpen').hasAttribute('title')).toBe(false);
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
      expect(button(el, 'recentlyCompleted').querySelector('.qv-n--zero')).not.toBeNull();
      expect(button(el, 'recentlyCompleted').getAttribute('aria-label')).toBe(
        'Recently completed, 0 tasks',
      );
      fixture.componentRef.setInput('counts', { ...counts, open: 1442 });
      fixture.detectChanges();
      expect(button(el, 'allOpen').getAttribute('aria-label')).toBe('All open, 1,442 tasks');
    });

    it('shows no count on My pod without a primary Pod', () => {
      const fixture = create(emptyFilters(), { ...ctx, primaryPodId: null });
      fixture.componentRef.setInput('counts', { ...counts, myPod: null });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'myPod').querySelector('.qv-n')).toBeNull();
      expect(button(el, 'myPod').getAttribute('aria-label')).toBe('My pod');
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
});
