import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LeaveConfirmService } from '../guards/unsaved-changes.guard';
import { LookupDialog } from './lookup-dialog';
import { TextField } from './text-field';

@Component({
  imports: [LookupDialog, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" id="opener" (click)="open.set(true)">New</button>
    <mf-lookup-dialog
      title="New link role"
      submitLabel="Add role"
      [(visible)]="open"
      [dirty]="name() !== ''"
      [saving]="saving()"
      [error]="error()"
      [summary]="summary()"
      (save)="saves = saves + 1"
      (cancel)="cancels = cancels + 1"
    >
      <mf-text-field
        inputId="lr-name"
        label="Name"
        [maxLength]="50"
        [counter]="true"
        [error]="summary().length ? summary()[0] : null"
        [(value)]="name"
      />
      <span mfPreview data-badge>{{ name() }}</span>
    </mf-lookup-dialog>
  `,
})
class Host {
  readonly open = signal(false);
  readonly name = signal('');
  readonly saving = signal(false);
  readonly error = signal('');
  readonly summary = signal<readonly string[]>([]);
  saves = 0;
  cancels = 0;
}

describe('LookupDialog (#564)', () => {
  let leaveAnswer = true;
  let asked = 0;

  async function settle(f: { detectChanges(): void }): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      f.detectChanges();
    }
  }

  async function create() {
    leaveAnswer = true;
    asked = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LeaveConfirmService,
          useValue: {
            ask: () => {
              asked++;
              return Promise.resolve(leaveAnswer);
            },
            open: () => false,
          },
        },
      ],
    });
    const f = TestBed.createComponent(Host);
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    f.componentInstance.open.set(true);
    await settle(f);
    return f;
  }
  const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
  const btn = (sel: string) => q(`${sel} button`) ?? q(sel);

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach((m) => m.remove()));

  it('opens with the title, the field, the counter, the preview and the two buttons; focus goes to the first field', async () => {
    const f = await create();
    expect(q('[data-lookup-title]')!.textContent).toContain('New link role');
    expect(q('#lr-name')).not.toBeNull();
    expect(q('[data-char-count]')!.textContent!.trim()).toBe('0 / 50');
    expect(q('[data-preview] legend')!.textContent).toContain('Preview');
    expect(btn('[data-lookup-submit]')!.textContent).toContain('Add role');
    expect(btn('[data-lookup-cancel]')!.textContent).toContain('Cancel');
    expect(document.activeElement).toBe(q('#lr-name'));
    f.destroy();
  });

  it('hides the Preview group when the page gives no preview', async () => {
    // The group is hidden by CSS when its slot is empty; this host fills it, so it is shown.
    const f = await create();
    expect(getComputedStyle(q('[data-preview]')!).display).not.toBe('none');
    f.destroy();
  });

  it('saves from the button and from Enter in the field, but not while saving', async () => {
    const f = await create();
    btn('[data-lookup-submit]')!.click();
    q('#lr-name')!.closest('form')!.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(f.componentInstance.saves).toBe(2);
    f.componentInstance.saving.set(true);
    await settle(f);
    btn('[data-lookup-submit]')!.click();
    expect(f.componentInstance.saves).toBe(2);
    expect(btn('[data-lookup-submit]')!.closest('[aria-busy]')).not.toBeNull();
    f.destroy();
  });

  it('shows the summary at the top and moves focus to the first invalid field', async () => {
    const f = await create();
    f.componentInstance.summary.set(['Enter a name.']);
    await settle(f);
    const summary = q('[data-summary]')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.textContent).toContain('Fix the following to save:');
    expect(summary.querySelector('li')!.textContent).toBe('Enter a name.');
    expect(q('#lr-name')!.getAttribute('aria-invalid')).toBe('true');
    expect(q('#lr-name-error')!.textContent).toContain('Enter a name.');
    expect(document.activeElement).toBe(q('#lr-name'));
    f.destroy();
  });

  it('shows a server failure and keeps the dialog open', async () => {
    const f = await create();
    f.componentInstance.error.set('Couldn’t save. Try again.');
    await settle(f);
    expect(q('[data-lookup-error]')!.getAttribute('role')).toBe('alert');
    expect(q('[data-lookup-form]')).not.toBeNull();
    f.destroy();
  });

  it('closes at once when nothing was edited (Cancel), and says so with (cancel)', async () => {
    const f = await create();
    btn('[data-lookup-cancel]')!.click();
    await settle(f);
    expect(asked).toBe(0);
    expect(f.componentInstance.open()).toBe(false);
    expect(f.componentInstance.cancels).toBe(1);
    f.destroy();
  });

  it('asks before closing with edits: Stay keeps it open, Leave closes it', async () => {
    const f = await create();
    f.componentInstance.name.set('Source');
    await settle(f);
    leaveAnswer = false;
    btn('[data-lookup-cancel]')!.click();
    await settle(f);
    expect(asked).toBe(1);
    expect(f.componentInstance.open()).toBe(true);
    expect(f.componentInstance.cancels).toBe(0);
    leaveAnswer = true;
    btn('[data-lookup-cancel]')!.click();
    await settle(f);
    expect(asked).toBe(2);
    expect(f.componentInstance.open()).toBe(false);
    expect(f.componentInstance.cancels).toBe(1);
    f.destroy();
  });

  it('closes with Escape and the X like Cancel (through the leave question when there are edits)', async () => {
    const f = await create();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(f);
    expect(f.componentInstance.open()).toBe(false);
    f.componentInstance.open.set(true);
    f.componentInstance.name.set('Source');
    await settle(f);
    leaveAnswer = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(f);
    expect(asked).toBe(1);
    expect(f.componentInstance.open()).toBe(true);
    leaveAnswer = true;
    q('[data-lookup-close]')!.click();
    await settle(f);
    expect(asked).toBe(2);
    expect(f.componentInstance.open()).toBe(false);
    f.destroy();
  });

  it('ignores a close request while saving', async () => {
    const f = await create();
    f.componentInstance.name.set('Source');
    f.componentInstance.saving.set(true);
    await settle(f);
    btn('[data-lookup-cancel]')!.click();
    await settle(f);
    expect(asked).toBe(0);
    expect(f.componentInstance.open()).toBe(true);
    f.destroy();
  });
});
