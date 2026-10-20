import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { Permission } from '../../../core/auth/permissions';
import { ApiError } from '../../../core/http/api-error';
import { settle } from '../../../shared/testing/org-testing';
import { TaskDetailStore } from './task-detail.store';
import { aTask, allowed, click, mountTaskPage, q } from './task-detail-testing';

const PERMS: Permission[] = ['Task.View', 'Task.Edit', 'Workflow.Execute'];

type Mounted = Awaited<ReturnType<typeof mountTaskPage>>;

const trigger = (el: HTMLElement) => q(el, '[data-due] [data-due-trigger]') as HTMLButtonElement;
const pop = (el: HTMLElement) => q(el, '[data-due-popover]');

async function tick(m: Mounted): Promise<void> {
  await new Promise((r) => setTimeout(r, 120));
  await settle(m.fixture);
}

async function open(m: Mounted): Promise<void> {
  await click(m.fixture, trigger(m.el));
  await tick(m);
}

async function type(m: Mounted, selector: string, value: string): Promise<void> {
  const input = q(m.el, selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur'));
  await settle(m.fixture);
}

const apiError = (status: number, code: string, errors?: Record<string, string>): ApiError =>
  new ApiError(
    status,
    code,
    'Server says no.',
    {
      code,
      errors: errors
        ? Object.fromEntries(
            Object.entries(errors).map(([k, v]) => [k, [{ code: 'X', message: v }]]),
          )
        : undefined,
    },
    new HttpErrorResponse({ status }),
  );

describe('Task page: inline Due date (#664)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('makes the Due tile a menu button for a person who may edit, plain text for the others', async () => {
    const editable = await mountTaskPage(aTask(), PERMS);
    const t = trigger(editable.el);
    expect(t.getAttribute('aria-haspopup')).toBe('true');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.getAttribute('aria-label')).toBe('ASAP, change due date of TSK-1042');
    TestBed.resetTestingModule();

    const viewOnly = await mountTaskPage(aTask({ allowedActions: allowed({ canEdit: false }) }), [
      'Task.View',
    ]);
    expect(trigger(viewOnly.el)).toBeNull();
    expect(q(viewOnly.el, '[data-due]')!.textContent).toContain('ASAP');
    TestBed.resetTestingModule();

    const closed = await mountTaskPage(
      aTask({
        status: 'COMPLETED',
        statusLabel: 'Completed',
        dueDate: '2026-10-14',
        allowedActions: allowed({ canEdit: false }),
      }),
      PERMS,
    );
    expect(trigger(closed.el)).toBeNull();
    expect(q(closed.el, '[data-due]')!.textContent).toContain('Was due');
  });

  it('opens a popover with Due date, Time, Save, Cancel and no Clear while nothing is set; Esc closes it and returns focus', async () => {
    const m = await mountTaskPage(aTask(), PERMS);
    await open(m);
    expect(trigger(m.el).getAttribute('aria-expanded')).toBe('true');
    const p = pop(m.el)!;
    expect(p.querySelector('mf-date-input input')).not.toBeNull();
    expect(p.querySelector('input[type=time]')).not.toBeNull();
    expect(p.querySelector('[data-due-save]')!.textContent).toContain('Save');
    expect(p.querySelector('[data-due-cancel]')).not.toBeNull();
    expect(p.querySelector('[data-due-clear]')).toBeNull();
    expect(p.querySelector('label[for$="-time"]')!.textContent).toMatch(/^Time \(/);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(m.fixture);
    expect(pop(m.el)).toBeNull();
    expect(document.activeElement).toBe(trigger(m.el));
    expect(trigger(m.el).getAttribute('aria-expanded')).toBe('false');
  });

  it('saves only the due fields: the other details go back as they are, the tile updates at once, it is announced and focus returns to the tile', async () => {
    const task = aTask({ requestedAtUtc: '2026-10-10T12:00:00Z', project: undefined });
    const saved = aTask({
      dueDate: '2026-10-24',
      dueTime: '17:00',
      dueAtUtc: '2026-10-24T21:00:00Z',
      isAsap: false,
      rowVersion: 'RV2',
    });
    const updateTask = vi.fn().mockReturnValue(of(saved));
    const m = await mountTaskPage(task, PERMS, { tasks: { updateTask } });
    await open(m);
    await type(m, '[data-due-popover] mf-date-input input', 'Oct 24, 2026');
    await type(m, '[data-due-popover] input[type=time]', '17:00');
    await click(m.fixture, q(m.el, '[data-due-save]'));
    await tick(m);

    expect(updateTask).toHaveBeenCalledTimes(1);
    const [id, body] = updateTask.mock.calls[0];
    expect(id).toBe(1042);
    expect(body).toMatchObject({
      rowVersion: 'RV1',
      title: 'Process Smith custodians',
      description: 'Process the custodians.',
      requestorName: 'Jane Roe',
      requestorEmail: 'jane.roe@client.com',
      requestedAtUtc: '2026-10-10T12:00:00Z',
      dueDate: '2026-10-24',
      dueTime: '17:00',
    });
    expect(body.priorityId).toBeUndefined();
    expect(body.formValues).toBeUndefined();
    expect(pop(m.el)).toBeNull();
    expect(q(m.el, '[data-due]')!.textContent).toContain('Oct 24');
    expect(q(m.el, '[data-due]')!.textContent).not.toContain('ASAP');
    expect(q(m.el, '[data-due-live]')!.textContent).toBe('Due date set to Oct 24, 2026 5:00 PM');
    expect(document.activeElement).toBe(trigger(m.el));
  });

  it('clears the due date with one action ("Due date cleared") and sends no date', async () => {
    const task = aTask({
      dueDate: '2026-10-24',
      dueTime: '17:00',
      dueAtUtc: '2026-10-24T21:00:00Z',
    });
    const updateTask = vi.fn().mockReturnValue(of(aTask({ rowVersion: 'RV2' })));
    const m = await mountTaskPage(task, PERMS, { tasks: { updateTask } });
    await open(m);
    expect((q(m.el, '[data-due-popover] mf-date-input input') as HTMLInputElement).value).toContain(
      'Oct 24, 2026',
    );
    await click(m.fixture, q(m.el, '[data-due-clear]'));
    await tick(m);
    const body = updateTask.mock.calls[0][1];
    expect(body.dueDate).toBeUndefined();
    expect(body.dueTime).toBeUndefined();
    expect(q(m.el, '[data-due]')!.textContent).toContain('ASAP');
    expect(q(m.el, '[data-due-live]')!.textContent).toBe('Due date cleared');
  });

  it('makes no request when nothing changed, and blocks a time without a date and text that is not a date', async () => {
    const updateTask = vi.fn();
    const m = await mountTaskPage(aTask(), PERMS, { tasks: { updateTask } });
    await open(m);
    await click(m.fixture, q(m.el, '[data-due-save]'));
    expect(updateTask).not.toHaveBeenCalled();
    expect(pop(m.el)).toBeNull();

    await open(m);
    await type(m, '[data-due-popover] input[type=time]', '09:30');
    await click(m.fixture, q(m.el, '[data-due-save]'));
    expect(q(m.el, '[data-due-error="date"]')!.textContent).toBe('Choose a date for the due time.');

    await type(m, '[data-due-popover] mf-date-input input', 'not a date');
    await click(m.fixture, q(m.el, '[data-due-save]'));
    expect(q(m.el, '[data-due-error="date"]')!.textContent).toContain('Enter a valid date');
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('warns, without blocking, about a date that has passed', async () => {
    const m = await mountTaskPage(aTask(), PERMS);
    await open(m);
    await type(m, '[data-due-popover] mf-date-input input', 'Jan 5, 2020');
    expect(q(m.el, '[data-past-due]')!.textContent).toContain('already passed');
  });

  it('keeps the popover open on a server field error, shows it under the field and puts the cursor on Save', async () => {
    const updateTask = vi
      .fn()
      .mockReturnValue(
        throwError(() => apiError(400, 'VALIDATION', { dueTime: 'Enter a valid time.' })),
      );
    const m = await mountTaskPage(aTask(), PERMS, { tasks: { updateTask } });
    await open(m);
    await type(m, '[data-due-popover] mf-date-input input', 'Oct 24, 2026');
    await click(m.fixture, q(m.el, '[data-due-save]'));
    await tick(m);
    expect(pop(m.el)).not.toBeNull();
    expect(q(m.el, '[data-due-error="time"]')!.textContent).toBe('Enter a valid time.');
    expect(document.activeElement).toBe(q(m.el, '[data-due-save]'));
    expect(q(m.el, '[data-due]')!.textContent).toContain('ASAP');
  });

  it('shows another server failure as an alert inside the popover', async () => {
    const updateTask = vi
      .fn()
      .mockReturnValue(throwError(() => apiError(409, 'TASK_NOT_EDITABLE')));
    const m = await mountTaskPage(aTask(), PERMS, { tasks: { updateTask } });
    await open(m);
    await type(m, '[data-due-popover] mf-date-input input', 'Oct 24, 2026');
    await click(m.fixture, q(m.el, '[data-due-save]'));
    await tick(m);
    const alert = q(m.el, '[data-due-message]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('Server says no.');
    expect(document.activeElement).toBe(q(m.el, '[data-due-save]'));
  });

  it('shows the conflict message with Reload inside the popover and reloads the task', async () => {
    const updateTask = vi
      .fn()
      .mockReturnValue(throwError(() => apiError(409, 'CONCURRENCY_CONFLICT')));
    const m = await mountTaskPage(aTask(), PERMS, { tasks: { updateTask } });
    await open(m);
    await type(m, '[data-due-popover] mf-date-input input', 'Oct 24, 2026');
    await click(m.fixture, q(m.el, '[data-due-save]'));
    await tick(m);
    expect(q(m.el, '[data-due-conflict]')!.textContent).toContain('changed by someone else');
    expect(q(m.el, '[data-conflict-banner]')).not.toBeNull();
    const loads = m.fakes.tasks['getTask'].mock.calls.length;
    await click(m.fixture, q(m.el, '[data-due-reload]'));
    await tick(m);
    expect(m.fakes.tasks['getTask'].mock.calls.length).toBe(loads + 1);
    expect(pop(m.el)).toBeNull();
  });

  it('is plain while the Edit dialog is open', async () => {
    const m = await mountTaskPage(aTask(), PERMS);
    m.fixture.debugElement.injector.get(TaskDetailStore).editing.set(true);
    await settle(m.fixture);
    expect(trigger(m.el)).toBeNull();
    expect(q(m.el, '[data-due]')!.textContent).toContain('ASAP');
  });
});
