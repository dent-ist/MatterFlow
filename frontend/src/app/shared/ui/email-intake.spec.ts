import { ComponentFixture, TestBed } from '@angular/core/testing';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { EmailSource, IntakeClient, ParsedEmailResponse } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../testing/org-testing';
import {
  EMAIL_PANEL_STORAGE_KEY,
  EmailIntake,
  EmailPrefill,
  MAX_EMAIL_FILE_BYTES,
} from './email-intake';

type Mock = ReturnType<typeof vi.fn>;

const parsed = (overrides: Partial<ParsedEmailResponse> = {}): ParsedEmailResponse => ({
  subject: 'Production volume 7',
  body: 'Hi team,\n\nPlease prepare the load file.',
  fromName: 'Jane Doe',
  fromEmail: 'jane.doe@example-firm.test',
  sentAt: '2026-10-12T13:15:00+00:00',
  source: EmailSource.Eml,
  warnings: [],
  ...overrides,
});

describe('EmailIntake', () => {
  beforeEach(() => localStorage.removeItem(EMAIL_PANEL_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(EMAIL_PANEL_STORAGE_KEY));

  let api: Record<'parseEmailText' | 'parseEmailFile', Mock>;
  let fixture: ComponentFixture<EmailIntake>;
  let emitted: EmailPrefill[];
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends Element>(selector: string): T => el().querySelector<T>(selector)!;

  async function create(
    permissions: Permission[] = ['Task.Create'],
    inputs: Record<string, unknown> = {},
  ): Promise<void> {
    api = {
      parseEmailText: vi.fn().mockReturnValue(ok(parsed({ source: EmailSource.Text }))),
      parseEmailFile: vi.fn().mockReturnValue(ok(parsed())),
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: IntakeClient, useValue: api },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(EmailIntake);
    // Most tests work inside the panel, so they start it open; the collapsed default has its own tests below.
    for (const [k, v] of Object.entries({ expanded: true, ...inputs })) {
      fixture.componentRef.setInput(k, v);
    }
    emitted = [];
    fixture.componentInstance.prefill.subscribe((p) => emitted.push(p));
    await settle(fixture);
  }

  async function paste(text: string): Promise<void> {
    const box = q<HTMLTextAreaElement>('textarea');
    box.value = text;
    box.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByLabel(el(), 'Fill from pasted text')!.click();
    await settle(fixture);
  }

  async function chooseFile(file: File): Promise<void> {
    const input = q<HTMLInputElement>('input[type=file]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
  }

  function dropEvent(data: Partial<DataTransfer>): Event {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: data });
    return event;
  }

  const editor = (): HTMLElement => q<HTMLElement>('[data-ei-description] [role=textbox]');

  const field = (id: string): HTMLInputElement | HTMLTextAreaElement =>
    q<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);

  it('renders nothing without the Task.Create permission', async () => {
    await create(['Task.View']);

    expect(el().querySelector('[data-email-intake]')).toBeNull();
  });

  it('shows the privacy and privilege notices and the three input paths', async () => {
    await create();

    expect(q('[data-privacy-note]').textContent).toContain(
      'Attachments and the original email are not saved',
    );
    expect(q('[data-privilege-note]').textContent).toContain('Privilege reminder');
    expect(q('[data-dropzone]').textContent).toContain('may not work');
    expect(q('textarea')).toBeTruthy();
    expect(buttonByLabel(el(), 'Choose .eml/.msg file')).toBeTruthy();
    expect(q<HTMLInputElement>('input[type=file]').accept).toBe('.eml,.msg');
  });

  it('keeps the paste button disabled until there is text', async () => {
    await create();

    expect(buttonByLabel(el(), 'Fill from pasted text')!.disabled).toBe(true);
  });

  it('reads pasted text through the API, shows the values for review and emits the edited prefill', async () => {
    await create();
    await paste('From: Jane\nSubject: Production volume 7\n\nbody');

    expect(api.parseEmailText).toHaveBeenCalledWith({
      pastedText: 'From: Jane\nSubject: Production volume 7\n\nbody',
      pastedHtml: undefined,
    });
    expect(field('ei-f-title').value).toBe('Production volume 7');
    expect(editor().innerHTML).toBe('<p>Hi team,</p><p>Please prepare the load file.</p>');
    expect(field('ei-f-name').value).toBe('Jane Doe');
    expect(field('ei-f-email').value).toBe('jane.doe@example-firm.test');
    expect(q('[data-sent]').textContent).toContain('Oct 12, 2026');

    // The user edits a field before applying.
    field('ei-f-title').value = 'Volume 7 load file';
    field('ei-f-title').dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByLabel(el(), 'Fill the task')!.click();
    await settle(fixture);

    expect(emitted).toEqual([
      {
        title: 'Volume 7 load file',
        description: '<p>Hi team,</p><p>Please prepare the load file.</p>',
        requestorName: 'Jane Doe',
        requestorEmail: 'jane.doe@example-firm.test',
        requestedAt: '2026-10-12T13:15:00+00:00',
      },
    ]);
    expect(q('[data-done]').textContent).toContain(
      'Filled Title, Description, Requestor name, Requestor email, Sent date.',
    );
  });

  it('uploads a chosen .eml file and reviews the result', async () => {
    await create();
    const file = new File(['From: a@b.test\n\nx'], 'request.eml');

    await chooseFile(file);

    expect(api.parseEmailFile).toHaveBeenCalledTimes(1);
    expect(api.parseEmailFile.mock.calls[0][0]).toEqual({ data: file, fileName: 'request.eml' });
    expect(field('ei-f-title').value).toBe('Production volume 7');
  });

  it('shows a loading state while the server reads the email', async () => {
    await create();
    let release!: (value: ParsedEmailResponse) => void;
    api.parseEmailFile.mockReturnValue({
      subscribe: (observer: { next: (v: ParsedEmailResponse) => void; complete: () => void }) => {
        release = (v) => {
          observer.next(v);
          observer.complete();
        };
        return { unsubscribe: () => undefined };
      },
    });

    void chooseFile(new File(['x'], 'a.msg'));
    await settle(fixture);
    expect(q('[data-loading]').textContent).toContain('Reading the email');
    expect(q('[aria-busy=true]')).toBeTruthy();
    expect(buttonByLabel(el(), 'Choose .eml/.msg file')!.disabled).toBe(true);

    release(parsed());
    await settle(fixture);
    expect(el().querySelector('[data-loading]')).toBeNull();
    expect(q('[data-review]')).toBeTruthy();
  });

  it('rejects other file types and oversized or empty files without calling the API', async () => {
    await create();

    await chooseFile(new File(['x'], 'notes.pdf'));
    expect(q('[data-error]').textContent).toContain('Choose a .eml or .msg file');

    await chooseFile(new File([new Uint8Array(MAX_EMAIL_FILE_BYTES + 1)], 'big.eml'));
    expect(q('[data-error]').textContent).toContain('larger than 10 MB');

    await chooseFile(new File([], 'empty.eml'));
    expect(q('[data-error]').textContent).toContain('empty');

    expect(api.parseEmailFile).not.toHaveBeenCalled();
  });

  it('shows the server problem message and keeps paste available after a failure', async () => {
    await create();
    api.parseEmailFile.mockReturnValue(
      apiError(400, {
        status: 400,
        code: 'EMAIL_PARSE_FAILED',
        detail: 'The email could not be read. Paste the email text instead.',
      }),
    );

    await chooseFile(new File(['x'], 'broken.eml'));

    const alert = q('[data-error]');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('Paste the email text instead');
    expect(q('textarea')).toBeTruthy();
    expect(q<HTMLInputElement>('input[type=file]')).toBeTruthy();
  });

  it('explains a network failure', async () => {
    await create();
    api.parseEmailText.mockReturnValue(apiError(0, {}));

    await paste('some text');

    expect(q('[data-error]').textContent).toContain("couldn't reach the server");
  });

  it('shows an empty state when nothing could be found', async () => {
    await create();
    api.parseEmailText.mockReturnValue(
      ok(parsed({ subject: '', body: '', fromName: '', fromEmail: '', sentAt: undefined })),
    );

    await paste('???');

    expect(q('[data-empty]').textContent).toContain("couldn't find a subject, sender or body");
    expect(q('[data-sent]').textContent).toContain('not found');
  });

  it('shows server warnings in the review', async () => {
    await create();
    api.parseEmailText.mockReturnValue(
      ok(parsed({ warnings: ['The sent date could not be read.'] })),
    );

    await paste('x');

    expect(q('[data-warning]').textContent).toContain('sent date could not be read');
  });

  it('guesses the requestor name from the address and flags it for confirmation', async () => {
    await create();
    api.parseEmailText.mockReturnValue(ok(parsed({ fromName: '', fromEmail: 'jane.doe@x.test' })));

    await paste('x');

    expect(field('ei-f-name').value).toBe('jane.doe');
    expect(el().textContent).toContain('Please confirm the name.');
  });

  it('defaults to Keep for fields the form already holds and omits them from the prefill', async () => {
    await create(['Task.Create'], { existing: { title: 'My own title', requestorName: 'Dana' } });
    await paste('x');

    const box = (key: string) => q<HTMLInputElement>(`[data-replace=${key}]`);
    expect(box('title').checked).toBe(false);
    expect(box('requestorName').checked).toBe(false);
    expect(box('description').checked).toBe(true);
    expect(box('requestorEmail').checked).toBe(true);
    expect(el().textContent).toContain('Replace the current title');

    buttonByLabel(el(), 'Fill the task')!.click();
    await settle(fixture);
    expect(emitted[0].title).toBeUndefined();
    expect(emitted[0].requestorName).toBeUndefined();
    expect(emitted[0].description).toContain('load file');
  });

  it('blocks applying an invalid requestor email', async () => {
    await create();
    await paste('x');

    field('ei-f-email').value = 'not-an-email';
    field('ei-f-email').dispatchEvent(new Event('input'));
    await settle(fixture);

    expect(el().textContent).toContain('Enter a valid email address.');
    expect(buttonByLabel(el(), 'Fill the task')!.disabled).toBe(true);
  });

  it('clears the panel', async () => {
    await create();
    await paste('x');

    buttonByLabel(el(), 'Cancel')!.click();
    await settle(fixture);

    expect(el().querySelector('[data-review]')).toBeNull();
    expect(q<HTMLTextAreaElement>('textarea').value).toBe('');
  });

  describe('drop zone', () => {
    it('uploads a dropped .eml file', async () => {
      await create();
      const file = new File(['x'], 'dropped.eml');

      q('[data-dropzone]').dispatchEvent(dropEvent({ files: [file] as unknown as FileList }));
      await settle(fixture);

      expect(api.parseEmailFile.mock.calls[0][0]).toEqual({ data: file, fileName: 'dropped.eml' });
    });

    it('treats dropped text as pasted text (best effort)', async () => {
      await create();

      q('[data-dropzone]').dispatchEvent(
        dropEvent({
          files: [] as unknown as FileList,
          getData: (type: string) =>
            type === 'text/plain' ? 'Subject: Hi\nFrom: A <a@b.test>' : '',
        }),
      );
      await settle(fixture);

      expect(api.parseEmailText).toHaveBeenCalledWith({
        pastedText: 'Subject: Hi\nFrom: A <a@b.test>',
      });
    });

    it('reads the text of a dropped HTML payload without running scripts', async () => {
      await create();

      q('[data-dropzone]').dispatchEvent(
        dropEvent({
          files: [] as unknown as FileList,
          getData: (type: string) =>
            type === 'text/html' ? '<p>Hello</p><script>window.hacked = true</script>' : '',
        }),
      );
      await settle(fixture);

      expect(api.parseEmailText.mock.calls[0][0].pastedText).toContain('Hello');
      expect((window as unknown as Record<string, unknown>)['hacked']).toBeUndefined();
    });

    it('says what to do instead when the drop carries nothing usable and focuses the paste box', async () => {
      await create();

      q('[data-dropzone]').dispatchEvent(
        dropEvent({ files: [] as unknown as FileList, getData: () => '' }),
      );
      await settle(fixture);

      expect(q('[data-error]').textContent).toContain(
        "We couldn't read that drop. Paste the email text or choose a file instead.",
      );
      expect(document.activeElement).toBe(q('textarea'));
      expect(api.parseEmailText).not.toHaveBeenCalled();
      expect(api.parseEmailFile).not.toHaveBeenCalled();
    });

    it('does not treat a bare dropped URL as email text', async () => {
      await create();

      q('[data-dropzone]').dispatchEvent(
        dropEvent({
          files: [] as unknown as FileList,
          getData: (type: string) =>
            type === 'text/plain' ? 'https://outlook.office.com/mail/x' : '',
        }),
      );
      await settle(fixture);

      expect(q('[data-error]').textContent).toContain("couldn't read that drop");
    });

    it('opens the paste box from the keyboard', async () => {
      await create();

      q('[data-dropzone]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await settle(fixture);

      expect(document.activeElement).toBe(q('textarea'));
    });
  });

  describe('collapsed by default and remembered (UXR-38)', () => {
    const toggle = (): HTMLButtonElement => q<HTMLButtonElement>('[data-email-toggle]');

    it('starts collapsed with a Fill from email button, and opens', async () => {
      await create(['Task.Create'], { expanded: false });

      expect(el().querySelector('textarea')).toBeNull();
      expect(toggle().textContent).toContain('Fill from email');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      toggle().click();
      await settle(fixture);
      expect(el().querySelector('textarea')).toBeTruthy();
      expect(toggle().textContent!.trim()).toBe('Hide');
    });

    it('remembers the last choice in this browser', async () => {
      await create(['Task.Create'], { expanded: false });
      toggle().click();
      await settle(fixture);
      expect(localStorage.getItem(EMAIL_PANEL_STORAGE_KEY)).toBe('1');

      TestBed.resetTestingModule();
      await create(['Task.Create'], { expanded: false });
      expect(el().querySelector('textarea')).toBeTruthy();

      toggle().click(); // hide again
      await settle(fixture);
      expect(localStorage.getItem(EMAIL_PANEL_STORAGE_KEY)).toBe('0');
      TestBed.resetTestingModule();
      await create(['Task.Create'], { expanded: true });
      expect(el().querySelector('textarea')).toBeNull();
    });

    it('still works when storage is blocked', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      try {
        await create(['Task.Create'], { expanded: false });
        expect(el().querySelector('textarea')).toBeNull();
        toggle().click();
        await settle(fixture);
        expect(el().querySelector('textarea')).toBeTruthy();
      } finally {
        spy.mockRestore();
        set.mockRestore();
      }
    });
  });

  describe('rich description (decision R)', () => {
    const table =
      '<p>Please load:</p><table><tbody><tr><td>Smith</td><td>12 GB</td></tr></tbody></table>';

    function pasteWithHtml(box: HTMLTextAreaElement, text: string, html: string): void {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: (type: string) =>
            type === 'text/html' ? html : type === 'text/plain' ? text : '',
        },
      });
      box.dispatchEvent(event);
      // The browser then puts the plain text into the box.
      box.value = text;
      box.dispatchEvent(new Event('input'));
    }

    it('keeps the table of an email in the description and the description editable as rich text', async () => {
      await create();
      api.parseEmailFile.mockReturnValue(ok(parsed({ bodyHtml: table })));
      await chooseFile(new File(['From: a@b.test\n\nx'], 'request.eml'));

      expect(editor().querySelector('table')).not.toBeNull();
      expect(editor().getAttribute('aria-label')).toBe('Description');
      expect(el().textContent).toContain('Formatting and tables from the email are kept');
      expect(q('[data-privilege-note]').textContent).toContain('Privilege reminder');

      buttonByLabel(el(), 'Fill the task')!.click();
      await settle(fixture);
      expect(emitted[0].description).toBe(table);
    });

    it('shows hostile markup in the returned body as nothing (the editor sanitizes again)', async () => {
      await create();
      api.parseEmailFile.mockReturnValue(
        ok(
          parsed({
            bodyHtml:
              '<p onclick="x()">Hi</p><script>window.__eml=1</script><img src=x onerror="window.__eml=2">',
          }),
        ),
      );
      await chooseFile(new File(['x'], 'request.eml'));
      expect(editor().innerHTML).not.toContain('script');
      expect(editor().innerHTML).not.toContain('onclick');
      expect(editor().innerHTML).not.toContain('onerror');
      expect((window as unknown as { __eml?: number }).__eml).toBeUndefined();
    });

    it('falls back to the plain text body as paragraphs when the email has no HTML body', async () => {
      await create();
      api.parseEmailFile.mockReturnValue(
        ok(parsed({ body: 'a <b>x</b>\nb', bodyHtml: undefined })),
      );
      await chooseFile(new File(['x'], 'request.eml'));
      expect(editor().innerHTML).toBe('<p>a &lt;b&gt;x&lt;/b&gt;<br>b</p>');
    });

    it('sends the HTML of a paste into the empty box along with the text', async () => {
      await create();
      const box = q<HTMLTextAreaElement>('textarea');
      pasteWithHtml(box, 'Name\tQty\nDisk\t2', '<table><tr><td>Name</td><td>Qty</td></tr></table>');
      await settle(fixture);
      buttonByLabel(el(), 'Fill from pasted text')!.click();
      await settle(fixture);

      expect(api.parseEmailText).toHaveBeenCalledWith({
        pastedText: 'Name\tQty\nDisk\t2',
        pastedHtml: '<table><tr><td>Name</td><td>Qty</td></tr></table>',
      });
    });

    it('does not send HTML once the text in the box was edited or when the paste went into text that was already there', async () => {
      await create();
      const box = q<HTMLTextAreaElement>('textarea');
      pasteWithHtml(box, 'pasted', '<p>pasted</p>');
      box.value = 'pasted and edited';
      box.dispatchEvent(new Event('input'));
      await settle(fixture);
      buttonByLabel(el(), 'Fill from pasted text')!.click();
      await settle(fixture);
      expect(api.parseEmailText.mock.calls[0][0].pastedHtml).toBeUndefined();

      // A second paste into a box that already holds text cannot be matched with its HTML.
      const again = q<HTMLTextAreaElement>('textarea');
      again.value = 'existing text';
      again.dispatchEvent(new Event('input'));
      pasteWithHtml(again, 'existing textmore', '<p>more</p>');
      await settle(fixture);
      expect(again.value).toBe('existing textmore');
    });
  });
});
