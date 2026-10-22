import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ClientsClient, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aClient,
  aMatter,
  apiError,
  fakeQuery,
  ok,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ClientOverview, rowsFromMatters, rowsFromSummary } from './client-overview';
import { aClientSummary, aTopMatter } from './client-overview-testing';

describe('ClientOverview', () => {
  let api: { getClientSummary: ReturnType<typeof vi.fn> };
  let matters: { listMatters: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ClientOverview>;
  const el = (): HTMLElement => fixture.nativeElement;
  const text = (e: Element | null): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function create(
    permissions: Permission[],
    client = aClient(),
    summary = aClientSummary(),
  ): Promise<void> {
    api = { getClientSummary: vi.fn().mockReturnValue(ok(summary)) };
    matters = {
      listMatters: vi
        .fn()
        .mockReturnValue(
          ok(pageOfMatters(aMatter(), aMatter({ matterId: 8, matterRef: '00343-00013' }))),
        ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        fakeQuery().provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ClientsClient, useValue: api },
        { provide: MattersClient, useValue: matters },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ClientOverview);
    fixture.componentRef.setInput('client', client);
    await settle(fixture);
  }

  it('shows the strip as links to the Task Queue scoped to the client, then the top matters and the dates', async () => {
    await create(['Client.View', 'Matter.View', 'Task.View']);

    const strip = Array.from(el().querySelectorAll<HTMLAnchorElement>('a[data-strip-item]'));
    expect(strip.map((a) => text(a))).toEqual([
      'Open 9',
      'Overdue 2',
      'Due soon 2',
      'ASAP 3',
      'On hold 1',
    ]);
    expect(strip.every((a) => a.getAttribute('href')!.startsWith('/tasks?client=1'))).toBe(true);
    expect(strip[1].getAttribute('href')).toContain('overdue=true');

    expect(text(el().querySelector('.ov-h'))).toBe('Matters with the most open tasks');
    const rows = Array.from(el().querySelectorAll('[data-top-matters] tbody tr'));
    expect(
      rows.map((r) =>
        Array.from(r.children)
          .map((c) => text(c))
          .join(' '),
      ),
    ).toEqual(['00343-00012 Merger Review 4 1 overdue Active', '00343-00013 Audit 5 0 Active']);
    expect(el().querySelector('[data-matter="7"] a')!.getAttribute('href')).toBe('/matters/7');
    expect(text(el().querySelector('[data-view-all]'))).toBe('View all 2 matters');
    expect(text(el().querySelector('[data-created-line]'))).toBe('Created Oct 1, 2026');
    expect(el().querySelector('dl')).toBeNull(); // no number, name or status rows
  });

  it('puts the last change on the muted line', async () => {
    await create(
      ['Client.View', 'Matter.View', 'Task.View'],
      aClient({ modifiedAtUtc: '2026-10-05T12:00:00Z' }),
    );
    expect(text(el().querySelector('[data-created-line]'))).toBe(
      'Created Oct 1, 2026 - Last changed Oct 5, 2026',
    );
  });

  it('has no strip without Task.View and lists the matters with reference, name and status only', async () => {
    await create(['Client.View', 'Matter.View']);

    expect(api.getClientSummary).not.toHaveBeenCalled();
    expect(el().querySelector('[data-strip]')).toBeNull();
    expect(text(el().querySelector('.ov-h'))).toBe('Matters');
    expect(Array.from(el().querySelectorAll('th')).map((h) => text(h))).toEqual([
      'Matter',
      'Name',
      'Status',
    ]);
    expect(el().querySelectorAll('[data-top-matters] tbody tr').length).toBe(2);
    expect(matters.listMatters).toHaveBeenCalledWith(
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      5,
      undefined,
    );
  });

  it('has no matters table without Matter.View, but keeps the strip and the dates', async () => {
    await create(['Client.View', 'Task.View']);

    expect(el().querySelector('[data-overview-matters]')).toBeNull();
    expect(el().querySelector('[data-strip]')).not.toBeNull();
    expect(el().querySelector('[data-created-line]')).not.toBeNull();
    expect(matters.listMatters).not.toHaveBeenCalled();
  });

  it('shows No matters yet. with New matter for someone who can create, and nothing else about matters', async () => {
    await create(
      ['Client.View', 'Matter.View', 'Matter.Create', 'Task.View'],
      aClient({ matterCount: 0 }),
      aClientSummary({
        matterCount: 0,
        topMatters: [],
        openTasks: 0,
        overdue: 0,
        asap: 0,
        onHold: 0,
        dueSoon: 0,
      }),
    );

    expect(text(el().querySelector('[data-no-matters]'))).toBe('No matters yet. New matter');
    expect(el().querySelector('[data-new-matter]')!.getAttribute('href')).toBe(
      '/matters/new?clientId=1',
    );
    expect(el().querySelector('[data-top-matters]')).toBeNull();
    expect(el().querySelector('[data-view-all]')).toBeNull();
    // Real zeros stay in the strip, muted.
    expect(text(el().querySelector('[data-strip-item="open"]'))).toBe('Open 0');
    expect(el().querySelector('[data-strip-item="open"]')!.classList).toContain('zero');
  });

  it('explains an inactive client with no matters instead of offering New matter', async () => {
    await create(
      ['Client.View', 'Matter.View', 'Matter.Create', 'Task.View'],
      aClient({ matterCount: 0, isActive: false }),
      aClientSummary({ matterCount: 0, topMatters: [] }),
    );
    expect(el().querySelector('[data-new-matter]')).toBeNull();
    expect(text(el().querySelector('[data-inactive-reason]'))).toContain('This client is inactive');
  });

  it('says so when no matter has open tasks', async () => {
    await create(
      ['Client.View', 'Matter.View', 'Task.View'],
      aClient(),
      aClientSummary({ topMatters: [] }),
    );
    expect(text(el().querySelector('[data-no-open]'))).toBe('No matter has open tasks.');
    expect(el().querySelector('[data-view-all]')).not.toBeNull();
  });

  it('says "View all 63 matters" for a client with many matters', async () => {
    await create(['Client.View', 'Matter.View', 'Task.View'], aClient({ matterCount: 63 }));
    expect(text(el().querySelector('[data-view-all]'))).toBe('View all 63 matters');
  });

  it('shows a skeleton while the numbers load and an inline error with Retry when they fail', async () => {
    await create(['Client.View', 'Matter.View', 'Task.View']);
    api.getClientSummary.mockReturnValue(apiError(500, { title: 'x', status: 500 } as never));
    fixture.componentRef.setInput('client', aClient({ clientId: 2 }));
    await settle(fixture);
    expect(el().querySelector('[data-overview-error]')).not.toBeNull();
    expect(el().querySelector('[data-strip]')).toBeNull();
    expect(el().querySelector('[data-matters-unavailable]')).not.toBeNull();
    expect(el().querySelector('[data-created-line]')).not.toBeNull(); // the rest of the tab stays

    api.getClientSummary.mockReturnValue(ok(aClientSummary({ clientId: 2 })));
    el().querySelector<HTMLButtonElement>('[data-retry] button, button[data-retry]')!.click();
    await settle(fixture);
    expect(el().querySelector('[data-overview-error]')).toBeNull();
    expect(el().querySelector('[data-strip]')).not.toBeNull();
  });
});

describe('overview rows', () => {
  it('takes at most five top matters in the order the API gave', () => {
    const top = Array.from({ length: 7 }, (_, i) =>
      aTopMatter({ matterId: i + 1, openTasks: 9 - i }),
    );
    const rows = rowsFromSummary(aClientSummary({ topMatters: top }));
    expect(rows.map((r) => r.matterId)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({ open: 9, overdue: 1, reference: '00343-00012' });
  });

  it('has no rows when the viewer cannot see the top matters', () => {
    expect(rowsFromSummary(aClientSummary({ topMatters: undefined }))).toEqual([]);
  });

  it('maps listed matters without counts', () => {
    expect(rowsFromMatters([aMatter()])).toEqual([
      {
        matterId: 7,
        reference: '00343-00012',
        name: 'Merger Review',
        isActive: true,
        open: null,
        overdue: null,
      },
    ]);
  });
});
