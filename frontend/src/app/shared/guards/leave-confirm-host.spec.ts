import { TestBed } from '@angular/core/testing';
import { LeaveConfirmHost } from './leave-confirm-host';
import { LeaveConfirmService } from './unsaved-changes.guard';

describe('LeaveConfirmHost wording (D-31, #1246)', () => {
  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach((n) => n.remove()));

  it('asks "Unsaved Changes" - "You have unsaved changes. Discard them?" with [Keep Editing] [Discard Changes]', async () => {
    const fixture = TestBed.createComponent(LeaveConfirmHost);
    const answer = TestBed.inject(LeaveConfirmService).ask();
    await fixture.whenStable();
    fixture.detectChanges();
    const dialog = document.body.querySelector<HTMLElement>('.p-dialog')!;
    expect(dialog.querySelector('.p-dialog-title')?.textContent?.trim()).toBe('Unsaved Changes');
    expect(dialog.querySelector('[data-confirm-body]')?.textContent?.trim()).toBe(
      'You have unsaved changes. Discard them?',
    );
    const buttons = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'),
    );
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Keep Editing', 'Discard Changes']);
    expect(dialog.textContent).not.toMatch(/Stay|Leave|lost if you/);
    buttons[1].click();
    expect(await answer).toBe(true);
  });
});
