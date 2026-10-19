import { TestBed } from '@angular/core/testing';
import { aTask, allowed, mountTaskPage, q, transition } from './task-detail-testing';
import { statusNoteOf } from './task-status-note';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';
const NOW = new Date('2026-10-19T16:00:00Z');

const reason = (bodyHtml: string, authorName = 'KE\\kekim') => ({
  commentId: 1,
  purpose: 'CANCEL',
  bodyHtml,
  authorUserId: 3,
  authorName,
  createdAtUtc: '2026-10-18T20:03:00Z',
});

describe('statusNoteOf (B1, B2, #301, #302)', () => {
  it('Completed: "Completed Oct 18, 4:03 PM by Test User 01" in the viewer zone, from the completion moment', () => {
    const task = aTask({
      status: 'COMPLETED',
      statusChangedAtUtc: '2026-10-18T20:04:00Z',
      completedAtUtc: '2026-10-18T20:03:00Z',
      statusChangedBy: { userId: 5, displayName: 'Test User 01', isActive: true },
    });
    expect(statusNoteOf(task, NY, NOW)!.lead).toBe('Completed Oct 18, 4:03 PM by Test User 01');
    // The same instant in another zone is another day and clock time.
    expect(statusNoteOf(task, TOKYO, NOW)!.lead).toBe('Completed Oct 19, 5:03 AM by Test User 01');
  });

  it('shows the year only outside the current year, and no "by" when the actor is unknown', () => {
    const task = aTask({ status: 'COMPLETED', completedAtUtc: '2025-12-31T23:30:00Z' });
    expect(statusNoteOf(task, NY, NOW)!.lead).toBe('Completed Dec 31, 2025, 6:30 PM');
    expect(statusNoteOf(task, TOKYO, NOW)!.lead).toBe('Completed Jan 1, 8:30 AM');
  });

  it('Cancelled and On Hold: who, when and the reason as plain text; the tooltip has the full date and the whole reason', () => {
    const cancelled = statusNoteOf(
      aTask({
        status: 'CANCELLED',
        statusChangedAtUtc: '2026-10-18T20:03:00Z',
        statusReason: reason(
          '<p>Duplicate of an <strong>earlier</strong> request</p><p>Second line</p>',
        ),
      }),
      NY,
      NOW,
    )!;
    expect(cancelled.lead).toBe('Cancelled Oct 18, 4:03 PM by KE\\kekim');
    expect(cancelled.reason).toBe('Duplicate of an earlier request\nSecond line');
    expect(cancelled.tooltip).toBe(
      'Cancelled Oct 18, 2026, 4:03 PM EDT by KE\\kekim\nDuplicate of an earlier request\nSecond line',
    );
    const hold = statusNoteOf(
      aTask({
        status: 'ON_HOLD',
        statusChangedAtUtc: '2026-10-18T20:03:00Z',
        statusReason: reason('Waiting for the custodian'),
      }),
      NY,
      NOW,
    )!;
    expect(hold.lead).toBe('On hold since Oct 18, 4:03 PM by KE\\kekim');
    expect(hold.icon).toBe('pi-pause');
  });

  it('has no note for an open task', () => {
    expect(statusNoteOf(aTask({ status: 'IN_PROGRESS' }), NY, NOW)).toBeNull();
    expect(statusNoteOf(aTask({ status: 'NEW' }), NY, NOW)).toBeNull();
  });
});

describe('TaskStatusNote on the page', () => {
  afterEach(() => TestBed.resetTestingModule());

  // The viewer zone here is the browser's, so the page tests match the stamp's shape; the exact text is covered above in two zones.
  const mount = (overrides: Parameters<typeof aTask>[0]) =>
    mountTaskPage(aTask(overrides), ['Task.View', 'Task.Edit', 'Workflow.Execute']);

  it('an open task has no note; a closed or held task has exactly one, with no button and no old banner or workflow notice', async () => {
    const open = await mount({ status: 'IN_PROGRESS' });
    expect(q(open.el, '[data-status-note]')).toBeNull();
    TestBed.resetTestingModule();

    const hold = await mount({
      status: 'ON_HOLD',
      statusLabel: 'On Hold',
      statusChangedAtUtc: '2026-10-18T20:03:00Z',
      statusReason: reason('Waiting for the custodian'),
      allowedActions: allowed({ canExecuteSteps: false, transitions: [transition('RESUME')] }),
    });
    expect(hold.el.querySelectorAll('[data-status-note]').length).toBe(1);
    const note = q(hold.el, '[data-status-note]')!;
    expect(note.getAttribute('data-status')).toBe('ON_HOLD');
    expect(note.textContent).toMatch(/On hold since Oct 1[89], \d{1,2}:\d{2} [AP]M by KE\\kekim/);
    expect(note.textContent).toContain('Waiting for the custodian');
    expect(note.querySelector('button')).toBeNull();
    expect(q(hold.el, '[data-closed-banner]')).toBeNull();
    expect(q(hold.el, '[data-workflow-notice]')).toBeNull();
    expect(q(hold.el, '[data-blocked-reason]')).toBeNull();
    // "On hold" is said once on the page's note, and "Resume it" nowhere in the Workflow.
    expect(hold.el.textContent).not.toContain('Resume it');
  });

  it('a closed task in an inactive Matter says once that it cannot be reopened', async () => {
    const { el } = await mount({
      status: 'CANCELLED',
      statusLabel: 'Cancelled',
      allowedActions: allowed({
        canEdit: false,
        transitions: [transition('REOPEN', { permitted: false, blockedReason: 'MATTER_INACTIVE' })],
      }),
    });
    expect(el.querySelectorAll('[data-matter-inactive]').length).toBe(1);
    expect(q(el, '[data-status-note] [data-matter-inactive]')!.textContent).toContain(
      "can't be reopened",
    );
  });
});
