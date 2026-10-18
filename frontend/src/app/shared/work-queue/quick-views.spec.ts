import { TestBed } from '@angular/core/testing';
import { OPEN_STATUSES, ViewContext, builtInFilters, emptyFilters } from './queue-filters';
import { QuickViews, viewCount } from './quick-views';

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
    expect(Array.from(el.querySelectorAll('button')).map((b) => b.textContent!.trim())).toEqual([
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

  describe('counts (display is #219)', () => {
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

    it('carries the counts on the buttons without changing their names', () => {
      const fixture = create();
      fixture.componentRef.setInput('counts', counts);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(button(el, 'overdue').getAttribute('data-count')).toBe('101');
      expect(button(el, 'overdue').textContent!.trim()).toBe('Overdue');
      expect(button(el, 'allOpen').getAttribute('data-count')).toBe('442');
    });
  });
});
