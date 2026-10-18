import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskActivityClient, TaskActivityItem } from '../../../api/generated/api-client';
import { QuietRequests } from '../../../core/http/interceptors';
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

  it('shows dates as Oct 15, 2026 in the sentence and in View changes (BUG-5)', async () => {
    await create({
      items: [
        anActivity({
          eventId: 20,
          category: 'FIELDS',
          fieldKey: 'dueDate',
          summary: 'Due date changed from 2026-10-15 to 2026-10-14',
          oldValue: '2026-10-15',
          newValue: '2026-10-14',
        }),
      ],
      nextCursor: undefined,
      canViewChanges: true,
    });
    expect(q('[data-summary]').textContent).toBe(
      'Due date changed from Oct 15, 2026 to Oct 14, 2026',
    );
    q<HTMLButtonElement>('[data-changes-toggle]').click();
    await settle(fixture);
    expect(q('[data-changes]').textContent).toContain('Oct 15, 2026');
    expect(q('[data-changes]').textContent).toContain('Oct 14, 2026');
    expect(q('[data-changes]').textContent).not.toContain('2026-10');
  });

  it('loads quietly: the inline message is the only one (BUG-8)', async () => {
    let quiet: boolean | null = null;
    api = {
      getTaskActivity: vi.fn().mockImplementation(() => {
        quiet = TestBed.inject(QuietRequests).active;
        return ok({ items: [first], nextCursor: '10', canViewChanges: true });
      }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: TaskActivityClient, useValue: api }] });
    fixture = TestBed.createComponent(TaskActivity);
    fixture.componentRef.setInput('taskId', 42);
    await settle(fixture);
    expect(quiet).toBe(true);
    quiet = null;
    q<HTMLButtonElement>('[data-more]').click();
    await settle(fixture);
    expect(quiet).toBe(true);
  });

  it('a failed Load more shows one message under the list and the button tries again', async () => {
    await create({ items: [first], nextCursor: '10', canViewChanges: true });
    api.getTaskActivity.mockReturnValue(apiError(500, { status: 500, title: 'x' }));
    q<HTMLButtonElement>('[data-more]').click();
    await settle(fixture);
    expect(el().querySelectorAll('[data-more-error]')).toHaveLength(1);
    expect(el().querySelectorAll('[data-event-id]')).toHaveLength(1); // the loaded rows stay
    expect(q('[data-more]')).not.toBeNull();

    api.getTaskActivity.mockReturnValue(
      ok({ items: [second], nextCursor: undefined, canViewChanges: true }),
    );
    q<HTMLButtonElement>('[data-more]').click();
    await settle(fixture);
    expect(el().querySelector('[data-more-error]')).toBeNull();
    expect(el().querySelectorAll('[data-event-id]')).toHaveLength(2);
  });

  describe('comment excerpts and folding', () => {
    const comment = (id: number, minutes: number, overrides: Partial<TaskActivityItem> = {}) =>
      anActivity({
        eventId: id,
        eventType: 'COMMENT_ADDED',
        category: 'COMMENTS',
        summary: 'Comment added',
        oldValue: undefined,
        newValue: undefined,
        occurredAtUtc: new Date(Date.UTC(2026, 9, 13, 16, minutes)).toISOString(),
        commentId: id * 10,
        excerpt: `Excerpt of ${id}`,
        ...overrides,
      });
    const page = (items: TaskActivityItem[]) => ({
      items,
      nextCursor: undefined as string | undefined,
      canViewChanges: true,
    });

    it('shows the excerpt as a link that reports the comment id', async () => {
      await create(page([comment(5, 0)]));
      const link = q<HTMLButtonElement>('[data-comment-link]');
      expect(link.textContent).toContain('Excerpt of 5');
      const ids: number[] = [];
      fixture.componentInstance.showComment.subscribe((id) => ids.push(id));
      link.click();
      expect(ids).toEqual([50]);
    });

    it('shows no link without an excerpt (deleted comment) or for other events', async () => {
      await create(page([comment(5, 0, { excerpt: undefined }), anActivity({ eventId: 4 })]));
      expect(el().querySelector('[data-comment-link]')).toBeNull();
      expect(el().querySelectorAll('[data-event-id]').length).toBe(2);
    });

    it('folds a run of 3 or more into one row with an expand control, and unfolds it on request', async () => {
      const run = [comment(4, 5), comment(3, 3), comment(2, 1)];
      await create(page([anActivity({ eventId: 9 }), ...run, anActivity({ eventId: 1 })]));

      const rows = Array.from(el().querySelectorAll('.ta__list > li'));
      expect(rows.length).toBe(3);
      const group = q('[data-group-key]');
      expect(group.querySelector('[data-actor]')?.textContent).toBe('Dana P.');
      expect(group.querySelector('[data-group-summary]')?.textContent).toMatch(
        /^added 3 comments \(.+\)$/,
      );
      expect(el().querySelector('[data-event-id="3"]')).toBeNull();
      const toggle = group.querySelector<HTMLButtonElement>('[data-group-toggle]')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      toggle.click();
      await settle(fixture);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.textContent).toContain('Hide comments');
      expect(
        Array.from(group.querySelectorAll('[data-event-id]')).map((e) =>
          e.getAttribute('data-event-id'),
        ),
      ).toEqual(['4', '3', '2']);
      expect(group.querySelectorAll('[data-comment-link]').length).toBe(3);

      toggle.click();
      await settle(fixture);
      expect(group.querySelector('[data-group-items]')).toBeNull();
    });

    it('keeps two comments as separate rows', async () => {
      await create(page([comment(3, 3), comment(2, 1)]));
      expect(el().querySelector('[data-group-key]')).toBeNull();
      expect(el().querySelectorAll('[data-comment-link]').length).toBe(2);
    });

    it('keeps the group closed or open across Load more', async () => {
      await create({ ...page([comment(8, 8), comment(7, 6), comment(6, 4)]), nextCursor: 'c1' });
      q<HTMLButtonElement>('[data-group-toggle]').click();
      await settle(fixture);
      api.getTaskActivity.mockReturnValue(
        ok(page([comment(5, 2), comment(4, 0), anActivity({ eventId: 1 })])),
      );
      q<HTMLButtonElement>('[data-more]').click();
      await settle(fixture);
      expect(q('[data-group-toggle]').textContent).toContain('Hide comments');
      expect(q('[data-group-summary]').textContent).toContain('added 5 comments');
    });
  });
});
