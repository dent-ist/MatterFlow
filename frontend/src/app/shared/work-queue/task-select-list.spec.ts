import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaskQueueRow } from '../../api/generated/api-client';
import { TaskSelectList, isBulkEditable } from './task-select-list';

const row = (taskId: number, status: string, over: Partial<TaskQueueRow> = {}): TaskQueueRow =>
  ({
    taskId,
    taskNumber: `TSK-${taskId}`,
    title: `Task ${taskId}`,
    status,
    statusLabel: status === 'COMPLETED' ? 'Completed' : 'In Progress',
    priority: { priorityId: 1, label: 'Normal', color: '', sortOrder: 1 },
    assignedUser: undefined,
    assignedPod: undefined,
    isAsap: false,
    dueDate: undefined,
    ...over,
  }) as TaskQueueRow;

@Component({
  imports: [TaskSelectList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-task-select-list
    [rows]="rows"
    [selected]="selected()"
    [phone]="phone"
    (pick)="log.push($event.row.taskId + ':' + $event.on)"
    (toggleAll)="log.push('all:' + $event)"
  />`,
})
class Host {
  rows = [row(1, 'IN_PROGRESS'), row(2, 'COMPLETED'), row(3, 'NEW')];
  selected = signal<ReadonlySet<number>>(new Set([1]));
  phone = false;
  log: string[] = [];
}

describe('TaskSelectList', () => {
  async function mount(phone = false) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.phone = phone;
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;

  it('gives only open tasks a checkbox; a closed task says it cannot be changed', async () => {
    const f = await mount();
    const boxes = el(f).querySelectorAll<HTMLInputElement>('[data-select-row]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    expect(el(f).querySelector('[data-task="TSK-2"]')!.textContent).toContain(
      'closed: can’t be changed',
    );
    expect(isBulkEditable(row(2, 'CANCELLED'))).toBe(false);
  });

  it('names each checkbox and reports the pick and select-all', async () => {
    const f = await mount();
    const second = el(f).querySelectorAll<HTMLInputElement>('[data-select-row]')[1];
    expect(second.getAttribute('aria-label')).toBe('Select TSK-3 Task 3');
    second.click();
    el(f).querySelector<HTMLInputElement>('[data-select-all]')!.click();
    expect(f.componentInstance.log).toEqual(['3:true', 'all:true']);
    expect(el(f).querySelector<HTMLInputElement>('[data-select-all]')!.indeterminate).toBe(false);
  });

  it('is a list of cards with checkboxes on a phone', async () => {
    const f = await mount(true);
    expect(el(f).querySelector('[data-select-cards]')).not.toBeNull();
    expect(el(f).querySelector('table')).toBeNull();
    expect(el(f).querySelectorAll('[data-select-row]')).toHaveLength(2);
  });
});
