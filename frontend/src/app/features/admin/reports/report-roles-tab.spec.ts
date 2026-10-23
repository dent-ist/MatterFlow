import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ReportAssignmentClient } from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { ReportRolesTab, peopleText } from './report-roles-tab';

const roles = [
  {
    roleId: 1,
    name: 'System Admin',
    description: undefined,
    isActive: true,
    isSystemAdmin: true,
    memberCount: 1,
    assigned: false,
  },
  {
    roleId: 2,
    name: 'Pod Lead',
    description: undefined,
    isActive: true,
    isSystemAdmin: false,
    memberCount: 4,
    assigned: true,
  },
  {
    roleId: 3,
    name: 'Old role',
    description: undefined,
    isActive: false,
    isSystemAdmin: false,
    memberCount: 0,
    assigned: false,
  },
];

describe('ReportRolesTab (#717)', () => {
  const api = { getRolesOfReport: vi.fn(), setRolesOfReport: vi.fn() };

  async function create() {
    api.getRolesOfReport.mockReset().mockReturnValue(of(roles));
    api.setRolesOfReport.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: ReportAssignmentClient, useValue: api }],
    });
    const fixture = TestBed.createComponent(ReportRolesTab);
    fixture.componentRef.setInput('reportId', 5);
    fixture.componentRef.setInput('reportName', 'Overdue tasks');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('counts people in words', () => {
    expect(peopleText(1)).toBe('1 person');
    expect(peopleText(0)).toBe('0 people');
    expect(peopleText(4)).toBe('4 people');
  });

  it('lists the roles with their people, flags an inactive role in text and shows no SQL', async () => {
    const { el } = await create();
    expect(api.getRolesOfReport).toHaveBeenCalledWith(5);
    expect(el.querySelector('[data-item="2"]')!.textContent).toContain('4 people');
    expect(el.querySelector<HTMLInputElement>('[data-item="2"] input')!.checked).toBe(true);
    expect(el.querySelector('[data-item="3"] [data-flag]')!.textContent).toBe('Inactive');
    expect(el.querySelector('[data-checklist-count]')!.textContent).toContain(
      '1 of 3 roles assigned',
    );
    expect(el.textContent).not.toMatch(/select /i);
  });

  it('saves the checked roles, says what changed and keeps the list on screen', async () => {
    const { fixture, el } = await create();
    const success = vi.spyOn(TestBed.inject(NotificationService), 'success');
    api.setRolesOfReport.mockReturnValue(
      of({
        added: [{ id: 1, name: 'System Admin' }],
        removed: [],
        assignedCount: 2,
        ownerName: 'Overdue tasks',
      }),
    );
    el.querySelector<HTMLInputElement>('[data-item="1"] input')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-checklist-save]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.setRolesOfReport).toHaveBeenCalledWith(5, { roleIds: [1, 2] });
    expect(success).toHaveBeenCalledWith('Overdue tasks now has 2 roles (added System Admin).');
    expect(el.querySelector('[data-checklist-search]')).not.toBeNull();
  });

  it('shows the failure and keeps the checked boxes when the save fails', async () => {
    const { fixture, el } = await create();
    api.setRolesOfReport.mockReturnValue(throwError(() => new Error('x')));
    el.querySelector<HTMLInputElement>('[data-item="1"] input')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-checklist-save]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-failure]')!.textContent).toContain('could not be saved');
    expect(el.querySelector<HTMLInputElement>('[data-item="1"] input')!.checked).toBe(true);
  });
});
