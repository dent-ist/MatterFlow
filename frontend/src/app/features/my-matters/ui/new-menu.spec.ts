import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { MatterTree } from './mm-models';
import { MmNewMenu } from './new-menu';

const tree = (matters: number): MatterTree => ({
  asOfUtc: '',
  activeDays: 7,
  clientCount: 1,
  matterCount: matters,
  clients: [],
});

describe('+ New menu (UI-14)', () => {
  function setup(
    perms: string[],
    matters = 3,
    tab: 'overview' | 'calendar' | 'assets' = 'overview',
  ) {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: { has: (c: string) => perms.includes(c) } },
        { provide: Router, useValue: { url: '/my-matters', navigate } },
      ],
    });
    const fixture = TestBed.createComponent(MmNewMenu);
    fixture.componentRef.setInput('tab', tab);
    fixture.componentRef.setInput('tree', tree(matters));
    fixture.componentRef.setInput('matterId', 5);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('[data-new-menu]')!.click();
    fixture.detectChanges();
    const item = (k: string) => el.querySelector<HTMLElement>(`[data-new="${k}"]`)!;
    return { fixture, el, item, navigate };
  }
  const ALL = ['Task.Create', 'Matter.Edit', 'Asset.Create', 'Project.Create'];

  it('lists the four items and each one carries a menuitem role', () => {
    const { el } = setup(ALL);
    expect(el.querySelector('[role=menu]')).not.toBeNull();
    expect(
      Array.from(el.querySelectorAll('[role=menuitem]')).map(
        (i) => (i as HTMLElement).dataset['new'],
      ),
    ).toEqual(['task', 'event', 'asset', 'project']);
  });

  it('an item that is not allowed is greyed with its reason in words, and does nothing', () => {
    const { item, navigate } = setup(['Task.Create', 'Matter.Edit']);
    expect(item('asset').getAttribute('aria-disabled')).toBe('true');
    expect(item('asset').textContent).toContain('You do not have permission to create assets.');
    expect(item('project').textContent).toContain('You do not have permission to create projects.');
    item('asset').click();
    expect(navigate).not.toHaveBeenCalled();
    expect(item('task').getAttribute('aria-disabled')).toBeNull();
  });

  it('with no matters every item says so', () => {
    const { item } = setup(ALL, 0);
    for (const k of ['task', 'event', 'asset', 'project'])
      expect(item(k).textContent).toContain('You have no matters yet.');
  });

  it('on the Calendar tab the calendar item comes first', () => {
    const { el } = setup(ALL, 3, 'calendar');
    expect(el.querySelector('[role=menuitem]')!.getAttribute('data-new')).toBe('event');
    expect(el.querySelector('[role=menuitem]')!.textContent).toContain('Suggested here');
  });

  it('on the Assets tab the asset comes first', () => {
    const { el } = setup(ALL, 3, 'assets');
    expect(el.querySelector('[role=menuitem]')!.getAttribute('data-new')).toBe('asset');
  });

  it('New task opens the create form with the chosen matter', () => {
    const { item, navigate } = setup(ALL);
    item('task').click();
    expect(navigate).toHaveBeenCalledWith(['/tasks/new'], {
      queryParams: { matterId: 5, returnTo: '/my-matters' },
    });
  });
});
