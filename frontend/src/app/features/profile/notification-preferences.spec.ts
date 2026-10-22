import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { NotificationPreferencesClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../core/auth/auth-testing';
import { Permission } from '../../core/auth/permissions';
import { settle } from '../../shared/testing/org-testing';
import { NotificationPreferences } from './notification-preferences';

const ITEMS = [
  ['TaskAssigned', 'Technician', 'A task is assigned to me'],
  ['TaskDue', 'Technician', 'My task is overdue or due within a day'],
  ['TaskComment', 'Technician', 'Someone comments on or mentions me in my task'],
  ['MatterTaskOverdue', 'ProjectManager', 'A task on my matter becomes overdue'],
  ['MatterTaskCreated', 'ProjectManager', 'A new task is created on my matter'],
  [
    'MatterTaskStalled',
    'ProjectManager',
    'A task on my matter is unassigned or on hold for a while',
  ],
  ['MatterManagerSet', 'ProjectManager', "I am set as a matter's Primary or Secondary manager"],
  ['PodTaskUnassigned', 'PodLead', 'A task in my pod becomes unassigned'],
].map(([eventType, group, label]) => ({ eventType, group, label, enabled: true }));

describe('NotificationPreferences', () => {
  let client: Record<string, ReturnType<typeof vi.fn>>;

  async function create(
    permissions: Permission[] = ['Task.View'],
  ): Promise<ComponentFixture<NotificationPreferences>> {
    client = {
      getNotificationPreferences: vi.fn().mockReturnValue(of({ items: ITEMS })),
      updateNotificationPreferences: vi.fn().mockReturnValue(of({ items: ITEMS })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: NotificationPreferencesClient, useValue: client },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(NotificationPreferences);
    await settle(fixture);
    return fixture;
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const toggle = (f: ComponentFixture<unknown>, type: string) =>
    el(f).querySelector<HTMLInputElement>(`input[data-event=${type}]`)!;

  it('shows eight labelled switches, all on', async () => {
    const fixture = await create();
    const boxes = el(fixture).querySelectorAll<HTMLInputElement>('input[role=switch]');
    expect(boxes.length).toBe(8);
    expect(Array.from(boxes).every((b) => b.checked)).toBe(true);
    expect(el(fixture).textContent).toContain('nothing is sent by email');
    expect(el(fixture).textContent).toContain('future notifications only');
  });

  it('keeps roles the person does not hold under Other events, and shows held ones first', async () => {
    const other = await create();
    expect(
      other.nativeElement.querySelector('[data-prefs-other] [data-prefs-group=ProjectManager]'),
    ).not.toBeNull();
    expect(
      other.nativeElement.querySelector('[data-prefs-other] [data-prefs-group=Technician]'),
    ).toBeNull();
    TestBed.resetTestingModule();
    const pm = await create(['Task.View', 'Matter.BeManager']);
    expect(
      pm.nativeElement.querySelector('[data-prefs-other] [data-prefs-group=ProjectManager]'),
    ).toBeNull();
    expect(pm.nativeElement.querySelector('[data-prefs-group=ProjectManager]')).not.toBeNull();
  });

  it('saves at once and says "Saved."', async () => {
    const fixture = await create();
    const box = toggle(fixture, 'TaskDue');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(client['updateNotificationPreferences']).toHaveBeenCalledWith({
      items: [{ eventType: 'TaskDue', enabled: false }],
    });
    expect(el(fixture).querySelector('[data-prefs-status]')!.textContent).toContain('Saved.');
    expect(toggle(fixture, 'TaskDue').checked).toBe(false);
  });

  it('reverts the switch and shows an inline error when the save fails', async () => {
    const fixture = await create();
    client['updateNotificationPreferences'].mockReturnValue(throwError(() => new Error('x')));
    const box = toggle(fixture, 'TaskAssigned');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(toggle(fixture, 'TaskAssigned').checked).toBe(true);
    expect(el(fixture).querySelector('[data-prefs-error]')!.textContent).toContain(
      'A task is assigned to me',
    );
  });
});
