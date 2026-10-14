import { TestBed } from '@angular/core/testing';

vi.setConfig({ testTimeout: 60000 });
import { of } from 'rxjs';
import { apiError, settle } from '../../../shared/testing/org-testing';
import { aTask, allowed, click, mountTaskPage, q, transition } from './task-detail-testing';

const type = async (
  fixture: Parameters<typeof settle>[0],
  el: HTMLElement,
  selector: string,
  value: string,
): Promise<void> => {
  const input = q(el, selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
  await settle(fixture);
};

const schema = {
  fields: [
    { key: 'ocr', control: 'CHECKBOX', label: 'Requires OCR?', options: [] },
    { key: 'language', control: 'TEXT', label: 'OCR language', options: [] },
  ],
};

describe('Details tab', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the read view, the locked fields with their explanation and the request form values', async () => {
    const { el } = await mountTaskPage(
      aTask({ formVersionId: 3, formVersionNo: 3, formValues: { ocr: true, language: 'English' } }),
      ['Task.View', 'Task.Edit'],
      { forms: { getFormVersionSchema: vi.fn().mockReturnValue(of(schema)) } },
    );

    const view = q(el, '[data-view]')!.textContent!;
    expect(view).toContain('Process Smith custodians');
    expect(view).toContain('Jane Roe');
    expect(q(el, '[data-view] a[href="mailto:jane.roe@client.com"]')).not.toBeNull();
    expect(q(el, '[data-request-form]')!.textContent).toContain('form version 3');
    expect(q(el, '[data-request-form]')!.textContent).toContain('English');
    const locked = q(el, '[data-locked-fields]')!.textContent!;
    expect(locked).toContain('Data Processing');
    expect(locked).toContain('Standard Processing v2');
    expect(locked).toContain('00343-00012');
    expect(q(el, '[data-lock-text]')!.textContent).toContain("Can't be changed after creation");
  });

  it('closed tasks are read only', async () => {
    const { el } = await mountTaskPage(
      aTask({
        status: 'CANCELLED',
        statusLabel: 'Cancelled',
        allowedActions: allowed({ canEdit: false, transitions: [transition('REOPEN')] }),
      }),
    );
    expect(q(el, '[data-edit-details]')).toBeNull();
    expect(q(el, '[data-readonly-note]')!.textContent).toContain('Reopen it to edit');
  });

  it('edit mode shows inputs for the editable fields only, with the due time labelled with the zone', async () => {
    const { fixture, el } = await mountTaskPage(aTask({ dueDate: '2026-10-30', dueTime: '15:00' }));
    await click(fixture, q(el, '[data-edit-details]'));

    expect((q(el, '#td-title') as HTMLInputElement).value).toBe('Process Smith custodians');
    expect((q(el, '#td-due-date') as HTMLInputElement).value).toBe('2026-10-30');
    expect((q(el, '#td-due-time') as HTMLInputElement).value).toBe('15:00');
    expect(q(el, 'label[for=td-due-time]')!.textContent).toMatch(/Time \(.+\)/);
    expect(q(el, '#td-pod')).not.toBeNull();
    expect(q(el, '#td-assignee')).not.toBeNull();
    // Matter, Task Type and Workflow stay read-only
    expect(q(el, '[data-locked-fields]')).not.toBeNull();
    expect(q(el, '#td-matter')).toBeNull();
  });

  it('validates required fields before calling the server', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await click(fixture, q(el, '[data-edit-details]'));
    await type(fixture, el, '#td-title', '');
    await type(fixture, el, '#td-due-time', '10:00');
    await click(fixture, q(el, '[data-save]'));

    expect(q(el, '#td-title-error')!.textContent).toContain('Enter a title.');
    expect(q(el, '[data-error-summary]')!.textContent).toContain('Enter a title.');
    expect(q(el, '#td-title')!.getAttribute('aria-invalid')).toBe('true');
    expect(fakes.tasks['updateTask']).not.toHaveBeenCalled();
  });

  it('saves with the rowVersion and leaves edit mode', async () => {
    const saved = aTask({ title: 'New title', rowVersion: 'RV2' });
    const { fixture, el, fakes } = await mountTaskPage(aTask(), ['Task.View', 'Task.Edit'], {
      tasks: { updateTask: vi.fn().mockReturnValue(of(saved)) },
    });
    await click(fixture, q(el, '[data-edit-details]'));
    await type(fixture, el, '#td-title', 'New title');
    await type(fixture, el, '#td-due-date', '2026-11-02');
    await type(fixture, el, '#td-due-time', '09:30');
    await click(fixture, q(el, '[data-save]'));

    expect(fakes.tasks['updateTask']).toHaveBeenCalledWith(
      1042,
      expect.objectContaining({
        rowVersion: 'RV1',
        title: 'New title',
        requestorName: 'Jane Roe',
        dueDate: '2026-11-02',
        dueTime: '09:30',
        priorityId: undefined,
      }),
    );
    expect(q(el, '[data-edit-form]')).toBeNull();
    expect(q(el, '[data-task-title]')!.textContent).toBe('New title');
  });

  it('maps server field errors onto the fields and keeps the user in edit mode', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), ['Task.View', 'Task.Edit'], {
      tasks: {
        updateTask: vi.fn().mockReturnValue(
          apiError(400, {
            code: 'VALIDATION_FAILED',
            errors: {
              requestorEmail: [{ code: 'INVALID', message: 'That email address looks wrong.' }],
              dueDate: [{ code: 'INVALID', message: 'Due date is not valid.' }],
            },
          }),
        ),
      },
    });
    await click(fixture, q(el, '[data-edit-details]'));
    await click(fixture, q(el, '[data-save]'));

    expect(q(el, '#td-req-email-error')!.textContent).toContain('That email address looks wrong.');
    expect(q(el, '#td-req-email')!.getAttribute('aria-invalid')).toBe('true');
    expect(q(el, '[data-error-summary]')!.textContent).toContain('Due date is not valid.');
    expect(q(el, '[data-edit-form]')).not.toBeNull();
    expect(q(el, '[data-conflict-banner]')).toBeNull();
  });

  it('shows the conflict banner and keeps the edit when someone else changed the task', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), ['Task.View', 'Task.Edit'], {
      tasks: {
        updateTask: vi.fn().mockReturnValue(apiError(409, { code: 'CONCURRENCY_CONFLICT' })),
      },
    });
    await click(fixture, q(el, '[data-edit-details]'));
    await type(fixture, el, '#td-title', 'Mine');
    await click(fixture, q(el, '[data-save]'));

    expect(q(el, '[data-conflict-banner]')).not.toBeNull();
    expect((q(el, '#td-title') as HTMLInputElement).value).toBe('Mine');
  });

  it('request form values are edited under the stored form version and sent as a patch', async () => {
    const { fixture, el, fakes } = await mountTaskPage(
      aTask({ formVersionId: 3, formVersionNo: 3, formValues: { ocr: true, language: 'English' } }),
      ['Task.View', 'Task.Edit'],
      {
        forms: { getFormVersionSchema: vi.fn().mockReturnValue(of(schema)) },
        tasks: { updateTask: vi.fn().mockReturnValue(of(aTask())) },
      },
    );
    await click(fixture, q(el, '[data-edit-details]'));
    expect(fakes.forms.getFormVersionSchema).toHaveBeenCalledWith(3);
    const language = Array.from(
      el.querySelectorAll<HTMLInputElement>('mf-dynamic-form input[type=text]'),
    )[0];
    language.value = 'French';
    language.dispatchEvent(new Event('input'));
    await settle(fixture);
    await click(fixture, q(el, '[data-save]'));

    const body = fakes.tasks['updateTask'].mock.calls[0][1];
    expect(body.formValues).toEqual({ ocr: true, language: 'French' });
  });

  it('saves a changed assignment with the second call and warns when the user is outside the Pod', async () => {
    const assigned = aTask({ rowVersion: 'RV3', warnings: ['USER_NOT_IN_POD'] });
    const { fixture, el, fakes } = await mountTaskPage(
      aTask(),
      ['Task.View', 'Task.Edit', 'Task.Assign', 'Pod.View', 'User.View'],
      {
        tasks: {
          updateTask: vi.fn().mockReturnValue(of(aTask({ rowVersion: 'RV2' }))),
          assignTask: vi.fn().mockReturnValue(of(assigned)),
        },
      },
    );
    await click(fixture, q(el, '[data-edit-details]'));
    const pod = q(el, '#td-pod') as HTMLSelectElement;
    pod.value = '';
    pod.dispatchEvent(new Event('change'));
    await settle(fixture);
    await click(fixture, q(el, '[data-save]'));

    expect(fakes.tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV2',
      podId: undefined,
      userId: 9,
    });
    expect(q(el, '[data-warning]')!.textContent).toContain("isn't a member of the assigned Pod");
  });
});
