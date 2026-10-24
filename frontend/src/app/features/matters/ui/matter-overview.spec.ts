import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatterOverview, MatterOverviewClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { MatterOverviewSections, reasonWords } from './matter-overview';

function overview(over: Partial<MatterOverview> = {}): MatterOverview {
  return {
    timeZone: 'America/New_York',
    asOfUtc: '2026-10-23T12:00:00Z',
    matter: {
      matterId: 7,
      matterRef: '90001-80001',
      name: 'Merger',
      clientId: 2,
      clientName: 'Acme',
      isActive: true,
      isSensitive: false,
      primaryManager: undefined,
      secondaryManager: undefined,
    },
    taskCounts: {
      new: 4,
      inProgress: 21,
      onHold: 3,
      completed: 12,
      open: 28,
      newQuery: 'matter=7&status=NEW',
      inProgressQuery: 'matter=7&status=IN_PROGRESS',
      onHoldQuery: 'matter=7&status=ON_HOLD',
      completedQuery: 'matter=7&status=COMPLETED',
      openQuery: 'matter=7',
    },
    deadlines: {
      total: 7,
      query: 'matter=7&sort=due',
      items: [
        {
          taskId: 11,
          taskNumber: 'TSK-11',
          title: 'Review batch 4',
          dueDate: '2026-10-26',
          dueAtUtc: undefined,
          assigneeId: 3,
          assigneeName: 'Alex Kim',
        },
        {
          taskId: 12,
          taskNumber: 'TSK-12',
          title: 'Privilege log',
          dueDate: '2026-10-27',
          dueAtUtc: undefined,
          assigneeId: undefined,
          assigneeName: undefined,
        },
      ],
    },
    people: {
      total: 12,
      unassignedOpen: 2,
      items: [
        {
          userId: 3,
          displayName: 'Alex Kim',
          isActive: true,
          open: 14,
          overdue: 2,
          away: undefined,
          query: 'matter=7&assignee=3',
        },
        {
          userId: 4,
          displayName: 'Priya Rao',
          isActive: true,
          open: 9,
          overdue: 0,
          away: { from: '2026-10-26', to: '2026-10-30', reasonCode: 'OUT_OF_OFFICE' },
          query: 'matter=7&assignee=4',
        },
      ],
    },
    assets: {
      total: 14,
      items: [
        {
          assetId: 5,
          displayName: 'Custodian_01',
          assetTypeName: 'Laptop',
          externalReference: undefined,
        },
      ],
    },
    activity: [
      {
        eventId: 12,
        occurredAtUtc: '2026-10-23T13:42:00Z',
        kind: 'STATUS_CHANGED',
        actorName: 'Dana',
        matterId: 7,
        matterRef: '90001-80001',
        matterName: 'Merger',
        clientName: 'Acme',
        taskId: 7,
        taskTitle: 'Privilege log',
        to: 'ON_HOLD',
        isUnread: false,
      } as never,
    ],
    health: {
      flag: 'RED',
      amberDueDays: 3,
      stuckOnHoldDays: 7,
      reasons: [
        { code: 'OVERDUE', count: 4, query: 'matter=7&overdue=true' },
        { code: 'UNASSIGNED', count: 1, query: 'matter=7&unassigned=true' },
      ],
    },
    ...over,
  };
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatterOverviewSections],
  template: `<mf-matter-overview
    [matterId]="7"
    [reload]="reload()"
    [canOpenActivity]="true"
    (openAssets)="assets = assets + 1"
    (openActivity)="activity = activity + 1"
  />`,
})
class Host {
  reload = signal(0);
  assets = 0;
  activity = 0;
}

