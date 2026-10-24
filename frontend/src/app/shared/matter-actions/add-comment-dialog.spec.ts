import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TaskCommentsClient, TaskQueueClient } from '../../api/generated/api-client';
import { NotificationService } from '../../core/notify/notification.service';
import { AddCommentDialog } from './add-comment-dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AddCommentDialog],
  template: `<mf-add-comment-dialog
    [matterId]="7"
    matterLabel="90001-80001 Merger"
    [(visible)]="open"
    (posted)="posted.push($event)"
  />`,
})
class Host {
  readonly open = signal(true);
  readonly posted: number[] = [];
}

const row = (taskId: number, title: string) => ({ taskId, taskNumber: `TSK-${taskId}`, title });

describe('AddCommentDialog (Add comment from a matter, epic #758)', () => {
  let queue: { getTaskQueue: ReturnType<typeof vi.fn> };
  let comments: { addTaskComment: ReturnType<typeof vi.fn> };
  let notify: { success: ReturnType<typeof vi.fn> };

  async function create() {
    queue = {
      getTaskQueue: vi
        .fn()
        .mockReturnValue(of({ items: [row(11, 'Review batch 4'), row(12, 'Privilege log')] })),
    };
    comments = { addTaskComment: vi.fn().mockReturnValue(of({})) };
    notify = { success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: TaskQueueClient, useValue: queue },
        { provide: TaskCommentsClient, useValue: comments },
        { provide: NotificationService, useValue: notify },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const body = () => document.body;
  const confirmButton = () =>
    Array.from(body().querySelectorAll<HTMLButtonElement>('p-dialog button')).find(
      (b) => b.textContent?.trim() === 'Add comment',
    )!;

  afterEach(() => document.body.replaceChildren());

  it("lists the matter's open tasks (only open statuses, only this matter) when it opens", async () => {
    await create();
    const args = queue.getTaskQueue.mock.calls[0];
    expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']);
    expect(args[10]).toBe(7);
    expect(
      Array.from(body().querySelectorAll('[data-task-list] label')).map((l) =>
        l.textContent?.trim(),
      ),
    ).toEqual(['TSK-11 Review batch 4', 'TSK-12 Privilege log']);
    expect(body().querySelector('[data-note]')!.textContent).toContain('90001-80001 Merger');
  });

  it('posts plain text as paragraphs to the chosen task through the task comment API, then says so and closes', async () => {
    const f = await create();
    body().querySelectorAll<HTMLInputElement>('[data-task-list] input')[1].click();
    const text = body().querySelector<HTMLTextAreaElement>('[data-comment-text]')!;
    text.value = 'Called the client.\n\nWaiting for <b>batch 5</b>.';
    text.dispatchEvent(new Event('input'));
    f.detectChanges();
    confirmButton().click();
    await f.whenStable();
    expect(comments.addTaskComment).toHaveBeenCalledWith(12, {
      bodyHtml: '<p>Called the client.</p><p>Waiting for &lt;b&gt;batch 5&lt;/b&gt;.</p>',
    });
    expect(notify.success).toHaveBeenCalledWith('Comment posted.');
    expect(f.componentInstance.posted).toEqual([12]);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('does not post without a task and a text, and says what is missing', async () => {
    const f = await create();
    confirmButton().click();
    f.detectChanges();
    expect(comments.addTaskComment).not.toHaveBeenCalled();
    expect(body().querySelector('[data-need]')!.textContent).toContain('Choose a task.');
    expect(f.componentInstance.open()).toBe(true);
  });

  it('keeps the typed text and stays open when the post fails', async () => {
    const f = await create();
    comments.addTaskComment.mockReturnValue(throwError(() => new Error('boom')));
    body().querySelectorAll<HTMLInputElement>('[data-task-list] input')[0].click();
    const text = body().querySelector<HTMLTextAreaElement>('[data-comment-text]')!;
    text.value = 'Keep me';
    text.dispatchEvent(new Event('input'));
    f.detectChanges();
    confirmButton().click();
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    expect(body().querySelector<HTMLTextAreaElement>('[data-comment-text]')!.value).toBe('Keep me');
    expect(body().querySelector('[data-confirm-error]')).not.toBeNull();
  });

  it('says so when the matter has no open task', async () => {
    queue = { getTaskQueue: vi.fn().mockReturnValue(of({ items: [] })) };
    TestBed.configureTestingModule({
      providers: [
        { provide: TaskQueueClient, useValue: queue },
        { provide: TaskCommentsClient, useValue: { addTaskComment: vi.fn() } },
        { provide: NotificationService, useValue: { success: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(body().querySelector('[data-no-tasks]')!.textContent).toContain(
      'This matter has no open tasks.',
    );
  });
});
