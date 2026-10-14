import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskActivityClient } from '../../../api/generated/api-client';
import { apiError, ok, settle } from '../../../shared/testing/org-testing';
import { anActivity } from './task-panels-testing';
import { TaskActivity } from './task-activity';

describe('TaskActivity', () => {
  let api: { getTaskActivity: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<TaskActivity>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(selector: string): T => el().querySelector<T>(selector)!;

  const first = anActivity();
  const second = anActivity({
    eventId: 9,
    eventType: 'COMMENT_ADDED',
    category: 'COMMENTS',
    summary: 'Comment added',
    fieldKey: 'purpose',
    oldValue: undefined,
    newValue: undefined,
  });
  const system = anActivity({
    eventId: 8,
    eventType: 'TASK_CREATED',
    category: 'TASK',
    actor: undefined,
    summary: 'TSK-1 created: Load custodian data',
    oldValue: undefined,
    newValue: undefined,
  });

  async function create(
    page = {
      items: [first, second, system],
      nextCursor: undefined as string | undefined,
      canViewChanges: true,
    },
  ): Promise<void> {
    api = { getTaskActivity: vi.fn().mockReturnValue(ok(page)) };
    TestBed.configureTestingModule({ providers: [{ provide: TaskActivityClient, useValue: api }] });
    fixture = TestBed.createComponent(TaskActivity);
    fixture.componentRef.setInput('taskId', 42);
    await settle(fixture);
  }

  it('shows each entry with the actor, the time and the readable sentence, newest first', async () => {
    await create();

    const items = Array.from(el().querySelectorAll('[data-event-id]'));
    expect(items.map((i) => i.getAttribute('data-event-id'))).toEqual(['10', '9', '8']);
    expect(items[0].querySelector('[data-actor]')?.textContent).toBe('Dana P.');
    expect(items[0].querySelector('[data-summary]')?.textContent).toBe(
      'Status changed from In Progress to On Hold',
    );
    expect(items[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-13T14:25:00Z');
    expect(items[0].querySelector('time')?.getAttribute('title')).toContain('(UTC)');
    expect(items[2].querySelector('[data-actor]')?.textContent).toBe('System');
    expect(api.getTaskActivity).toHaveBeenCalledWith(42, undefined, 25);
  });

  it('shows old and new values on demand when the server includes them', async () => {
    await create();
    const item = q('[data-event-id="10"]');
    expect(item.querySelector('[data-changes]')).toBeNull();

    item.querySelector<HTMLButtonElement>('[data-changes-toggle]')!.click();
    await settle(fixture);
    expect(item.querySelector('[data-changes]')?.textContent).toContain('In Progress');
    expect(item.querySelector('[data-changes]')?.textContent).toContain('On Hold');

    item.querySelector<HTMLButtonElement>('[data-changes-toggle]')!.click();
    await settle(fixture);
    expect(item.querySelector('[data-changes]')).toBeNull();
    // Entries without values have nothing to show.
    expect(q('[data-event-id="9"]').querySelector('[data-changes-toggle]')).toBeNull();
  });

  it('offers no "View changes" without Audit.View', async () => {
    await create({
      items: [anActivity({ oldValue: undefined, newValue: undefined })],
      nextCursor: undefined,
      canViewChanges: false,
    });
    expect(el().querySelector('[data-changes-toggle]')).toBeNull();
    expect(q('[data-summary]').textContent).toContain('Status changed');
  });

  it('filters by type', async () => {
    await create();
    q<HTMLButtonElement>('[data-filter=COMMENTS]').click();
    await settle(fixture);
    expect(
      Array.from(el().querySelectorAll('[data-event-id]')).map((i) =>
        i.getAttribute('data-event-id'),
      ),
    ).toEqual(['9']);
    expect(q('[data-filter=COMMENTS]').getAttribute('aria-pressed')).toBe('true');

    q<HTMLButtonElement>('[data-filter=ASSETS]').click();
    await settle(fixture);
    expect(q('[data-empty]').textContent).toContain('No activity of this type');

    q<HTMLButtonElement>('[data-filter=ALL]').click();
    await settle(fixture);
    expect(el().querySelectorAll('[data-event-id]').length).toBe(3);
  });

  it('loads older entries with the cursor', async () => {
    await create({ items: [first], nextCursor: '10', canViewChanges: true });
    expect(q('[data-more]')).not.toBeNull();

    api.getTaskActivity.mockReturnValue(
      ok({ items: [second], nextCursor: undefined, canViewChanges: true }),
    );
    q<HTMLButtonElement>('[data-more]').click();
    await settle(fixture);

    expect(api.getTaskActivity).toHaveBeenLastCalledWith(42, '10', 25);
    expect(el().querySelectorAll('[data-event-id]').length).toBe(2);
    expect(el().querySelector('[data-more]')).toBeNull();
  });

  it('reloads when the refresh input changes', async () => {
    await create();
    fixture.componentRef.setInput('refresh', 1);
    await settle(fixture);
    expect(api.getTaskActivity).toHaveBeenCalledTimes(2);
  });

  it('shows an error with retry', async () => {
    await create();
    api.getTaskActivity.mockReturnValue(apiError(500, { status: 500, title: 'x' }));
    q<HTMLButtonElement>('[data-filter=ALL]').click();
    fixture.componentRef.setInput('refresh', 2);
    await settle(fixture);
    expect(q('[data-load-error]').textContent).toContain('Something went wrong. Try again.');

    api.getTaskActivity.mockReturnValue(
      ok({ items: [first], nextCursor: undefined, canViewChanges: true }),
    );
    q<HTMLButtonElement>('[data-load-error] button').click();
    await settle(fixture);
    expect(el().querySelectorAll('[data-event-id]').length).toBe(1);
  });

  it('shows the empty state', async () => {
    await create({ items: [], nextCursor: undefined, canViewChanges: false });
    expect(q('[data-empty]').textContent).toContain('No activity recorded yet.');
  });
});
