import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ToastNoAutofocus } from './toast-no-autofocus';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ToastNoAutofocus],
  template: `<input id="field" />
    <div mfToastNoAutofocus id="host"><button id="close">x</button></div>`,
})
class Host {}

describe('ToastNoAutofocus', () => {
  const setup = async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const q = <T extends HTMLElement>(s: string) => fixture.nativeElement.querySelector(s) as T;
    return { fixture, field: q<HTMLInputElement>('#field'), close: q<HTMLButtonElement>('#close') };
  };

  it('hands focus back when a toast grabs it by itself (autofocus), so a status message never moves focus', async () => {
    const { fixture, field, close } = await setup();
    field.focus();
    close.focus();
    expect(document.activeElement).toBe(field);
    fixture.nativeElement.remove();
  });

  it('lets the person reach the close button with Tab or a click', async () => {
    const { fixture, field, close } = await setup();
    field.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    close.focus();
    expect(document.activeElement).toBe(close);

    field.focus();
    close.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    close.focus();
    expect(document.activeElement).toBe(close);
    fixture.nativeElement.remove();
  });
});
