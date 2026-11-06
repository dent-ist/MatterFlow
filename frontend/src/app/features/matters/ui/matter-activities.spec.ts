import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuditSearchClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ddChoose } from '../../../testing/dropdown-testing.spec-util';
import { MatterActivities } from './matter-activities';

const item = (id: number, type: string, label: string | null, summary: string, extra = {}) => ({
  auditEventId: id,
  occurredAtUtc: `2026-10-0${id}T10:00:00Z`,
  actor: { userId: 1, displayName: 'Ann Lee' },
  eventType: 'FIELD_CHANGED',
  object: { type, id: String(id), label },
  matterId: 7,
  summary,
  correlationId: 'c',
  correlationEventCount: 1,
  oldValueTruncated: false,
  newValueTruncated: false,
  valuesRedacted: false,
  ...extra,
});

describe('MatterActivities (MD-07, #1008)', () => {
  let search: ReturnType<typeof vi.fn>;
  async function start(permissions: string[], seen?: string) {
    localStorage.clear();
    if (seen) localStorage.setItem('mf.matter-activity-seen.7', seen);
    search = vi.fn().mockReturnValue(
      ok({
        items: [
          item(4, 'Note', 'Hold reminders', 'Note saved'),
          item(3, 'Production', 'Volume 1', 'Production changed'),
          item(2, 'Task', 'TSK-1 First task', 'Status changed', { taskId: 2 }),
          item(1, 'Asset', 'Restricted record', 'Asset renamed'),
        ],
        nextCursor: null,
        pageSize: 50,
        timeZone: 'UTC',
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...(permissions as never[])))),
        { provide: AuditSearchClient, useValue: { searchAuditEvents: search } },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const f = TestBed.createComponent(MatterActivities);
    f.componentRef.setInput('matterId', 7);
    await settle(f);
    return f;
  }
  const rows = (f: { nativeElement: HTMLElement }) =>
    Array.from(f.nativeElement.querySelectorAll('tbody tr[data-record-id]'));

  it('asks for the events of the matter and lists them newest first with the object as a link when it has a page', async () => {
    const f = await start(['Audit.View', 'Task.View', 'Production.View', 'MatterNote.View']);
    expect(search.mock.lastCall![10]).toBe(7);
    expect(rows(f)).toHaveLength(4);
    const links = Array.from(
      (f.nativeElement as HTMLElement).querySelectorAll('[data-object-link]'),
    ).map((a) => (a as HTMLElement).getAttribute('href'));
    expect(links).toEqual(['/matters/7?tab=notes', '/matters/7?tab=productions', '/tasks/2']);
    expect(rows(f)[0].textContent).toContain('Note saved');
  });

  it('shows plain text where the viewer may not open the object, and keeps Restricted record', async () => {
    const f = await start(['Audit.View']);
    expect(f.nativeElement.querySelector('[data-object-link]')).toBeNull();
    expect(rows(f)[3].textContent).toContain('Restricted record');
  });

  it('filters by kind on the server with the Kind dropdown', async () => {
    const f = await start(['Audit.View']);
    ddChoose(f.nativeElement, 'Kind', 'Notes');
    await settle(f);
    expect(search.mock.lastCall![0]).toBe('Note,NoteTemplate');
    ddChoose(f.nativeElement, 'Kind', 'Productions');
    await settle(f);
    expect(search.mock.lastCall![0]).toBe('Production,ProductionComment');
    ddChoose(f.nativeElement, 'Kind', 'Specs');
    await settle(f);
    expect(search.mock.lastCall![0]).toBe('ProductionSpec');
  });

  it('says how many are new since the last visit and remembers this visit', async () => {
    const f = await start(['Audit.View'], '2');
    expect(f.nativeElement.querySelector('[data-new-banner]')!.textContent).toContain('2 new');
    expect(localStorage.getItem('mf.matter-activity-seen.7')).toBe('4');
  });

  it('is the shared record grid: When, What and Who, resize handles and Columns', async () => {
    const f = await start(['Audit.View']);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('mf-record-columns')).not.toBeNull();
    expect(Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent!.trim())).toEqual([
      'When',
      'What',
      'Who',
    ]);
    expect(el.querySelectorAll('thead .mf-resize').length).toBeGreaterThan(0);
  });

  it('shows no banner on the first visit', async () => {
    const f = await start(['Audit.View']);
    expect(f.nativeElement.querySelector('[data-new-banner]')).toBeNull();
  });
});
