import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogFocus } from './dialog-focus';

@Component({
  imports: [DialogFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button id="opener" type="button" (click)="open.set(true)">Open</button>
    <div [mfDialogFocus]="open()"></div>`,
})
class Host {
  readonly open = signal(false);
}

describe('DialogFocus', () => {
  const later = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

  it('returns focus to the control that opened the dialog when it closes (UAT2-03)', async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus();

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    await later();

    expect(document.activeElement).toBe(opener);
    fixture.nativeElement.remove();
  });

  it('leaves focus alone when the page already moved it somewhere else', async () => {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    const other = document.createElement('button');
    document.body.appendChild(other);
    opener.focus();

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    fixture.componentInstance.open.set(false);
    other.focus();
    await fixture.whenStable();
    await later();

    expect(document.activeElement).toBe(other);
    other.remove();
    fixture.nativeElement.remove();
  });
});
