import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Opened from a table cell that does not wrap (white-space: nowrap is inherited by anything rendered inside it).
  template: `<table>
    <tbody>
      <tr>
        <td style="white-space: nowrap">
          <mf-confirm-dialog title="Put on hold" [visible]="true">
            <p data-text>
              The task stays On Hold until someone resumes it. Workflow steps can't be changed.
            </p>
          </mf-confirm-dialog>
        </td>
      </tr>
    </tbody>
  </table>`,
})
class Host {}

describe('ConfirmDialog', () => {
  it('wraps its text even inside a no-wrap table cell and breaks long references', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    const body = document.body.querySelector<HTMLElement>('[data-confirm-body]')!;
    const style = getComputedStyle(body);
    expect(style.whiteSpace).not.toBe('nowrap');
    expect(style.overflowWrap).toBe('anywhere');
  });
});

@Component({
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-confirm-dialog
    title="Leave without saving?"
    confirmLabel="Leave"
    cancelLabel="Stay"
    [danger]="true"
    [extraLabel]="extra()"
    [visible]="true"
    (confirmed)="log.push('leave')"
    (extra)="log.push('save')"
  >
    <p>Unsaved changes.</p>
  </mf-confirm-dialog>`,
})
class ExtraHost {
  readonly extra = signal('Save draft and leave');
  readonly log: string[] = [];
}

describe('ConfirmDialog extra choice (VP8, #398)', () => {
  const buttons = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button'));

  it('shows Stay, Leave and the primary extra choice in this order, and each says what it is', async () => {
    const fixture = TestBed.createComponent(ExtraHost);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      'Stay',
      'Leave',
      'Save draft and leave',
    ]);
    buttons()[1].click();
    buttons()[2].click();
    expect(fixture.componentInstance.log).toEqual(['leave', 'save']);
  });

  it('without an extra label the dialog has just the two buttons', async () => {
    const fixture = TestBed.createComponent(ExtraHost);
    fixture.componentInstance.extra.set('');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Stay', 'Leave']);
  });
});
