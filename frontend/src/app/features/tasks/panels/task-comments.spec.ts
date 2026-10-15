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
import { TaskComments } from './task-comments';

describe('TaskComments', () => {
  let api: {
    listTaskComments: ReturnType<typeof vi.fn>;
    addTaskComment: ReturnType<typeof vi.fn>;
    editTaskComment: ReturnType<typeof vi.fn>;
    deleteTaskComment: ReturnType<typeof vi.fn>;
    listTaskCommentRevisions: ReturnType<typeof vi.fn>;
  };
  let fixture: ComponentFixture<TaskComments>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(selector: string): T => el().querySelector<T>(selector)!;

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
    fixture = TestBed.createComponent(TaskComments);
    fixture.componentRef.setInput('taskId', 42);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle(fixture);
  }

  function typeComment(html: string, selector = '[data-composer] [role=textbox]'): void {
    const area = q(selector);
    area.innerHTML = html;
    area.dispatchEvent(new Event('input'));
  }

  beforeEach(() => {
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
    expect(api.listTaskComments).toHaveBeenCalledWith(42, false);
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

  it('reports the number of comments to the host', async () => {
    api = undefined as never;
    const counts: number[] = [];
    TestBed.resetTestingModule();
    await create([aComment(), aComment({ commentId: 2 })]);
    fixture.componentInstance.countChange.subscribe((n) => counts.push(n));
    el().querySelector<HTMLButtonElement>('[data-order=newest]')!.click();
    await settle(fixture);
    expect(counts).toEqual([2]);
    expect(api.listTaskComments).toHaveBeenLastCalledWith(42, true);
  });

  it('shows the empty state, the internal-only note and the privilege reminder', async () => {
    await create([]);

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

    typeComment('<p>New <b>note</b></p>');
    await settle(fixture);
    q<HTMLButtonElement>('[data-post]').click();
    await settle(fixture);

    expect(api.addTaskComment).toHaveBeenCalledWith(42, { bodyHtml: '<p>New <b>note</b></p>' });
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

    typeComment('<p>Keep me</p>');
    await settle(fixture);
    q<HTMLButtonElement>('[data-post]').click();
    await settle(fixture);

    expect(q('[data-post-error]').textContent).toContain('Write a comment before posting.');
    expect(q('[data-composer] [role=textbox]').innerHTML).toBe('<p>Keep me</p>');
  });

  it('does not post an empty comment', async () => {
    await create([]);
    expect(q<HTMLButtonElement>('[data-post]').disabled).toBe(true);
    typeComment('<p><br></p>');
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

    typeComment('<p>Approved by A. Lee</p>', '[data-edit-form] [role=textbox]');
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
    typeComment('<p>Mine</p>', '[data-edit-form] [role=textbox]');
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
    q<HTMLButtonElement>('[data-order=newest]').click();
    await settle(fixture);
    expect(q('[data-load-error]').textContent).toContain('Something went wrong. Try again.');

    api.listTaskComments.mockReturnValue(ok({ items: [aComment()], total: 1 }));
    q<HTMLButtonElement>('[data-load-error] button').click();
    await settle(fixture);
    expect(el().querySelector('[data-comment-id]')).not.toBeNull();
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
      q<HTMLButtonElement>('[data-order=newest]').click();
      await settle(fixture);

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
      q<HTMLButtonElement>('[data-order=newest]').click();
      await settle(fixture);
      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(shown()).toBe(40);

      const counts: number[] = [];
      fixture.componentInstance.countChange.subscribe((n) => counts.push(n));
      serve(51);
      typeComment('<p>One more</p>');
      await settle(fixture);
      q<HTMLButtonElement>('[data-post]').click();
      await settle(fixture);

      expect(shown()).toBe(40);
      expect(counts).toEqual([51]);
      expect(q('[data-more-note]').textContent).toContain('Showing 40 of 51 comments.');
    });

    it('starts over from the first page when the order changes', async () => {
      await create([]);
      serve(50);
      q<HTMLButtonElement>('[data-order=newest]').click();
      await settle(fixture);
      q<HTMLButtonElement>('[data-load-more]').click();
      await settle(fixture);
      expect(shown()).toBe(40);

      q<HTMLButtonElement>('[data-order=oldest]').click();
      await settle(fixture);
      expect(shown()).toBe(20);
      expect(api.listTaskComments).toHaveBeenLastCalledWith(42, false);
    });

    it('keeps what is shown and offers to try again when the next page fails', async () => {
      await create([]);
      serve(50);
      q<HTMLButtonElement>('[data-order=newest]').click();
      await settle(fixture);

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
});
