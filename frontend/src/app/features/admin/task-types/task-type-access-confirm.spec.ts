import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccessConfirm } from './task-type-access';
import { AccessDialogKind, TaskTypeAccessConfirm } from './task-type-access-confirm';

const confirm: AccessConfirm = {
  lead: 'This will hide the task type from 61 people.',
  lines: [
    { icon: 'pi-eye-slash', text: '14 open tasks of this type will no longer appear for them.' },
  ],
  closing: 'You can change the access again at any time.',
  danger: false,
};

describe('TaskTypeAccessConfirm (#1402)', () => {
  let fixture: ComponentFixture<TaskTypeAccessConfirm>;
  const dialog = (): HTMLElement | null => document.body.querySelector('.p-dialog');
  const buttons = (): string[] =>
    Array.from(document.body.querySelectorAll('.p-dialog .mf-dlg__buttons button')).map((b) =>
      b.textContent!.trim(),
    );

  async function show(kind: AccessDialogKind, c: AccessConfirm | null = null): Promise<void> {
    fixture = TestBed.createComponent(TaskTypeAccessConfirm);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('confirm', c);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach((n) => n.remove()));

  it('draws nothing while closed', async () => {
    await show('closed');
    expect(dialog()).toBeNull();
  });

  it('says it is checking, with Cancel only', async () => {
    await show('checking');
    expect(dialog()!.textContent).toContain('Save Access Rules');
    expect(dialog()!.querySelector('[data-access-checking]')!.textContent).toContain(
      'Checking who is affected',
    );
    expect(buttons()).toEqual(['Cancel']);
  });

  it('blocks the save when the check failed: Cancel and Retry, and Retry is emitted', async () => {
    await show('error');
    expect(dialog()!.textContent).toContain("Couldn't check who is affected. Nothing was saved.");
    expect(buttons()).toEqual(['Cancel', 'Retry']);
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    document.body
      .querySelector<HTMLButtonElement>(
        '.p-dialog [data-confirm-primary] button, .p-dialog button[data-confirm-primary]',
      )!
      .click();
    expect(retried).toBe(1);
  });

  it('shows the lead, the fact lines and the closing sentence with the confirm named after the title', async () => {
    await show('confirm', confirm);
    expect(dialog()!.querySelector('[data-access-lead]')!.textContent!.trim()).toBe(confirm.lead);
    expect(dialog()!.querySelectorAll('[data-access-lines] li')).toHaveLength(1);
    expect(dialog()!.querySelector('[data-access-closing]')!.textContent).toContain('at any time');
    expect(buttons()).toEqual(['Cancel', 'Save Access Rules']);
    expect(dialog()!.querySelector('.mf-btn--solid')).toBeNull();
  });

  it('uses the solid red confirm and no closing sentence when the caller loses access', async () => {
    await show('confirm', { ...confirm, closing: '', danger: true });
    expect(dialog()!.querySelector('.mf-btn--solid')).not.toBeNull();
    expect(dialog()!.querySelector('[data-access-closing]')).toBeNull();
  });
});
