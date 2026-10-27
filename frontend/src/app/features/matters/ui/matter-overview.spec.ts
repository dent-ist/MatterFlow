import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  MatterOverview,
  MatterOverviewClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
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
    types: [
      {
        taskTypeId: 2,
        name: 'Production (Outgoing)',
        iconKey: 'send',
        colourKey: 'blue',
        open: 6,
        overdue: 2,
        query: 'matter=7&status=NEW&type=2',
        overdueQuery: 'matter=7&status=NEW&type=2&overdue=true',
      },
      {
        taskTypeId: 3,
        name: 'Intake',
        iconKey: 'inbox',
        colourKey: undefined,
        open: 4,
        overdue: 0,
        query: 'matter=7&status=NEW&type=3',
        overdueQuery: 'matter=7&status=NEW&type=3&overdue=true',
      },
    ],
    holdReasons: [
      {
        onHoldReasonId: 5,
        name: 'Waiting for client data',
        count: 2,
        oldestDays: 6,
        query: 'matter=7&status=ON_HOLD&onHoldReason=5',
      },
      {
        onHoldReasonId: 0,
        name: 'No reason given',
        count: 1,
        oldestDays: 0,
        query: 'matter=7&status=ON_HOLD&onHoldReason=0',
      },
    ],
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
  let myMatters: {
    getMyMattersData: ReturnType<typeof vi.fn>;
    getMyMattersDataVolume: ReturnType<typeof vi.fn>;
  };

  async function create(
    response: unknown,
    permissions: Permission[] = ['Task.View', 'Asset.View', 'Matter.BeManager'],
  ) {
    api = { getMatterOverview: vi.fn().mockReturnValue(response) };
    const counts = {
      assets: 19,
      active: 16,
      inactive: 1,
      pendingDisposition: 2,
      disposed: 0,
      size: [{ unit: 'GB', value: 640.2, assets: 15 }],
    };
    myMatters = {
      getMyMattersData: vi.fn().mockReturnValue(
        of({
          totals: counts,
          matters: [
            {
              matterId: 7,
              matterRef: '90001-80001',
              matterName: 'Merger',
              clientName: 'Acme',
              matterIsActive: true,
              counts,
              query: 'matterId=7&matterManagedByMe=true',
            },
          ],
          types: [],
          warnings: {
            inactiveLinked: { assets: 0, query: '' },
            awaitingDisposition: { assets: 2, query: '' },
          },
          scopeQuery: '',
        }),
      ),
      getMyMattersDataVolume: vi.fn().mockReturnValue(
        of({
          units: ['GB'],
          limitation: 'Derived.',
          points: [
            {
              month: '2026-09',
              assets: 10,
              held: [{ unit: 'GB', value: 400, assets: 10 }],
              added: [],
              removed: [],
            },
            {
              month: '2026-10',
              assets: 19,
              held: [{ unit: 'GB', value: 640.2, assets: 15 }],
              added: [],
              removed: [],
            },
          ],
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MatterOverviewClient, useValue: api },
        { provide: MyMattersClient, useValue: myMatters },
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

  it('shows the task types with open and overdue as links, and the tasks on hold by reason (PM v2, #882)', async () => {
    const f = await create(of(overview()));
    const rows = Array.from(section(f, 'types')!.querySelectorAll('[data-type-row]'));
    expect(rows.map((r) => r.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Production (Outgoing) 6 open , 2 overdue',
      'Intake 4 open',
    ]);
    expect(rows[0].querySelector('a.mo__link')!.getAttribute('href')).toContain('type=2');
    expect(rows[0].querySelector('a.mo__over')!.getAttribute('href')).toContain('overdue=true');
    const holds = Array.from(section(f, 'holds')!.querySelectorAll('[data-hold-reason]'));
    expect(
      holds.map(
        (r) =>
          `${r.querySelector('a')!.textContent!.trim()} | ${r.querySelector('.mo__fact')!.textContent!.trim()}`,
      ),
    ).toEqual(['Waiting for client data | 2 tasks, longest 6 days', 'No reason given | 1 task']);
    expect(holds[0].querySelector('a')!.getAttribute('href')).toContain('onHoldReason=5');
  });

  it('leaves the types and the hold reasons out when there are none', async () => {
    const f = await create(of(overview({ types: [], holdReasons: [] })));
    expect(section(f, 'types')).toBeNull();
    expect(section(f, 'holds')).toBeNull();
  });

  it('shows the Data block from the Data API with the asset counts, the size and the pending count, and the chart from the volume endpoint', async () => {
    const f = await create(of(overview()));
    // The block asks for its numbers once the overview has arrived, and the chart once the matter's row is in.
    for (let i = 0; i < 3; i++) {
      await f.whenStable();
      f.detectChanges();
    }
    const block = section(f, 'data')!;
    expect(myMatters.getMyMattersData).toHaveBeenCalledWith('mine');
    expect(myMatters.getMyMattersDataVolume).toHaveBeenCalledWith(
      'mine',
      undefined,
      undefined,
      undefined,
      undefined,
      7,
      12,
    );
    expect(block.querySelector('[data-data-assets]')!.textContent).toContain('19');
    expect(block.querySelector('[data-data-size]')!.textContent).toContain('640.2 GB');
    expect(block.querySelector('[data-data-pending]')!.textContent).toContain('2');
    expect(block.querySelector('[data-data-pending]')!.getAttribute('href')).toContain(
      'status=pending',
    );
    expect(block.querySelector('[data-data-chart-note]')).not.toBeNull();
  });

  it('has no Data block without Asset.View, and none for a matter the Data API does not list', async () => {
    const f = await create(of(overview({ assets: undefined })), ['Task.View', 'Matter.BeManager']);
    expect(section(f, 'data')).toBeNull();
    expect(myMatters.getMyMattersData).not.toHaveBeenCalled();
    // Asset.View and Task.View but no right to manage matters: the Data API would answer 403, so nothing is asked for.
    TestBed.resetTestingModule();
    const g = await create(of(overview()), ['Task.View', 'Asset.View']);
    expect(section(g, 'assets')).not.toBeNull();
    expect(section(g, 'data')).toBeNull();
    expect(myMatters.getMyMattersData).not.toHaveBeenCalled();
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
