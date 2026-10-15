import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Button } from 'primeng/button';
import { suppressImplicitAutofocus } from './no-autofocus';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `
    <p-button label="Plain" />
    <p-button label="Wanted" [autofocus]="true" />
  `,
})
class Host {}

describe('suppressImplicitAutofocus (UXR2-09)', () => {
  it('keeps autofocus off every p-button unless it asks for it', async () => {
    suppressImplicitAutofocus();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    );
    expect(buttons.find((b) => b.textContent?.includes('Plain'))!.hasAttribute('autofocus')).toBe(
      false,
    );
    expect(buttons.find((b) => b.textContent?.includes('Wanted'))!.hasAttribute('autofocus')).toBe(
      true,
    );
  });
});
