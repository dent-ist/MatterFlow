import { TestBed } from '@angular/core/testing';
import { AuditEventsClient, UsersClient } from '../../../api/generated/api-client';
import { ok, settle } from '../../../shared/testing/org-testing';
import { ddChoose } from '../../../testing/dropdown-testing.spec-util';
import { MatterActivities } from './matter-activities';

const ev = (id: number, type: string, who = 1) => ({
  auditEventId: id,
  occurredAtUtc: `2026-10-0${id}T10:00:00Z`,
  actorUserId: who,
  eventType: type,
  objectType: 'Matter',
  objectId: '7',
  oldValueTruncated: false,
  newValueTruncated: false,
  summary: `Event ${id}`,
  correlationId: 'c',
});

describe('MatterActivities (MD-07, #1008)', () => {
  async function start(seen?: string) {
    localStorage.clear();
    if (seen) localStorage.setItem('mf.matter-activity-seen.7', seen);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuditEventsClient,
          useValue: {
            listAuditEvents: vi.fn().mockReturnValue(
              ok({
                items: [
                  ev(1, 'MATTER_CREATED'),
                  ev(2, 'FIELD_CHANGED'),
                  ev(3, 'MATTER_MANAGER_CHANGED'),
                ],
              }),
            ),
          },
        },
        {
          provide: UsersClient,
          useValue: {
            getUser: vi.fn().mockReturnValue(ok({ displayName: 'Ann Lee', windowsAccount: 'ann' })),
          },
        },
      ],
    });
    const f = TestBed.createComponent(MatterActivities);
    f.componentRef.setInput('matterId', 7);
    await settle(f);
    return f;
  }
  const rows = (f: { nativeElement: HTMLElement }) =>
    Array.from(f.nativeElement.querySelectorAll('[data-activity-row]'));

  it('lists the events newest first in a grid', async () => {
    const f = await start();
    expect(rows(f)).toHaveLength(3);
    expect(rows(f)[0].textContent).toContain('ann');
    expect(f.nativeElement.querySelector('thead')!.textContent).toContain('What');
  });

  it('filters by kind with the Kind dropdown', async () => {
    const f = await start();
    ddChoose(f.nativeElement, 'Kind', 'Managers');
    await settle(f);
    expect(rows(f)).toHaveLength(1);
  });

  it('says how many are new since the last visit and remembers this visit', async () => {
    const f = await start('1');
    expect(f.nativeElement.querySelector('[data-new-banner]')!.textContent).toContain('2 new');
    expect(localStorage.getItem('mf.matter-activity-seen.7')).toBe('3');
  });

  it('shows no banner on the first visit', async () => {
    const f = await start();
    expect(f.nativeElement.querySelector('[data-new-banner]')).toBeNull();
  });
});
