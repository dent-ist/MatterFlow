import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskCount, taskQueueQuery } from './task-count';

describe('taskQueueQuery', () => {
  it('scopes to the record and the open statuses; overdue adds overdue=true', () => {
    expect(taskQueueQuery('client', 5, 'open')).toEqual({
      client: '5',
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
    });
    expect(taskQueueQuery('project', 9, 'overdue')).toEqual({
      project: '9',
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      overdue: 'true',
    });
  });
});

describe('TaskCount', () => {
  function make(kind: 'open' | 'overdue', count: number, name = 'Acme') {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TaskCount);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('count', count);
    fixture.componentRef.setInput('scope', 'matter');
    fixture.componentRef.setInput('recordId', 7);
    fixture.componentRef.setInput('name', name);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('links a positive count and says "overdue" in the name and the tooltip', () => {
    const a = make('overdue', 1).querySelector('a')!;
    expect(a.getAttribute('aria-label')).toBe('1 overdue task in Acme');
    expect(a.getAttribute('title')).toBe('1 overdue task in Acme');
    expect(a.getAttribute('href')).toContain('/tasks?matter=7');
  });

  it('shows 0 for open and an en dash with a spoken sentence for overdue, neither as a link', () => {
    const open = make('open', 0);
    expect(open.querySelector('a')).toBeNull();
    expect(open.textContent!.trim()).toBe('0');
    TestBed.resetTestingModule();
    const overdue = make('overdue', 0);
    expect(overdue.querySelector('a')).toBeNull();
    expect(overdue.querySelector('[aria-hidden=true]')!.textContent).toBe('–');
    expect(overdue.textContent).toContain('0 overdue tasks in Acme');
  });
});
