import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { TaskCommentsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { aComment } from './task-panels-testing';
import { COMMENT_LIMIT_DEFAULT, TaskComments, commentLimitKey } from './task-comments';

describe('TaskComments', () => {
  let api: {
    listTaskComments: ReturnType<typeof vi.fn>;
    addTaskComment: ReturnType<typeof vi.fn>;
    editTaskComment: ReturnType<typeof vi.fn>;
    deleteTaskComment: ReturnType<typeof vi.fn>;
    listTaskCommentRevisions: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<TaskComments>;
  /** When set, the signed-in user's last visit to Task 42 is stored at this time before the component opens. */
  let seeded: string | null = null;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(selector: string): T => el().querySelector<T>(selector)!;
  /** Picks an option of the single "Sort comments" dropdown. */
  const setOrder = (order: 'oldest' | 'newest'): void => {
    const select = q<HTMLSelectElement>('[data-order-select]');
    select.value = order;
    select.dispatchEvent(new Event('change'));
  };

  /** Picks an option of the "Show latest" select. */
  const setLimit = (limit: '3' | '5' | '10' | 'all'): void => {
    const select = q<HTMLSelectElement>('[data-limit-select]');
    select.value = limit;
    select.dispatchEvent(new Event('change'));
  };
  /** The ids on screen, in screen order. */
  const shownIds = (): number[] =>
    Array.from(el().querySelectorAll('[data-comment-id]')).map((e) =>
      Number(e.getAttribute('data-comment-id')),
    );
  /** Asks the component to load again (the host changes `refresh` when the Task changes). */
  async function reloadFromServer(): Promise<void> {
    fixture.componentRef.setInput('refresh', 'RV-' + Math.random());
    await settle(fixture);
  }

  async function create(
    comments = [aComment()],
    permissions: Permission[] = ['Task.View', 'Task.Comment'],
    inputs: Record<string, unknown> = {},
  ): Promise<void> {
    api = {
      listTaskComments: vi.fn().mockReturnValue(ok({ items: comments, total: comments.length })),
      addTaskComment: vi.fn().mockReturnValue(ok(aComment({ commentId: 2 }))),
      editTaskComment: vi.fn().mockReturnValue(ok(aComment({ isEdited: true }))),
      deleteTaskComment: vi.fn().mockReturnValue(ok(undefined)),
      listTaskCommentRevisions: vi.fn().mockReturnValue(
        ok({
          items: [
            {
              revisionId: 1,
              bodyHtml: '<p>The first version</p>',
              reason: 'EDIT',
              revisedAtUtc: '2026-10-13T15:00:00Z',
              revisedBy: undefined,
            },
          ],
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: TaskCommentsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    if (seeded) {
      const user = TestBed.inject(AuthStore).profile()?.userId;
      localStorage.setItem(`mf.task-detail.comments.seen.${user}.42`, String(Date.parse(seeded)));
    }
    fixture = TestBed.createComponent(TaskComments);
    fixture.componentRef.setInput('taskId', 42);
    for (const [name, value] of Object.entries({ open: true, ...inputs }))
      fixture.componentRef.setInput(name, value);
    await settle(fixture);
  }

  /** The one-line composer turns into the editor when it gets focus. */
  async function expandComposer(): Promise<void> {
    q('[data-composer-quick]').dispatchEvent(new Event('focus'));
    await settle(fixture);
  }

  async function typeComment(
    html: string,
    selector = '[data-composer] [role=textbox]',
  ): Promise<void> {
    if (selector.startsWith('[data-composer]') && !el().querySelector(selector + '.rte__area')) {
      await expandComposer();
    }
    const area = q(selector);
    area.innerHTML = html;
    area.dispatchEvent(new Event('input'));
  }

  beforeEach(() => {
    seeded = null;
    localStorage.clear();
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, 'queryCommandState', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
      writable: true,
    });
  });

  it('lists the comments with author, time and rendered rich text, and the count', async () => {
    await create([aComment(), aComment({ commentId: 2, bodyHtml: '<ul><li>one</li></ul>' })]);

    expect(q('h2').textContent).toContain('Comments (2)');
    const items = el().querySelectorAll('[data-comment-id]');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.tc__author')?.textContent).toBe('Dana P.');
    expect(items[0].querySelector('time')?.getAttribute('datetime')).toBe('2026-10-13T14:25:00Z');
    expect(items[0].querySelector('time')?.getAttribute('title')).toContain('(UTC)');
    expect(items[0].querySelector('[data-body] strong')?.textContent).toBe('approved');
    expect(items[1].querySelector('[data-body] li')?.textContent).toBe('one');
    // Always newest first: the latest comments are in the first page, the order inside the window is applied on screen.
    expect(api.listTaskComments).toHaveBeenCalledWith(42, true);
  });

  it('reloads quietly when the host changes `refresh` (a status change adds its reason as a comment)', async () => {
    await create([aComment()]);
    const calls = api.listTaskComments.mock.calls.length;
    api.listTaskComments.mockReturnValue(
      ok({ items: [aComment(), aComment({ commentId: 2 })], total: 2 }),
    );
    fixture.componentRef.setInput('refresh', 'RV2');
    await settle(fixture);
    expect(api.listTaskComments.mock.calls.length).toBeGreaterThan(calls);
    expect(el().querySelectorAll('[data-comment-id]').length).toBe(2);
  });

  it('has one sort dropdown (oldest/newest first) instead of two buttons', async () => {
    await create([aComment()]);
    const select = q<HTMLSelectElement>('[data-order-select]');
    expect(select.getAttribute('aria-label')).toBe('Sort comments');
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
      'Oldest first',
      'Newest first',
    ]);
    expect(el().querySelector('button[data-order]')).toBeNull();
  });

  it('filters the loaded comments by author and text from the search box', async () => {
    await create([
      aComment({ commentId: 1, bodyHtml: '<p>Run the <strong>dedupe</strong> first</p>' }),
      aComment({ commentId: 2, bodyHtml: '<p>Vendor confirmed delivery</p>' }),
    ]);
    const input = q<HTMLInputElement>('#tc-search');
    expect(input).not.toBeNull();
    input.value = 'DEDUPE';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 400));
    await settle(fixture);
    expect(el().querySelectorAll('[data-comment-id]').length).toBe(1);
    expect(q('[data-match-count]').textContent).toContain('1 of 2');

    input.value = 'nothing like this';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 400));
    await settle(fixture);
    expect(el().querySelectorAll('[data-comment-id]').length).toBe(0);
    expect(q('[data-no-match]').textContent).toContain('No comments match');

    el().querySelector<HTMLButtonElement>('[data-no-match] button')!.click();
    await settle(fixture);
    expect(el().querySelectorAll('[data-comment-id]').length).toBe(2);
  });

  it('reports the number of comments to the host', async () => {
    api = undefined as never;
    const counts: number[] = [];
    TestBed.resetTestingModule();
    await create([aComment(), aComment({ commentId: 2 })]);
    fixture.componentInstance.countChange.subscribe((n) => counts.push(n));
    await reloadFromServer();
    expect(counts).toEqual([2]);
    expect(api.listTaskComments).toHaveBeenLastCalledWith(42, true);
  });

  it('shows the empty state, the internal-only note and the privilege reminder', async () => {
    await create([]);
    await expandComposer();

    expect(q('[data-empty]').textContent).toBe('No comments yet.');
    expect(q('[data-internal-note]').textContent).toContain(
      'Internal only. Visible to people who can view tasks.',
    );
    expect(q('[data-privilege-note]').textContent).toContain('Privilege reminder');
  });

  it('renders only safe markup even if the body were hostile (Angular sanitizer)', async () => {
    await create([
      aComment({
        bodyHtml:
          '<p onclick="x()">hi</p><script>window.__pwned=1</script><img src=x onerror="window.__pwned=1"><a href="javascript:alert(1)">bad</a>',
      }),
    ]);
    const body = q('[data-body]');

    expect(body.innerHTML).not.toContain('<script');
    expect(body.innerHTML).not.toContain('onclick');
    expect(body.innerHTML).not.toContain('onerror');
    // Angular neutralizes the scheme ("unsafe:javascript:...") so the link can't run anything.
    expect(body.querySelector('a')?.getAttribute('href')).toMatch(/^unsafe:/);
    expect(body.textContent).toContain('hi');
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('opens links in a new tab without opener access', async () => {
    await create([
      aComment({
        bodyHtml: '<p><a href="https://example.com" rel="noopener noreferrer">x</a></p>',
      }),
    ]);
    const link = q<HTMLAnchorElement>('[data-body] a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('tags Cancel and On Hold reasons and offers no delete for them', async () => {
    await create([
      aComment({
        commentId: 3,
        purpose: 'CANCEL',
        purposeLabel: 'Cancellation reason',
        canDelete: false,
      }),
      aComment({
        commentId: 4,
        purpose: 'ON_HOLD',
        purposeLabel: 'On hold reason',
        canDelete: false,
      }),
    ]);

    const tags = Array.from(el().querySelectorAll('[data-purpose]')).map((t) => t.textContent);
    expect(tags).toEqual(['Cancellation reason', 'On hold reason']);
    expect(el().querySelector('[data-delete]')).toBeNull();
    expect(el().querySelectorAll('[data-edit]').length).toBe(2);
  });

  it('shows edit and delete only for the own comments the API allows', async () => {
    await create([aComment(), aComment({ commentId: 2, canEdit: false, canDelete: false })]);
    const items = el().querySelectorAll('[data-comment-id]');

    expect(items[0].querySelector('[data-edit]')).not.toBeNull();
    expect(items[0].querySelector('[data-delete]')).not.toBeNull();
    // The buttons sit on the author line (right end), not in a row under the text.
    expect(items[0].querySelector('.tc__meta [data-edit]')).not.toBeNull();
    expect(items[0].querySelector('.tc__meta [data-delete]')).not.toBeNull();
    // Icon-only buttons: they have no visible text, so the accessible name carries it.
    expect(items[0].querySelector('[data-edit]')!.getAttribute('aria-label')).toBe('Edit comment');
    expect(items[0].querySelector('[data-delete]')!.getAttribute('aria-label')).toBe(
      'Delete comment',
    );
    expect(items[0].querySelector('[data-edit]')!.textContent!.trim()).toBe('');
    expect(items[1].querySelector('[data-edit]')).toBeNull();
    expect(items[1].querySelector('[data-delete]')).toBeNull();
  });

  it('posts a comment, clears the composer and tells the host', async () => {
    await create([]);
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    await typeComment('<p>New <b>note</b></p>');
    await settle(fixture);
    q<HTMLButtonElement>('[data-post]').click();
    await settle(fixture);

    expect(api.addTaskComment).toHaveBeenCalledWith(42, { bodyHtml: '<p>New <b>note</b></p>' });
    // The composer is one line again; opening it shows an empty editor.
    expect(el().querySelector('[data-composer] .rte__area')).toBeNull();
    await expandComposer();
    expect(q('[data-composer] [role=textbox]').innerHTML).toBe('');
    expect(api.listTaskComments).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed text and shows the error when posting fails', async () => {
    await create([]);
    api.addTaskComment.mockReturnValue(
      apiError(400, {
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'Write a comment before posting.',
      }),
    );

    await typeComment('<p>Keep me</p>');
    await settle(fixture);
    q<HTMLButtonElement>('[data-post]').click();
    await settle(fixture);

    expect(q('[data-post-error]').textContent).toContain('Write a comment before posting.');
    expect(q('[data-composer] [role=textbox]').innerHTML).toBe('<p>Keep me</p>');
  });

  it('does not post an empty comment', async () => {
    await create([]);
    await expandComposer();
    expect(q<HTMLButtonElement>('[data-post]').disabled).toBe(true);
    await typeComment('<p><br></p>');
    await settle(fixture);
    expect(q<HTMLButtonElement>('[data-post]').disabled).toBe(true);
  });

  it('hides the composer without Task.Comment and when read-only, but keeps the thread', async () => {
    await create([aComment()], ['Task.View']);
    expect(el().querySelector('[data-composer]')).toBeNull();
    expect(el().querySelector('[data-comment-id]')).not.toBeNull();
    expect(q('[data-internal-note]')).not.toBeNull();

    TestBed.resetTestingModule();
    await create([aComment()], ['Task.View', 'Task.Comment'], { readOnly: true });
    expect(el().querySelector('[data-composer]')).toBeNull();
    expect(el().querySelector('[data-edit]')).toBeNull();
    expect(el().querySelector('[data-delete]')).toBeNull();
  });

  it('edits a comment with its row version', async () => {
    await create();
    q<HTMLButtonElement>('[data-edit]').click();
    await settle(fixture);
    const area = q('[data-edit-form] [role=textbox]');
    expect(area.innerHTML).toContain('approved');

    await typeComment('<p>Approved by A. Lee</p>', '[data-edit-form] [role=textbox]');
    await settle(fixture);
    q<HTMLButtonElement>('[data-save-edit]').click();
    await settle(fixture);

    expect(api.editTaskComment).toHaveBeenCalledWith(42, 1, {
      bodyHtml: '<p>Approved by A. Lee</p>',
      rowVersion: 'AAAA',
    });
    expect(el().querySelector('[data-edit-form]')).toBeNull();
  });

  it('explains a conflicting edit and keeps the editor open', async () => {
    await create();
    api.editTaskComment.mockReturnValue(
      apiError(409, { status: 409, code: 'CONCURRENCY_CONFLICT', detail: 'changed' }),
    );
    q<HTMLButtonElement>('[data-edit]').click();
    await settle(fixture);
    await typeComment('<p>Mine</p>', '[data-edit-form] [role=textbox]');
    await settle(fixture);
    q<HTMLButtonElement>('[data-save-edit]').click();
    await settle(fixture);

    expect(q('[data-edit-error]').textContent).toContain('Someone else changed this comment');
    expect(el().querySelector('[data-edit-form]')).not.toBeNull();
  });

  it('cancels an edit without calling the API', async () => {
    await create();
    q<HTMLButtonElement>('[data-edit]').click();
    await settle(fixture);
    q<HTMLButtonElement>('[data-cancel-edit]').click();
    await settle(fixture);
    expect(api.editTaskComment).not.toHaveBeenCalled();
    expect(el().querySelector('[data-edit-form]')).toBeNull();
  });

  it('confirms before deleting and the comment simply disappears', async () => {
    await create();
    q<HTMLButtonElement>('[data-delete]').click();
    await settle(fixture);

    const dialog = document.body.querySelector('p-dialog') as HTMLElement;
    expect(dialog.textContent).toContain(
      'Delete this comment? It will be hidden from view but kept in the audit record.',
    );
    expect(api.deleteTaskComment).not.toHaveBeenCalled();

    api.listTaskComments.mockReturnValue(ok({ items: [], total: 0 }));
    buttonByLabel(dialog, 'Delete comment')!.click();
    await settle(fixture);

    expect(api.deleteTaskComment).toHaveBeenCalledWith(42, 1);
    expect(el().querySelector('[data-comment-id]')).toBeNull();
    expect(q('[data-empty]')).not.toBeNull();
  });

  it('keeps the comment when the delete dialog is dismissed', async () => {
    await create();
    q<HTMLButtonElement>('[data-delete]').click();
    await settle(fixture);
    buttonByLabel(document.body.querySelector('p-dialog') as HTMLElement, 'Keep comment')!.click();
    await settle(fixture);
    expect(api.deleteTaskComment).not.toHaveBeenCalled();
    expect(el().querySelector('[data-comment-id]')).not.toBeNull();
  });

  it('marks an edited comment and shows the earlier versions on request', async () => {
    await create([aComment({ isEdited: true, editedAtUtc: '2026-10-13T15:00:00Z' })]);

    expect(q('[data-edited]').textContent).toContain('Edited');
    expect(el().querySelector('[data-history]')).toBeNull();
    q<HTMLButtonElement>('[data-history-toggle]').click();
    await settle(fixture);

    expect(api.listTaskCommentRevisions).toHaveBeenCalledWith(42, 1);
    expect(q('[data-history]').textContent).toContain('The first version');
    q<HTMLButtonElement>('[data-history-toggle]').click();
    await settle(fixture);
    expect(el().querySelector('[data-history]')).toBeNull();
  });

  it('offers a retry when loading fails', async () => {
    await create();
    api.listTaskComments.mockReturnValue(apiError(500, { status: 500, title: 'x' }));
    await reloadFromServer();
    expect(q('[data-load-error]').textContent).toContain('Something went wrong. Try again.');

    api.listTaskComments.mockReturnValue(ok({ items: [aComment()], total: 1 }));
    q<HTMLButtonElement>('[data-load-error] button').click();
    await settle(fixture);
    expect(el().querySelector('[data-comment-id]')).not.toBeNull();
  });

  describe('Show latest (3 / 5 / 10 / All)', () => {
    /** Twelve comments, id n written n hours into the day (id 12 is the most recent). */
    const twelve = () =>
      Array.from({ length: 12 }, (_, i) =>
        aComment({
          commentId: i + 1,
          bodyHtml: `<p>Note number ${i + 1}</p>`,
          createdAtUtc: `2026-10-13T${String(i + 1).padStart(2, '0')}:00:00Z`,
        }),
      );

    it('shows only the 3 most recent comments by default, with a count line and a Show all link', async () => {
      await create(twelve());

      expect(q('h2').textContent).toContain('Comments (12)');
      expect(shownIds()).toEqual([10, 11, 12]);
      expect(q<HTMLSelectElement>('[data-limit-select]').value).toBe('3');
      expect(q('[data-limit-note]').textContent).toContain('Showing the latest 3 of 12 comments.');
      expect(q('[data-show-all]').textContent).toContain('Show all');
      expect(el().querySelector('.tc__show')?.textContent).toContain('Show latest');
    });

    it('offers 3, 5, 10 and All, and shows the most recent N for each', async () => {
      await create(twelve());
      const select = q<HTMLSelectElement>('[data-limit-select]');
      expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
        '3',
        '5',
        '10',
        'All',
      ]);

      setLimit('5');
      await settle(fixture);
      expect(shownIds()).toEqual([8, 9, 10, 11, 12]);
      expect(q('[data-limit-note]').textContent).toContain('Showing the latest 5 of 12');

      setLimit('10');
      await settle(fixture);
      expect(shownIds()).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

      setLimit('all');
      await settle(fixture);
      expect(shownIds().length).toBe(12);
      expect(el().querySelector('[data-limit-note]')).toBeNull();
    });

    it('takes the most recent N by date, then lets the sort order order them inside that window', async () => {
      // The ids do not follow the dates: id 1 is the newest comment.
      const mixed = [
        aComment({ commentId: 1, createdAtUtc: '2026-10-14T09:00:00Z' }),
        aComment({ commentId: 2, createdAtUtc: '2026-10-13T09:00:00Z' }),
        aComment({ commentId: 3, createdAtUtc: '2026-10-12T09:00:00Z' }),
        aComment({ commentId: 4, createdAtUtc: '2026-10-11T09:00:00Z' }),
        aComment({ commentId: 5, createdAtUtc: '2026-10-10T09:00:00Z' }),
      ];
      await create(mixed);
      expect(shownIds()).toEqual([3, 2, 1]); // oldest first inside the window of the latest three

      setOrder('newest');
      await settle(fixture);
      expect(shownIds()).toEqual([1, 2, 3]);
      setLimit('5');
      await settle(fixture);
      expect(shownIds()).toEqual([1, 2, 3, 4, 5]);
    });

    it('lets Show all (the link) show every comment and updates the select', async () => {
      await create(twelve());
      q<HTMLButtonElement>('[data-show-all]').click();
      await settle(fixture);
      expect(shownIds().length).toBe(12);
      expect(q<HTMLSelectElement>('[data-limit-select]').value).toBe('all');
    });

    it('does not show the count line when the whole thread fits the window', async () => {
      await create(twelve().slice(0, 3));
      expect(shownIds().length).toBe(3);
      expect(el().querySelector('[data-limit-note]')).toBeNull();
    });

    it('searches ALL loaded comments whatever the limit and shows the match count', async () => {
      await create(twelve());
      expect(shownIds()).toEqual([10, 11, 12]);
      const input = q<HTMLInputElement>('#tc-search');
      input.value = 'number 2';
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 400));
      await settle(fixture);

      expect(shownIds()).toEqual([2]); // outside the latest three
      expect(q('[data-match-count]').textContent).toContain('1 of 12 comments match');
      expect(el().querySelector('[data-limit-note]')).toBeNull();

      input.value = '';
      input.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 400));
      await settle(fixture);
      expect(shownIds()).toEqual([10, 11, 12]);
      expect(q('[data-limit-note]')).not.toBeNull();
    });

    it('counts Cancel and On Hold reasons like any other comment', async () => {
      const list = twelve();
      list[11] = aComment({
        commentId: 12,
        purpose: 'ON_HOLD',
        purposeLabel: 'On hold reason',
        canDelete: false,
        createdAtUtc: '2026-10-13T12:00:00Z',
      });
      await create(list);
      expect(shownIds()).toEqual([10, 11, 12]);
      expect(el().querySelectorAll('[data-purpose]').length).toBe(1);
      expect(q('[data-limit-note]').textContent).toContain('3 of 12');
    });

    it('keeps a newly posted comment visible: it is the latest', async () => {
      await create(twelve());
      const added = aComment({
        commentId: 13,
        bodyHtml: '<p>Fresh note</p>',
        createdAtUtc: '2026-10-14T08:00:00Z',
      });
      api.listTaskComments.mockReturnValue(ok({ items: [...twelve(), added], total: 13 }));
      await typeComment('<p>Fresh note</p>');
      await settle(fixture);
      q<HTMLButtonElement>('[data-post]').click();
      await settle(fixture);

      expect(shownIds()).toEqual([11, 12, 13]);
      expect(q('[data-limit-note]').textContent).toContain('Showing the latest 3 of 13');
    });

    it('remembers the choice per user and restores it', async () => {
      await create(twelve());
      const key = commentLimitKey(TestBed.inject(AuthStore).profile()?.userId);
      setLimit('10');
      await settle(fixture);
      expect(localStorage.getItem(key)).toBe('10');

      fixture.destroy();
      fixture = TestBed.createComponent(TaskComments);
      fixture.componentRef.setInput('taskId', 42);
      fixture.componentRef.setInput('open', true);
      await settle(fixture);
      expect(q<HTMLSelectElement>('[data-limit-select]').value).toBe('10');
      expect(shownIds().length).toBe(10);
    });

    it('falls back to 3 when storage holds rubbish or cannot be read', async () => {
      await create(twelve());
      const key = commentLimitKey(TestBed.inject(AuthStore).profile()?.userId);
      fixture.destroy();
      localStorage.setItem(key, '7');
      fixture = TestBed.createComponent(TaskComments);
      fixture.componentRef.setInput('taskId', 42);
      fixture.componentRef.setInput('open', true);
      await settle(fixture);
      expect(q<HTMLSelectElement>('[data-limit-select]').value).toBe(String(COMMENT_LIMIT_DEFAULT));

      fixture.destroy();
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      fixture = TestBed.createComponent(TaskComments);
      fixture.componentRef.setInput('taskId', 42);
      fixture.componentRef.setInput('open', true);
      await settle(fixture);
      expect(shownIds().length).toBe(3);
      setLimit('5'); // still works for this view
      await settle(fixture);
      expect(shownIds().length).toBe(5);
      spy.mockRestore();
      setSpy.mockRestore();
    });

    it('marks every comment body as rich text so tables scroll inside their own box (mf-rich)', async () => {
      await create([
        aComment({
          bodyHtml:
            '<table><tbody><tr><th>Custodian</th><th>Volume</th></tr><tr><td>Anna</td><td>14 GB</td></tr></tbody></table>',
        }),
      ]);
      const body = q('[data-body]');
      expect(body.classList).toContain('mf-rich');
      expect(body.querySelector('table')).not.toBeNull();
    });

    it('puts the thread in its own labelled, focusable scroll region', async () => {
      await create(twelve());
      const region = q('[data-comments-scroll]');
      expect(region.getAttribute('role')).toBe('region');
      expect(region.getAttribute('tabindex')).toBe('0');
      expect(region.getAttribute('aria-label')).toBe('Comment thread, scrollable');
    });
  });

  describe('long threads (SEC2-10)', () => {
    const PAGE = 20;
    const thread = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => aComment({ commentId: from + i }));

    /** A fake server whose pages hold at most 20 comments (the real one 200): skip and take cut the thread of `total` comments. */
    function serve(total: number): void {
      api.listTaskComments.mockImplementation((_id: number, _newest?: boolean, skip = 0) =>
        ok({ items: thread(skip + 1, Math.max(0, Math.min(PAGE, total - skip))), total }),
      );
    }

    const shown = (): number => el().querySelectorAll('[data-comment-id]').length;

    it('shows how many of the comments are on screen and loads the next page on request', async () => {
      await create([]);
      serve(50);
      setLimit('all');
      await reloadFromServer();

      expect(q('h2').textContent).toContain('Comments (50)');
      expect(shown()).toBe(20);
      expect(q('[data-more-note]').textContent).toContain('Showing 20 of 50 comments.');
      expect(api.listTaskComments).toHaveBeenLastCalledWith(42, true);

      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(api.listTaskComments).toHaveBeenLastCalledWith(42, true, 20, 200);
      expect(shown()).toBe(40);
      expect(q('[data-more-note]').textContent).toContain('Showing 40 of 50 comments.');

      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(shown()).toBe(50);
      expect(el().querySelector('[data-more]')).toBeNull();
      const ids = Array.from(el().querySelectorAll('[data-comment-id]')).map((e) =>
        e.getAttribute('data-comment-id'),
      );
      expect(new Set(ids).size).toBe(50);
    });

    it('offers no button when the whole thread fits the first page', async () => {
      await create([aComment(), aComment({ commentId: 2 })]);
      expect(el().querySelector('[data-more]')).toBeNull();
      expect(q('h2').textContent).toContain('Comments (2)');
    });

    it('reports the total to the host and keeps the loaded part after posting a comment', async () => {
      await create([]);
      serve(50);
      setLimit('all');
      await reloadFromServer();
      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(shown()).toBe(40);

      const counts: number[] = [];
      fixture.componentInstance.countChange.subscribe((n) => counts.push(n));
      serve(51);
      await typeComment('<p>One more</p>');
      await settle(fixture);
      q<HTMLButtonElement>('[data-post]').click();
      await settle(fixture);

      expect(shown()).toBe(40);
      expect(counts).toEqual([51]);
      expect(q('[data-more-note]').textContent).toContain('Showing 40 of 51 comments.');
    });

    it('reorders what is loaded without asking the server again when the order changes', async () => {
      await create([]);
      serve(50);
      setLimit('all');
      await reloadFromServer();
      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(shown()).toBe(40);
      const calls = api.listTaskComments.mock.calls.length;

      setOrder('newest');
      await settle(fixture);
      expect(shown()).toBe(40);
      expect(api.listTaskComments.mock.calls.length).toBe(calls);
    });

    it('with a Show latest limit the latest comments are on screen even when the thread is longer than a page', async () => {
      await create([]);
      serve(50);
      await reloadFromServer();
      expect(shown()).toBe(3);
      expect(q('[data-limit-note]').textContent).toContain('Showing the latest 3 of 50 comments.');
      expect(el().querySelector('[data-more]')).toBeNull();
    });

    it('keeps what is shown and offers to try again when the next page fails', async () => {
      await create([]);
      serve(50);
      setLimit('all');
      await reloadFromServer();

      api.listTaskComments.mockReturnValue(apiError(500, { status: 500, title: 'x' }));
      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(q('[data-more-error]').textContent).toContain(
        "Couldn't load more comments. Try again.",
      );
      expect(shown()).toBe(20);

      serve(50);
      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(shown()).toBe(40);
      expect(el().querySelector('[data-more-error]')).toBeNull();
    });
  });

  describe('links (SEC2-12)', () => {
    it('shows the real host next to a link and opens it in a new tab', async () => {
      await create([
        aComment({
          bodyHtml: '<p>See <a href="https://docs.example.com:8443/a/b?x=1">the memo</a>.</p>',
        }),
      ]);

      const link = q<HTMLAnchorElement>('[data-body] a');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('href')).toBe('https://docs.example.com:8443/a/b?x=1');
      expect(q('[data-body] .tc__host').textContent).toBe('(docs.example.com:8443)');
      expect(el().querySelector('.tc__warn')).toBeNull();
    });

    it('marks a link whose address hides a user name, and one whose text names another site', async () => {
      await create([
        aComment({
          commentId: 1,
          bodyHtml: '<p><a href="https://google.com@evil.example/login">google.com</a></p>',
        }),
        aComment({
          commentId: 2,
          bodyHtml: '<p><a href="https://evil.example/">www.bank.com</a></p>',
        }),
      ]);

      const [first, second] = Array.from(el().querySelectorAll('[data-comment-id]'));
      expect(first.querySelector('.tc__host')?.textContent).toBe('(evil.example)');
      expect(first.querySelector('.tc__warn')?.getAttribute('title')).toContain(
        'user name or password',
      );
      expect(second.querySelector('.tc__warn')?.getAttribute('title')).toContain('different site');
      expect(second.querySelector('.tc__warn')?.getAttribute('role')).toBe('img');
    });
  });

  describe('collapsible section', () => {
    const toggle = (): HTMLButtonElement => q<HTMLButtonElement>('[data-toggle]');
    const userId = (): number | undefined => TestBed.inject(AuthStore).profile()?.userId;
    const openKey = (): string => `mf.task-detail.comments.open.${userId()}`;
    const seenKey = (): string => `mf.task-detail.comments.seen.${userId()}.42`;
    /** A comment by someone else (the signed-in user is not 5). */
    const byOther = (id: number, createdAtUtc: string, extra = {}) =>
      aComment({
        commentId: id,
        createdAtUtc,
        author: { userId: 5000, displayName: 'Ola K.', isActive: true },
        ...extra,
      });

    /** A comment by the signed-in user (the fake profile is user 1). */
    const mine = (id: number, createdAtUtc: string) =>
      aComment({
        commentId: id,
        createdAtUtc,
        author: { userId: 1, displayName: 'Me', isActive: true },
      });

    it('is a disclosure: a heading holding a full-width button with aria-expanded and aria-controls', async () => {
      await create(
        [aComment(), aComment({ commentId: 2 }), aComment({ commentId: 3 })],
        undefined,
        {
          open: false,
        },
      );

      const heading = q('h2[data-section-heading]');
      expect(heading.querySelector('button')).toBe(toggle());
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(heading.textContent).toContain('Comments (3)');
      const panel = el().querySelector('#' + toggle().getAttribute('aria-controls'))!;
      expect(panel).not.toBeNull();
      expect((panel as HTMLElement).hidden).toBe(true);
      // The list was requested on load, but the thread and the composer are not rendered.
      expect(api.listTaskComments).toHaveBeenCalledTimes(1);
      expect(el().querySelector('[data-comment-id]')).toBeNull();
      expect(el().querySelector('[data-composer]')).toBeNull();
      // The actions are beside the toggle, not inside it.
      expect(toggle().contains(q('[data-add-comment]'))).toBe(false);
    });

    it('toggles on click and remembers the choice per user', async () => {
      await create([aComment()], undefined, { open: false });
      toggle().click();
      await settle(fixture);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(fixture.componentInstance.open()).toBe(true);
      expect(el().querySelector('[data-comment-id]')).not.toBeNull();
      expect(localStorage.getItem(openKey())).toBe('1');

      toggle().click();
      await settle(fixture);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(localStorage.getItem(openKey())).toBe('0');
    });

    it('still toggles when storage is blocked', async () => {
      await create([aComment()], undefined, { open: false });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      toggle().click();
      await settle(fixture);
      expect(fixture.componentInstance.open()).toBe(true);
      vi.restoreAllMocks();
    });

    it('previews the latest comment in one line with the full text in the title', async () => {
      await create(
        [
          byOther(1, '2026-10-12T10:00:00Z', { bodyHtml: '<p>Older</p>' }),
          byOther(2, '2026-10-13T10:00:00Z', {
            bodyHtml: '<p>Sent the <b>index</b></p><p>today</p>',
          }),
        ],
        undefined,
        { open: false },
      );
      const preview = q('[data-preview]');
      expect(preview.textContent).toMatch(/^Latest: Ola K\., .+: Sent the indextoday$/);
      expect(preview.getAttribute('title')).toBe(preview.textContent);
    });

    it('says "No comments yet" when there are none', async () => {
      await create([], undefined, { open: false });
      expect(q('[data-preview]').textContent).toBe('No comments yet');
      expect(q('h2').textContent).toContain('Comments (0)');
    });

    it('has no Add comment action for a view-only user', async () => {
      await create([aComment()], ['Task.View'], { open: false });
      expect(el().querySelector('[data-add-comment]')).toBeNull();
    });

    it('Add comment opens the section and puts the cursor in the editor', async () => {
      await create([aComment()], undefined, { open: false });
      document.body.appendChild(el());
      q<HTMLButtonElement>('[data-add-comment]').click();
      await settle(fixture);
      await new Promise((r) => setTimeout(r, 10));
      expect(fixture.componentInstance.open()).toBe(true);
      expect(document.activeElement).toBe(q('[data-composer] [role=textbox]'));
      el().remove();
    });

    describe('new comments', () => {
      it('records the visit on a first visit: no cue, stays collapsed', async () => {
        await create([byOther(1, '2026-10-13T10:00:00Z')], undefined, { open: false });
        expect(el().querySelector('[data-new-badge]')).toBeNull();
        expect(fixture.componentInstance.open()).toBe(false);
        expect(Number(localStorage.getItem(seenKey()))).toBeGreaterThan(0);
      });

      it('counts comments by others after the last visit, shows "N new", opens by itself and announces once', async () => {
        // Seen on Oct 13 noon: two newer comments by others, one newer by the user themself.
        await createWithSeen('2026-10-13T12:00:00Z', [
          byOther(1, '2026-10-13T10:00:00Z'),
          byOther(2, '2026-10-13T13:00:00Z'),
          byOther(3, '2026-10-13T14:00:00Z'),
          mine(4, '2026-10-13T15:00:00Z'),
        ]);
        expect(q('[data-new-badge]').textContent).toBe('2 new');
        expect(fixture.componentInstance.open()).toBe(true);
        expect(q('[data-live]').textContent).toBe('2 new comments');
        expect(q('h2').textContent).toContain('Comments (4)');
      });

      it("does not count the user's own comments or older ones", async () => {
        await createWithSeen('2026-10-13T12:00:00Z', [
          byOther(1, '2026-10-13T10:00:00Z'),
          mine(4, '2026-10-13T15:00:00Z'),
        ]);
        expect(el().querySelector('[data-new-badge]')).toBeNull();
        expect(fixture.componentInstance.open()).toBe(false);
      });

      it('marks the comments as seen when the section is open and clears the cue when it is collapsed again', async () => {
        await createWithSeen('2026-10-13T12:00:00Z', [byOther(2, '2026-10-13T13:00:00Z')]);
        expect(q('[data-new-badge]').textContent).toBe('1 new');
        expect(Number(localStorage.getItem(seenKey()))).toBeGreaterThan(
          Date.parse('2026-10-13T13:00:00Z'),
        );
        toggle().click();
        await settle(fixture);
        expect(el().querySelector('[data-new-badge]')).toBeNull();
      });

      it('keeps at most 200 tasks of seen times', async () => {
        const { saveSeen, SEEN_CAP } = await import('./section-state');
        for (let id = 1; id <= SEEN_CAP + 5; id++) saveSeen(7, id, id);
        expect(localStorage.getItem('mf.task-detail.comments.seen.7.1')).toBeNull();
        expect(localStorage.getItem(`mf.task-detail.comments.seen.7.${SEEN_CAP + 5}`)).toBe(
          String(SEEN_CAP + 5),
        );
        const keys = Object.keys(localStorage).filter((k) =>
          k.startsWith('mf.task-detail.comments.seen.7.'),
        );
        expect(keys.length).toBe(SEEN_CAP);
      });

      /** Opens the component, collapsed, for a user whose last visit to Task 42 was at `seen`. */
      async function createWithSeen(seen: string, comments: ReturnType<typeof aComment>[]) {
        seeded = seen;
        await create(comments, undefined, { open: false });
      }
    });

    describe('composer', () => {
      it('starts as one line and becomes the editor on focus, back again when emptied and blurred', async () => {
        await create([], undefined, {});
        expect(q('[data-composer-quick]').getAttribute('placeholder')).toBe('Write a comment...');
        expect(el().querySelector('[data-composer] .rte__area')).toBeNull();
        expect(el().querySelector('[data-privilege-note]')).toBeNull();

        await expandComposer();
        expect(q('[data-composer] .rte__area')).not.toBeNull();
        expect(el().querySelector('[data-composer-quick]')).toBeNull();
        expect(q('[data-privilege-note]')).not.toBeNull();

        // Empty and focus leaves: one line again.
        q('[data-composer]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await settle(fixture);
        expect(el().querySelector('[data-composer] .rte__area')).toBeNull();
      });

      it('stays an editor while it has content', async () => {
        await create([], undefined, {});
        await typeComment('<p>Draft</p>');
        q('[data-composer]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await settle(fixture);
        expect(q('[data-composer] .rte__area')).not.toBeNull();
      });
    });
  });
});