describe('MatterOverviewSections (the enriched Overview, epic #758)', () => {
  let api: { getMatterOverview: ReturnType<typeof vi.fn> };

  async function create(
    response: unknown,
    permissions: Permission[] = ['Task.View', 'Asset.View'],
  ) {
    api = { getMatterOverview: vi.fn().mockReturnValue(response) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MatterOverviewClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const section = (f: { nativeElement: HTMLElement }, key: string) =>
    f.nativeElement.querySelector(`[data-section=${key}]`);

  it('shows every section with one request, health in words first and every count as a link', async () => {
    const f = await create(of(overview()));
    expect(api.getMatterOverview).toHaveBeenCalledTimes(1);
    expect(api.getMatterOverview).toHaveBeenCalledWith(7);
    const flag = section(f, 'health')!.querySelector('[data-flag]')!;
    expect(flag.textContent).toContain('Red');
    expect(section(f, 'health')!.querySelector('[data-reasons]')!.textContent).toContain(
      '4 tasks are overdue',
    );
    expect(section(f, 'health')!.querySelector('[data-reasons]')!.textContent).toContain(
      '1 task has nobody assigned',
    );
    const status = Array.from(section(f, 'status')!.querySelectorAll('a')).map((a) =>
      a.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(status).toEqual(['4 New', '21 In progress', '3 On hold', '12 Completed (30 days)']);
    expect(section(f, 'status')!.querySelector('a')!.getAttribute('href')).toContain(
      '/tasks?matter=7&status=NEW',
    );
    expect(section(f, 'deadlines')!.querySelectorAll('[data-deadline]')).toHaveLength(2);
    expect(section(f, 'deadlines')!.textContent).toContain('Unassigned');
    expect(section(f, 'deadlines')!.textContent).toContain('All 7 deadlines');
    expect(section(f, 'people')!.textContent).toContain('14 open, 2 overdue');
    expect(section(f, 'people')!.querySelector('[data-away]')!.textContent).toContain(
      'Away Oct 26 to Oct 30',
    );
    expect(section(f, 'people')!.querySelector('[data-unassigned]')!.textContent).toContain(
      '2 open tasks have nobody assigned',
    );
    expect(section(f, 'people')!.querySelector('[data-capped]')!.textContent).toContain(
      'Showing 2 of 12 people',
    );
    expect(section(f, 'assets')!.textContent).toContain('Linked assets (14)');
    expect(section(f, 'activity')!.textContent).toContain('Dana moved "Privilege log" to On Hold');
  });

  it('opens the Assets tab and the activity drawer from its links', async () => {
    const f = await create(of(overview()));
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-open-assets]')!
      .click();
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-open-activity]')!
      .click();
    expect(f.componentInstance.assets).toBe(1);
    expect(f.componentInstance.activity).toBe(1);
  });

  it('leaves out a section the API did not send (not permitted), and warns about no manager nowhere', async () => {
    const f = await create(
      of(overview({ assets: undefined, deadlines: undefined, people: undefined })),
    );
    expect(section(f, 'assets')).toBeNull();
    expect(section(f, 'deadlines')).toBeNull();
    expect(section(f, 'people')).toBeNull();
    expect(section(f, 'status')).not.toBeNull();
    expect(f.nativeElement.textContent).not.toMatch(/manager|warning/i);
  });

  it('asks for nothing and draws nothing without Task.View and Asset.View', async () => {
    const f = await create(of(overview()), ['Matter.View']);
    expect(api.getMatterOverview).not.toHaveBeenCalled();
    expect(
      f.nativeElement.querySelector('[data-overview-sections], [data-overview-skeleton]'),
    ).toBeNull();
  });

  it('says it could not load, with Retry, and reads again', async () => {
    const f = await create(throwError(() => new Error('boom')));
    expect(f.nativeElement.querySelector('[data-overview-error]')).not.toBeNull();
    api.getMatterOverview.mockReturnValue(of(overview()));
    (f.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-overview-retry]')!
      .click();
    await f.whenStable();
    f.detectChanges();
    expect(section(f, 'health')).not.toBeNull();
  });

  it('words a reason with its count and the thresholds', () => {
    const health = { flag: 'AMBER', reasons: [], amberDueDays: 3, stuckOnHoldDays: 7 };
    expect(reasonWords({ code: 'DUE_SOON', count: 2, query: undefined }, health)).toBe(
      '2 tasks are due within 3 days',
    );
    expect(reasonWords({ code: 'LONG_HOLD', count: 1, query: undefined }, health)).toBe(
      '1 task has been on hold for more than 7 days',
    );
    expect(reasonWords({ code: 'NO_OPEN_TASKS', count: 0, query: undefined }, health)).toBe(
      'no open tasks',
    );
  });
});
