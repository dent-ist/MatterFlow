import { ChangeDetectionStrategy, Component } from '@angular/core';
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
