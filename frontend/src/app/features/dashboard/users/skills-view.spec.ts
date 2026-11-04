import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DashboardBoardClient } from '../../../api/generated/api-client';
import { Clock } from '../../../core/time/clock';
import { DashScope } from '../dash-scope';
import { SkillsView } from './skills-view';
import { aMatrix } from './users-testing';

describe('SkillsView', () => {
  let calls: unknown[][];

  function create() {
    calls = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: DashScope, useValue: { scope: () => 'all' } },
        { provide: Clock, useValue: { now: () => new Date('2026-11-03T12:00:00Z') } },
        {
          provide: DashboardBoardClient,
          useValue: {
            getDashboardSkills: (...a: unknown[]) => {
              calls.push(a);
              return of(aMatrix());
            },
          },
        },
      ],
    });
    const f = TestBed.createComponent(SkillsView);
    const opened: number[] = [];
    f.componentInstance.open.subscribe((p) => opened.push(p.userId));
    f.detectChanges();
    return { f, opened, el: f.nativeElement as HTMLElement };
  }

  it('reads the matrix for the page scope and draws people by task types with the number always shown', () => {
    const { el } = create();
    expect(calls[0]).toEqual(['all']);
    expect(el.querySelectorAll('[data-person]')).toHaveLength(4);
    expect(el.querySelectorAll('thead [data-type]')).toHaveLength(2);
    const ana = el.querySelector('[data-person="1"]')!;
    expect(ana.querySelector('[data-type-id], td')!.textContent!.trim()).toBe('12');
    // A cell with no tasks still prints 0.
    expect(el.querySelector('[data-person="2"] td')!.textContent!.trim()).toBe('0');
  });

  it('switches the window to 12 months', () => {
    const { f, el } = create();
    el.querySelector<HTMLButtonElement>('[data-window="12"]')!.click();
    f.detectChanges();
    expect(el.querySelector('[data-person="1"] td')!.textContent!.trim()).toBe('40');
  });

  it('marks a thin task type with an icon, the word and a spoken explanation', () => {
    const { el } = create();
    const thin = el.querySelectorAll('[data-thin]');
    expect(thin).toHaveLength(1);
    expect(thin[0].textContent).toContain('Thin');
    expect(thin[0].querySelector('.sr-only')!.textContent).toContain('Thin coverage: 1 person has');
  });

  it('filters by name and availability, and a name opens the person', () => {
    const { f, el, opened } = create();
    const sel = el.querySelector<HTMLSelectElement>('[data-skills-availability]')!;
    sel.value = 'now';
    sel.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(el.querySelectorAll('[data-person]')).toHaveLength(3);
    el.querySelector<HTMLButtonElement>('[data-person="4"] [data-skills-open]')!.click();
    expect(opened).toEqual([4]);
  });

  it('shows growth candidates for the chosen task type and opens one', () => {
    const { f, el, opened } = create();
    expect(el.querySelector('[data-growth]')).toBeNull();
    const sel = el.querySelector<HTMLSelectElement>('[data-skills-type]')!;
    sel.value = '2';
    sel.dispatchEvent(new Event('change'));
    f.detectChanges();
    const names = [...el.querySelectorAll('[data-growth-person]')].map((b) =>
      b.textContent!.trim(),
    );
    expect(names[0]).toContain('Ben Carter');
    expect(el.querySelectorAll('thead [data-type]')).toHaveLength(1);
    el.querySelector<HTMLButtonElement>('[data-growth-person]')!.click();
    expect(opened).toEqual([2]);
  });
});
