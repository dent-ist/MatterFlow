import { TestBed } from '@angular/core/testing';

vi.setConfig({ testTimeout: 60000 });
import { By } from '@angular/platform-browser';
import { Dialog } from 'primeng/dialog';
import { of } from 'rxjs';
import { apiError, settle } from '../../../shared/testing/org-testing';
import { UsersLookupClient } from '../../../api/generated/api-client';
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

  it('shows the read view in the panel and the request form values; the locked fields and their explanation come with the form', async () => {
    const { fixture, el } = await mountTaskPage(
      aTask({ formVersionId: 3, formVersionNo: 3, formValues: { ocr: true, language: 'English' } }),
      ['Task.View', 'Task.Edit'],
      { forms: { getFormVersionSchema: vi.fn().mockReturnValue(of(schema)) } },
    );

    const view = q(el, '[data-view]')!.textContent!;
    expect(q(el, '[data-description]')!.textContent).toContain('Process the custodians.');
    // Created (and Last updated, when the task was changed) share one row.
    expect(q(el, '.dt__pair')!.textContent).toContain('Created');
    // Edit is an icon button in the corner, named for screen readers.
    expect(q(el, '[data-edit-details]')!.getAttribute('aria-label')).toBe('Edit details');
    expect(q(el, '[data-edit-details]')!.textContent!.trim()).toBe('');
    expect(view).toContain('Jane Roe');
    // Task type, Pod and Due are in the header (the context line and the facts strip), not in the panel again (#297).
    expect(view).not.toContain('Data Processing');
    expect(view).not.toContain('Task type');
    expect(q(el, '[data-view] a[href="mailto:jane.roe@client.com"]')).not.toBeNull();
    expect(q(el, '[data-request-form]')!.textContent).toContain('form version 3');
    expect(q(el, '[data-request-form]')!.textContent).toContain('English');
    expect(q(el, '[data-locked-fields]')).toBeNull();

    await click(fixture, q(el, '[data-edit-details]'));
    const locked = q(document.body, '[data-locked-fields]')!.textContent!;
    expect(locked).toContain('Data Processing');
    expect(locked).toContain('Standard Processing v2');
    expect(locked).toContain('00343-00012');
    expect(q(document.body, '[data-lock-text]')!.textContent).toContain(
      "Can't be changed after creation",
    );
  });

  it('shows the description in the rich-text container (mf-rich) so wide tables scroll inside their own box', async () => {
    const { el } = await mountTaskPage(aTask({ description: 'a | b | c' }), ['Task.View']);
    const dd = q(el, '[data-description]')!;
    expect(dd.classList).toContain('mf-rich');
    expect(dd.textContent).toContain('a | b | c');
  });

  describe('rich text description (decision R)', () => {
    const html =
      '<p>Please load:</p><table><thead><tr><th scope="col">Custodian</th><th scope="col">Size</th></tr></thead><tbody><tr><td>Smith</td><td colspan="2">12 GB</td></tr></tbody></table><p><a href="https://example.com/doc">doc</a></p>';

    it('shows a saved table as a table inside the mf-rich box, with links opening in a new tab and showing their host', async () => {
      const { el } = await mountTaskPage(aTask({ description: html, descriptionFormat: 'HTML' }), [
        'Task.View',
      ]);
      const box = q(el, '[data-description]')!;
      expect(box.getAttribute('data-format')).toBe('HTML');
      expect(box.classList).toContain('mf-rich');
      expect(box.querySelectorAll('table').length).toBe(1);
      expect(box.querySelectorAll('thead th[scope=col]').length).toBe(2);
      expect(box.querySelector('td[colspan="2"]')?.textContent).toBe('12 GB');
      const link = box.querySelector('a')!;
      expect(link.getAttribute('target')).toBe('_blank');
      expect(box.textContent).toContain('(example.com)');
    });

    it("never renders script, handlers or styles even if they were in the stored value (Angular's own sanitizer as defence in depth)", async () => {
      const { el } = await mountTaskPage(
        aTask({
          description:
            '<p onclick="x()" style="position:fixed">Hi</p><script>window.__pwn=1</script><img src=x onerror="window.__pwn=2"><table><tr><td onmouseover="x()">c</td></tr></table>',
          descriptionFormat: 'HTML',
        }),
        ['Task.View'],
      );
      const box = q(el, '[data-description]')!;
      expect(box.innerHTML).not.toContain('script');
      expect(box.innerHTML).not.toContain('onclick');
      expect(box.innerHTML).not.toContain('onmouseover');
      expect(box.innerHTML).not.toContain('style=');
      expect(box.innerHTML).not.toContain('<img');
      expect(box.innerHTML).not.toContain('onerror');
      expect(box.querySelector('td')?.textContent).toBe('c');
      expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
    });

    it('shows a description saved as text escaped, with its line breaks, never as markup', async () => {
      const { el } = await mountTaskPage(
        aTask({
          description: 'Line 1\nLine <b>2</b> & <script>x</script>\n\nSecond',
          descriptionFormat: 'TEXT',
        }),
        ['Task.View'],
      );
      const box = q(el, '[data-description]')!;
      expect(box.querySelectorAll('p').length).toBe(2);
      expect(box.querySelector('br')).not.toBeNull();
      expect(box.querySelector('b')).toBeNull();
      expect(box.querySelector('script')).toBeNull();
      expect(box.textContent).toContain('Line <b>2</b> & <script>x</script>');
    });

    it('edits a saved table in the rich text editor, sends HTML, and sends a text description back unchanged when it was not touched', async () => {
      const saved = aTask({ rowVersion: 'RV2' });
      const { fixture, el, fakes } = await mountTaskPage(
        aTask({ description: html, descriptionFormat: 'HTML' }),
        ['Task.View', 'Task.Edit'],
        { tasks: { updateTask: vi.fn().mockReturnValue(of(saved)) } },
      );
      await click(fixture, q(el, '[data-action="edit"]'));
      const area = q(document.body, '[data-description-editor] [role=textbox]')!;
      expect(area.querySelectorAll('table').length).toBe(1);
      expect(area.getAttribute('aria-label')).toBe('Description');

      area.insertAdjacentHTML('beforeend', '<p>More</p>');
      area.dispatchEvent(new Event('input'));
      await settle(fixture);
      await click(fixture, q(document.body, '[data-save]'));
      const body = fakes.tasks['updateTask'].mock.calls[0][1];
      expect(body.description).toContain('<table>');
      expect(body.description).toContain('<p>More</p>');
    });

    it('does not turn an untouched text description into HTML on save (the server then records no change)', async () => {
      const { fixture, el, fakes } = await mountTaskPage(
        aTask({ description: 'Old text\nsecond line', descriptionFormat: 'TEXT' }),
        ['Task.View', 'Task.Edit'],
        { tasks: { updateTask: vi.fn().mockReturnValue(of(aTask({ rowVersion: 'RV2' }))) } },
      );
      await click(fixture, q(el, '[data-action="edit"]'));
      const area = q(document.body, '[data-description-editor] [role=textbox]')!;
      expect(area.innerHTML).toBe('<p>Old text<br>second line</p>');
      await type(fixture, document.body, '#td-title', 'Only the title changed');
      await click(fixture, q(document.body, '[data-save]'));
      expect(fakes.tasks['updateTask'].mock.calls[0][1].description).toBe('Old text\nsecond line');
    });

    it('sends the edited text as HTML, and nothing when the description was cleared', async () => {
      const { fixture, el, fakes } = await mountTaskPage(
        aTask({ description: 'Old text', descriptionFormat: 'TEXT' }),
        ['Task.View', 'Task.Edit'],
        { tasks: { updateTask: vi.fn().mockReturnValue(of(aTask({ rowVersion: 'RV2' }))) } },
      );
      await click(fixture, q(el, '[data-action="edit"]'));
      const area = q(document.body, '[data-description-editor] [role=textbox]')!;
      area.innerHTML = '<p>New text</p>';
      area.dispatchEvent(new Event('input'));
      await settle(fixture);
      await click(fixture, q(document.body, '[data-save]'));
      expect(fakes.tasks['updateTask'].mock.calls[0][1].description).toBe('<p>New text</p>');

      await click(fixture, q(el, '[data-action="edit"]'));
      const again = q(document.body, '[data-description-editor] [role=textbox]')!;
      again.innerHTML = '<p><br></p>';
      again.dispatchEvent(new Event('input'));
      await settle(fixture);
      await click(fixture, q(document.body, '[data-save]'));
      expect(fakes.tasks['updateTask'].mock.calls[1][1].description).toBeUndefined();
    });

    it('rejects a description over 20000 characters before it is sent', async () => {
      const { fixture, el, fakes } = await mountTaskPage(aTask(), ['Task.View', 'Task.Edit']);
      await click(fixture, q(el, '[data-action="edit"]'));
      const area = q(document.body, '[data-description-editor] [role=textbox]')!;
      area.innerHTML = `<p>${'x'.repeat(20001)}</p>`;
      area.dispatchEvent(new Event('input'));
      await settle(fixture);
      await click(fixture, q(document.body, '[data-save]'));
      expect(q(document.body, '#td-description-error')!.textContent).toContain('20000');
      expect(fakes.tasks['updateTask']).not.toHaveBeenCalled();
    });
  });

  it('Edit details in the panel opens the same form as the header Edit and returns to the page', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    document.body.appendChild(el);
    const open = q(el, '[data-edit-details]') as HTMLElement;
    open.focus();
    await click(fixture, open);
    expect(q(document.body, '[data-edit-form]')).not.toBeNull();
    expect(q(document.body, '.p-dialog [role=dialog], .p-dialog')).not.toBeNull();

    await click(fixture, q(document.body, '[data-cancel]'));
    await new Promise((r) => setTimeout(r, 20));
    expect(q(document.body, '[data-edit-form]')).toBeNull();
    expect(q(el, '[data-view]')).not.toBeNull();
    expect(document.activeElement).toBe(open);
    el.remove();
  });

  it('puts the cursor in the Title when Edit opens, but never takes focus back from a field the person moved to (the Assignee list stayed shut)', async () => {
    const { fixture, el } = await mountTaskPage(aTask());
    document.body.appendChild(el);
    await click(fixture, q(el, '[data-action="edit"]'));
    const waitFor = async (cond: () => boolean): Promise<void> => {
      for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
    };
    await waitFor(() => document.activeElement?.id === 'td-title');
    expect(document.activeElement?.id).toBe('td-title');

    // PrimeNG's own focus-on-show runs after the enter animation (jsdom has none) and takes focus from whatever field the person
    // already moved to; the dialog must leave that to the Title rule above, which yields to a field the person is already in.
    const dialog = fixture.debugElement
      .queryAll(By.directive(Dialog))
      .map((d) => d.componentInstance as Dialog)
      .find((d) => d.header === 'Edit task details')!;
    expect(dialog.focusOnShow).toBe(false);
    const pod = q(document.body, '#td-pod') as HTMLSelectElement;
    pod.focus();
    dialog.onShow.emit({});
    expect(document.activeElement).toBe(pod);
    el.remove();
  });

  it('closed tasks are read only', async () => {
    const { el } = await mountTaskPage(
      aTask({
        status: 'CANCELLED',
        statusLabel: 'Cancelled',
        allowedActions: allowed({ canEdit: false, transitions: [transition('REOPEN')] }),
      }),
    );
    expect(q(el, '[data-action="edit"]')).toBeNull();
    expect(q(el, '[data-closed-banner]')!.textContent).toContain('Reopen it to edit');
    expect(q(el, '[data-readonly-note]')).toBeNull();
  });

  it('edit mode shows inputs for the editable fields only, with the due time labelled with the zone', async () => {
    const { fixture, el } = await mountTaskPage(aTask({ dueDate: '2026-10-30', dueTime: '15:00' }));
    await click(fixture, q(el, '[data-action="edit"]'));

    expect((q(document.body, '#td-title') as HTMLInputElement).value).toBe(
      'Process Smith custodians',
    );
    expect((q(document.body, '#td-due-date') as HTMLInputElement).value).toBe('Oct 30, 2026');
    expect((q(document.body, '#td-due-time') as HTMLInputElement).value).toBe('15:00');
    expect(q(document.body, 'label[for=td-due-time]')!.textContent).toMatch(/Time \(.+\)/);
    expect(q(document.body, '#td-pod')).not.toBeNull();
    // The assignee is chosen with the user picker (any active user), not a list of the Pod's members.
    expect(q(document.body, 'mf-entity-picker')).not.toBeNull();
    // Matter, Task Type and Workflow stay read-only
    expect(q(document.body, '[data-locked-fields]')).not.toBeNull();
    expect(q(document.body, '#td-matter')).toBeNull();
  });

  it('validates required fields before calling the server', async () => {
    const { fixture, el, fakes } = await mountTaskPage(aTask());
    await click(fixture, q(el, '[data-action="edit"]'));
    await type(fixture, document.body, '#td-title', '');
    await type(fixture, document.body, '#td-due-time', '10:00');
    await click(fixture, q(document.body, '[data-save]'));

    expect(q(document.body, '#td-title-error')!.textContent).toContain('Enter a title.');
    expect(q(document.body, '[data-error-summary]')!.textContent).toContain('Enter a title.');
    expect(q(document.body, '#td-title')!.getAttribute('aria-invalid')).toBe('true');
    expect(fakes.tasks['updateTask']).not.toHaveBeenCalled();
  });

  it('groups the dialog into Task, Request details (collapsed, kept mounted) and Assignment, with the Save footer outside the scrolling form', async () => {
    const { fixture, el } = await mountTaskPage(
      aTask({ formVersionId: 3, formVersionNo: 3, formValues: { ocr: true, language: 'English' } }),
      ['Task.View', 'Task.Edit'],
      { forms: { getFormVersionSchema: vi.fn().mockReturnValue(of(schema)) } },
    );
    await click(fixture, q(el, '[data-edit-details]'));
    const body = document.body;
    expect(q(body, '[data-section="task"]')).not.toBeNull();
    expect(q(body, '[data-section="assignment"]')).not.toBeNull();
    const toggle = q(body, '[data-request-toggle]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('2 fields');
    // Collapsed, not removed: the form still holds its fields so it validates and saves.
    expect(q(body, '[data-request-body]')!.hasAttribute('hidden')).toBe(true);
    expect(
      q(body, '[data-request-body] input, [data-request-body] [role=checkbox]'),
    ).not.toBeNull();
    // The footer is the dialog's own footer, outside the form body, and its Save button submits the form.
    const save = q(body, '[data-save]')!;
    expect(q(body, '[data-edit-form]')!.contains(save)).toBe(false);
    expect(save.getAttribute('form')).toBe('td-edit-form');
    await click(fixture, toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(q(body, '[data-request-body]')!.hasAttribute('hidden')).toBe(false);
  });

  it('a Task section error leaves Request details collapsed and puts the cursor in the first invalid field', async () => {
    const { fixture, el } = await mountTaskPage(
      aTask({ formVersionId: 3 }),
      ['Task.View', 'Task.Edit'],
      {
        forms: { getFormVersionSchema: vi.fn().mockReturnValue(of(schema)) },
      },
    );
    await click(fixture, q(el, '[data-edit-details]'));
    await type(fixture, document.body, '#td-title', '');
    await click(fixture, q(document.body, '[data-save]'));
    await new Promise((r) => setTimeout(r, 30));
    expect(q(document.body, '[data-request-toggle]')!.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement?.id).toBe('td-title');
  });

  it('saves with the rowVersion and leaves edit mode', async () => {
    const saved = aTask({ title: 'New title', rowVersion: 'RV2' });
    const { fixture, el, fakes } = await mountTaskPage(aTask(), ['Task.View', 'Task.Edit'], {
      tasks: { updateTask: vi.fn().mockReturnValue(of(saved)) },
    });
    await click(fixture, q(el, '[data-action="edit"]'));
    await type(fixture, document.body, '#td-title', 'New title');
    await type(fixture, document.body, '#td-due-date', '2026-11-02');
    await type(fixture, document.body, '#td-due-time', '09:30');
    await click(fixture, q(document.body, '[data-save]'));

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
    expect(q(document.body, '[data-edit-form]')).toBeNull();
    expect(q(el, '[data-task-header] [data-name]')!.textContent).toBe('New title');
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
    await click(fixture, q(el, '[data-action="edit"]'));
    await click(fixture, q(document.body, '[data-save]'));

    expect(q(document.body, '#td-req-email-error')!.textContent).toContain(
      'That email address looks wrong.',
    );
    expect(q(document.body, '#td-req-email')!.getAttribute('aria-invalid')).toBe('true');
    expect(q(document.body, '[data-error-summary]')!.textContent).toContain(
      'Due date is not valid.',
    );
    expect(q(document.body, '[data-edit-form]')).not.toBeNull();
    expect(q(el, '[data-conflict-banner]')).toBeNull();
  });

  it('shows the conflict banner and keeps the edit when someone else changed the task', async () => {
    const { fixture, el } = await mountTaskPage(aTask(), ['Task.View', 'Task.Edit'], {
      tasks: {
        updateTask: vi.fn().mockReturnValue(apiError(409, { code: 'CONCURRENCY_CONFLICT' })),
      },
    });
    await click(fixture, q(el, '[data-action="edit"]'));
    await type(fixture, document.body, '#td-title', 'Mine');
    await click(fixture, q(document.body, '[data-save]'));

    expect(q(el, '[data-conflict-banner]')).not.toBeNull();
    expect((q(document.body, '#td-title') as HTMLInputElement).value).toBe('Mine');
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
    await click(fixture, q(el, '[data-action="edit"]'));
    expect(fakes.forms.getFormVersionSchema).toHaveBeenCalledWith(3);
    const language = Array.from(
      document.body.querySelectorAll<HTMLInputElement>(
        '.p-dialog mf-dynamic-form input[type=text]',
      ),
    )[0];
    language.value = 'French';
    language.dispatchEvent(new Event('input'));
    await settle(fixture);
    await click(fixture, q(document.body, '[data-save]'));

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
    await click(fixture, q(el, '[data-action="edit"]'));
    const pod = q(document.body, '#td-pod') as HTMLSelectElement;
    pod.value = '';
    pod.dispatchEvent(new Event('change'));
    await settle(fixture);
    await click(fixture, q(document.body, '[data-save]'));

    expect(fakes.tasks['assignTask']).toHaveBeenCalledWith(1042, {
      rowVersion: 'RV2',
      podId: undefined,
      userId: 9,
    });
    expect(q(el, '[data-warning]')!.textContent).toContain("isn't a member of the assigned Pod");
  });

  it('lets a user with Task.Assign pick any active user, as Create Task does (E2E-F2, UAT2-13)', async () => {
    const { fixture, el, fakes } = await mountTaskPage(
      aTask(),
      ['Task.View', 'Task.Edit', 'Task.Assign'],
      {
        tasks: { updateTask: vi.fn().mockReturnValue(of(aTask({ rowVersion: 'RV2' }))) },
      },
    );
    await click(fixture, q(el, '[data-action="edit"]'));
    await click(fixture, q(document.body, '[data-chosen] button'));
    await type(fixture, document.body, '#td-assignee', 'Coll');
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    const lookup = TestBed.inject(UsersLookupClient).lookupUsers as ReturnType<typeof vi.fn>;
    expect(lookup).toHaveBeenCalledWith('Coll', 8);
    const option = q(document.body, '[role=option]')!;
    expect(option.textContent).toContain('Colleague C.');
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);
    await click(fixture, q(document.body, '[data-save]'));

    expect(fakes.tasks['assignTask']).toHaveBeenCalledWith(
      1042,
      expect.objectContaining({ userId: 20 }),
    );
  });

  it('warns, without blocking, when the due date is in the past (UAT2-16)', async () => {
    const { fixture, el } = await mountTaskPage(aTask({ dueDate: '2099-10-30' }));
    await click(fixture, q(el, '[data-action="edit"]'));
    expect(q(document.body, '[data-past-due]')).toBeNull();

    await type(fixture, document.body, '#td-due-date', '2020-01-02');
    expect(q(document.body, '[data-past-due]')!.textContent).toContain('already passed');
    expect((q(document.body, '[data-save]') as HTMLButtonElement).disabled).toBe(false);
  });
});
