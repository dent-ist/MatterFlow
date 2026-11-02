import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatterAiAllowed } from '../../../api/generated/api-client';
import { AI_FLAGS } from './ai-flags';
import { AI_OFF_MESSAGE, AiButton, AiComingSoon, AiWarningDialog } from './ai-assist';

@Component({
  imports: [AiButton, AiComingSoon, AiWarningDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-ai-button [allowed]="allowed()" (pressed)="soon.set(true)" />
    <mf-ai-coming-soon [(visible)]="soon" />
    <mf-ai-warning-dialog
      [reasons]="['Mentions a client outside the matter']"
      [(visible)]="warn"
      (saveAnyway)="log.push('anyway')"
    />`,
})
class Host {
  readonly allowed = signal<MatterAiAllowed>(MatterAiAllowed.CompanyApproved);
  readonly soon = signal(false);
  readonly warn = signal(false);
  readonly log: string[] = [];
}

describe('AI placeholder (MD-16, #1017)', () => {
  async function start() {
    const f = TestBed.createComponent(Host);
    await f.whenStable();
    f.detectChanges();
    return f;
  }
  const q = (s: string) => document.body.querySelector<HTMLElement>(s);

  it('the policy check flag is OFF by default', () => {
    expect(TestBed.inject(AI_FLAGS).aiPolicyCheck).toBe(false);
  });

  it('opens the coming-soon panel when AI is allowed', async () => {
    const f = await start();
    expect(q('[data-ai-button]')!.textContent).toContain('soon');
    q('[data-ai-button]')!.click();
    f.detectChanges();
    await f.whenStable();
    expect(q('[data-ai-soon]')!.textContent).toContain('coming soon');
  });

  it('is disabled with the message when AI allowed is No and does nothing', async () => {
    const f = await start();
    f.componentInstance.allowed.set(MatterAiAllowed.No);
    f.detectChanges();
    const b = q('[data-ai-button]')!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(q('[data-ai-off-note]')!.textContent).toBe(AI_OFF_MESSAGE);
    b.click();
    f.detectChanges();
    expect(f.componentInstance.soon()).toBe(false);
  });

  it('the warning dialog lists the reasons and offers Edit (left) and Save anyway (right)', async () => {
    const f = await start();
    f.componentInstance.warn.set(true);
    f.detectChanges();
    await f.whenStable();
    expect(q('[data-ai-warning-reasons]')!.textContent).toContain('outside the matter');
    const buttons = Array.from(document.body.querySelectorAll('.p-dialog-footer button')).map((b) =>
      b.textContent!.trim(),
    );
    expect(buttons).toEqual(['Edit', 'Save anyway']);
  });
});
